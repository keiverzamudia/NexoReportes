import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ForecastSalesDaily,
  ForecastSellerActivation,
  ForecastSellerAllocationBasis,
  ForecastSellerAttribution,
  ForecastSellerBilling,
  ForecastSellerClientDetailResponse,
  ForecastSellerClientProductRow,
  ForecastSellerClientRow,
  ForecastSellerCollection,
  ForecastSellerDetailQuery,
  ForecastSellerHistory,
  ForecastSellerNoteRow,
  ForecastSellerProductClientRow,
  ForecastSellerProductClientsResponse,
  ForecastSellerProductRow,
  ForecastSellerProductsResponse,
  ForecastSellerRow,
  ForecastSellersQuery,
  ForecastSellersResponse,
} from '@nexo/contracts';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import { ForecastService } from './forecast.service';
import { allocateGapByHeadroom } from './sellers-gap-plan';
import { allocateByWeight, sharePct } from './sellers-allocation';
import {
  MonthCalendar,
  basisElapsed,
  computeRunRate,
  countWorkingDays,
  isoDay,
  monthCalendar,
  pad2,
  previousMonths,
  roundTo,
  todayInTimeZone,
  workingDayFlags,
} from './sales-run-rate';

// ============================================================
// Vendedor vs Forecast (solo lectura).
//
//  · PORTFOLIO (por defecto): cada cliente pertenece al vendedor que tiene
//    asignado hoy en Profit (`clientes.co_ven`). La cartera se muestra
//    completa, aunque el cliente no haya comprado. Es la foto que responde
//    «¿cada vendedor tiene realmente sus clientes?».
//  · NOTE: la venta se atribuye al vendedor de la nota de entrega
//    (`not_ent.co_ven`), como en la versión anterior. Sirve para comparar
//    quién ejecutó la venta.
//
// En ambos criterios se conserva el cruce: cada vendedor muestra cuánto firmó
// por nota y cada cliente cuánto le facturó otro vendedor.
//
// La meta de la empresa es EXACTAMENTE la del informe «Ventas vs Forecast»
// (`ForecastService.companyTarget`). La cuota de cada vendedor es su
// participación en los kg de los meses cerrados de la ventana (`months`, 6 por
// defecto). La meta del cliente es su participación en la venta histórica de
// su vendedor.
//
// Σ cuotas = 100 % y Σ metas = meta de la empresa (redondeo por mayor
// residuo). Sin histórico se reparte en partes iguales y se marca
// `EQUAL_FALLBACK`; sin meta los porcentajes quedan en `null`.
//
// COBRANZA Y ACTIVACIÓN: además de la venta, el expediente muestra la cobranza
// del mes (fecha de pago vs vencimiento) y la activación de la cartera (nuevos,
// reactivados e inertes). La cobranza se lee de `cobros` + `reng_cob`; la
// actividad, del mismo histórico de notas que alimenta la cuota.
//
// PLAN DE CIERRE (mes en curso): la brecha es `meta − (proyección + cartera
// comprometida)`. Se reparte entre los clientes según su margen real (mejor mes
// de los últimos 12 menos lo esperado), nunca por encima de esa marca. Lo que
// la cartera no puede absorber se devuelve como `closingUncoveredKg`: no se
// inventan kg ni clientes. Todo se calcula en cada consulta a partir de la meta
// viva de Profit, así que si el forecast cambia el reparto sigue cuadrando.
// ============================================================

export const PROFIT_SELLER_PORTFOLIO_SQL = `
SELECT /* nexo:seller_portfolio */
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven,
  RTRIM(ISNULL(v.ven_des, '')) AS ven_des,
  RTRIM(c.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, '')))) AS tipo
FROM dbo.clientes AS c
LEFT JOIN dbo.vendedor AS v ON v.co_ven = c.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE c.inactivo = 0
`;

export const PROFIT_SELLER_MONTHLY_SQL = `
SELECT /* nexo:seller_sales_monthly */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(vn.ven_des, '')) AS ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(vc.ven_des, '')) AS ven_cartera,
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, '')))) AS tipo,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas,
  MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
LEFT JOIN dbo.vendedor AS vn ON vn.co_ven = f.co_ven
LEFT JOIN dbo.vendedor AS vc ON vc.co_ven = c.co_ven
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY
  YEAR(f.fec_emis),
  MONTH(f.fec_emis),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(vn.ven_des, '')),
  RTRIM(ISNULL(c.co_ven, '')),
  RTRIM(ISNULL(vc.ven_des, '')),
  RTRIM(f.co_cli),
  RTRIM(ISNULL(c.cli_des, '')),
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, ''))))
`;

export const PROFIT_SELLER_DAILY_SQL = `
SELECT /* nexo:seller_sales_daily */
  CAST(f.fec_emis AS date) AS fecha,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date), RTRIM(ISNULL(f.co_ven, '')), RTRIM(ISNULL(c.co_ven, ''))
`;

export const PROFIT_SELLER_NAME_SQL = `
SELECT /* nexo:seller_name */
  RTRIM(ven_des) AS ven_des
FROM dbo.vendedor
WHERE RTRIM(co_ven) = @coVen
`;

export const PROFIT_SELLER_PRODUCTS_SQL = `
SELECT /* nexo:seller_products */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(a.uni_venta) AS uni_venta,
  a.uni_relac AS uni_relac,
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas,
  MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (RTRIM(ISNULL(c.co_ven, '')) = @coVen OR RTRIM(ISNULL(f.co_ven, '')) = @coVen)
GROUP BY
  YEAR(f.fec_emis),
  MONTH(f.fec_emis),
  RTRIM(r.co_art),
  RTRIM(a.art_des),
  RTRIM(a.uni_venta),
  a.uni_relac,
  RTRIM(f.co_cli),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(c.co_ven, ''))
`;

// ============================================================
// Detalle contextual del expediente.
//
// Las notas se leen con los MISMOS filtros que PROFIT_SELLER_MONTHLY_SQL
// (anuladas fuera, línea ABA, artículo activo, mismo rango de fechas) para que
// la suma de las notas coincida al kilo con la fila del cliente. Se incluyen
// los dos vendedores de cada nota: el que la firmó (`co_ven_nota`) y el que
// tiene asignado al cliente hoy (`co_ven_cartera`). Así la UI puede separar
// «Tú» / «Otros» sin recalcular reglas.
// ============================================================

const SELLER_CLIENT_MATCH = `(RTRIM(ISNULL(c.co_ven, '')) = @coVen OR RTRIM(ISNULL(f.co_ven, '')) = @coVen)`;

/** Notas individuales del cliente en el mes (una fila por nota). */
export function sellerClientNotesSql(onlyProduct: boolean): string {
  return `
SELECT /* nexo:seller_client_notes */
  CAST(f.fact_num AS varchar(30)) AS nota,
  MAX(f.fec_emis) AS fecha,
  RTRIM(MAX(ISNULL(c.cli_des, ''))) AS cli_des,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(vn.ven_des, '')) AS ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(vc.ven_des, '')) AS ven_cartera,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(*) AS lineas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.vendedor AS vn ON vn.co_ven = f.co_ven
LEFT JOIN dbo.vendedor AS vc ON vc.co_ven = c.co_ven
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND RTRIM(f.co_cli) = @co_cli
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  ${onlyProduct ? 'AND RTRIM(r.co_art) = @co_art' : ''}
  AND ${SELLER_CLIENT_MATCH}
GROUP BY
  CAST(f.fact_num AS varchar(30)),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(vn.ven_des, '')),
  RTRIM(ISNULL(c.co_ven, '')),
  RTRIM(ISNULL(vc.ven_des, ''))
ORDER BY MAX(f.fec_emis) DESC, CAST(f.fact_num AS varchar(30)) DESC
`;
}

/** Productos del cliente en el mes, separados por vendedor de la nota. */
export function sellerClientProductsSql(onlyProduct: boolean): string {
  return `
SELECT /* nexo:seller_client_products */
  RTRIM(r.co_art) AS co_art,
  RTRIM(ISNULL(a.art_des, '')) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(DISTINCT f.fact_num) AS notas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND RTRIM(f.co_cli) = @co_cli
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  ${onlyProduct ? 'AND RTRIM(r.co_art) = @co_art' : ''}
  AND ${SELLER_CLIENT_MATCH}
GROUP BY
  RTRIM(r.co_art),
  RTRIM(ISNULL(a.art_des, '')),
  RTRIM(ISNULL(a.uni_venta, '')),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(c.co_ven, ''))
ORDER BY SUM(r.total_art * ISNULL(a.uni_relac, 1)) DESC, RTRIM(ISNULL(a.art_des, ''))
`;
}

/** Clientes que compraron un producto en el mes (drill-down de Productos). */
export const PROFIT_SELLER_PRODUCT_CLIENTS_SQL = `
SELECT /* nexo:seller_product_clients */
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, '')))) AS tipo,
  RTRIM(ISNULL(a.art_des, '')) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven_nota,
  RTRIM(ISNULL(vn.ven_des, '')) AS ven_nota,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(vc.ven_des, '')) AS ven_cartera,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(DISTINCT f.fact_num) AS notas,
  MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
LEFT JOIN dbo.vendedor AS vn ON vn.co_ven = f.co_ven
LEFT JOIN dbo.vendedor AS vc ON vc.co_ven = c.co_ven
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND RTRIM(r.co_art) = @co_art
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (RTRIM(ISNULL(c.co_ven, '')) = @coVen OR RTRIM(ISNULL(f.co_ven, '')) = @coVen)
GROUP BY
  RTRIM(f.co_cli),
  RTRIM(ISNULL(c.cli_des, '')),
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, '')))),
  RTRIM(ISNULL(a.art_des, '')),
  RTRIM(ISNULL(a.uni_venta, '')),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(vn.ven_des, '')),
  RTRIM(ISNULL(c.co_ven, '')),
  RTRIM(ISNULL(vc.ven_des, ''))
ORDER BY SUM(r.total_art * ISNULL(a.uni_relac, 1)) DESC, RTRIM(ISNULL(c.cli_des, ''))
`;

// ============================================================
// Cobranza del mes por vendedor.
//
// `docum_cc` no expone la fecha de pago; `cobros` (cabecera del recibo) sí.
// `reng_cob` aplica cada recibo a una factura y copia emisión/vencimiento.
// Se comparan la fecha de cobro y el vencimiento de la factura, y se convierte
// el monto a USD con la tasa del documento (igual que el estado de cuenta).
//
// Se devuelven las dos atribuciones posibles (cartera y nota) para que el
// servicio elija después la misma que usa el informe, sin una consulta extra.
// ============================================================
export const PROFIT_SELLER_COLLECTION_SQL = `
SELECT /* nexo:seller_collection */
  RTRIM(ISNULL(cl.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(c.co_ven, '')) AS co_ven_cobro,
  COUNT(*) AS pagos,
  SUM(CASE WHEN c.fec_cob <= rc.fec_venc THEN rc.mont_cob / NULLIF(rc.tasa, 0) ELSE 0 END) AS usd_a_tiempo,
  SUM(CASE WHEN c.fec_cob > rc.fec_venc THEN rc.mont_cob / NULLIF(rc.tasa, 0) ELSE 0 END) AS usd_tarde,
  SUM(rc.mont_cob / NULLIF(rc.tasa, 0)) AS usd_total,
  SUM(DATEDIFF(DAY, rc.fec_emis, c.fec_cob) * (rc.mont_cob / NULLIF(rc.tasa, 0))) AS dias_peso,
  SUM(CASE WHEN c.fec_cob > rc.fec_venc THEN DATEDIFF(DAY, rc.fec_venc, c.fec_cob) * (rc.mont_cob / NULLIF(rc.tasa, 0)) ELSE 0 END) AS atraso_peso,
  SUM(CASE WHEN c.fec_cob <= rc.fec_venc THEN 1 ELSE 0 END) AS pagos_a_tiempo,
  SUM(CASE WHEN c.fec_cob > rc.fec_venc THEN 1 ELSE 0 END) AS pagos_tarde
FROM dbo.cobros AS c
INNER JOIN dbo.reng_cob AS rc ON rc.cob_num = c.cob_num
LEFT JOIN dbo.clientes AS cl ON cl.co_cli = c.co_cli
WHERE c.anulado = 0
  AND c.fec_cob >= @desde
  AND c.fec_cob < @hasta
  AND rc.tp_doc_cob IN ('FACT', 'N/DB', 'AJPM', 'GIRO')
  AND rc.mont_cob > 0
  AND rc.fec_emis IS NOT NULL
  AND rc.fec_venc IS NOT NULL
  AND rc.fec_venc > '1990-01-01'
  AND (rc.moneda LIKE 'US$%' OR rc.moneda LIKE 'USD%')
  AND rc.tasa > 0
GROUP BY RTRIM(ISNULL(cl.co_ven, '')), RTRIM(ISNULL(c.co_ven, ''))
`;

// Vencido pendiente de cobro HOY. Solo se consulta en el mes en curso: el
// saldo de `docum_cc` es vivo y no se puede reconstruir a una fecha pasada.
export const PROFIT_SELLER_OVERDUE_SQL = `
SELECT /* nexo:seller_overdue */
  RTRIM(ISNULL(cl.co_ven, '')) AS co_ven_cartera,
  RTRIM(ISNULL(cc.co_ven, '')) AS co_ven_cobro,
  SUM(cc.saldo / NULLIF(cc.tasa, 0)) AS usd_vencido
FROM dbo.docum_cc AS cc
LEFT JOIN dbo.clientes AS cl ON cl.co_cli = cc.co_cli
WHERE cc.anulado = 0
  AND cc.saldo > 0
  AND cc.tipo_doc IN ('FACT', 'N/DB', 'AJPM', 'GIRO')
  AND (cc.moneda LIKE 'US$%' OR cc.moneda LIKE 'USD%')
  AND cc.tasa > 0
  AND cc.fec_venc IS NOT NULL
  AND cc.fec_venc < CAST(GETDATE() AS date)
GROUP BY RTRIM(ISNULL(cl.co_ven, '')), RTRIM(ISNULL(cc.co_ven, ''))
`;

const BUSINESS_TIME_ZONE = 'America/Caracas';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 40;
// Ventana de capacidad real del plan de cierre: mejor mes de los últimos 12.
// Es independiente de la ventana histórica de la cuota (3/6/12/24).
const PLAN_CAPACITY_MONTHS = 12;
const NO_SELLER = '__sin_vendedor__';
const NO_SELLER_LABEL = 'Sin vendedor';
const NO_CLIENT = '__sin_cliente__';
const NO_CLIENT_LABEL = 'Sin cliente';
// Cuentas internas de Profit: no son personas, pero hoy participan como una
// vendedor más en el reparto. Se marcan en la UI.
const INTERNAL_SELLER_CODES = new Set(['001', '004']);

/**
 * Acceso de la sesión que consulta el informe. `vendedor:view_all` separa al
 * gerente que ve toda la fuerza de ventas de la vendedora que solo ve su
 * cartera (`sellerCode` asignado en Usuarios).
 */
export interface SellerReportAccess {
  isAdmin: boolean;
  permissions: string[];
  sellerCode: string | null;
}

export function hasFullSellerScope(access?: SellerReportAccess | null): boolean {
  if (!access) return true;
  return access.isAdmin || access.permissions.includes('vendedor:view_all');
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

// Normaliza una fecha de SQL Server (Date, ISO o `yyyy-mm-dd hh:mm:ss`).
function isoDayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  const part = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(part) ? part : null;
}

function emptyMetrics() {
  return {
    dailyAvgKg: 0,
    projectedKg: null as number | null,
    attainmentPct: null as number | null,
    projectedAttainmentPct: null as number | null,
    gapKg: null as number | null,
    requiredDailyKg: null as number | null,
    historicalAvgKg: null as number | null,
    vsHistoricalPct: null as number | null,
  };
}

/** Totales en cero (sin datos o sin alcance sobre ninguna cartera). */
function zeroTotals(): ForecastSellersResponse['totals'] {
  return {
    forecastKg: 0,
    actualKg: 0,
    actualUnits: 0,
    ...emptyMetrics(),
    pendingKg: 0,
    expectedKg: 0,
    closingGapKg: 0,
    closingCoveredKg: 0,
    closingUncoveredKg: 0,
    invoiceCount: 0,
    lastInvoiceDate: null,
    sellerCount: 0,
    clientCount: 0,
    assignedClientCount: 0,
    windowClientCount: 0,
    activeClientCount: 0,
    billing: {
      facturadoKg: 0,
      facturadoOwnPortfolioKg: 0,
      facturadoOutsideKg: 0,
      carteraKg: 0,
      carteraByOthersKg: 0,
      carteraByOthersExternalKg: 0,
      carteraByOthersInternalKg: 0,
      carteraByOthersPct: null,
      facturadoClients: 0,
      leakedClients: 0,
      internalClients: 0,
    },
    carteraByOthersHistory: [],
  };
}

interface CollectionAccum {
  onTimeAmount: number;
  lateAmount: number;
  totalAmount: number;
  daysWeight: number;
  lateDaysWeight: number;
  paymentCount: number;
  onTimePaymentCount: number;
  latePaymentCount: number;
}

function emptyCollectionAccum(): CollectionAccum {
  return {
    onTimeAmount: 0,
    lateAmount: 0,
    totalAmount: 0,
    daysWeight: 0,
    lateDaysWeight: 0,
    paymentCount: 0,
    onTimePaymentCount: 0,
    latePaymentCount: 0,
  };
}

function collectionResult(
  accum: CollectionAccum | undefined,
  available: boolean,
  overdueUsd: number | null,
): ForecastSellerCollection {
  const total = accum?.totalAmount ?? 0;
  return {
    available,
    onTimePct: total > 0 ? roundTo(((accum?.onTimeAmount ?? 0) / total) * 100, 1) : null,
    onTimeAmountUsd: roundTo(accum?.onTimeAmount ?? 0, 2),
    lateAmountUsd: roundTo(accum?.lateAmount ?? 0, 2),
    collectedAmountUsd: roundTo(total, 2),
    averageDays: total > 0 ? roundTo((accum?.daysWeight ?? 0) / total, 1) : null,
    averageLateDays:
      (accum?.lateAmount ?? 0) > 0
        ? roundTo((accum?.lateDaysWeight ?? 0) / (accum?.lateAmount ?? 1), 1)
        : null,
    paymentCount: accum?.paymentCount ?? 0,
    onTimePaymentCount: accum?.onTimePaymentCount ?? 0,
    latePaymentCount: accum?.latePaymentCount ?? 0,
    overdueUsd: overdueUsd === null ? null : roundTo(overdueUsd, 2),
  };
}

interface SellerClientAccum {
  code: string;
  name: string;
  customerType: string | null;
  assignedSellerCode: string;
  assignedSellerName: string;
  history: Map<string, number>;
  currentKg: number;
  currentUnits: number;
  currentInvoices: number;
  lastInvoiceDate: string | null;
  otherSellerKg: number;
  otherSellerExternalKg: number;
  otherSellerInternalKg: number;
  /** Código → nombre de cada vendedor que le facturó a este cliente. */
  otherSellers: Map<string, string>;
}

interface SellerAccum {
  code: string;
  name: string;
  history: Map<string, number>;
  clients: Map<string, SellerClientAccum>;
  currentKg: number;
  currentUnits: number;
  currentInvoices: number;
  lastInvoiceDate: string | null;
  daily: Map<number, { kg: number; units: number; invoices: number }>;
  otherSellerKg: number;
  otherExternalKg: number;
  otherInternalKg: number;
  /** Kg de cartera de cada mes cerrado facturados por otros. */
  otherHistory: Map<string, number>;
}

interface CachedSellers {
  at: number;
  data: ForecastSellersResponse;
}

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);
  private readonly cache = new Map<string, CachedSellers>();

  constructor(
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
    private readonly forecast: ForecastService,
  ) {}

  async sellersReport(
    query: ForecastSellersQuery,
    access?: SellerReportAccess | null,
  ): Promise<ForecastSellersResponse> {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    const year = query.year ?? Number(today.slice(0, 4));
    const month = query.month ?? Number(today.slice(5, 7));
    const calendar = monthCalendar({
      year,
      month,
      basis: query.basis,
      includeToday: query.includeToday,
      today,
    });

    const cacheKey = [
      year,
      month,
      query.months,
      query.basis,
      query.includeToday ? 1 : 0,
      query.attribution,
      today,
    ].join('|');
    if (!query.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return this.applyScope(cached.data, access);
    }

    try {
      const data = await this.build(query, calendar);
      this.remember(cacheKey, data);
      return this.applyScope(data, access);
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer las ventas por vendedor de Profit (not_ent/reng_nde): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return this.applyScope(this.empty(calendar, query.attribution), access);
    }
  }

  /**
   * Restringe el informe a la cartera del usuario cuando no tiene
   * `vendedor:view_all`. La fuente se calcula igual (y se cachea) para toda la
   * red; aquí solo se recorta la vista y se recalculan los totales con la fila
   * propia, de modo que la meta y los indicadores también sean «solo míos».
   */
  private applyScope(
    data: ForecastSellersResponse,
    access?: SellerReportAccess | null,
  ): ForecastSellersResponse {
    if (hasFullSellerScope(access)) {
      return { ...data, scope: 'ALL', scopeSellerCode: null };
    }

    const code = (access?.sellerCode ?? '').trim();
    if (!code) {
      return {
        ...data,
        scope: 'UNASSIGNED',
        scopeSellerCode: null,
        sellers: [],
        daily: [],
        totals: zeroTotals(),
      };
    }

    const row = data.sellers.find(
      (seller) => seller.sellerCode.trim().toUpperCase() === code.toUpperCase(),
    );
    if (!row) {
      return {
        ...data,
        scope: 'OWN',
        scopeSellerCode: code,
        sellers: [],
        daily: [],
        totals: zeroTotals(),
      };
    }

    const gap = Math.max(0, row.targetKg - row.expectedKg);
    const covered = Math.min(gap, row.closingPlanKg);
    return {
      ...data,
      scope: 'OWN',
      scopeSellerCode: row.sellerCode,
      sellers: [row],
      daily: row.daily.map((day) => ({
        date: day.date,
        actualKg: day.actualKg,
        actualUnits: 0,
        invoiceCount: day.invoiceCount,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: day.cumulativeKg,
        projectedCumulativeKg: day.projectedCumulativeKg,
        forecastCumulativeKg: day.forecastCumulativeKg,
      })),
      totals: {
        forecastKg: row.targetKg,
        actualKg: row.actualKg,
        actualUnits: row.actualUnits,
        dailyAvgKg: row.dailyAvgKg,
        projectedKg: row.projectedKg,
        attainmentPct: row.attainmentPct,
        projectedAttainmentPct: row.projectedAttainmentPct,
        gapKg: row.gapKg,
        requiredDailyKg: row.requiredDailyKg,
        historicalAvgKg: row.historicalAvgKg,
        vsHistoricalPct: row.vsHistoricalPct,
        pendingKg: row.pendingKg,
        expectedKg: row.expectedKg,
        closingGapKg: data.closingPlanAvailable ? gap : 0,
        closingCoveredKg: data.closingPlanAvailable ? covered : 0,
        closingUncoveredKg: data.closingPlanAvailable ? Math.max(0, gap - covered) : 0,
        invoiceCount: row.invoiceCount,
        lastInvoiceDate: row.lastInvoiceDate,
        sellerCount: 1,
        clientCount: row.clientCount,
        assignedClientCount: row.assignedClientCount,
        windowClientCount: row.windowClientCount,
        activeClientCount: row.activeClientCount,
        billing: row.billing,
        carteraByOthersHistory: row.carteraByOthersHistory,
      },
    };
  }

  /**
   * Productos vendidos por un vendedor. Devuelve el cruce cartera/nota para
   * responder «qué vendió, qué no y por producto» sin cargar el informe
   * completo con todas las combinaciones producto × cliente.
   */
  async sellerProducts(
    sellerCode: string,
    query: ForecastSellersQuery,
  ): Promise<ForecastSellerProductsResponse> {
    const code = sellerCode.trim();
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    const year = query.year ?? Number(today.slice(0, 4));
    const month = query.month ?? Number(today.slice(5, 7));
    const calendar = monthCalendar({
      year,
      month,
      basis: query.basis,
      includeToday: query.includeToday,
      today,
    });
    const reportKey = monthKey(year, month);
    const reportStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [todayYear, todayMonth, todayDay] = calendar.today.split('-').map(Number) as [number, number, number];

    let monthlyHasta = monthEnd;
    if (calendar.status === 'OPEN') {
      monthlyHasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + (query.includeToday ? 1 : 0)));
    } else if (calendar.status === 'FUTURE') {
      monthlyHasta = reportStart;
    }
    const historyMonths = previousMonths(year, month, query.months);
    const historyKeys = new Set(historyMonths.map((entry) => monthKey(entry.year, entry.month)));
    const historyStart = new Date(Date.UTC(year, month - 1 - query.months, 1));

    const [nameRows, productRows] = await Promise.all([
      this.profit
        .selectQuery(PROFIT_SELLER_NAME_SQL, 1, { coVen: code })
        .catch(() => [] as Record<string, unknown>[]),
      this.profit.selectQuery(PROFIT_SELLER_PRODUCTS_SQL, 20000, {
        coVen: code,
        desde: historyStart,
        hasta: monthlyHasta,
      }),
    ]);

    const sellerName = text(nameRows[0]?.ven_des) || code || NO_SELLER_LABEL;

    interface ProductAccum {
      productCode: string;
      description: string;
      uom: string;
      kgPerUom: number | null;
      carteraCurrentKg: number;
      carteraHistoricalKg: number;
      noteCurrentKg: number;
      noteHistoricalKg: number;
      otherCurrentKg: number;
      clients: Set<string>;
      noteClients: Set<string>;
      lastInvoiceDate: string | null;
    }

    const products = new Map<string, ProductAccum>();
    for (const raw of productRows) {
      const rowYear = num(raw.anio);
      const rowMonth = num(raw.mes);
      if (!rowYear || !rowMonth) continue;
      const key = monthKey(rowYear, rowMonth);
      const isCurrent = key === reportKey;
      const isHistory = historyKeys.has(key);
      if (!isCurrent && !isHistory) continue;

      const productCode = text(raw.co_art);
      if (!productCode) continue;
      const kg = num(raw.kg);
      const cartera = text(raw.co_ven_cartera);
      const nota = text(raw.co_ven_nota);
      const clientCode = text(raw.co_cli) || NO_CLIENT;
      const last = isoDayOf(raw.ultima);

      let product = products.get(productCode);
      if (!product) {
        product = {
          productCode,
          description: text(raw.art_des) || productCode,
          uom: text(raw.uni_venta),
          kgPerUom: raw.uni_relac === null || raw.uni_relac === undefined ? null : num(raw.uni_relac),
          carteraCurrentKg: 0,
          carteraHistoricalKg: 0,
          noteCurrentKg: 0,
          noteHistoricalKg: 0,
          otherCurrentKg: 0,
          clients: new Set(),
          noteClients: new Set(),
          lastInvoiceDate: null,
        };
        products.set(productCode, product);
      }

      if (last && (!product.lastInvoiceDate || last > product.lastInvoiceDate)) {
        product.lastInvoiceDate = last;
      }

      if (cartera === code) {
        if (isCurrent) {
          product.carteraCurrentKg += kg;
          if (nota !== code) product.otherCurrentKg += kg;
        } else {
          product.carteraHistoricalKg += kg;
        }
        product.clients.add(clientCode);
      }
      if (nota === code) {
        if (isCurrent) product.noteCurrentKg += kg;
        else product.noteHistoricalKg += kg;
        product.noteClients.add(clientCode);
      }
    }

    const carteraHistoricalTotal = [...products.values()].reduce(
      (acc, product) => acc + product.carteraHistoricalKg,
      0,
    );
    const noteHistoricalTotal = [...products.values()].reduce(
      (acc, product) => acc + product.noteHistoricalKg,
      0,
    );

    const rows: ForecastSellerProductRow[] = [...products.values()]
      .map((product) => ({
        productCode: product.productCode,
        description: product.description,
        uom: product.uom,
        kgPerUom: product.kgPerUom,
        carteraCurrentKg: roundTo(product.carteraCurrentKg),
        carteraHistoricalKg: roundTo(product.carteraHistoricalKg),
        noteCurrentKg: roundTo(product.noteCurrentKg),
        noteHistoricalKg: roundTo(product.noteHistoricalKg),
        otherCurrentKg: roundTo(product.otherCurrentKg),
        clientCount: product.clients.size,
        noteClientCount: product.noteClients.size,
        carteraShareOfSellerPct: sharePct(product.carteraHistoricalKg, carteraHistoricalTotal),
        noteShareOfSellerPct: sharePct(product.noteHistoricalKg, noteHistoricalTotal),
        lastInvoiceDate: product.lastInvoiceDate,
      }))
      .sort(
        (a, b) =>
          b.carteraCurrentKg - a.carteraCurrentKg ||
          b.carteraHistoricalKg - a.carteraHistoricalKg ||
          b.noteCurrentKg - a.noteCurrentKg ||
          a.description.localeCompare(b.description, 'es'),
      );

    return {
      sellerCode: code,
      sellerName,
      attribution: query.attribution,
      months: query.months,
      products: rows,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Ventana del mes del informe para el detalle contextual. Usa el mismo corte
   * que el informe (ayer por defecto, hoy si `includeToday`, mes cerrado
   * completo y mes futuro vacío) para que las notas cuadren con la fila.
   */
  private detailWindow(query: ForecastSellerDetailQuery): {
    year: number;
    month: number;
    calendar: MonthCalendar;
    desde: Date;
    hasta: Date;
  } {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    const year = query.year ?? Number(today.slice(0, 4));
    const month = query.month ?? Number(today.slice(5, 7));
    const calendar = monthCalendar({
      year,
      month,
      basis: query.basis,
      includeToday: query.includeToday,
      today,
    });
    const desde = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [todayYear, todayMonth, todayDay] = calendar.today.split('-').map(Number) as [number, number, number];

    let hasta = monthEnd;
    if (calendar.status === 'OPEN') {
      hasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + (query.includeToday ? 1 : 0)));
    } else if (calendar.status === 'FUTURE') {
      hasta = desde;
    }

    return { year, month, calendar, desde, hasta };
  }

  /**
   * Detalle contextual de un cliente en el expediente: notas individuales y
   * productos del mes. La vista (Facturado / Mi cartera / Facturado por otros)
   * la resuelve la UI; aquí solo se aplican los filtros del informe. Cada nota
   * trae sus dos vendedores (nota y cartera) para poder separar «Tú» / «Otros»
   * y para que los totales coincidan con la fila clicada.
   */
  async clientDetail(
    sellerCodeRaw: string,
    clientCodeRaw: string,
    query: ForecastSellerDetailQuery,
  ): Promise<ForecastSellerClientDetailResponse> {
    const window = this.detailWindow(query);
    const sellerCode = sellerCodeRaw.trim() || NO_SELLER;
    const clientCode = clientCodeRaw.trim();
    const productCode = query.productCode?.trim() || null;
    const sellerCodeResponse = sellerCode === NO_SELLER ? '' : sellerCode;
    const sellerCodeSql = sellerCode === NO_SELLER ? '' : sellerCode;
    const source = this.profit.dialect === 'mssql' ? ('profit' as const) : ('fixtures' as const);

    const empty = (available: boolean, sellerName = sellerCodeResponse || NO_SELLER_LABEL): ForecastSellerClientDetailResponse => ({
      sellerCode: sellerCodeResponse,
      sellerName,
      clientCode,
      clientName: clientCode,
      year: window.year,
      month: window.month,
      basis: query.basis,
      includeToday: query.includeToday,
      attribution: query.attribution,
      productCode,
      notes: [],
      products: [],
      productsAvailable: false,
      totals: {
        allKg: 0,
        allNotes: 0,
        ownKg: 0,
        ownNotes: 0,
        otherKg: 0,
        otherNotes: 0,
        otherExternalKg: 0,
        otherInternalKg: 0,
        lastInvoiceDate: null,
      },
      available,
      source,
    });

    if (!clientCode) return empty(false);

    const params = {
      coVen: sellerCodeSql,
      co_cli: clientCode,
      desde: window.desde,
      hasta: window.hasta,
      ...(productCode ? { co_art: productCode } : {}),
    };

    const [notesRes, productsRes, nameRes] = await Promise.allSettled([
      this.profit.selectQuery(sellerClientNotesSql(Boolean(productCode)), 5000, params),
      this.profit.selectQuery(sellerClientProductsSql(Boolean(productCode)), 5000, params),
      this.profit.selectQuery(PROFIT_SELLER_NAME_SQL, 1, { coVen: sellerCodeSql }),
    ]);

    const notesOk = notesRes.status === 'fulfilled';
    const productsOk = productsRes.status === 'fulfilled';
    const notesRows = notesOk ? notesRes.value : [];
    const productRows = productsOk ? productsRes.value : [];
    if (!notesOk) {
      this.logger.warn(
        `No se pudieron leer las notas del cliente ${clientCode} para el vendedor ${sellerCode}: ${
          notesRes.status === 'rejected' && notesRes.reason instanceof Error
            ? notesRes.reason.message
            : 'error desconocido'
        }`,
      );
    }
    if (!productsOk) {
      this.logger.warn(
        `No se pudieron leer los productos del cliente ${clientCode} para el vendedor ${sellerCode}: ${
          productsRes.status === 'rejected' && productsRes.reason instanceof Error
            ? productsRes.reason.message
            : 'error desconocido'
        }`,
      );
    }

    const sellerName =
      (nameRes.status === 'fulfilled' ? text(nameRes.value[0]?.ven_des) : '') ||
      (sellerCode === NO_SELLER ? NO_SELLER_LABEL : sellerCode);

    const notes: ForecastSellerNoteRow[] = notesRows
      .map((raw) => {
        const noteSeller = text(raw.co_ven_nota) || NO_SELLER;
        const portfolioSeller = text(raw.co_ven_cartera) || NO_SELLER;
        return {
          number: text(raw.nota),
          date: isoDayOf(raw.fecha),
          kg: num(raw.kg),
          units: num(raw.unid),
          lines: Math.trunc(num(raw.lineas)),
          noteSellerCode: noteSeller === NO_SELLER ? '' : noteSeller,
          noteSellerName: text(raw.ven_nota) || (noteSeller === NO_SELLER ? NO_SELLER_LABEL : noteSeller),
          portfolioSellerCode: portfolioSeller === NO_SELLER ? '' : portfolioSeller,
          portfolioSellerName:
            text(raw.ven_cartera) || (portfolioSeller === NO_SELLER ? NO_SELLER_LABEL : portfolioSeller),
          noteSellerInternal: INTERNAL_SELLER_CODES.has(noteSeller),
        };
      })
      .filter((note) => note.number !== '');

    let allKg = 0;
    let ownKg = 0;
    let otherKg = 0;
    let ownNotes = 0;
    let otherNotes = 0;
    let otherExternalKg = 0;
    let otherInternalKg = 0;
    const lastDates: string[] = [];

    for (const note of notes) {
      allKg += note.kg;
      if (note.date) lastDates.push(note.date);
      if (note.noteSellerCode === sellerCodeResponse) {
        ownKg += note.kg;
        ownNotes += 1;
      }
      if (note.portfolioSellerCode === sellerCodeResponse && note.noteSellerCode !== sellerCodeResponse) {
        otherKg += note.kg;
        otherNotes += 1;
        if (note.noteSellerInternal) otherInternalKg += note.kg;
        else otherExternalKg += note.kg;
      }
    }

    interface ClientProductAccum {
      productCode: string;
      description: string;
      uom: string;
      kg: number;
      notes: number;
      ownKg: number;
      ownNotes: number;
      otherKg: number;
      otherNotes: number;
    }

    const productMap = new Map<string, ClientProductAccum>();
    for (const raw of productRows) {
      const code = text(raw.co_art);
      if (!code) continue;
      const noteSeller = text(raw.co_ven_nota) || NO_SELLER;
      const portfolioSeller = text(raw.co_ven_cartera) || NO_SELLER;
      const kg = num(raw.kg);
      const noteCount = Math.trunc(num(raw.notas));

      let product = productMap.get(code);
      if (!product) {
        product = {
          productCode: code,
          description: text(raw.art_des) || code,
          uom: text(raw.uni_venta),
          kg: 0,
          notes: 0,
          ownKg: 0,
          ownNotes: 0,
          otherKg: 0,
          otherNotes: 0,
        };
        productMap.set(code, product);
      }

      product.kg += kg;
      product.notes += noteCount;
      if (noteSeller === sellerCode) {
        product.ownKg += kg;
        product.ownNotes += noteCount;
      }
      if (portfolioSeller === sellerCode && noteSeller !== sellerCode) {
        product.otherKg += kg;
        product.otherNotes += noteCount;
      }
    }

    const products: ForecastSellerClientProductRow[] = [...productMap.values()]
      .map((product) => ({
        productCode: product.productCode,
        description: product.description,
        uom: product.uom,
        kg: roundTo(product.kg),
        notes: product.notes,
        ownKg: roundTo(product.ownKg),
        ownNotes: product.ownNotes,
        otherKg: roundTo(product.otherKg),
        otherNotes: product.otherNotes,
      }))
      .sort((a, b) => b.kg - a.kg || a.description.localeCompare(b.description, 'es'));

    return {
      sellerCode: sellerCodeResponse,
      sellerName,
      clientCode,
      clientName: text(notesRows[0]?.cli_des) || clientCode,
      year: window.year,
      month: window.month,
      basis: query.basis,
      includeToday: query.includeToday,
      attribution: query.attribution,
      productCode,
      notes,
      products,
      productsAvailable: productsOk,
      totals: {
        allKg: roundTo(allKg),
        allNotes: notes.length,
        ownKg: roundTo(ownKg),
        ownNotes,
        otherKg: roundTo(otherKg),
        otherNotes,
        otherExternalKg: roundTo(otherExternalKg),
        otherInternalKg: roundTo(otherInternalKg),
        lastInvoiceDate: lastDates.sort().at(-1) ?? null,
      },
      available: notesOk,
      source,
    };
  }

  /**
   * Clientes que compraron un producto en el mes. Es el drill-down de la
   * pestaña Productos: mismos filtros del informe y separación cartera /
   * firmado por él / otros.
   */
  async productClients(
    sellerCodeRaw: string,
    productCodeRaw: string,
    query: ForecastSellerDetailQuery,
  ): Promise<ForecastSellerProductClientsResponse> {
    const window = this.detailWindow(query);
    const sellerCode = sellerCodeRaw.trim() || NO_SELLER;
    const productCode = productCodeRaw.trim();
    const sellerCodeResponse = sellerCode === NO_SELLER ? '' : sellerCode;
    const sellerCodeSql = sellerCode === NO_SELLER ? '' : sellerCode;
    const source = this.profit.dialect === 'mssql' ? ('profit' as const) : ('fixtures' as const);

    const empty = (available: boolean, sellerName = sellerCodeResponse || NO_SELLER_LABEL): ForecastSellerProductClientsResponse => ({
      sellerCode: sellerCodeResponse,
      sellerName,
      productCode,
      description: productCode,
      uom: '',
      year: window.year,
      month: window.month,
      basis: query.basis,
      includeToday: query.includeToday,
      attribution: query.attribution,
      clients: [],
      totals: {
        carteraKg: 0,
        ownKg: 0,
        otherKg: 0,
        carteraNotes: 0,
        ownNotes: 0,
        clientCount: 0,
        noteClientCount: 0,
        lastInvoiceDate: null,
      },
      available,
      source,
    });

    if (!productCode) return empty(false);

    const [rowsRes, nameRes] = await Promise.allSettled([
      this.profit.selectQuery(PROFIT_SELLER_PRODUCT_CLIENTS_SQL, 5000, {
        coVen: sellerCodeSql,
        co_art: productCode,
        desde: window.desde,
        hasta: window.hasta,
      }),
      this.profit.selectQuery(PROFIT_SELLER_NAME_SQL, 1, { coVen: sellerCodeSql }),
    ]);

    const rowsOk = rowsRes.status === 'fulfilled';
    const rows = rowsOk ? rowsRes.value : [];
    if (!rowsOk) {
      this.logger.warn(
        `No se pudieron leer los clientes del producto ${productCode} para el vendedor ${sellerCode}: ${
          rowsRes.status === 'rejected' && rowsRes.reason instanceof Error
            ? rowsRes.reason.message
            : 'error desconocido'
        }`,
      );
    }

    const sellerName =
      (nameRes.status === 'fulfilled' ? text(nameRes.value[0]?.ven_des) : '') ||
      (sellerCode === NO_SELLER ? NO_SELLER_LABEL : sellerCode);

    interface ProductClientAccum {
      clientCode: string;
      clientName: string;
      customerType: string | null;
      carteraKg: number;
      ownKg: number;
      otherKg: number;
      otherExternalKg: number;
      otherInternalKg: number;
      carteraNotes: number;
      ownNotes: number;
      lastInvoiceDate: string | null;
    }

    const clientMap = new Map<string, ProductClientAccum>();
    for (const raw of rows) {
      const code = text(raw.co_cli) || NO_CLIENT;
      const noteSeller = text(raw.co_ven_nota) || NO_SELLER;
      const portfolioSeller = text(raw.co_ven_cartera) || NO_SELLER;
      const kg = num(raw.kg);
      const noteCount = Math.trunc(num(raw.notas));
      const last = isoDayOf(raw.ultima);

      let client = clientMap.get(code);
      if (!client) {
        client = {
          clientCode: code === NO_CLIENT ? '' : code,
          clientName: text(raw.cli_des) || (code === NO_CLIENT ? NO_CLIENT_LABEL : code),
          customerType: text(raw.tipo) || null,
          carteraKg: 0,
          ownKg: 0,
          otherKg: 0,
          otherExternalKg: 0,
          otherInternalKg: 0,
          carteraNotes: 0,
          ownNotes: 0,
          lastInvoiceDate: null,
        };
        clientMap.set(code, client);
      }

      if (last && (!client.lastInvoiceDate || last > client.lastInvoiceDate)) {
        client.lastInvoiceDate = last;
      }
      if (portfolioSeller === sellerCode) {
        client.carteraKg += kg;
        client.carteraNotes += noteCount;
        if (noteSeller !== sellerCode) {
          client.otherKg += kg;
          if (INTERNAL_SELLER_CODES.has(noteSeller)) client.otherInternalKg += kg;
          else client.otherExternalKg += kg;
        }
      }
      if (noteSeller === sellerCode) {
        client.ownKg += kg;
        client.ownNotes += noteCount;
      }
    }

    const clients: ForecastSellerProductClientRow[] = [...clientMap.values()]
      .map((client) => ({
        clientCode: client.clientCode,
        clientName: client.clientName,
        customerType: client.customerType,
        carteraKg: roundTo(client.carteraKg),
        ownKg: roundTo(client.ownKg),
        otherKg: roundTo(client.otherKg),
        otherExternalKg: roundTo(client.otherExternalKg),
        otherInternalKg: roundTo(client.otherInternalKg),
        carteraNotes: client.carteraNotes,
        ownNotes: client.ownNotes,
        lastInvoiceDate: client.lastInvoiceDate,
      }))
      .sort(
        (a, b) =>
          b.carteraKg - a.carteraKg ||
          b.ownKg - a.ownKg ||
          a.clientName.localeCompare(b.clientName, 'es'),
      );

    const totals = clients.reduce(
      (acc, client) => {
        acc.carteraKg += client.carteraKg;
        acc.ownKg += client.ownKg;
        acc.otherKg += client.otherKg;
        acc.carteraNotes += client.carteraNotes;
        acc.ownNotes += client.ownNotes;
        if (client.carteraKg > 0 || client.carteraNotes > 0) acc.clientCount += 1;
        if (client.ownKg > 0 || client.ownNotes > 0) acc.noteClientCount += 1;
        if (
          client.lastInvoiceDate &&
          (!acc.lastInvoiceDate || client.lastInvoiceDate > acc.lastInvoiceDate)
        ) {
          acc.lastInvoiceDate = client.lastInvoiceDate;
        }
        return acc;
      },
      {
        carteraKg: 0,
        ownKg: 0,
        otherKg: 0,
        carteraNotes: 0,
        ownNotes: 0,
        clientCount: 0,
        noteClientCount: 0,
        lastInvoiceDate: null as string | null,
      },
    );

    return {
      sellerCode: sellerCodeResponse,
      sellerName,
      productCode,
      description: text(rows[0]?.art_des) || productCode,
      uom: text(rows[0]?.uni_venta),
      year: window.year,
      month: window.month,
      basis: query.basis,
      includeToday: query.includeToday,
      attribution: query.attribution,
      clients,
      totals: {
        carteraKg: roundTo(totals.carteraKg),
        ownKg: roundTo(totals.ownKg),
        otherKg: roundTo(totals.otherKg),
        carteraNotes: totals.carteraNotes,
        ownNotes: totals.ownNotes,
        clientCount: totals.clientCount,
        noteClientCount: totals.noteClientCount,
        lastInvoiceDate: totals.lastInvoiceDate,
      },
      available: rowsOk,
      source,
    };
  }

  private async build(query: ForecastSellersQuery, calendar: MonthCalendar): Promise<ForecastSellersResponse> {
    const { year, month } = calendar;
    const reportKey = monthKey(year, month);
    const reportStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [todayYear, todayMonth, todayDay] = calendar.today.split('-').map(Number) as [number, number, number];

    let monthlyHasta = monthEnd;
    let dailyHasta: Date | null = monthEnd;
    if (calendar.status === 'OPEN') {
      monthlyHasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + (query.includeToday ? 1 : 0)));
      // La serie diaria incluye hoy como día parcial (igual que el informe).
      dailyHasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + 1));
    } else if (calendar.status === 'FUTURE') {
      monthlyHasta = reportStart;
      dailyHasta = null;
    }

    const historyMonths = previousMonths(year, month, query.months);
    const historyKeys = new Set(historyMonths.map((entry) => monthKey(entry.year, entry.month)));
    // La misma consulta trae 12 meses: los de la ventana alimentan la cuota y
    // los 12 (meses cerrados) alimentan la capacidad real del plan de cierre.
    const capacityStart = new Date(Date.UTC(year, month - 1 - Math.max(query.months, PLAN_CAPACITY_MONTHS), 1));

    // Ventanas FIJAS de activación (independientes del selector histórico):
    // inerte = sin compra este mes; reactivado = sin compra en 3 meses pero
    // con compra en los 12 previos; nuevo = sin compra en los 12 previos.
    const recent3Keys = new Set(previousMonths(year, month, 3).map((entry) => monthKey(entry.year, entry.month)));
    const recent12Keys = new Set(previousMonths(year, month, 12).map((entry) => monthKey(entry.year, entry.month)));

    // Cobranza del mes: mismo corte que la venta. En un mes cerrado llega
    // hasta el último día; en el mes en curso, hasta el corte (ayer por
    // defecto o hoy si se incluye).
    const collectionStart = reportStart;
    let collectionHasta: Date | null = null;
    if (calendar.status !== 'FUTURE' && calendar.cut) {
      const [cutYear, cutMonth, cutDay] = calendar.cut.split('-').map(Number) as [number, number, number];
      collectionHasta = new Date(Date.UTC(cutYear, cutMonth - 1, cutDay + 1));
    }

    const collectionPromise: Promise<Record<string, unknown>[] | null> = collectionHasta
      ? this.profit
          .selectQuery(PROFIT_SELLER_COLLECTION_SQL, 2000, { desde: collectionStart, hasta: collectionHasta })
          .catch((error: unknown) => {
            this.logger.warn(
              `Cobranza por vendedor no disponible: ${
                error instanceof Error ? error.message : 'error desconocido'
              }`,
            );
            return null;
          })
      : Promise.resolve(null);

    // El vencido vivo solo tiene sentido en el mes en curso.
    const overduePromise: Promise<Record<string, unknown>[] | null> =
      calendar.status === 'OPEN'
        ? this.profit.selectQuery(PROFIT_SELLER_OVERDUE_SQL, 2000).catch((error: unknown) => {
            this.logger.warn(
              `Vencido por vendedor no disponible: ${
                error instanceof Error ? error.message : 'error desconocido'
              }`,
            );
            return null;
          })
        : Promise.resolve(null);

    const dailyPromise = dailyHasta
      ? this.profit
          .selectQuery(PROFIT_SELLER_DAILY_SQL, 4000, { desde: reportStart, hasta: dailyHasta })
          .catch((error: unknown) => {
            // La serie diaria es complementaria: sin ella el informe sigue.
            this.logger.warn(
              `Serie diaria por vendedor no disponible: ${
                error instanceof Error ? error.message : 'error desconocido'
              }`,
            );
            return [] as Record<string, unknown>[];
          })
      : Promise.resolve([] as Record<string, unknown>[]);

    const portfolioPromise = this.profit
      .selectQuery(PROFIT_SELLER_PORTFOLIO_SQL, 20000)
      .catch((error: unknown) => {
        this.logger.warn(
          `No se pudo leer la cartera de clientes de Profit (clientes.co_ven): ${
            error instanceof Error ? error.message : 'error desconocido'
          }`,
        );
        return [] as Record<string, unknown>[];
      });

    const [
      company,
      monthlyRows,
      dailyRows,
      portfolioRows,
      pendingByClient,
      collectionRows,
      overdueRows,
    ] = await Promise.all([
      this.forecast.companyTarget(year, month, calendar.status),
      this.profit.selectQuery(PROFIT_SELLER_MONTHLY_SQL, 40000, { desde: capacityStart, hasta: monthlyHasta }),
      dailyPromise,
      portfolioPromise,
      // La cartera comprometida solo se usa en el mes en curso (plan de cierre).
      calendar.status === 'OPEN'
        ? this.forecast.pendingKgByCustomer(year, month).catch(() => new Map<string, number>())
        : Promise.resolve(new Map<string, number>()),
      collectionPromise,
      overduePromise,
    ]);

    const assignmentAvailable = portfolioRows.length > 0;
    const attribution: ForecastSellerAttribution =
      query.attribution === 'PORTFOLIO' && assignmentAvailable ? 'PORTFOLIO' : 'NOTE';

    // Cobranza por las dos atribuciones. La consulta devuelve ambos códigos de
    // vendedor (cartera y nota) y aquí se elige el mismo criterio del informe.
    const collectionPortfolio = new Map<string, CollectionAccum>();
    const collectionNote = new Map<string, CollectionAccum>();
    const overduePortfolio = new Map<string, number>();
    const overdueNote = new Map<string, number>();

    const addCollection = (
      target: Map<string, CollectionAccum>,
      keyRaw: unknown,
      raw: Record<string, unknown>,
    ) => {
      const key = text(keyRaw) || NO_SELLER;
      const acc = target.get(key) ?? emptyCollectionAccum();
      acc.onTimeAmount += num(raw.usd_a_tiempo);
      acc.lateAmount += num(raw.usd_tarde);
      acc.totalAmount += num(raw.usd_total);
      acc.daysWeight += num(raw.dias_peso);
      acc.lateDaysWeight += num(raw.atraso_peso);
      acc.paymentCount += Math.trunc(num(raw.pagos));
      acc.onTimePaymentCount += Math.trunc(num(raw.pagos_a_tiempo));
      acc.latePaymentCount += Math.trunc(num(raw.pagos_tarde));
      target.set(key, acc);
    };

    for (const raw of collectionRows ?? []) {
      addCollection(collectionPortfolio, raw.co_ven_cartera, raw);
      addCollection(collectionNote, raw.co_ven_cobro, raw);
    }
    for (const raw of overdueRows ?? []) {
      const amount = num(raw.usd_vencido);
      const portfolioKey = text(raw.co_ven_cartera) || NO_SELLER;
      const noteKey = text(raw.co_ven_cobro) || NO_SELLER;
      overduePortfolio.set(portfolioKey, (overduePortfolio.get(portfolioKey) ?? 0) + amount);
      overdueNote.set(noteKey, (overdueNote.get(noteKey) ?? 0) + amount);
    }
    // Un mes futuro no tiene cobros por definición: available=true con cero
    // evita mostrar el aviso de error de Profit.
    const collectionAvailable = calendar.status === 'FUTURE' ? true : collectionRows !== null;
    const chosenCollection = attribution === 'PORTFOLIO' ? collectionPortfolio : collectionNote;
    const chosenOverdue = attribution === 'PORTFOLIO' ? overduePortfolio : overdueNote;

    const portfolioSellers = new Map<string, SellerAccum>();
    const noteSellers = new Map<string, SellerAccum>();
    const companyHistory = new Map<string, number>();
    const portfolioClients = new Set<string>();
    // Conteo por vendedor de la cartera leída en Profit. Se lleva aparte para
    // no mezclarlo con clientes que solo aparecen en las notas (inactivos).
    const portfolioAssignmentCounts = new Map<string, number>();
    // Códigos asignados por vendedor: base exacta de la activación (no incluye
    // clientes inactivos que solo aparecen en una nota).
    const portfolioAssigned = new Map<string, Set<string>>();
    // Actividad previa por cliente para las cuotas de activación.
    const activityByClient = new Map<string, { recent3: boolean; recent12: boolean }>();
    const windowClients = new Set<string>();
    const activeClients = new Set<string>();
    // Capacidad real (plan de cierre): mejor mes de los últimos 12 meses por
    // vendedor + cliente, en paralelo para cartera y nota.
    const carteraCapacity = new Map<string, Map<string, number>>();
    const noteCapacity = new Map<string, Map<string, number>>();

    const addCapacityKg = (
      map: Map<string, Map<string, number>>,
      sellerCode: string,
      clientCode: string,
      month: string,
      kg: number,
    ) => {
      const key = `${sellerCode}\u0000${clientCode}`;
      let byMonth = map.get(key);
      if (!byMonth) {
        byMonth = new Map();
        map.set(key, byMonth);
      }
      byMonth.set(month, (byMonth.get(month) ?? 0) + kg);
    };
    const bestMonthKg = (
      map: Map<string, Map<string, number>>,
      sellerCode: string,
      clientCode: string,
    ): number => {
      const byMonth = map.get(`${sellerCode}\u0000${clientCode}`);
      if (!byMonth) return 0;
      let best = 0;
      for (const kg of byMonth.values()) if (kg > best) best = kg;
      return best;
    };

    const sellerOf = (map: Map<string, SellerAccum>, codeRaw: unknown, nameRaw: unknown): SellerAccum => {
      const code = text(codeRaw) || NO_SELLER;
      const name = text(nameRaw) || (code === NO_SELLER ? NO_SELLER_LABEL : code);
      let seller = map.get(code);
      if (!seller) {
        seller = {
          code,
          name,
          history: new Map(),
          clients: new Map(),
          currentKg: 0,
          currentUnits: 0,
          currentInvoices: 0,
          lastInvoiceDate: null,
          daily: new Map(),
          otherSellerKg: 0,
          otherExternalKg: 0,
          otherInternalKg: 0,
          otherHistory: new Map(),
        };
        map.set(code, seller);
      } else if (!seller.name || seller.name === seller.code) {
        seller.name = name;
      }
      return seller;
    };

    const clientOf = (
      seller: SellerAccum,
      codeRaw: unknown,
      nameRaw: unknown,
      typeRaw: unknown,
      assignedSellerCode: string,
      assignedSellerName: string,
    ): SellerClientAccum => {
      const code = text(codeRaw) || NO_CLIENT;
      const name = text(nameRaw) || (code === NO_CLIENT ? NO_CLIENT_LABEL : code);
      const customerType = text(typeRaw) || null;
      let client = seller.clients.get(code);
      if (!client) {
        client = {
          code,
          name,
          customerType,
          assignedSellerCode,
          assignedSellerName,
          history: new Map(),
          currentKg: 0,
          currentUnits: 0,
          currentInvoices: 0,
          lastInvoiceDate: null,
          otherSellerKg: 0,
          otherSellerExternalKg: 0,
          otherSellerInternalKg: 0,
          otherSellers: new Map(),
        };
        seller.clients.set(code, client);
      } else {
        if (!client.customerType && customerType) client.customerType = customerType;
        if (!client.assignedSellerCode && assignedSellerCode) {
          client.assignedSellerCode = assignedSellerCode;
          client.assignedSellerName = assignedSellerName;
        }
      }
      return client;
    };

    // 1) Cartera completa de Profit: crea vendedores y clientes con cero venta.
    for (const raw of portfolioRows) {
      const sellerCode = text(raw.co_ven) || NO_SELLER;
      const sellerName = text(raw.ven_des) || (sellerCode === NO_SELLER ? NO_SELLER_LABEL : sellerCode);
      const clientCode = text(raw.co_cli) || NO_CLIENT;
      if (clientCode !== NO_CLIENT) portfolioClients.add(clientCode);
      const seller = sellerOf(portfolioSellers, sellerCode, sellerName);
      clientOf(seller, clientCode, raw.cli_des, raw.tipo, sellerCode, sellerName);
      portfolioAssignmentCounts.set(sellerCode, (portfolioAssignmentCounts.get(sellerCode) ?? 0) + 1);
      if (clientCode !== NO_CLIENT) {
        const assigned = portfolioAssigned.get(sellerCode) ?? new Set<string>();
        assigned.add(clientCode);
        portfolioAssigned.set(sellerCode, assigned);
      }
    }

    // 2) Ventas: se acumulan por cartera y por nota al mismo tiempo.
    for (const raw of monthlyRows) {
      const rowYear = num(raw.anio);
      const rowMonth = num(raw.mes);
      if (!rowYear || !rowMonth) continue;
      const key = monthKey(rowYear, rowMonth);

      // Actividad previa (ventanas fijas): se procesa ANTES del filtro de la
      // ventana histórica de la cuota para que «nuevo» y «reactivado» no
      // cambien cuando el usuario elige 3, 6, 12 o 24 meses.
      if (key !== reportKey && recent12Keys.has(key) && num(raw.kg) > 0) {
        const activityClient = text(raw.co_cli) || NO_CLIENT;
        const activity = activityByClient.get(activityClient) ?? { recent3: false, recent12: false };
        activity.recent12 = true;
        if (recent3Keys.has(key)) activity.recent3 = true;
        activityByClient.set(activityClient, activity);
      }

      if (key !== reportKey && !historyKeys.has(key)) continue;

      const carteraCode = text(raw.co_ven_cartera ?? raw.co_ven) || NO_SELLER;
      const carteraName =
        text(raw.ven_cartera ?? raw.ven_des) || (carteraCode === NO_SELLER ? NO_SELLER_LABEL : carteraCode);
      const notaCode = text(raw.co_ven_nota ?? raw.co_ven) || NO_SELLER;
      const notaName = text(raw.ven_nota ?? raw.ven_des) || (notaCode === NO_SELLER ? NO_SELLER_LABEL : notaCode);
      const clientCode = text(raw.co_cli) || NO_CLIENT;
      const kg = num(raw.kg);
      const units = num(raw.unid);
      const invoices = Math.trunc(num(raw.notas));
      const last = isoDayOf(raw.ultima);
      const mismatched = notaCode !== carteraCode;

      // Capacidad demostrada: solo meses cerrados de los últimos 12. Se
      // acumula por mes antes del filtro de la ventana histórica de la cuota.
      if (key !== reportKey && kg > 0) {
        addCapacityKg(carteraCapacity, carteraCode, clientCode, key, kg);
        addCapacityKg(noteCapacity, notaCode, clientCode, key, kg);
      }

      const portfolioSeller = sellerOf(portfolioSellers, carteraCode, carteraName);
      const portfolioClient = clientOf(
        portfolioSeller,
        clientCode,
        raw.cli_des,
        raw.tipo,
        carteraCode,
        carteraName,
      );
      const noteSeller = sellerOf(noteSellers, notaCode, notaName);
      const noteClient = clientOf(noteSeller, clientCode, raw.cli_des, raw.tipo, carteraCode, carteraName);

      if (last && (!portfolioClient.lastInvoiceDate || last > portfolioClient.lastInvoiceDate)) {
        portfolioClient.lastInvoiceDate = last;
      }
      if (last && (!portfolioSeller.lastInvoiceDate || last > portfolioSeller.lastInvoiceDate)) {
        portfolioSeller.lastInvoiceDate = last;
      }
      if (last && (!noteClient.lastInvoiceDate || last > noteClient.lastInvoiceDate)) {
        noteClient.lastInvoiceDate = last;
      }
      if (last && (!noteSeller.lastInvoiceDate || last > noteSeller.lastInvoiceDate)) {
        noteSeller.lastInvoiceDate = last;
      }

      if (key === reportKey) {
        portfolioSeller.currentKg += kg;
        portfolioSeller.currentUnits += units;
        portfolioSeller.currentInvoices += invoices;
        portfolioClient.currentKg += kg;
        portfolioClient.currentUnits += units;
        portfolioClient.currentInvoices += invoices;
        noteSeller.currentKg += kg;
        noteSeller.currentUnits += units;
        noteSeller.currentInvoices += invoices;
        noteClient.currentKg += kg;
        noteClient.currentUnits += units;
        noteClient.currentInvoices += invoices;
        activeClients.add(clientCode);
        windowClients.add(clientCode);
      } else {
        portfolioSeller.history.set(key, (portfolioSeller.history.get(key) ?? 0) + kg);
        portfolioClient.history.set(key, (portfolioClient.history.get(key) ?? 0) + kg);
        noteSeller.history.set(key, (noteSeller.history.get(key) ?? 0) + kg);
        noteClient.history.set(key, (noteClient.history.get(key) ?? 0) + kg);
        companyHistory.set(key, (companyHistory.get(key) ?? 0) + kg);
        windowClients.add(clientCode);
      }

      if (mismatched && key === reportKey) {
        const internal = INTERNAL_SELLER_CODES.has(notaCode);
        portfolioSeller.otherSellerKg += kg;
        portfolioClient.otherSellerKg += kg;
        if (internal) {
          portfolioSeller.otherInternalKg += kg;
          portfolioClient.otherSellerInternalKg += kg;
        } else {
          portfolioSeller.otherExternalKg += kg;
          portfolioClient.otherSellerExternalKg += kg;
        }
        if (notaCode !== NO_SELLER && notaName) portfolioClient.otherSellers.set(notaCode, notaName);
      }

      // Fuga histórica: mismo criterio sobre los meses cerrados de la ventana.
      if (mismatched && key !== reportKey) {
        portfolioSeller.otherHistory.set(key, (portfolioSeller.otherHistory.get(key) ?? 0) + kg);
      }
    }

    // 3) Serie diaria: se arma por cartera y por nota.
    const portfolioDaily = new Map<string, Map<number, { kg: number; units: number; invoices: number }>>();
    const noteDaily = new Map<string, Map<number, { kg: number; units: number; invoices: number }>>();
    const companyByDay = new Map<number, { kg: number; units: number; invoices: number }>();

    const addDaily = (
      map: Map<string, Map<number, { kg: number; units: number; invoices: number }>>,
      code: string,
      dayNumber: number,
      kg: number,
      units: number,
      invoices: number,
    ) => {
      let sellerDaily = map.get(code);
      if (!sellerDaily) {
        sellerDaily = new Map();
        map.set(code, sellerDaily);
      }
      const bucket = sellerDaily.get(dayNumber) ?? { kg: 0, units: 0, invoices: 0 };
      bucket.kg += kg;
      bucket.units += units;
      bucket.invoices += invoices;
      sellerDaily.set(dayNumber, bucket);
    };

    for (const raw of dailyRows) {
      const day = isoDayOf(raw.fecha);
      if (!day) continue;
      const dayNumber = Number(day.slice(8, 10));
      if (!Number.isFinite(dayNumber)) continue;
      const kg = num(raw.kg);
      const units = num(raw.unid);
      const invoices = Math.trunc(num(raw.notas));
      const carteraCode = text(raw.co_ven_cartera ?? raw.co_ven) || NO_SELLER;
      const notaCode = text(raw.co_ven_nota ?? raw.co_ven) || NO_SELLER;

      addDaily(portfolioDaily, carteraCode, dayNumber, kg, units, invoices);
      addDaily(noteDaily, notaCode, dayNumber, kg, units, invoices);

      const companyBucket = companyByDay.get(dayNumber) ?? { kg: 0, units: 0, invoices: 0 };
      companyBucket.kg += kg;
      companyBucket.units += units;
      companyBucket.invoices += invoices;
      companyByDay.set(dayNumber, companyBucket);
    }

    const portfolioSellerList = [...portfolioSellers.values()].filter(
      (seller) => seller.clients.size > 0 || seller.currentKg > 0 || seller.history.size > 0,
    );
    const noteSellerList = [...noteSellers.values()].filter(
      (seller) => seller.currentKg > 0 || seller.history.size > 0,
    );
    // El informe muestra siempre los dos libros: la lista es la unión de los
    // vendedores con cartera y los que firmaron notas. La atribución solo
    // elige la base de la cuota, no a quién se muestra.
    const unionSellers = new Map<string, SellerAccum>();
    for (const seller of portfolioSellerList) unionSellers.set(seller.code, seller);
    for (const seller of noteSellerList) {
      if (!unionSellers.has(seller.code)) unionSellers.set(seller.code, seller);
    }
    const sellerList = [...unionSellers.values()];
    const basisSellerList = attribution === 'PORTFOLIO' ? portfolioSellerList : noteSellerList;
    const chosenDaily = attribution === 'PORTFOLIO' ? portfolioDaily : noteDaily;

    const sumHistory = (seller?: SellerAccum): number =>
      seller ? [...seller.history.values()].reduce((acc, kg) => acc + kg, 0) : 0;
    const totalHistoryOf = (sellers: SellerAccum[]): number =>
      sellers.reduce((acc, seller) => acc + sumHistory(seller), 0);
    const historySeriesOf = (seller?: SellerAccum): ForecastSellerHistory[] =>
      historyMonths.map((entry) => ({
        year: entry.year,
        month: entry.month,
        actualKg: roundTo(seller?.history.get(monthKey(entry.year, entry.month)) ?? 0),
      }));
    const historySeriesFromMap = (map?: Map<string, number>): ForecastSellerHistory[] =>
      historyMonths.map((entry) => ({
        year: entry.year,
        month: entry.month,
        actualKg: roundTo(map?.get(monthKey(entry.year, entry.month)) ?? 0),
      }));
    const weightsOf = (sellers: SellerAccum[]): Map<string, number> => {
      const weights = new Map<string, number>();
      for (const seller of sellers) weights.set(seller.code, sumHistory(seller));
      return weights;
    };
    const basisOf = (sellers: SellerAccum[], total: number): ForecastSellerAllocationBasis =>
      company.totalKg <= 0 || sellers.length === 0
        ? 'NONE'
        : total > 0
          ? 'HISTORY'
          : 'EQUAL_FALLBACK';

    const historyTotal = [...companyHistory.values()].reduce((acc, kg) => acc + kg, 0);
    const portfolioBasis = basisOf(portfolioSellerList, totalHistoryOf(portfolioSellerList));
    const noteBasis = basisOf(noteSellerList, totalHistoryOf(noteSellerList));
    const allocationBasis = attribution === 'PORTFOLIO' ? portfolioBasis : noteBasis;

    const portfolioWeights = weightsOf(portfolioSellerList);
    const noteWeights = weightsOf(noteSellerList);
    const portfolioTargets =
      company.totalKg > 0
        ? allocateByWeight(portfolioWeights, company.totalKg, {
            equalWhenEmpty: portfolioBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();
    const noteTargets =
      company.totalKg > 0
        ? allocateByWeight(noteWeights, company.totalKg, {
            equalWhenEmpty: noteBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();
    const portfolioQuotas =
      company.totalKg > 0
        ? allocateByWeight(portfolioWeights, 100, {
            equalWhenEmpty: portfolioBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();
    const noteQuotas =
      company.totalKg > 0
        ? allocateByWeight(noteWeights, 100, {
            equalWhenEmpty: noteBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();

    const chosenTargets = attribution === 'PORTFOLIO' ? portfolioTargets : noteTargets;
    const chosenQuotas = attribution === 'PORTFOLIO' ? portfolioQuotas : noteQuotas;

    const companyActual = roundTo(basisSellerList.reduce((acc, seller) => acc + seller.currentKg, 0));
    const companyUnits = roundTo(basisSellerList.reduce((acc, seller) => acc + seller.currentUnits, 0));
    const companyInvoices = basisSellerList.reduce((acc, seller) => acc + seller.currentInvoices, 0);
    const companyLastInvoice =
      basisSellerList
        .map((seller) => seller.lastInvoiceDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

    const rows: ForecastSellerRow[] = sellerList.map((seller) => {
      const carteraSeller = portfolioSellers.get(seller.code);
      const noteSeller = noteSellers.get(seller.code);
      const carteraSellerHistory = sumHistory(carteraSeller);
      const noteSellerHistory = sumHistory(noteSeller);
      const chosenSellerHistory = attribution === 'PORTFOLIO' ? carteraSellerHistory : noteSellerHistory;
      const chosenSellerCurrent =
        attribution === 'PORTFOLIO' ? (carteraSeller?.currentKg ?? 0) : (noteSeller?.currentKg ?? 0);
      const targetKg = roundTo(chosenTargets.get(seller.code) ?? 0, 1);
      const chosenQuota = chosenQuotas.get(seller.code) ?? 0;
      const chosenHistory = historySeriesOf(attribution === 'PORTFOLIO' ? carteraSeller : noteSeller);
      const metrics = computeRunRate({
        actualKg: chosenSellerCurrent,
        forecastKg: targetKg,
        calendar,
        history: chosenHistory.map((entry) => entry.actualKg),
      });

      const carteraTargetKg = roundTo(portfolioTargets.get(seller.code) ?? 0, 1);
      const noteTargetKg = roundTo(noteTargets.get(seller.code) ?? 0, 1);
      const carteraQuota = portfolioQuotas.get(seller.code) ?? 0;
      const noteQuota = noteQuotas.get(seller.code) ?? 0;

      const carteraClientWeights = new Map<string, number>();
      for (const client of carteraSeller?.clients.values() ?? []) {
        carteraClientWeights.set(
          client.code,
          [...client.history.values()].reduce((acc, kg) => acc + kg, 0),
        );
      }
      const noteClientWeights = new Map<string, number>();
      for (const client of noteSeller?.clients.values() ?? []) {
        noteClientWeights.set(
          client.code,
          [...client.history.values()].reduce((acc, kg) => acc + kg, 0),
        );
      }
      const carteraClientTargets =
        carteraTargetKg > 0
          ? allocateByWeight(carteraClientWeights, carteraTargetKg, {
              equalWhenEmpty: carteraSellerHistory <= 0,
            })
          : new Map<string, number>();
      const noteClientTargets =
        noteTargetKg > 0
          ? allocateByWeight(noteClientWeights, noteTargetKg, {
              equalWhenEmpty: noteSellerHistory <= 0,
            })
          : new Map<string, number>();
      const carteraClientQuotas =
        carteraTargetKg > 0
          ? allocateByWeight(carteraClientWeights, carteraQuota, {
              equalWhenEmpty: carteraSellerHistory <= 0,
            })
          : new Map<string, number>();
      const noteClientQuotas =
        noteTargetKg > 0
          ? allocateByWeight(noteClientWeights, noteQuota, {
              equalWhenEmpty: noteSellerHistory <= 0,
            })
          : new Map<string, number>();

      const chosenClientTargets = attribution === 'PORTFOLIO' ? carteraClientTargets : noteClientTargets;
      const chosenClientQuotas = attribution === 'PORTFOLIO' ? carteraClientQuotas : noteClientQuotas;

      const clientCodes = new Set<string>();
      for (const code of carteraSeller?.clients.keys() ?? []) clientCodes.add(code);
      for (const code of noteSeller?.clients.keys() ?? []) clientCodes.add(code);

      const clients: ForecastSellerClientRow[] = [...clientCodes]
        .map((code) => {
          const carteraClient = carteraSeller?.clients.get(code);
          const noteClient = noteSeller?.clients.get(code);
          const carteraHistory = carteraClient
            ? [...carteraClient.history.values()].reduce((acc, kg) => acc + kg, 0)
            : 0;
          const carteraCurrent = carteraClient?.currentKg ?? 0;
          const noteHistory = noteClient ? [...noteClient.history.values()].reduce((acc, kg) => acc + kg, 0) : 0;
          const noteCurrent = noteClient?.currentKg ?? 0;
          const chosenClientHistory = attribution === 'PORTFOLIO' ? carteraHistory : noteHistory;
          const chosenClientCurrent = attribution === 'PORTFOLIO' ? carteraCurrent : noteCurrent;
          const baseClient = carteraClient ?? noteClient;
          const assignedCode = carteraClient?.assignedSellerCode ?? noteClient?.assignedSellerCode ?? '';
          const assignedName = carteraClient?.assignedSellerName ?? noteClient?.assignedSellerName ?? '';
          const clientTarget = roundTo(chosenClientTargets.get(code) ?? 0, 1);
          const chosenClientHistorySeries = historyMonths.map((entry) => {
            if (attribution === 'PORTFOLIO') {
              return carteraClient?.history.get(monthKey(entry.year, entry.month)) ?? 0;
            }
            return noteClient?.history.get(monthKey(entry.year, entry.month)) ?? 0;
          });
          const clientMetrics = computeRunRate({
            actualKg: chosenClientCurrent,
            forecastKg: clientTarget,
            calendar,
            history: chosenClientHistorySeries,
          });
          const lastDates = [carteraClient?.lastInvoiceDate, noteClient?.lastInvoiceDate]
            .filter((value): value is string => Boolean(value))
            .sort();
          const otherEntries = [...(carteraClient?.otherSellers ?? new Map<string, string>()).entries()].sort(
            (a, b) => a[1].localeCompare(b[1], 'es'),
          );
          return {
            clientCode: code === NO_CLIENT ? '' : code,
            clientName: baseClient?.name ?? code,
            customerType: baseClient?.customerType ?? null,
            assignedSellerCode: assignedCode === NO_SELLER ? '' : assignedCode,
            assignedSellerName: assignedName,
            otherSellerKg: roundTo(carteraClient?.otherSellerKg ?? 0),
            otherSellerNames: otherEntries.map(([, name]) => name),
            otherSellers: otherEntries.map(([sellerCode, name]) => ({
              code: sellerCode,
              name,
              internal: INTERNAL_SELLER_CODES.has(sellerCode),
            })),
            otherSellerExternalKg: roundTo(carteraClient?.otherSellerExternalKg ?? 0),
            otherSellerInternalKg: roundTo(carteraClient?.otherSellerInternalKg ?? 0),
            carteraHistoricalKg: roundTo(carteraHistory),
            carteraCurrentKg: roundTo(carteraCurrent),
            carteraTargetKg: roundTo(carteraClientTargets.get(code) ?? 0, 1),
            carteraQuotaPct: company.totalKg > 0 ? roundTo(carteraClientQuotas.get(code) ?? 0, 1) : null,
            carteraShareOfSellerPct: sharePct(carteraHistory, carteraSellerHistory),
            noteHistoricalKg: roundTo(noteHistory),
            noteCurrentKg: roundTo(noteCurrent),
            noteTargetKg: roundTo(noteClientTargets.get(code) ?? 0, 1),
            noteQuotaPct: company.totalKg > 0 ? roundTo(noteClientQuotas.get(code) ?? 0, 1) : null,
            noteShareOfSellerPct: sharePct(noteHistory, noteSellerHistory),
            historicalKg: roundTo(chosenClientHistory),
            shareOfSellerPct: sharePct(chosenClientHistory, chosenSellerHistory),
            quotaPct: company.totalKg > 0 ? roundTo(chosenClientQuotas.get(code) ?? 0, 1) : null,
            targetKg: clientTarget,
            actualKg: roundTo(chosenClientCurrent),
            actualUnits: roundTo(
              attribution === 'PORTFOLIO' ? (carteraClient?.currentUnits ?? 0) : (noteClient?.currentUnits ?? 0),
            ),
            invoiceCount:
              attribution === 'PORTFOLIO'
                ? (carteraClient?.currentInvoices ?? 0)
                : (noteClient?.currentInvoices ?? 0),
            carteraInvoiceCount: carteraClient?.currentInvoices ?? 0,
            noteInvoiceCount: noteClient?.currentInvoices ?? 0,
            lastInvoiceDate: lastDates.at(-1) ?? null,
            isNew: chosenClientHistory <= 0 && chosenClientCurrent > 0,
            // Se completan en el pase del plan de cierre (después del reparto).
            pendingKg: 0,
            expectedKg: 0,
            bestMonthKg: roundTo(
              attribution === 'PORTFOLIO'
                ? bestMonthKg(carteraCapacity, seller.code, code)
                : bestMonthKg(noteCapacity, seller.code, code),
            ),
            capacityKg: 0,
            headroomKg: 0,
            closingPlanKg: 0,
            ...clientMetrics,
          };
        })
        .sort((a, b) => b.targetKg - a.targetKg || b.actualKg - a.actualKg || a.clientName.localeCompare(b.clientName, 'es'));

      // Activación sobre la cartera asignada (no sobre la vista Nota): la
      // cuota es de «sus clientes», aunque la venta la firme otro vendedor.
      const assignedCodes = portfolioAssigned.get(seller.code) ?? new Set<string>();
      let activeActivation = 0;
      let reactivatedClients = 0;
      let newClients = 0;
      for (const clientCode of assignedCodes) {
        const client = carteraSeller?.clients.get(clientCode);
        if (!client || client.currentKg <= 0) continue;
        activeActivation += 1;
        const activity = activityByClient.get(clientCode);
        if (!activity?.recent12) newClients += 1;
        else if (!activity.recent3) reactivatedClients += 1;
      }
      const activation: ForecastSellerActivation = {
        available: assignmentAvailable,
        assignedClients: assignedCodes.size,
        activeClients: activeActivation,
        inertClients: Math.max(0, assignedCodes.size - activeActivation),
        activationPct:
          assignedCodes.size > 0 ? roundTo((activeActivation / assignedCodes.size) * 100, 1) : null,
        reactivatedClients,
        newClients,
      };

      const collection = collectionResult(
        chosenCollection.get(seller.code),
        collectionAvailable,
        chosenOverdue.get(seller.code) ?? null,
      );

      const carteraHistory = historySeriesOf(carteraSeller);
      const noteHistory = historySeriesOf(noteSeller);

      // Los dos libros: lo que firmó él y lo que compró su cartera. La fuga se
      // separa entre vendedores reales y cuentas internas (001/004).
      const carteraCurrent = roundTo(carteraSeller?.currentKg ?? 0);
      const facturadoCurrent = roundTo(noteSeller?.currentKg ?? 0);
      const byOthers = roundTo(carteraSeller?.otherSellerKg ?? 0);
      const byOthersExternal = roundTo(carteraSeller?.otherExternalKg ?? 0);
      const byOthersInternal = roundTo(carteraSeller?.otherInternalKg ?? 0);
      const ownPortfolio = roundTo(Math.max(0, carteraCurrent - byOthers));
      const outside = roundTo(Math.max(0, facturadoCurrent - ownPortfolio));
      const billing: ForecastSellerBilling = {
        facturadoKg: facturadoCurrent,
        facturadoOwnPortfolioKg: ownPortfolio,
        facturadoOutsideKg: outside,
        carteraKg: carteraCurrent,
        carteraByOthersKg: byOthers,
        carteraByOthersExternalKg: byOthersExternal,
        carteraByOthersInternalKg: byOthersInternal,
        carteraByOthersPct: carteraCurrent > 0 ? roundTo((byOthers / carteraCurrent) * 100, 1) : null,
        facturadoClients: clients.filter((client) => client.noteCurrentKg > 0).length,
        leakedClients: clients.filter((client) => client.otherSellerExternalKg > 0).length,
        internalClients: clients.filter((client) => client.otherSellerInternalKg > 0).length,
      };

      return {
        sellerCode: seller.code === NO_SELLER ? '' : seller.code,
        sellerName: seller.name,
        isInternal: INTERNAL_SELLER_CODES.has(seller.code),
        carteraHistoricalKg: roundTo(carteraSellerHistory),
        carteraCurrentKg: roundTo(carteraSeller?.currentKg ?? 0),
        carteraQuotaPct: company.totalKg > 0 ? roundTo(carteraQuota, 1) : null,
        carteraTargetKg,
        noteHistoricalKg: roundTo(noteSellerHistory),
        noteCurrentKg: roundTo(noteSeller?.currentKg ?? 0),
        noteQuotaPct: company.totalKg > 0 ? roundTo(noteQuota, 1) : null,
        noteTargetKg,
        billing,
        carteraHistory,
        noteHistory,
        carteraByOthersHistory: historySeriesFromMap(carteraSeller?.otherHistory),
        clientCount: clients.length,
        assignedClientCount: assignmentAvailable ? (portfolioAssignmentCounts.get(seller.code) ?? 0) : 0,
        windowClientCount: clients.filter(
          (client) => client.carteraHistoricalKg > 0 || client.noteHistoricalKg > 0,
        ).length,
        activeClientCount: clients.filter(
          (client) => client.carteraCurrentKg > 0 || client.noteCurrentKg > 0,
        ).length,
        invoiceCount:
          attribution === 'PORTFOLIO'
            ? (carteraSeller?.currentInvoices ?? 0)
            : (noteSeller?.currentInvoices ?? 0),
        executedKg: roundTo(noteSeller?.currentKg ?? 0),
        executedHistoricalKg: roundTo(noteSellerHistory),
        otherSellerKg: roundTo(carteraSeller?.otherSellerKg ?? 0),
        // Se completan en el pase del plan de cierre.
        pendingKg: 0,
        expectedKg: 0,
        closingPlanKg: 0,
        historicalKg: roundTo(chosenSellerHistory),
        sharePct: sharePct(chosenSellerHistory, historyTotal),
        currentSharePct: sharePct(chosenSellerCurrent, companyActual),
        quotaPct: company.totalKg > 0 ? roundTo(chosenQuota, 1) : null,
        targetKg,
        actualKg: roundTo(chosenSellerCurrent),
        actualUnits: roundTo(
          attribution === 'PORTFOLIO' ? (carteraSeller?.currentUnits ?? 0) : (noteSeller?.currentUnits ?? 0),
        ),
        lastInvoiceDate:
          [carteraSeller?.lastInvoiceDate, noteSeller?.lastInvoiceDate]
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ?? null,
        ...metrics,
        history: chosenHistory,
        daily: this.buildDaily(calendar, chosenDaily.get(seller.code) ?? new Map(), targetKg),
        collection,
        activation,
        clients,
      };
    });

    rows.sort(
      (a, b) => b.targetKg - a.targetKg || b.actualKg - a.actualKg || a.sellerName.localeCompare(b.sellerName, 'es'),
    );

    // ---------- Plan de cierre de brecha ----------
    //
    // 1) La cartera comprometida es del CLIENTE, no del vendedor: se cuelga de
    //    una sola fila para no contarla dos veces en el criterio Nota (un
    //    cliente puede aparecer con varios vendedores). Se prefiere su vendedor
    //    asignado en Profit y, si no está en la lista, la fila de mayor meta.
    // 2) Esperado = proyección + pendiente. Capacidad = su mejor mes real de
    //    los últimos 12. Margen = lo que puede crecer sin pasar de esa marca.
    // 3) La brecha de la red se reparte solo entre márgenes reales de clientes
    //    de vendedores reales (las cuentas internas no la absorben).
    if (calendar.status === 'OPEN' && pendingByClient.size > 0) {
      const clientRows = new Map<
        string,
        Array<{ sellerCode: string; isInternal: boolean; client: ForecastSellerClientRow }>
      >();
      for (const row of rows) {
        for (const client of row.clients) {
          if (!client.clientCode) continue;
          const list = clientRows.get(client.clientCode) ?? [];
          list.push({ sellerCode: row.sellerCode, isInternal: row.isInternal, client });
          clientRows.set(client.clientCode, list);
        }
      }
      for (const [clientCode, pending] of pendingByClient) {
        if (pending <= 0) continue;
        const candidates = clientRows.get(clientCode);
        if (!candidates || candidates.length === 0) continue;
        const real = candidates.filter((entry) => !entry.isInternal);
        const assigned =
          real.find((entry) => entry.client.assignedSellerCode === entry.sellerCode) ??
          real.sort((a, b) => b.client.targetKg - a.client.targetKg)[0] ??
          candidates.sort((a, b) => b.client.targetKg - a.client.targetKg)[0];
        if (assigned) assigned.client.pendingKg = roundTo(pending);
      }
    }

    for (const row of rows) {
      let pending = 0;
      let expected = 0;
      for (const client of row.clients) {
        const base = client.projectedKg ?? client.actualKg;
        client.expectedKg = roundTo(base + client.pendingKg);
        client.capacityKg = roundTo(Math.max(client.bestMonthKg, client.expectedKg));
        client.headroomKg = roundTo(Math.max(0, client.capacityKg - client.expectedKg));
        pending += client.pendingKg;
        expected += client.expectedKg;
      }
      row.pendingKg = roundTo(pending);
      row.expectedKg = roundTo(expected);
    }

    const expectedTotal = roundTo(rows.reduce((acc, row) => acc + row.expectedKg, 0));
    const closingPlanAvailable = calendar.status === 'OPEN' && company.totalKg > 0;
    const closingGapKg = closingPlanAvailable ? roundTo(Math.max(0, company.totalKg - expectedTotal)) : 0;

    // Un cliente puede aparecer en varias filas en el criterio Nota (varios
    // vendedores le firmaron). Para no duplicar su margen se toma una sola
    // fila: la de mayor margen y, a igualdad, la de su vendedor asignado.
    const planRows = new Map<string, { sellerCode: string; client: ForecastSellerClientRow }>();
    for (const row of rows) {
      // La cuenta interna no tiene cartera real: su cuota la cubren los reales.
      if (row.isInternal) continue;
      for (const client of row.clients) {
        if (!client.clientCode || client.headroomKg <= 0) continue;
        const current = planRows.get(client.clientCode);
        const preferAssigned = client.assignedSellerCode === row.sellerCode;
        if (
          !current ||
          client.headroomKg > current.client.headroomKg ||
          (client.headroomKg === current.client.headroomKg && preferAssigned)
        ) {
          planRows.set(client.clientCode, { sellerCode: row.sellerCode, client });
        }
      }
    }
    const headroom = new Map<string, number>();
    for (const [clientCode, entry] of planRows) headroom.set(clientCode, entry.client.headroomKg);
    const gapPlan =
      closingGapKg > 0
        ? allocateGapByHeadroom(headroom, closingGapKg)
        : { plan: new Map<string, number>(), gapKg: closingGapKg, coveredKg: 0, uncoveredKg: closingGapKg };
    if (closingGapKg > 0) {
      for (const [clientCode, kg] of gapPlan.plan) {
        const entry = planRows.get(clientCode);
        if (entry && kg > 0) entry.client.closingPlanKg = kg;
      }
      for (const row of rows) {
        row.closingPlanKg = roundTo(row.clients.reduce((acc, client) => acc + client.closingPlanKg, 0));
      }
    }
    const pendingTotal = roundTo(rows.reduce((acc, row) => acc + row.pendingKg, 0));

    const companyHistorySeries = historyMonths.map(
      (entry) => companyHistory.get(monthKey(entry.year, entry.month)) ?? 0,
    );
    const totalsMetrics = computeRunRate({
      actualKg: companyActual,
      forecastKg: company.totalKg,
      calendar,
      history: companyHistorySeries,
    });

    // Totales de los dos libros y de la fuga. Σ facturado = venta de la red por
    // nota; Σ cartera = venta de la red por cartera; ambos cuadran al kilo.
    const billingTotals: ForecastSellerBilling = {
      facturadoKg: 0,
      facturadoOwnPortfolioKg: 0,
      facturadoOutsideKg: 0,
      carteraKg: 0,
      carteraByOthersKg: 0,
      carteraByOthersExternalKg: 0,
      carteraByOthersInternalKg: 0,
      carteraByOthersPct: null,
      facturadoClients: activeClients.size,
      leakedClients: 0,
      internalClients: 0,
    };
    for (const row of rows) {
      billingTotals.facturadoKg += row.billing.facturadoKg;
      billingTotals.facturadoOwnPortfolioKg += row.billing.facturadoOwnPortfolioKg;
      billingTotals.facturadoOutsideKg += row.billing.facturadoOutsideKg;
      billingTotals.carteraKg += row.billing.carteraKg;
      billingTotals.carteraByOthersKg += row.billing.carteraByOthersKg;
      billingTotals.carteraByOthersExternalKg += row.billing.carteraByOthersExternalKg;
      billingTotals.carteraByOthersInternalKg += row.billing.carteraByOthersInternalKg;
      billingTotals.leakedClients += row.billing.leakedClients;
      billingTotals.internalClients += row.billing.internalClients;
    }
    billingTotals.facturadoKg = roundTo(billingTotals.facturadoKg);
    billingTotals.facturadoOwnPortfolioKg = roundTo(billingTotals.facturadoOwnPortfolioKg);
    billingTotals.facturadoOutsideKg = roundTo(billingTotals.facturadoOutsideKg);
    billingTotals.carteraKg = roundTo(billingTotals.carteraKg);
    billingTotals.carteraByOthersKg = roundTo(billingTotals.carteraByOthersKg);
    billingTotals.carteraByOthersExternalKg = roundTo(billingTotals.carteraByOthersExternalKg);
    billingTotals.carteraByOthersInternalKg = roundTo(billingTotals.carteraByOthersInternalKg);
    billingTotals.carteraByOthersPct =
      billingTotals.carteraKg > 0
        ? roundTo((billingTotals.carteraByOthersKg / billingTotals.carteraKg) * 100, 1)
        : null;

    const carteraByOthersHistory = historyMonths.map((entry, index) => ({
      year: entry.year,
      month: entry.month,
      actualKg: roundTo(rows.reduce((acc, row) => acc + (row.carteraByOthersHistory[index]?.actualKg ?? 0), 0)),
    }));

    return {
      year,
      month,
      asOf: calendar.cut,
      scope: 'ALL',
      scopeSellerCode: null,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: true,
      forecastAvailable: company.available,
      forecastSource: company.source,
      forecastLiveKg: company.liveKg,
      forecastCapturedKg: company.capturedKg,
      forecastCapturedAt: company.capturedAt,
      forecastDriftAt: company.driftAt,
      attribution,
      assignmentAvailable,
      allocationBasis,
      closingPlanAvailable,
      days: {
        inMonth: calendar.inMonth,
        elapsed: calendar.elapsed,
        remaining: calendar.remaining,
        workingInMonth: calendar.workingInMonth,
        workingElapsed: calendar.workingElapsed,
        workingRemaining: calendar.workingRemaining,
        today: calendar.today,
        cut: calendar.cut,
      },
      totals: {
        forecastKg: roundTo(company.totalKg),
        actualKg: companyActual,
        actualUnits: companyUnits,
        ...totalsMetrics,
        pendingKg: pendingTotal,
        expectedKg: roundTo(expectedTotal),
        closingGapKg,
        closingCoveredKg: gapPlan.coveredKg,
        closingUncoveredKg: gapPlan.uncoveredKg,
        invoiceCount: companyInvoices,
        lastInvoiceDate: companyLastInvoice,
        sellerCount: rows.length,
        clientCount: attribution === 'PORTFOLIO' ? portfolioClients.size : windowClients.size,
        assignedClientCount: assignmentAvailable ? portfolioClients.size : 0,
        windowClientCount: windowClients.size,
        activeClientCount: activeClients.size,
        billing: billingTotals,
        carteraByOthersHistory,
      },
      daily: this.buildDaily(calendar, companyByDay, company.totalKg),
      sellers: rows,
      generatedAt: new Date().toISOString(),
    };
  }

  // Serie diaria (real hasta el corte, proyección desde el corte y ritmo
  // uniforme de la cuota). Mismo cálculo que el informe de ventas, sin el
  // desglose por artículo.
  private buildDaily(
    calendar: MonthCalendar,
    byDay: Map<number, { kg: number; units: number; invoices: number }>,
    forecastKg: number,
  ): ForecastSalesDaily[] {
    if (calendar.status === 'FUTURE') return [];

    const cutDay = calendar.cut ? Number(calendar.cut.slice(8, 10)) : 0;
    const flags = workingDayFlags(calendar.year, calendar.month);
    const elapsed = basisElapsed(calendar);
    const actualToCut = Array.from({ length: cutDay }, (_, index) => byDay.get(index + 1)?.kg ?? 0).reduce(
      (acc, value) => acc + value,
      0,
    );
    const dailyAvg = elapsed > 0 ? actualToCut / elapsed : 0;
    const forecastPerWorkingDay =
      forecastKg > 0 && calendar.workingInMonth > 0 ? forecastKg / calendar.workingInMonth : 0;
    const projectionStart = cutDay > 0 ? cutDay : 1;

    let cumulativeActual = 0;
    let cumulativeForecast = 0;
    const series: ForecastSalesDaily[] = [];

    for (let day = 1; day <= calendar.inMonth; day += 1) {
      const bucket = byDay.get(day);
      const actualKg = roundTo(bucket?.kg ?? 0);
      if (day <= cutDay) cumulativeActual += actualKg;

      const isWorking = flags[day - 1] === true;
      if (forecastPerWorkingDay > 0 && (calendar.basis === 'WORKING' ? isWorking : true)) {
        cumulativeForecast += forecastPerWorkingDay;
      }

      const steps =
        day >= projectionStart
          ? calendar.basis === 'WORKING'
            ? countWorkingDays(calendar.year, calendar.month, projectionStart + 1, day)
            : day - projectionStart
          : 0;
      const projected =
        calendar.status === 'OPEN' && day >= projectionStart ? roundTo(actualToCut + dailyAvg * steps) : null;

      series.push({
        date: isoDay(calendar.year, calendar.month, day),
        actualKg,
        actualUnits: roundTo(bucket?.units ?? 0),
        invoiceCount: Math.trunc(bucket?.invoices ?? 0),
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: day <= cutDay ? roundTo(cumulativeActual) : null,
        projectedCumulativeKg: projected,
        forecastCumulativeKg: forecastKg > 0 ? roundTo(cumulativeForecast) : null,
      });
    }

    return series;
  }

  private remember(key: string, data: ForecastSellersResponse) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, { at: Date.now(), data });
  }

  private empty(calendar: MonthCalendar, attribution: ForecastSellerAttribution): ForecastSellersResponse {
    return {
      year: calendar.year,
      month: calendar.month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: false,
      forecastAvailable: false,
      forecastSource: 'NONE',
      forecastLiveKg: null,
      forecastCapturedKg: null,
      forecastCapturedAt: null,
      forecastDriftAt: null,
      attribution,
      assignmentAvailable: false,
      allocationBasis: 'NONE',
      closingPlanAvailable: false,
      days: {
        inMonth: calendar.inMonth,
        elapsed: calendar.elapsed,
        remaining: calendar.remaining,
        workingInMonth: calendar.workingInMonth,
        workingElapsed: calendar.workingElapsed,
        workingRemaining: calendar.workingRemaining,
        today: calendar.today,
        cut: calendar.cut,
      },
      totals: zeroTotals(),
      daily: [],
      sellers: [],
      generatedAt: new Date().toISOString(),
      scope: 'ALL',
      scopeSellerCode: null,
    };
  }
}

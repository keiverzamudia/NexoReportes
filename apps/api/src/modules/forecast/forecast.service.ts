import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FORECAST_WEEK_INDEXES,
  ForecastCustomerSalesResponse,
  ForecastPlanResponse,
  ForecastPlanRow,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastRow,
  ForecastSalesDaily,
  ForecastSalesDayCustomer,
  ForecastSalesDayDetail,
  ForecastSalesDayDetailProduct,
  ForecastSalesDayPendingCustomer,
  ForecastSalesDayPendingLine,
  ForecastSalesDayPendingProduct,
  ForecastSalesHistory,
  ForecastSalesQuery,
  ForecastSalesResponse,
  ForecastSalesRow,
  ForecastSalesSource,
  ForecastSalesStatus,
  ForecastSetWeeks,
  ForecastWeekRange,
  ForecastWeekRow,
  InventoryByWarehouse,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { computeAvailability } from '../availability/availability.engine';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import { deliveryDateKey } from '../sales/delivery-dates.service';
import { resolveForecastTargets } from './forecast-targets';
import {
  buildCustomerShare,
  CustomerInfo,
  CustomerProductSale,
} from './customer-sales-share';
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
// Forecast (pronóstico de producción).
//
//  · El FORECAST MENSUAL por artículo se lee de Profit (`dbo.forecast`). La
//    columna `kg_mensual` viene en la presentación del artículo: los SAC se
//    multiplican por `art.uni_relac` para llevarlos a KILOGRAMOS y el granel
//    (KG) se usa tal cual. Es solo lectura; Nexo nunca lo escribe.
//  · `forecast.fecha` es el mes de vigencia (primer día del mes) y `co_art` el
//    código del artículo, así que cada mes se consulta directamente y no hace
//    falta cruzar por descripción.
//  · Cada semana (4 bloques) tiene una CANTIDAD editable. Por defecto se
//    llena con el PROMEDIO = forecast mensual / 4; aquí solo se ajustan semanas.
//  · El Reporte reutiliza el MISMO motor de disponibilidad que la vista
//    «Disponibilidad por Producto», con la demanda OBJETIVO de la semana
//    (max(forecast de la semana, demanda de la semana)).
// ============================================================

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Sacos de una línea (día): SAC convierte kg ÷ kg por saco; si falta la
// relación se usan las unidades. Granel no tiene presentación en sacos.
function sacksOf(kg: number, units: number, uom: string, kgPerUom: number | null): number | null {
  if (uom !== 'SAC') return null;
  return roundTo(kgPerUom !== null && kgPerUom > 0 ? kg / kgPerUom : units, 1);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Bloques fijos: 1-7, 8-14, 15-21, 22-fin.
export const WEEK_BOUNDS = [
  [1, 7],
  [8, 14],
  [15, 21],
  [22, 31],
] as const;

// Almacenes reales de la compañía (mismos códigos que la vista de Disponibilidad).
const WAREHOUSE_03 = 'Stock 03';
const WAREHOUSE_9999 = 'Stock 9999';
const WAREHOUSE_68 = 'Stock 68';

// Forecast mensual mantenido por producción en Profit (`COR_A3.dbo.forecast`).
// `fecha` es el mes de vigencia (primer día del mes), `co_art` el artículo y
// `kg_mensual` la cantidad en la PRESENTACIÓN del artículo: si `art.uni_venta`
// es `SAC` viene en sacos y se multiplica por `art.uni_relac` (kg por saco);
// si es `KG` (granel) ya viene en kilogramos y se usa tal cual. `kg_semanal`
// no se usa: Nexo reparte el mensual convertido a kg en 4 bloques editables.
// El rango [@desde, @hasta) permite leer un mes suelto o varios meses de
// histórico en una sola consulta.
export const PROFIT_FORECAST_SQL = `
SELECT
  RTRIM(f.co_art) AS co_art,
  f.kg_mensual AS forecast_mes,
  f.fecha AS fecha,
  RTRIM(a.uni_venta) AS uni_venta,
  a.uni_relac AS uni_relac
FROM dbo.forecast AS f
LEFT JOIN dbo.art AS a ON a.co_art = f.co_art
WHERE f.fecha >= @desde
  AND f.fecha < @hasta
`;

// ============================================================
// Ventas reales vs forecast (solo lectura).
//
// La venta se mide por NOTA DE ENTREGA (despacho), no por factura: encabezado
// `dbo.not_ent` + renglones `dbo.reng_nde`. En este Profit ambas tablas usan
// `fact_num` como llave (NO `not_num`): es el número de documento del módulo,
// por eso el JOIN es `r.fact_num = f.fact_num`. `kg_mensual` de `forecast` está
// en KILOGRAMOS, por eso la comparación global es en kg/t y la de producto añade
// sacos cuando `uni_venta = 'SAC'`.
//
// Filtro de negocio: nota no anulada, artículo no anulado y línea ABA
// (alimentos balanceados). En 2026 no hay renglones `reng_nde` anulados ni
// negativos: la venta neta equivale a la venta bruta. Las notas suelen ir
// 1–2 % por encima de lo facturado (despachos aún no facturados).
// ============================================================
export const PROFIT_SALES_MONTHLY_SQL = `
SELECT
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(a.uni_venta) AS uni_venta,
  a.uni_relac AS uni_relac,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  MAX(f.fec_emis) AS ultima_factura
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(a.uni_venta), a.uni_relac
`;

export const PROFIT_SALES_DAILY_SQL = `
SELECT
  CAST(f.fec_emis AS date) AS fecha,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(DISTINCT f.fact_num) AS facturas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date)
`;

// Desglose del día por artículo: alimenta el panel «Ventas del día» que se
// sincroniza con el hover/clic de la gráfica de acumulado. Misma fuente y
// filtros que la serie diaria; la consulta diaria se mantiene aparte para no
// alterar el conteo de notas (un artículo no puede multiplicar las facturas).
export const PROFIT_SALES_DAILY_PRODUCTS_SQL = `
SELECT /* nexo:daily_products */
  CAST(f.fec_emis AS date) AS fecha,
  RTRIM(r.co_art) AS co_art,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date), RTRIM(r.co_art)
`;

// Desglose de UN día por cliente y artículo (modal «Desglose del día»). Con
// estas filas se arman las dos vistas del modal: productos (sumando clientes) y
// clientes (anidando sus productos). Misma fuente y filtros que el informe, así
// los kg cuadran con la barra del día. Solo se consulta al abrir el detalle.
export const PROFIT_SALES_DAILY_CUSTOMER_PRODUCT_SQL = `
SELECT /* nexo:daily_customer_products */
  CAST(f.fec_emis AS date) AS fecha,
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  a.uni_relac AS uni_relac,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date), RTRIM(f.co_cli), RTRIM(ISNULL(c.cli_des, '')),
         RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(ISNULL(a.uni_venta, '')), a.uni_relac
`;

// Kg despachados por cliente y artículo en el mes del informe. Es la base de
// la participación por cliente: no consulta meses históricos. Misma fuente y
// filtros que el informe de ventas.
export const PROFIT_SALES_CUSTOMER_PRODUCT_SQL = `
SELECT /* nexo:customer_products */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  a.uni_relac AS uni_relac,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  MAX(f.fec_emis) AS ultima_factura
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), RTRIM(f.co_cli), RTRIM(ISNULL(c.cli_des, '')),
         RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(ISNULL(a.uni_venta, '')), a.uni_relac
`;

// Kg despachados por artículo y BLOQUE DE SEMANA del mes (1: 1-7, 2: 8-14,
// 3: 15-21, 4: 22-fin). Misma fuente y filtros que el informe de ventas (notas
// de entrega no anuladas, artículo vigente y línea ABA), así el plan de
// producción compara lo vendido contra el forecast con el mismo criterio.
// `@desde`/`@hasta` son un rango semiabierto: mes completo [1º, 1º del siguiente).
export const PROFIT_SALES_WEEKLY_SQL = `
SELECT
  RTRIM(r.co_art) AS co_art,
  CASE
    WHEN DAY(f.fec_emis) <= 7 THEN 1
    WHEN DAY(f.fec_emis) <= 14 THEN 2
    WHEN DAY(f.fec_emis) <= 21 THEN 3
    ELSE 4
  END AS semana,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY RTRIM(r.co_art), CASE
    WHEN DAY(f.fec_emis) <= 7 THEN 1
    WHEN DAY(f.fec_emis) <= 14 THEN 2
    WHEN DAY(f.fec_emis) <= 21 THEN 3
    ELSE 4
  END
`;

// Zona del negocio: el corte del informe no puede depender de la hora del
// servidor (un contenedor en UTC cambiaría de día a las 20:00 de Caracas).
const BUSINESS_TIME_ZONE = 'America/Caracas';

// Caché en memoria: la pestaña se puede refrescar varias veces seguidas y no
// tiene sentido golpear SQL Server en cada render. 5 minutos por combinación.
const SALES_CACHE_TTL_MS = 5 * 60_000;
const SALES_CACHE_MAX_ENTRIES = 40;

// La consulta cliente × artículo del mes puede ser grande. El límite es
// defensivo: si se alcanza, la respuesta marca `truncated` y la UI lo avisa.
const CUSTOMER_PRODUCTS_QUERY_LIMIT = 200_000;

// Un solo día no debería acercarse a este tope, pero la consulta es defensiva:
// si se alcanza, el modal marca `truncated` y no presume de porcentajes.
const DAY_DETAIL_QUERY_LIMIT = 20_000;

// Las notas sin `co_cli` (poco frecuentes) se agrupan para que Σ clientes = día.
const NO_CUSTOMER = '__sin_cliente__';
const NO_CUSTOMER_LABEL = 'Sin cliente';

// Ventana para corregir la captura inicial de la meta. `forecast` ya identifica
// el mes con `fecha`, pero producción puede cargar o ajustar la meta durante
// los primeros días. Durante estas horas la captura se puede corregir; después
// queda congelada.
const TARGET_GRACE_HOURS_DEFAULT = 72;

function targetGraceHours(): number {
  const raw = process.env.FORECAST_TARGET_GRACE_HOURS;
  const value = raw === undefined || raw.trim() === '' ? TARGET_GRACE_HOURS_DEFAULT : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : TARGET_GRACE_HOURS_DEFAULT;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

interface SalesMonthBucket {
  kg: number;
  units: number;
}

// Metadatos de la meta capturada que necesita el informe (sin `capturedAt`,
// que es solo la última escritura oficial).
interface ForecastTargetMeta {
  targetKg: number;
  firstCapturedAt: string | null;
  frozenAt: string | null;
  lastSeenKg: number | null;
  driftDetectedAt: string | null;
}

interface CaptureStats {
  created: number;
  corrected: number;
  frozen: number;
  drifted: number;
}

interface SalesProductMeta {
  description: string;
  uom: string;
  kgPerUom: number | null;
  lastInvoiceDate: string | null;
}

// Despachos del mes agrupados por artículo y semana (índice 0 = semana 1).
interface WeeklySalesIndex {
  byCode: Map<string, { weeks: number[]; monthKg: number }>;
  available: boolean;
}

// Forecast de Profit agrupado por mes (`yyyy-mm` → código → kg).
interface ForecastSeries {
  byMonth: Map<string, Map<string, number>>;
  available: boolean;
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

// Normaliza una fecha de SQL Server (Date, ISO o `yyyy-mm-dd hh:mm:ss`) a día.
function isoDayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function addBucket(map: Map<string, SalesMonthBucket>, key: string, kg: number, units: number) {
  const bucket = map.get(key) ?? { kg: 0, units: 0 };
  bucket.kg += kg;
  bucket.units += units;
  map.set(key, bucket);
}

function emptyMetrics() {
  return {
    dailyAvgKg: 0,
    projectedKg: null,
    attainmentPct: null,
    projectedAttainmentPct: null,
    gapKg: null,
    requiredDailyKg: null,
    historicalAvgKg: null,
    vsHistoricalPct: null,
  };
}

// Días que suma la proyección entre `from` (corte) y `to`.
function projectionSteps(
  basis: MonthCalendar['basis'],
  year: number,
  month: number,
  from: number,
  to: number,
): number {
  if (to <= from) return 0;
  return basis === 'WORKING' ? countWorkingDays(year, month, from + 1, to) : to - from;
}

export function weekIndexOf(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function weekRanges(year: number, month: number): ForecastWeekRange[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return WEEK_BOUNDS.map(([from, to], i) => {
    const end = Math.min(to, daysInMonth);
    return { weekIndex: i + 1, label: `S${i + 1} (${from}-${end})`, from: isoDate(year, month, from), to: isoDate(year, month, end) };
  });
}

function warehouseQty(list: InventoryByWarehouse[], code: string): number {
  return round3(list.find((w) => w.warehouseCode === code)?.qty ?? 0);
}

/**
 * Cartera comprometida del mes: kg pendientes de pedidos activos agrupados por
 * día de entrega EFECTIVA (fecha tentativa si existe; si no, la de Profit).
 * Es la fuente del pronóstico de ventas que se apila en la tira diaria.
 */
interface PendingSalesBuckets {
  byDay: Map<number, { kg: number; orders: number }>;
  totalKg: number;
  totalOrders: number;
}

/** Renglón de pedido pendiente ya normalizado a su fecha de entrega efectiva. */
interface PendingLine {
  day: number;
  orderNumber: string;
  lineNumber: number;
  customerCode: string | null;
  customerName: string | null;
  productCode: string;
  description: string;
  uom: string;
  kg: number;
  pendingQty: number;
  requestedDate: Date | null;
  tentativeDate: Date | null;
  authorized: boolean | null;
}

function emptyPendingBuckets(): PendingSalesBuckets {
  return { byDay: new Map(), totalKg: 0, totalOrders: 0 };
}

/** Fecha calendario (yyyy-mm-dd) de una columna DateTime de Prisma. */
function isoDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);
  // Ventas vs forecast: la pestaña se refresca seguido y Profit es un recurso
  // único; 5 minutos por combinación evitan ráfagas de consultas.
  private readonly salesCache = new Map<string, { at: number; data: ForecastSalesResponse }>();
  // Participación por cliente: misma política que el informe de ventas.
  private readonly customerSalesCache = new Map<string, { at: number; data: ForecastCustomerSalesResponse }>();
  // Detalle del día (modal): una entrada por fecha, misma política de 5 min.
  private readonly dayDetailCache = new Map<string, { at: number; data: ForecastSalesDayDetail }>();
  // Despachos semanales del plan: misma política (5 min, tope 40) porque el
  // plan se refresca junto con el Asignador y Profit es un recurso único.
  private readonly weeklyCache = new Map<string, { at: number; data: WeeklySalesIndex }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  async list(year: number, month: number): Promise<ForecastResponse> {
    const products = await this.prisma.product.findMany({
      where: { isProduction: true, isActive: true },
      orderBy: { externalCode: 'asc' },
    });

    const [stock, demand, forecast] = await Promise.all([
      this.stockIndex(),
      this.demandBuckets(year, month),
      this.profitForecastIndex(year, month),
    ]);
    const forecasts = await this.prisma.forecast.findMany({ where: { year, month }, include: { weeks: true } });
    const byCode = new Map(forecasts.map((f) => [f.productCode, f]));
    const ranges = weekRanges(year, month);

    const rows: ForecastRow[] = products.map((p) => {
      const f = byCode.get(p.externalCode);
      // El mensual SIEMPRE manda desde Profit. El valor local sólo se usa para
      // saber si las semanas guardadas se editaron sobre este mismo mensual.
      const monthlyQty = forecast.byCode.get(p.externalCode) ?? 0;
      const storedMonthly = f ? num(f.monthlyQty) : null;
      const useStoredWeeks = f !== undefined && storedMonthly === monthlyQty;
      const weeks = this.computeWeeks(monthlyQty, f?.weeks ?? [], useStoredWeeks);
      const demandMonth = demand.byProduct.get(p.externalCode) ?? { qty: 0, kg: 0 };
      return {
        productCode: p.externalCode,
        description: p.description,
        uom: p.uom,
        category: p.category,
        kgPerUom: p.kgPerUom === null || p.kgPerUom === undefined ? null : num(p.kgPerUom),
        stockTotal: round3(stock.get(p.externalCode)?.total ?? 0),
        demandMonthQty: round3(demandMonth.qty),
        demandMonthKg: round3(demandMonth.kg),
        monthlyQty: round3(monthlyQty),
        averageQty: round3(monthlyQty / WEEK_BOUNDS.length),
        weeks,
        weeksTotalQty: round3(weeks.reduce((acc, w) => acc + w.qty, 0)),
      };
    });

    return { year, month, weekRanges: ranges, rows, profitForecastAvailable: forecast.available };
  }

  // Cambia SOLO las cantidades por semana. El forecast mensual no se edita aquí:
  // se toma de Profit y se guarda como "snapshot" para detectar si cambió.
  async setWeeks(productCode: string, dto: ForecastSetWeeks) {
    const forecast = await this.profitForecastIndex(dto.year, dto.month);
    if (!forecast.available) {
      throw new ServiceUnavailableException('No se pudo leer el forecast de Profit (forecast). Intenta de nuevo.');
    }
    const monthlyQty = forecast.byCode.get(productCode) ?? 0;
    const forecastRow = await this.prisma.forecast.upsert({
      where: { productCode_year_month: { productCode, year: dto.year, month: dto.month } },
      update: { monthlyQty, locked: false, lockedAt: null },
      create: { productCode, year: dto.year, month: dto.month, monthlyQty, locked: false },
    });
    for (const w of dto.weeks) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId: forecastRow.id, weekIndex: w.weekIndex } },
        update: { qty: w.qty },
        create: { forecastId: forecastRow.id, weekIndex: w.weekIndex, qty: w.qty },
      });
    }
    // Crea las semanas que falten con el promedio (no pisa las recién guardadas).
    await this.ensureWeeks(forecastRow.id, monthlyQty, false);
    await this.audit.record({
      action: 'FORECAST_SET_WEEKS',
      entityType: 'Forecast',
      entityId: forecastRow.id,
      context: { productCode, year: dto.year, month: dto.month, monthlyQty, weeks: dto.weeks },
    });
    const weeks = await this.weeksOf(forecastRow.id, monthlyQty);
    return { ok: true, productCode, year: dto.year, month: dto.month, weeks };
  }

  // Reporte: plan de producción semanal por artículo, con los campos de la
  // tabla de Disponibilidad por Producto calculados sobre la demanda objetivo
  // de cada semana (max(forecast, demanda)).
  async plan(year: number, month: number): Promise<ForecastPlanResponse> {
    const [list, stock, demand, sold] = await Promise.all([
      this.list(year, month),
      this.stockIndex(),
      this.demandBuckets(year, month),
      this.weeklySalesIndex(year, month),
    ]);

    const rows: ForecastPlanRow[] = list.rows.map((r) => {
      const stockInfo = stock.get(r.productCode) ?? { total: 0, byWarehouse: [] };
      const demandMonth = demand.byProduct.get(r.productCode) ?? { qty: 0, kg: 0 };
      const soldInfo = sold.byCode.get(r.productCode);
      const weeks: ForecastPlanWeek[] = list.weekRanges.map((range) => {
        const forecastQty = r.weeks.find((w) => w.weekIndex === range.weekIndex)?.qty ?? 0;
        const dem = demand.byProductWeek.get(`${r.productCode}#${range.weekIndex}`) ?? { qty: 0, kg: 0 };
        const objectiveQty = round3(Math.max(forecastQty, dem.qty));
        // Mismo motor que la vista «Disponibilidad por Producto».
        const availability = computeAvailability({
          productCode: r.productCode,
          description: r.description,
          uom: r.uom,
          kgPerUom: r.kgPerUom,
          stockByWarehouse: stockInfo.byWarehouse,
          demandQty: objectiveQty,
          demandKg: dem.kg,
        });
        return {
          weekIndex: range.weekIndex,
          forecastQty: round3(forecastQty),
          demandQty: round3(dem.qty),
          demandKg: round3(dem.kg),
          // Kg despachados en la semana (0 si Profit no respondió).
          soldKg: round3(soldInfo?.weeks[range.weekIndex - 1] ?? 0),
          objectiveQty,
          availableQty: availability.availableQty,
          toProduceQty: availability.toProduceQty,
          toProduceKg: availability.toProduceKg,
          netQty: availability.netQty,
          status: availability.status,
        };
      });
      return {
        productCode: r.productCode,
        description: r.description,
        uom: r.uom,
        category: r.category,
        kgPerUom: r.kgPerUom,
        stockTotal: stockInfo.total,
        stock03: warehouseQty(stockInfo.byWarehouse, WAREHOUSE_03),
        stock9999: warehouseQty(stockInfo.byWarehouse, WAREHOUSE_9999),
        stock68: warehouseQty(stockInfo.byWarehouse, WAREHOUSE_68),
        forecastMonthQty: r.monthlyQty,
        averageQty: r.averageQty,
        demandMonthQty: r.demandMonthQty,
        // Ventas del mes: demanda de pedidos y despachos reales, ambos en kg.
        demandMonthKg: round3(demandMonth.kg),
        soldMonthKg: round3(soldInfo?.monthKg ?? 0),
        productionMonthQty: round3(weeks.reduce((acc, w) => acc + w.toProduceQty, 0)),
        productionMonthKg: round3(weeks.reduce((acc, w) => acc + (w.toProduceKg ?? 0), 0)),
        weeks,
      };
    });

    return {
      year,
      month,
      weekRanges: list.weekRanges,
      salesAvailable: sold.available,
      rows,
      totals: {
        forecastQty: round3(rows.reduce((acc, r) => acc + r.forecastMonthQty, 0)),
        demandQty: round3(rows.reduce((acc, r) => acc + r.demandMonthQty, 0)),
        productionQty: round3(rows.reduce((acc, r) => acc + r.productionMonthQty, 0)),
        productionKg: round3(rows.reduce((acc, r) => acc + r.productionMonthKg, 0)),
      },
    };
  }

  // ============================================================
  // Ventas del mes vs Forecast (run-rate).
  //
  // 1. Calendario con corte a AYER (o hoy si `includeToday`), en la zona del
  //    negocio. Los días hábiles son lun–sáb.
  // 2. Una consulta mensual (histórico + mes del informe) y una diaria.
  // 3. Forecast: vivo de Profit en el mes en curso y snapshot local
  //    (`ForecastTarget`) para los meses cerrados.
  // 4. Todo el cálculo se delega al motor puro `sales-run-rate`.
  //
  // Si Profit falla se devuelve `salesAvailable: false` y la UI avisa; nunca
  // se muestran ceros como si fueran ventas.
  // ============================================================
  async salesReport(query: ForecastSalesQuery): Promise<ForecastSalesResponse> {
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

    const cacheKey = [year, month, query.months, query.basis, query.includeToday ? 1 : 0, today].join('|');
    const cached = this.salesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SALES_CACHE_TTL_MS) return cached.data;

    try {
      const data = await this.buildSalesReport(query, calendar);
      this.rememberSales(cacheKey, data);
      return data;
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer los despachos de Profit (not_ent/reng_nde): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return this.emptySalesReport(calendar);
    }
  }

  // ============================================================
  // Detalle de un día (modal «Desglose del día»).
  //
  // Una sola consulta agrupada por cliente × artículo alimenta las dos vistas:
  // se suman los clientes para los productos y se anidan los productos para
  // cada cliente. `sharePct` se calcula sobre el kg total del día.
  // ============================================================
  async salesDayDetail(date: string): Promise<ForecastSalesDayDetail> {
    const cached = this.dayDetailCache.get(date);
    if (cached && Date.now() - cached.at < SALES_CACHE_TTL_MS) return cached.data;

    // El pipe valida `yyyy-mm-dd`; el día completo va de 00:00 a 24:00 UTC y
    // SQL Server aplica el rango semiabierto de la consulta.
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);

    // La venta (Profit) y la cartera local se consultan en paralelo: el fallo
    // de una fuente no debe ocultar la otra en el modal.
    const [salesResult, pendingResult] = await Promise.allSettled([
      this.profit.selectQuery(
        PROFIT_SALES_DAILY_CUSTOMER_PRODUCT_SQL,
        DAY_DETAIL_QUERY_LIMIT,
        { desde: start, hasta: end },
      ),
      this.pendingLines(start, end),
    ]);

    const salesOk = salesResult.status === 'fulfilled';
    const pendingOk = pendingResult.status === 'fulfilled';

    if (!salesOk) {
      this.logger.warn(
        `Detalle diario de ventas no disponible (${date}): ${
          salesResult.reason instanceof Error ? salesResult.reason.message : 'error desconocido'
        }`,
      );
    }
    if (!pendingOk) {
      this.logger.warn(
        `Cartera de pedidos del día no disponible (${date}): ${
          pendingResult.reason instanceof Error ? pendingResult.reason.message : 'error desconocido'
        }`,
      );
    }

    const data = this.buildDayDetail(
      date,
      salesOk ? salesResult.value : [],
      pendingOk ? pendingResult.value : [],
      salesOk,
      pendingOk,
    );
    // Un fallo transitorio no se cachea: el reintento del modal vuelve a pedir.
    if (salesOk && pendingOk) this.rememberDayDetail(date, data);
    return data;
  }

  private buildDayDetail(
    date: string,
    rows: Record<string, unknown>[],
    pendingLines: PendingLine[],
    salesAvailable: boolean,
    pendingAvailable: boolean,
  ): ForecastSalesDayDetail {
    interface Bucket {
      kg: number;
      units: number;
    }
    interface CustomerBucket {
      customerCode: string;
      customerName: string;
      kg: number;
      units: number;
      products: Map<string, Bucket>;
    }

    const productMeta = new Map<string, { description: string; uom: string; kgPerUom: number | null }>();
    const productTotals = new Map<string, Bucket>();
    const customers = new Map<string, CustomerBucket>();
    let totalKg = 0;
    let totalUnits = 0;

    for (const raw of rows) {
      const productCode = String(raw.co_art ?? '').trim();
      if (!productCode) continue;

      const customerCode = String(raw.co_cli ?? '').trim() || NO_CUSTOMER;
      const customerName =
        String(raw.cli_des ?? '').trim() || (customerCode === NO_CUSTOMER ? NO_CUSTOMER_LABEL : customerCode);
      const kg = num(raw.kg);
      const units = num(raw.unid);
      const uom = String(raw.uni_venta ?? '').trim() || 'KG';
      const relation = raw.uni_relac === null || raw.uni_relac === undefined ? null : num(raw.uni_relac);

      totalKg += kg;
      totalUnits += units;

      const meta = productMeta.get(productCode);
      productMeta.set(productCode, {
        description: String(raw.art_des ?? '').trim() || meta?.description || productCode,
        uom,
        kgPerUom: uom === 'SAC' && relation !== null && relation > 0 ? relation : (meta?.kgPerUom ?? null),
      });

      const product = productTotals.get(productCode) ?? { kg: 0, units: 0 };
      product.kg += kg;
      product.units += units;
      productTotals.set(productCode, product);

      const customer = customers.get(customerCode) ?? {
        customerCode,
        customerName,
        kg: 0,
        units: 0,
        products: new Map<string, Bucket>(),
      };
      customer.kg += kg;
      customer.units += units;
      const line = customer.products.get(productCode) ?? { kg: 0, units: 0 };
      line.kg += kg;
      line.units += units;
      customer.products.set(productCode, line);
      customers.set(customerCode, customer);
    }

    // Porcentaje sobre el kg total del día; sin venta no hay base y queda null.
    const share = (kg: number) => (totalKg > 0 ? roundTo((kg / totalKg) * 100, 1) : null);

    const customerRows: ForecastSalesDayCustomer[] = [...customers.values()]
      .map((customer) => ({
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        kg: roundTo(customer.kg),
        units: roundTo(customer.units),
        sharePct: share(customer.kg),
        products: [...customer.products.entries()]
          .map(([productCode, line]) => {
            const meta = productMeta.get(productCode);
            const uom = meta?.uom ?? 'KG';
            const kgPerUom = meta?.kgPerUom ?? null;
            return {
              productCode,
              description: meta?.description ?? productCode,
              uom,
              kgPerUom,
              kg: roundTo(line.kg),
              units: roundTo(line.units),
              sacks: sacksOf(line.kg, line.units, uom, kgPerUom),
            };
          })
          .sort((a, b) => b.kg - a.kg || a.productCode.localeCompare(b.productCode)),
      }))
      .sort((a, b) => b.kg - a.kg || a.customerName.localeCompare(b.customerName));

    const productRows: ForecastSalesDayDetailProduct[] = [...productTotals.entries()]
      .map(([productCode, bucket]) => {
        const meta = productMeta.get(productCode);
        const uom = meta?.uom ?? 'KG';
        const kgPerUom = meta?.kgPerUom ?? null;
        return {
          productCode,
          description: meta?.description ?? productCode,
          uom,
          kgPerUom,
          kg: roundTo(bucket.kg),
          units: roundTo(bucket.units),
          // Misma regla que el informe: SAC en sacos, granel sin columna.
          sacks: sacksOf(bucket.kg, bucket.units, uom, kgPerUom),
          sharePct: share(bucket.kg),
        };
      })
      .sort((a, b) => b.kg - a.kg || a.productCode.localeCompare(b.productCode));

    // ---------- Cartera pendiente del día (cartera local) ----------
    const pendingCustomersMap = new Map<
      string,
      { customerCode: string; customerName: string; kg: number; orders: Set<string>; lines: ForecastSalesDayPendingLine[] }
    >();
    const pendingProductsMap = new Map<
      string,
      { productCode: string; description: string; uom: string; kg: number; orders: Set<string> }
    >();
    const pendingOrderSet = new Set<string>();
    let pendingKg = 0;

    for (const line of pendingLines) {
      const customerCode = line.customerCode?.trim() || NO_CUSTOMER;
      const customerName =
        line.customerName?.trim() || (customerCode === NO_CUSTOMER ? NO_CUSTOMER_LABEL : customerCode);

      pendingKg += line.kg;
      pendingOrderSet.add(line.orderNumber);

      const customer = pendingCustomersMap.get(customerCode) ?? {
        customerCode,
        customerName,
        kg: 0,
        orders: new Set<string>(),
        lines: [] as ForecastSalesDayPendingLine[],
      };
      customer.kg += line.kg;
      customer.orders.add(line.orderNumber);
      customer.lines.push({
        orderNumber: line.orderNumber,
        lineNumber: line.lineNumber,
        productCode: line.productCode,
        description: line.description,
        uom: line.uom,
        kg: roundTo(line.kg),
        pendingQty: roundTo(line.pendingQty),
        requestedDate: isoDateOnly(line.requestedDate),
        tentativeDate: isoDateOnly(line.tentativeDate),
        authorized: line.authorized,
      });
      pendingCustomersMap.set(customerCode, customer);

      const product = pendingProductsMap.get(line.productCode) ?? {
        productCode: line.productCode,
        description: line.description,
        uom: line.uom,
        kg: 0,
        orders: new Set<string>(),
      };
      product.kg += line.kg;
      product.orders.add(line.orderNumber);
      pendingProductsMap.set(line.productCode, product);
    }

    // Porcentaje sobre el total pendiente del día (no sobre la venta).
    const pendingShare = (kg: number) => (pendingKg > 0 ? roundTo((kg / pendingKg) * 100, 1) : null);

    const pendingCustomerRows: ForecastSalesDayPendingCustomer[] = [...pendingCustomersMap.values()]
      .map((customer) => ({
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        kg: roundTo(customer.kg),
        orderCount: customer.orders.size,
        sharePct: pendingShare(customer.kg),
        lines: customer.lines.sort((a, b) => b.kg - a.kg || a.orderNumber.localeCompare(b.orderNumber)),
      }))
      .sort((a, b) => b.kg - a.kg || a.customerName.localeCompare(b.customerName));

    const pendingProductRows: ForecastSalesDayPendingProduct[] = [...pendingProductsMap.values()]
      .map((product) => ({
        productCode: product.productCode,
        description: product.description,
        uom: product.uom,
        kg: roundTo(product.kg),
        orderCount: product.orders.size,
        sharePct: pendingShare(product.kg),
      }))
      .sort((a, b) => b.kg - a.kg || a.productCode.localeCompare(b.productCode));

    return {
      date,
      available: salesAvailable,
      kg: roundTo(totalKg),
      units: roundTo(totalUnits),
      products: productRows,
      customers: customerRows,
      pendingAvailable,
      pendingKg: roundTo(pendingKg),
      pendingOrders: pendingOrderSet.size,
      pendingProducts: pendingProductRows,
      pendingCustomers: pendingCustomerRows,
      truncated: rows.length >= DAY_DETAIL_QUERY_LIMIT,
      generatedAt: new Date().toISOString(),
    };
  }

  private rememberDayDetail(key: string, data: ForecastSalesDayDetail) {
    if (this.dayDetailCache.size >= SALES_CACHE_MAX_ENTRIES) {
      const oldest = [...this.dayDetailCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.dayDetailCache.delete(oldest[0]);
    }
    this.dayDetailCache.set(key, { at: Date.now(), data });
  }

  /**
   * Meta de la empresa del mes, en kg, con la MISMA resolución que el informe
   * de ventas (viva de `forecast` o snapshot local). La usa el módulo de
   * vendedores para repartir la meta sin duplicar la regla de captura/drift.
   */
  async companyTarget(
    year: number,
    month: number,
    status: ForecastSalesStatus,
  ): Promise<{ totalKg: number; available: boolean; source: ForecastSalesSource }> {
    const key = monthKey(year, month);
    const [series, targets] = await Promise.all([
      this.profitForecastSeries([{ year, month }]),
      this.forecastTargetIndex([{ year, month }]),
    ]);
    const live = series.byMonth.get(key) ?? new Map<string, number>();
    const captured = targets.get(key) ?? new Map<string, ForecastTargetMeta>();
    const resolved = resolveForecastTargets(status, series.available, live, captured);
    return { totalKg: resolved.totalKg, available: resolved.forecastAvailable, source: resolved.source };
  }

  // ============================================================
  // Participación por cliente.
  //
  // Sin histórico ni meta: se lee la venta ABA del mes hasta el corte y se
  // calcula qué porcentaje representa cada cliente sobre el total. Cada
  // producto del cliente lleva su peso dentro del cliente y dentro de la venta
  // total de ese producto. Los clientes del catálogo sin venta se incluyen con
  // 0 % para que la tabla sea completa.
  // ============================================================
  async customerSalesReport(query: ForecastSalesQuery): Promise<ForecastCustomerSalesResponse> {
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

    const cacheKey = [year, month, query.includeToday ? 1 : 0, today].join('|');
    const cached = this.customerSalesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SALES_CACHE_TTL_MS) return cached.data;

    try {
      const data = await this.buildCustomerSalesReport(calendar, query.includeToday);
      this.rememberCustomerSales(cacheKey, data);
      return data;
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la participación por cliente (not_ent/reng_nde): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return this.emptyCustomerSalesReport(calendar);
    }
  }

  private async buildCustomerSalesReport(
    calendar: MonthCalendar,
    includeToday: boolean,
  ): Promise<ForecastCustomerSalesResponse> {
    const { year, month } = calendar;
    const reportStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [todayYear, todayMonth, todayDay] = calendar.today.split('-').map(Number) as [number, number, number];

    let monthlyHasta = monthEnd;
    if (calendar.status === 'OPEN') {
      monthlyHasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + (includeToday ? 1 : 0)));
    } else if (calendar.status === 'FUTURE') {
      monthlyHasta = reportStart;
    }

    const rows = await this.profit.selectQuery(
      PROFIT_SALES_CUSTOMER_PRODUCT_SQL,
      CUSTOMER_PRODUCTS_QUERY_LIMIT,
      { desde: reportStart, hasta: monthlyHasta },
    );

    const productMeta = new Map<string, { description: string; uom: string; kgPerUom: number | null }>();
    const salesNames = new Map<string, string>();
    const lastInvoiceByCustomer = new Map<string, string>();
    const sales: CustomerProductSale[] = [];
    let skipped = 0;

    for (const raw of rows) {
      const customerCode = String(raw.co_cli ?? '').trim();
      const productCode = String(raw.co_art ?? '').trim();
      if (!customerCode || !productCode) {
        skipped += 1;
        continue;
      }

      const kg = num(raw.kg);
      const units = num(raw.unid);
      const customerName = String(raw.cli_des ?? '').trim();
      if (customerName) salesNames.set(customerCode, customerName);

      const meta = productMeta.get(productCode);
      const uom = String(raw.uni_venta ?? '').trim() || meta?.uom || 'KG';
      const relation = raw.uni_relac === null || raw.uni_relac === undefined ? null : num(raw.uni_relac);
      productMeta.set(productCode, {
        description: String(raw.art_des ?? '').trim() || meta?.description || productCode,
        uom,
        kgPerUom: uom === 'SAC' && relation !== null && relation > 0 ? relation : (meta?.kgPerUom ?? null),
      });

      const lastInvoice = isoDayOf(raw.ultima_factura);
      if (lastInvoice) {
        const previous = lastInvoiceByCustomer.get(customerCode);
        if (!previous || lastInvoice > previous) lastInvoiceByCustomer.set(customerCode, lastInvoice);
      }

      sales.push({ customerCode, productCode, kg, units });
    }

    if (skipped > 0) {
      this.logger.warn(`Participación por cliente: ${skipped} filas sin cliente o artículo fueron ignoradas.`);
    }

    // El catálogo activo permite incluir clientes sin venta con 0 %.
    const catalogByCode = new Map<string, CustomerInfo>();
    try {
      const catalog = await this.prisma.customer.findMany({
        where: { isActive: true },
        select: { externalCode: true, name: true, customerType: true, vendor: true },
      });
      for (const customer of catalog) {
        catalogByCode.set(customer.externalCode, {
          code: customer.externalCode,
          name: customer.name,
          customerType: customer.customerType,
          vendor: customer.vendor,
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el catálogo local de clientes: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }

    // Un cliente con venta que no esté en la BD local se agrega con el nombre
    // que trae Profit, para que la tabla y el total no pierdan esa venta.
    for (const customerCode of new Set(sales.map((sale) => sale.customerCode))) {
      if (catalogByCode.has(customerCode)) continue;
      catalogByCode.set(customerCode, {
        code: customerCode,
        name: salesNames.get(customerCode) || customerCode,
        customerType: null,
        vendor: null,
      });
    }

    const result = buildCustomerShare({
      sales,
      catalog: [...catalogByCode.values()],
      products: productMeta,
      lastInvoiceByCustomer,
    });

    return {
      year,
      month,
      asOf: calendar.cut,
      status: calendar.status,
      salesAvailable: true,
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
      totals: result.totals,
      customers: result.customers,
      truncated: rows.length >= CUSTOMER_PRODUCTS_QUERY_LIMIT,
      generatedAt: new Date().toISOString(),
    };
  }

  private emptyCustomerSalesReport(calendar: MonthCalendar): ForecastCustomerSalesResponse {
    return {
      year: calendar.year,
      month: calendar.month,
      asOf: calendar.cut,
      status: calendar.status,
      salesAvailable: false,
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
        actualKg: 0,
        actualUnits: 0,
        customerCount: 0,
        activeCustomerCount: 0,
        productCount: 0,
        lastInvoiceDate: null,
      },
      customers: [],
      truncated: false,
      generatedAt: new Date().toISOString(),
    };
  }

  private rememberCustomerSales(key: string, data: ForecastCustomerSalesResponse) {
    if (this.customerSalesCache.size >= SALES_CACHE_MAX_ENTRIES) {
      const oldest = [...this.customerSalesCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.customerSalesCache.delete(oldest[0]);
    }
    this.customerSalesCache.set(key, { at: Date.now(), data });
  }

  private async buildSalesReport(query: ForecastSalesQuery, calendar: MonthCalendar): Promise<ForecastSalesResponse> {
    const { year, month } = calendar;
    const reportStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const [todayYear, todayMonth, todayDay] = calendar.today.split('-').map(Number) as [number, number, number];

    let monthlyHasta = monthEnd;
    let dailyHasta: Date | null = monthEnd;

    if (calendar.status === 'OPEN') {
      // Corte a ayer: el día en curso solo entra si `includeToday`.
      monthlyHasta = new Date(
        Date.UTC(todayYear, todayMonth - 1, todayDay + (query.includeToday ? 1 : 0)),
      );
      // La serie diaria sí incluye hoy para mostrarlo como «parcial».
      dailyHasta = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay + 1));
    } else if (calendar.status === 'FUTURE') {
      monthlyHasta = reportStart;
      dailyHasta = null;
    }

    const historyStart = new Date(Date.UTC(year, month - 1 - query.months, 1));
    // El mes del informe siempre entra: en un mes en curso es la meta viva; en
    // uno cerrado, el snapshot. Incluso con meta viva necesitamos sus metadatos
    // para saber si Profit la cambió después de capturarla.
    const historyMonths = previousMonths(year, month, query.months);
    const targetMonths = [{ year, month }, ...historyMonths];

    const [monthlyRows, dailyRows, dailyProductRows, forecastSeries, catalog, pending] = await Promise.all([
      this.profit.selectQuery(PROFIT_SALES_MONTHLY_SQL, 20000, { desde: historyStart, hasta: monthlyHasta }),
      dailyHasta
        ? this.profit.selectQuery(PROFIT_SALES_DAILY_SQL, 3000, { desde: reportStart, hasta: dailyHasta })
        : Promise.resolve([] as Record<string, unknown>[]),
      dailyHasta
        ? this.profit
            .selectQuery(PROFIT_SALES_DAILY_PRODUCTS_SQL, 6000, { desde: reportStart, hasta: dailyHasta })
            // Consulta complementaria: si falla, el panel del día queda vacío
            // pero el informe (totales, proyección y tabla) sigue disponible.
            .catch((error: unknown) => {
              this.logger.warn(
                `Desglose diario por artículo no disponible: ${
                  error instanceof Error ? error.message : 'error desconocido'
                }`,
              );
              return [] as Record<string, unknown>[];
            })
        : Promise.resolve([] as Record<string, unknown>[]),
      // Una sola consulta de `forecast` trae el mes del informe y el histórico:
      // `fecha` identifica el mes de cada fila.
      this.profitForecastSeries(targetMonths),
      // Catálogo local de producción: el informe lista TODOS los artículos ABA,
      // aunque no tengan meta ni venta en el mes.
      this.prisma.product.findMany({
        where: { isProduction: true, isActive: true },
        select: { externalCode: true, description: true, uom: true, kgPerUom: true },
      }),
      // Cartera comprometida del mes (pedidos locales + fecha tentativa). Si la
      // lectura falla, el pronóstico queda en cero pero el informe sigue vivo.
      calendar.status === 'FUTURE'
        ? Promise.resolve(emptyPendingBuckets())
        : this.pendingSalesBuckets(year, month).catch((error: unknown) => {
            this.logger.warn(
              `No se pudo leer la cartera de pedidos para el pronóstico: ${
                error instanceof Error ? error.message : 'error desconocido'
              }`,
            );
            return emptyPendingBuckets();
          }),
    ]);

    const catalogMeta = new Map<
      string,
      { description: string; uom: string; kgPerUom: number | null; lastInvoiceDate: string | null }
    >();
    for (const product of catalog) {
      catalogMeta.set(product.externalCode, {
        description: product.description,
        uom: product.uom,
        kgPerUom: product.kgPerUom === null || product.kgPerUom === undefined ? null : num(product.kgPerUom),
        lastInvoiceDate: null,
      });
    }

    const reportKey = monthKey(year, month);
    const globalByMonth = new Map<string, SalesMonthBucket>();
    const byCodeMonth = new Map<string, Map<string, SalesMonthBucket>>();
    const salesMeta = new Map<string, SalesProductMeta>();

    // La captura de la meta NO se hace aquí: este endpoint es de solo lectura.
    // `ForecastTargetScheduler` guarda el snapshot cada hora (y `captureForecastTargets`
    // sigue disponible para ejecutarlo a demanda). Antes se escribía dentro del GET,
    // lo que añadía cientos de upserts a la primera carga del informe.
    for (const raw of monthlyRows) {
      const rowYear = num(raw.anio);
      const rowMonth = num(raw.mes);
      const code = String(raw.co_art ?? '').trim();
      if (!rowYear || !rowMonth || !code) continue;

      const kg = num(raw.kg);
      const units = num(raw.unid);
      const key = monthKey(rowYear, rowMonth);
      addBucket(globalByMonth, key, kg, units);

      let perCode = byCodeMonth.get(code);
      if (!perCode) {
        perCode = new Map();
        byCodeMonth.set(code, perCode);
      }
      addBucket(perCode, key, kg, units);

      const uom = String(raw.uni_venta ?? '').trim() || 'KG';
      const relation = raw.uni_relac === null || raw.uni_relac === undefined ? null : num(raw.uni_relac);
      const lastInvoice = isoDayOf(raw.ultima_factura);
      const previous = salesMeta.get(code);
      salesMeta.set(code, {
        description: String(raw.art_des ?? '').trim() || previous?.description || code,
        uom,
        kgPerUom: uom === 'SAC' && relation !== null && relation > 0 ? relation : (previous?.kgPerUom ?? null),
        lastInvoiceDate: [previous?.lastInvoiceDate, lastInvoice].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null,
      });
    }

    // Filas = catálogo de producción completo + artículos con venta en este mes
    // + artículos con meta. El catálogo manda para que «todos» incluya también
    // los que no tienen meta ni venta (quedan en 0 y se pueden filtrar en la UI).
    const currentSalesCodes = [...byCodeMonth.entries()]
      .filter(([, months]) => months.has(reportKey))
      .map(([code]) => code);
    const targetsByMonth = await this.forecastTargetIndex(targetMonths);
    const reportTargets = targetsByMonth.get(reportKey) ?? new Map<string, ForecastTargetMeta>();
    const reportForecast = forecastSeries.byMonth.get(reportKey) ?? new Map<string, number>();
    const isLive = calendar.status === 'OPEN';
    // Regla única de meta (compartida con Vendedoras vs Forecast).
    const resolvedTargets = resolveForecastTargets(
      calendar.status,
      forecastSeries.available,
      reportForecast,
      reportTargets,
    );
    const useLive = resolvedTargets.useLive;
    const forecastAvailable = resolvedTargets.forecastAvailable;
    // Incluye tanto la meta viva como la capturada: si un artículo desapareció
    // de `forecast`, debe seguir visible para que la UI muestre el drift.
    const forecastCodes = new Set<string>(resolvedTargets.codes);
    const codes = new Set<string>([
      ...catalogMeta.keys(),
      ...currentSalesCodes,
      ...forecastCodes,
    ]);
    const productRows = await this.productMeta(
      [...codes].filter((code) => !salesMeta.has(code) && !catalogMeta.has(code)),
    );

    const rows: ForecastSalesRow[] = [...codes].map((code) => {
      const info = salesMeta.get(code);
      const product = catalogMeta.get(code) ?? productRows.get(code);
      const uom = info?.uom ?? product?.uom ?? 'KG';
      const kgPerUom = info?.kgPerUom ?? product?.kgPerUom ?? null;
      const agg = byCodeMonth.get(code)?.get(reportKey) ?? { kg: 0, units: 0 };
      const captured = reportTargets.get(code);
      const capturedKg = captured ? roundTo(captured.targetKg) : null;
      const liveKg = useLive ? roundTo(reportForecast.get(code) ?? 0) : null;
      // Regla: el mes en curso usa la meta VIVA de Profit; un mes cerrado con
      // snapshot conserva la meta congelada. Si no hay snapshot, se usa la
      // lectura viva de `forecast` para ese mes.
      const forecastKg = resolvedTargets.byCode.get(code) ?? 0;
      const rowHistory = historyMonths.map((entry) => {
        const key = monthKey(entry.year, entry.month);
        const bucket = byCodeMonth.get(code)?.get(key);
        const target = targetsByMonth.get(key)?.get(code);
        const live = forecastSeries.byMonth.get(key)?.get(code);
        return {
          year: entry.year,
          month: entry.month,
          kg: bucket?.kg ?? 0,
          units: bucket?.units ?? 0,
          forecastKg: target ? roundTo(target.targetKg) : live === undefined ? null : roundTo(live),
        };
      });
      const metrics = computeRunRate({
        actualKg: agg.kg,
        forecastKg,
        calendar,
        history: rowHistory.map((entry) => entry.kg),
      });

      return {
        productCode: code,
        description: info?.description || product?.description || code,
        uom,
        kgPerUom,
        forecastKg,
        forecastCapturedKg: capturedKg,
        forecastLiveKg: liveKg,
        forecastCapturedAt: captured?.firstCapturedAt ?? null,
        // El drift solo se muestra en el mes en curso: en un cerrado no hay
        // lectura viva con la que comparar.
        forecastDriftAt: isLive ? (captured?.driftDetectedAt ?? null) : null,
        actualKg: roundTo(agg.kg),
        actualUnits: roundTo(agg.units),
        // Los sacos solo tienen sentido en artículos SAC: kg / kg por saco.
        actualSacks:
          uom === 'SAC' ? roundTo(kgPerUom !== null && kgPerUom > 0 ? agg.kg / kgPerUom : agg.units, 1) : null,
        ...metrics,
        lastInvoiceDate: info?.lastInvoiceDate ?? null,
        history: rowHistory.map((entry) => ({
          year: entry.year,
          month: entry.month,
          actualKg: roundTo(entry.kg),
          actualUnits: roundTo(entry.units),
          forecastKg: entry.forecastKg,
        })),
      };
    });

    rows.sort(
      (a, b) => b.forecastKg - a.forecastKg || b.actualKg - a.actualKg || a.productCode.localeCompare(b.productCode),
    );

    const totalForecastKg = roundTo(rows.reduce((acc, row) => acc + row.forecastKg, 0));
    const totalActualKg = roundTo(rows.reduce((acc, row) => acc + row.actualKg, 0));
    const totalActualUnits = roundTo(rows.reduce((acc, row) => acc + row.actualUnits, 0));

    const globalHistory = historyMonths.map(
      (entry) => globalByMonth.get(monthKey(entry.year, entry.month))?.kg ?? 0,
    );
    const totals = computeRunRate({
      actualKg: totalActualKg,
      forecastKg: totalForecastKg,
      calendar,
      history: globalHistory,
    });

    let invoiceCount = 0;
    let lastInvoiceDate: string | null = null;
    for (const raw of dailyRows) {
      const day = isoDayOf(raw.fecha);
      if (!day || !calendar.cut || day > calendar.cut) continue;
      invoiceCount += Math.trunc(num(raw.facturas));
      if (!lastInvoiceDate || day > lastInvoiceDate) lastInvoiceDate = day;
    }

    const history: ForecastSalesHistory[] = historyMonths.map((entry) => {
      const key = monthKey(entry.year, entry.month);
      const bucket = globalByMonth.get(key);
      const targets = targetsByMonth.get(key);
      const live = forecastSeries.byMonth.get(key);
      return {
        year: entry.year,
        month: entry.month,
        actualKg: roundTo(bucket?.kg ?? 0),
        actualUnits: roundTo(bucket?.units ?? 0),
        // Snapshot congelado si existe; si no, la meta viva de `forecast` para
        // ese mes (la tabla ya trae el mes de vigencia en `fecha`).
        forecastKg:
          targets && targets.size > 0
            ? roundTo([...targets.values()].reduce((acc, target) => acc + target.targetKg, 0))
            : live && live.size > 0
              ? roundTo([...live.values()].reduce((acc, kg) => acc + kg, 0))
              : null,
      };
    });

    // Origen de la meta del mes del informe. `NONE` no es un error: un mes sin
    // meta en `forecast` ni snapshot simplemente no tiene meta.
    // `CAPTURED` = mes en curso sin lectura viva; se usa la captura local.
    const forecastSource: ForecastSalesSource = resolvedTargets.source;

    return {
      year,
      month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: true,
      forecastAvailable,
      forecastSource,
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
        forecastKg: totalForecastKg,
        actualKg: totalActualKg,
        actualUnits: totalActualUnits,
        pendingKg: pending.totalKg,
        pendingOrders: pending.totalOrders,
        ...totals,
        invoiceCount,
        lastInvoiceDate,
      },
      daily: this.buildDailySeries(calendar, dailyRows, dailyProductRows, totalForecastKg, pending.byDay),
      history,
      rows,
      generatedAt: new Date().toISOString(),
    };
  }

  // Serie diaria del mes: real hasta el corte, proyección desde el corte y
  // ritmo uniforme del forecast (solo si hay meta).
  private buildDailySeries(
    calendar: MonthCalendar,
    dailyRows: Record<string, unknown>[],
    dailyProductRows: Record<string, unknown>[],
    forecastKg: number,
    pendingByDay: Map<number, { kg: number; orders: number }> = new Map(),
  ): ForecastSalesDaily[] {
    if (calendar.status === 'FUTURE') return [];

    const byDay = new Map<number, { kg: number; units: number; invoices: number }>();
    for (const raw of dailyRows) {
      const day = isoDayOf(raw.fecha);
      if (!day) continue;
      const dayNumber = Number(day.slice(8, 10));
      if (!Number.isFinite(dayNumber)) continue;
      const bucket = byDay.get(dayNumber) ?? { kg: 0, units: 0, invoices: 0 };
      bucket.kg += num(raw.kg);
      bucket.units += num(raw.unid);
      bucket.invoices += num(raw.facturas);
      byDay.set(dayNumber, bucket);
    }

    // Desglose por artículo y día (misma fecha, distinta agrupación).
    const productsByDay = new Map<number, Map<string, { kg: number; units: number }>>();
    for (const raw of dailyProductRows) {
      const day = isoDayOf(raw.fecha);
      const code = String(raw.co_art ?? '').trim();
      if (!day || !code) continue;
      const dayNumber = Number(day.slice(8, 10));
      if (!Number.isFinite(dayNumber)) continue;
      const perCode = productsByDay.get(dayNumber) ?? new Map<string, { kg: number; units: number }>();
      const bucket = perCode.get(code) ?? { kg: 0, units: 0 };
      bucket.kg += num(raw.kg);
      bucket.units += num(raw.unid);
      perCode.set(code, bucket);
      productsByDay.set(dayNumber, perCode);
    }

    const cutDay = calendar.cut ? Number(calendar.cut.slice(8, 10)) : 0;
    const flags = workingDayFlags(calendar.year, calendar.month);
    const elapsedBasis = basisElapsed(calendar);
    const actualToCut = Array.from({ length: cutDay }, (_, index) => byDay.get(index + 1)?.kg ?? 0).reduce(
      (acc, value) => acc + value,
      0,
    );
    const dailyAvg = elapsedBasis > 0 ? actualToCut / elapsedBasis : 0;
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
          ? projectionSteps(calendar.basis, calendar.year, calendar.month, projectionStart, day)
          : 0;
      const projected =
        calendar.status === 'OPEN' && day >= projectionStart ? roundTo(actualToCut + dailyAvg * steps) : null;

      const dayProducts = [...(productsByDay.get(day)?.entries() ?? [])]
        .map(([productCode, item]) => ({
          productCode,
          kg: roundTo(item.kg),
          units: roundTo(item.units),
        }))
        .sort((a, b) => b.kg - a.kg || a.productCode.localeCompare(b.productCode));

      const dayPending = pendingByDay.get(day);

      series.push({
        date: isoDay(calendar.year, calendar.month, day),
        actualKg,
        actualUnits: roundTo(bucket?.units ?? 0),
        invoiceCount: Math.trunc(bucket?.invoices ?? 0),
        pendingKg: roundTo(dayPending?.kg ?? 0),
        pendingOrders: dayPending?.orders ?? 0,
        products: dayProducts,
        cumulativeKg: day <= cutDay ? roundTo(cumulativeActual) : null,
        projectedCumulativeKg: projected,
        forecastCumulativeKg: forecastKg > 0 ? roundTo(cumulativeForecast) : null,
      });
    }

    return series;
  }

  private emptySalesReport(calendar: MonthCalendar): ForecastSalesResponse {
    return {
      year: calendar.year,
      month: calendar.month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: false,
      forecastAvailable: false,
      forecastSource: 'NONE',
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
        forecastKg: 0,
        actualKg: 0,
        actualUnits: 0,
        pendingKg: 0,
        pendingOrders: 0,
        ...emptyMetrics(),
        invoiceCount: 0,
        lastInvoiceDate: null,
      },
      daily: [],
      history: [],
      rows: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // Snapshot mensual de la meta (`ForecastTarget`).
  //
  // `forecast` ya trae el mes en `fecha`, pero la meta se coloca una sola vez y
  // producción puede editarla después. El snapshot conserva el valor oficial
  // del mes (congelado) para que el histórico no cambie; si no existe, el
  // informe usa la lectura viva de `forecast` para ese mes. La captura es
  // idempotente y NUNCA escribe en Profit; si falla, el informe sigue
  // funcionando.
  // ============================================================

  /**
   * Captura la meta viva del mes en curso. La llaman el scheduler del módulo y
   * el arranque del informe; también se puede disparar a mano (`POST
   * /forecast/sales/capture`).
   */
  async captureForecastTargets(): Promise<{
    year: number;
    month: number;
    products: number;
    captured: boolean;
    created: number;
    corrected: number;
    frozen: number;
    drifted: number;
  }> {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const forecast = await this.profitForecastIndex(year, month);
    if (!forecast.available) {
      return { year, month, products: 0, captured: false, created: 0, corrected: 0, frozen: 0, drifted: 0 };
    }
    const stats = await this.persistForecastTargets(year, month, forecast.byCode);
    return { year, month, products: forecast.byCode.size, captured: true, ...stats };
  }

  /**
   * Captura la meta del mes en curso con la regla de negocio:
   *  · La primera lectura crea la meta.
   *  · Durante `FORECAST_TARGET_GRACE_HOURS` se puede corregir (carga tardía).
   *  · Después queda congelada: un cambio en Profit solo se registra como drift.
   *  · Un artículo que desaparece de `forecast` se trata como 0: durante la
   *    gracia corrige el target; después solo marca drift.
   * Nunca escribe en Profit ni en meses cerrados.
   */
  private async persistForecastTargets(
    year: number,
    month: number,
    byCode: Map<string, number>,
  ): Promise<CaptureStats> {
    const stats: CaptureStats = { created: 0, corrected: 0, frozen: 0, drifted: 0 };
    if (!this.isCurrentMonth(year, month)) return stats;

    const entries = [...byCode.entries()].filter(([code]) => code.length > 0);
    if (entries.length === 0) return stats;

    try {
      const existing = await this.prisma.forecastTarget.findMany({
        where: { year, month },
        select: {
          id: true,
          productCode: true,
          targetKg: true,
          capturedAt: true,
          firstCapturedAt: true,
          frozenAt: true,
          lastSeenKg: true,
          driftDetectedAt: true,
        },
      });
      const existingByCode = new Map(existing.map((row) => [row.productCode, row]));
      const now = new Date();
      const graceMs = targetGraceHours() * 60 * 60_000;

      const captureRow = async (row: (typeof existing)[number], liveKg: number): Promise<void> => {
        const firstCapturedAt = row.firstCapturedAt ?? row.capturedAt ?? now;
        const frozen = row.frozenAt !== null || now.getTime() - firstCapturedAt.getTime() >= graceMs;
        const targetKg = num(row.targetKg);
        const same = Math.abs(targetKg - liveKg) < 0.001;

        if (!frozen) {
          // Ventana de gracia: corrige la captura (cambio de mes o carga tardía).
          if (same) return;
          await this.prisma.forecastTarget.update({
            where: { id: row.id },
            data: {
              targetKg: liveKg,
              firstCapturedAt,
              lastSeenKg: liveKg,
              lastSeenAt: now,
              capturedAt: now,
              driftDetectedAt: null,
            },
          });
          stats.corrected += 1;
          return;
        }

        // Congelada: nunca se toca `targetKg`; solo se registra la diferencia.
        const wasFrozen = row.frozenAt === null;
        if (same) {
          if (wasFrozen || row.driftDetectedAt !== null) {
            await this.prisma.forecastTarget.update({
              where: { id: row.id },
              data: {
                firstCapturedAt,
                frozenAt: row.frozenAt ?? now,
                lastSeenKg: liveKg,
                lastSeenAt: now,
                driftDetectedAt: null,
              },
            });
          }
          if (wasFrozen) stats.frozen += 1;
          return;
        }

        const wasDrifting = row.driftDetectedAt !== null;
        await this.prisma.forecastTarget.update({
          where: { id: row.id },
          data: {
            firstCapturedAt,
            frozenAt: row.frozenAt ?? now,
            lastSeenKg: liveKg,
            lastSeenAt: now,
            driftDetectedAt: row.driftDetectedAt ?? now,
          },
        });
        if (wasFrozen) stats.frozen += 1;
        if (!wasDrifting) stats.drifted += 1;
      };

      for (const [productCode, targetKg] of entries) {
        const row = existingByCode.get(productCode);
        if (!row) {
          await this.prisma.forecastTarget.create({
            data: {
              year,
              month,
              productCode,
              targetKg,
              firstCapturedAt: now,
              lastSeenKg: targetKg,
              lastSeenAt: now,
              capturedAt: now,
            },
          });
          stats.created += 1;
          continue;
        }
        await captureRow(row, targetKg);
      }

      // Artículos que estaban capturados y desaparecieron de `forecast`.
      for (const row of existing) {
        if (byCode.has(row.productCode)) continue;
        await captureRow(row, 0);
      }

      if (stats.created + stats.corrected + stats.frozen + stats.drifted > 0) {
        this.logger.log(
          `ForecastTarget ${year}-${pad2(month)}: ${stats.created} nuevas, ${stats.corrected} corregidas, ` +
            `${stats.frozen} congeladas, ${stats.drifted} con diferencia en Profit.`,
        );
      }
    } catch (error) {
      // La captura es un extra: si la BD local falla, el informe sigue en pie.
      this.logger.warn(
        `No se pudo guardar el snapshot de la meta ${year}-${pad2(month)}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
    return stats;
  }

  /**
   * Acepta un cambio de Profit sobre una meta ya congelada. Solo para el mes en
   * curso y con permiso `forecast:update`; deja rastro en la bitácora.
   */
  async acceptTargetDrift(
    year: number,
    month: number,
    productCode: string,
  ): Promise<{ ok: boolean; targetKg: number | null }> {
    if (!this.isCurrentMonth(year, month)) {
      throw new BadRequestException('Solo se puede aceptar un cambio de meta del mes en curso.');
    }
    const row = await this.prisma.forecastTarget.findUnique({
      where: { year_month_productCode: { year, month, productCode } },
    });
    if (!row) throw new NotFoundException('No hay una meta capturada para ese artículo.');
    if (row.lastSeenKg === null || row.lastSeenKg === undefined) {
      throw new BadRequestException('Todavía no hay una lectura viva de Profit para aceptar.');
    }

    const liveKg = num(row.lastSeenKg);
    if (Math.abs(num(row.targetKg) - liveKg) < 0.001) {
      return { ok: true, targetKg: num(row.targetKg) };
    }

    const updated = await this.prisma.forecastTarget.update({
      where: { id: row.id },
      data: {
        targetKg: liveKg,
        capturedAt: new Date(),
        frozenAt: row.frozenAt ?? new Date(),
        driftDetectedAt: null,
      },
    });
    await this.audit.record({
      action: 'FORECAST_TARGET_ACCEPTED',
      entityType: 'ForecastTarget',
      entityId: row.id,
      context: { year, month, productCode, fromKg: num(row.targetKg), toKg: liveKg },
    });
    return { ok: true, targetKg: num(updated.targetKg) };
  }

  /**
   * Metas por mes (`yyyy-mm` → código → metadatos). Si la consulta falla,
   * devuelve un mapa vacío para no tumbar el informe.
   */
  private async forecastTargetIndex(
    months: { year: number; month: number }[],
  ): Promise<Map<string, Map<string, ForecastTargetMeta>>> {
    const map = new Map<string, Map<string, ForecastTargetMeta>>();
    if (months.length === 0) return map;
    try {
      const rows = await this.prisma.forecastTarget.findMany({
        where: { OR: months.map((entry) => ({ year: entry.year, month: entry.month })) },
        select: {
          year: true,
          month: true,
          productCode: true,
          targetKg: true,
          capturedAt: true,
          firstCapturedAt: true,
          frozenAt: true,
          lastSeenKg: true,
          driftDetectedAt: true,
        },
      });
      for (const row of rows) {
        const key = monthKey(row.year, row.month);
        let perCode = map.get(key);
        if (!perCode) {
          perCode = new Map();
          map.set(key, perCode);
        }
        perCode.set(row.productCode, {
          targetKg: num(row.targetKg),
          firstCapturedAt: isoOrNull(row.firstCapturedAt ?? row.capturedAt),
          frozenAt: isoOrNull(row.frozenAt),
          lastSeenKg: row.lastSeenKg === null || row.lastSeenKg === undefined ? null : num(row.lastSeenKg),
          driftDetectedAt: isoOrNull(row.driftDetectedAt),
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el snapshot de metas (ForecastTarget): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
    return map;
  }

  // Metadatos del catálogo local para artículos con forecast que aún no
  // tuvieron ventas en la ventana consultada (uom, kg por unidad, descripción).
  private async productMeta(codes: string[]) {
    const map = new Map<string, { description: string; uom: string; kgPerUom: number | null }>();
    if (codes.length === 0) return map;
    const products = await this.prisma.product.findMany({
      where: { externalCode: { in: codes } },
      select: { externalCode: true, description: true, uom: true, kgPerUom: true },
    });
    for (const product of products) {
      map.set(product.externalCode, {
        description: product.description,
        uom: product.uom,
        kgPerUom: product.kgPerUom === null || product.kgPerUom === undefined ? null : num(product.kgPerUom),
      });
    }
    return map;
  }

  private rememberSales(key: string, data: ForecastSalesResponse) {
    if (this.salesCache.size >= SALES_CACHE_MAX_ENTRIES) {
      const oldest = [...this.salesCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.salesCache.delete(oldest[0]);
    }
    this.salesCache.set(key, { at: Date.now(), data });
  }

  private rememberWeekly(key: string, data: WeeklySalesIndex) {
    if (this.weeklyCache.size >= SALES_CACHE_MAX_ENTRIES) {
      const oldest = [...this.weeklyCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.weeklyCache.delete(oldest[0]);
    }
    this.weeklyCache.set(key, { at: Date.now(), data });
  }

  // Despachos del mes por artículo y semana (notas de entrega), para contrastar
  // el plan contra lo realmente vendido. Caché de 5 minutos por 'year-month'.
  // Si Profit falla NO se lanza: `available=false` y mapa vacío para que la UI
  // avise en lugar de pintar ceros como si fueran ventas reales.
  private async weeklySalesIndex(year: number, month: number): Promise<WeeklySalesIndex> {
    const key = monthKey(year, month);
    const cached = this.weeklyCache.get(key);
    if (cached && Date.now() - cached.at < SALES_CACHE_TTL_MS) return cached.data;

    const desde = new Date(Date.UTC(year, month - 1, 1));
    const hasta = new Date(Date.UTC(year, month, 1));
    try {
      const rows = await this.profit.selectQuery(PROFIT_SALES_WEEKLY_SQL, 20000, { desde, hasta });
      const byCode = new Map<string, { weeks: number[]; monthKg: number }>();
      for (const raw of rows) {
        const code = String(raw.co_art ?? '').trim();
        if (!code) continue;
        const week = Math.trunc(num(raw.semana));
        if (week < 1 || week > WEEK_BOUNDS.length) continue;
        const entry = byCode.get(code) ?? { weeks: [0, 0, 0, 0], monthKg: 0 };
        entry.weeks[week - 1] = round3((entry.weeks[week - 1] ?? 0) + num(raw.kg));
        byCode.set(code, entry);
      }
      // El total del mes es la suma de las 4 semanas (un solo redondeo final).
      for (const entry of byCode.values()) {
        entry.monthKg = round3(entry.weeks.reduce((acc, kg) => acc + kg, 0));
      }
      const data: WeeklySalesIndex = { byCode, available: true };
      this.rememberWeekly(key, data);
      return data;
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer los despachos semanales de Profit (not_ent/reng_nde): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return { byCode: new Map(), available: false };
    }
  }

  // ---------- auxiliares ----------

  // Cantidades por semana. `useStored=false` (el forecast de Profit cambió o no
  // hay fila local) devuelve el PROMEDIO del mes; si es true respeta lo editado.
  private computeWeeks(monthlyQty: number, stored: { weekIndex: number; qty: unknown }[], useStored: boolean): ForecastWeekRow[] {
    const average = monthlyQty / WEEK_BOUNDS.length;
    return FORECAST_WEEK_INDEXES.map((weekIndex) => {
      const found = stored.find((w) => w.weekIndex === weekIndex);
      return { weekIndex, qty: round3(useStored && found ? num(found.qty) : average) };
    });
  }

  private async weeksOf(forecastId: string, monthlyQty: number): Promise<ForecastWeekRow[]> {
    const stored = await this.prisma.forecastWeek.findMany({ where: { forecastId } });
    return this.computeWeeks(monthlyQty, stored, true);
  }

  // Se compara contra la fecha del NEGOCIO (America/Caracas), no la del
  // servidor: la captura del snapshot y la aceptación de diferencias solo
  // aplican al mes en curso.
  private isCurrentMonth(year: number, month: number): boolean {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    return Number(today.slice(0, 4)) === year && Number(today.slice(5, 7)) === month;
  }

  // Forecast mensual por artículo desde Profit (`forecast.kg_mensual`), SIN
  // conversión. Se consulta el mes pedido con `fecha`, así que también sirve
  // para meses pasados y futuros. Si la consulta falla, se devuelve el mapa
  // vacío y `available=false` para que la UI avise en lugar de mostrar valores
  // inventados.
  private async profitForecastIndex(
    year: number,
    month: number,
  ): Promise<{ byCode: Map<string, number>; available: boolean }> {
    const series = await this.profitForecastSeries([{ year, month }]);
    return {
      byCode: series.byMonth.get(monthKey(year, month)) ?? new Map<string, number>(),
      available: series.available,
    };
  }

  // Lee `forecast` una sola vez para todos los meses pedidos. `fecha` es el mes
  // de vigencia: se agrupa por `yyyy-mm` y se descartan los meses no pedidos
  // (la consulta cubre el rango completo entre el primero y el último).
  private async profitForecastSeries(months: { year: number; month: number }[]): Promise<ForecastSeries> {
    const keys = [...new Set(months.map((entry) => monthKey(entry.year, entry.month)))].sort();
    if (keys.length === 0) return { byMonth: new Map(), available: true };

    const [minKey, maxKey] = [keys[0]!, keys[keys.length - 1]!];
    const [minYear, minMonth] = minKey.split('-').map(Number) as [number, number];
    const [maxYear, maxMonth] = maxKey.split('-').map(Number) as [number, number];
    const desde = new Date(Date.UTC(minYear, minMonth - 1, 1));
    const hasta = new Date(Date.UTC(maxYear, maxMonth, 1));

    try {
      const rows = await this.profit.selectQuery(PROFIT_FORECAST_SQL, 20000, { desde, hasta });
      const allowed = new Set(keys);
      const byMonth = new Map<string, Map<string, number>>();
      for (const raw of rows) {
        const day = isoDayOf(raw.fecha);
        if (!day) continue;
        const key = day.slice(0, 7);
        if (!allowed.has(key)) continue;
        const code = String(raw.co_art ?? '').trim();
        if (!code) continue;
        // `kg_mensual` viene en la presentación del artículo: SAC × kg por
        // saco; KG (o sin presentación conocida) se deja igual. Todo el
        // servicio trabaja en kg.
        const presentation = String(raw.uni_venta ?? '').trim().toUpperCase();
        const relation = raw.uni_relac === null || raw.uni_relac === undefined ? null : num(raw.uni_relac);
        const factor = presentation === '' || presentation === 'KG' || relation === null || relation <= 0 ? 1 : relation;
        const kg = num(raw.forecast_mes) * factor;
        let perCode = byMonth.get(key);
        if (!perCode) {
          perCode = new Map();
          byMonth.set(key, perCode);
        }
        if (perCode.has(code)) {
          this.logger.warn(`forecast trae más de una fila para ${key}/${code}; se usa la última.`);
        }
        perCode.set(code, kg);
      }
      return { byMonth, available: true };
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el forecast de Profit (forecast): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return { byMonth: new Map(), available: false };
    }
  }

  // Crea las 4 semanas. `reset=true` reescribe el promedio; `false` sólo crea
  // las que falten (sin pisar ajustes manuales del usuario).
  private async ensureWeeks(forecastId: string, monthlyQty: number, reset: boolean) {
    const average = round3(monthlyQty / WEEK_BOUNDS.length);
    for (const weekIndex of FORECAST_WEEK_INDEXES) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId, weekIndex } },
        update: reset ? { qty: average } : {},
        create: { forecastId, weekIndex, qty: average },
      });
    }
  }

  // Existencia por artículo (última fotografía de inventario): total y desglose.
  private async stockIndex(): Promise<Map<string, { total: number; byWarehouse: InventoryByWarehouse[] }>> {
    const snapshot = await this.prisma.inventorySnapshot.findFirst({
      orderBy: { takenAt: 'desc' },
      include: { lines: { include: { warehouse: true } } },
    });
    const map = new Map<string, { total: number; byWarehouse: InventoryByWarehouse[] }>();
    for (const l of snapshot?.lines ?? []) {
      const entry: InventoryByWarehouse = {
        warehouseCode: l.warehouseCode,
        warehouseName: l.warehouse?.name ?? null,
        qty: num(l.qty),
        reservedQty: num(l.reservedQty),
      };
      const bucket = map.get(l.productCode) ?? { total: 0, byWarehouse: [] };
      bucket.total += entry.qty;
      bucket.byWarehouse.push(entry);
      map.set(l.productCode, bucket);
    }
    for (const bucket of map.values()) bucket.total = round3(bucket.total);
    return map;
  }

  // Renglones de pedidos activos con entrega efectiva dentro del rango. La
  // fecha efectiva es la tentativa local cuando existe; si no, la que trae
  // Profit (`requestedDate`). También lee los renglones de pedidos que fueron
  // movidos al rango con fecha tentativa aunque su fecha original viva fuera.
  private async pendingLines(from: Date, to: Date): Promise<PendingLine[]> {
    const overrides = await this.prisma.deliveryDateOverride.findMany({
      where: { tentativeDate: { gte: from, lt: to } },
      select: { orderNumber: true, productCode: true, tentativeDate: true },
    });
    const overrideByKey = new Map(
      overrides.map((override) => [
        deliveryDateKey(override.orderNumber, override.productCode),
        override.tentativeDate,
      ]),
    );
    const overrideOrders = [...new Set(overrides.map((override) => override.orderNumber))];

    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        order: {
          isActive: true,
          OR: [
            { requestedDate: { gte: from, lt: to } },
            ...(overrideOrders.length > 0 ? [{ externalNumber: { in: overrideOrders } }] : []),
          ],
        },
      },
      select: {
        lineNumber: true,
        productCode: true,
        description: true,
        uom: true,
        pendingQty: true,
        pendingKg: true,
        order: {
          select: {
            externalNumber: true,
            requestedDate: true,
            customerCode: true,
            customerName: true,
            authorized: true,
          },
        },
      },
    });

    const result: PendingLine[] = [];
    for (const line of lines) {
      const orderNumber = line.order.externalNumber;
      const tentativeDate = overrideByKey.get(deliveryDateKey(orderNumber, line.productCode)) ?? null;
      const effective = tentativeDate ?? line.order.requestedDate;
      if (!effective || effective < from || effective >= to) continue;

      const kg = Math.max(0, line.pendingKg === null || line.pendingKg === undefined ? 0 : num(line.pendingKg));
      if (kg <= 0) continue;

      result.push({
        day: effective.getUTCDate(),
        orderNumber,
        lineNumber: line.lineNumber,
        customerCode: line.order.customerCode,
        customerName: line.order.customerName,
        productCode: line.productCode,
        description: line.description ?? line.productCode,
        uom: line.uom ?? 'KG',
        kg,
        pendingQty: num(line.pendingQty),
        requestedDate: line.order.requestedDate,
        tentativeDate,
        authorized: line.order.authorized,
      });
    }
    return result;
  }

  // Cartera comprometida del mes: kg pendientes por día de entrega efectiva.
  // Los pedidos atrasados se quedan en su día original y los de otros meses no
  // entran (la tira sólo dibuja el mes del informe).
  private async pendingSalesBuckets(year: number, month: number): Promise<PendingSalesBuckets> {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const lines = await this.pendingLines(from, to);

    const byDay = new Map<number, { kg: number; orders: Set<string> }>();
    const monthOrders = new Set<string>();

    for (const line of lines) {
      const bucket = byDay.get(line.day) ?? { kg: 0, orders: new Set<string>() };
      bucket.kg += line.kg;
      bucket.orders.add(line.orderNumber);
      byDay.set(line.day, bucket);
      monthOrders.add(line.orderNumber);
    }

    return {
      byDay: new Map(
        [...byDay.entries()].map(([day, bucket]) => [
          day,
          { kg: roundTo(bucket.kg), orders: bucket.orders.size },
        ]),
      ),
      totalKg: roundTo([...byDay.values()].reduce((acc, bucket) => acc + bucket.kg, 0)),
      totalOrders: monthOrders.size,
    };
  }

  // Demanda de pedidos ACTIVOS del mes: total por artículo y por semana.
  private async demandBuckets(year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const lines = await this.prisma.salesOrderLine.findMany({
      where: { order: { isActive: true, requestedDate: { gte: from, lt: to } } },
      include: { order: { select: { requestedDate: true } } },
    });
    const byProduct = new Map<string, { qty: number; kg: number }>();
    const byProductWeek = new Map<string, { qty: number; kg: number }>();
    for (const l of lines) {
      const qty = num(l.pendingQty);
      const kg = l.pendingKg === null || l.pendingKg === undefined ? 0 : num(l.pendingKg);
      const total = byProduct.get(l.productCode) ?? { qty: 0, kg: 0 };
      total.qty += qty;
      total.kg += kg;
      byProduct.set(l.productCode, total);

      const date = l.order.requestedDate;
      const day = date ? date.getUTCDate() : 1;
      const key = `${l.productCode}#${weekIndexOf(day)}`;
      const bucket = byProductWeek.get(key) ?? { qty: 0, kg: 0 };
      bucket.qty += qty;
      bucket.kg += kg;
      byProductWeek.set(key, bucket);
    }
    return { byProduct, byProductWeek };
  }
}

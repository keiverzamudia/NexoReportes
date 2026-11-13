import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ForecastSalesDaily,
  ForecastSellerAllocationBasis,
  ForecastSellerAttribution,
  ForecastSellerClientRow,
  ForecastSellerHistory,
  ForecastSellerProductRow,
  ForecastSellerProductsResponse,
  ForecastSellerRow,
  ForecastSellersQuery,
  ForecastSellersResponse,
} from '@nexo/contracts';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import { ForecastService } from './forecast.service';
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

const BUSINESS_TIME_ZONE = 'America/Caracas';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 40;
const NO_SELLER = '__sin_vendedor__';
const NO_SELLER_LABEL = 'Sin vendedor';
const NO_CLIENT = '__sin_cliente__';
const NO_CLIENT_LABEL = 'Sin cliente';
// Cuentas internas de Profit: no son personas, pero hoy participan como una
// vendedor más en el reparto. Se marcan en la UI.
const INTERNAL_SELLER_CODES = new Set(['001', '004']);

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
  otherSellers: Set<string>;
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

  async sellersReport(query: ForecastSellersQuery): Promise<ForecastSellersResponse> {
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
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
    }

    try {
      const data = await this.build(query, calendar);
      this.remember(cacheKey, data);
      return data;
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer las ventas por vendedor de Profit (not_ent/reng_nde): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      return this.empty(calendar, query.attribution);
    }
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
    const historyStart = new Date(Date.UTC(year, month - 1 - query.months, 1));

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

    const [company, monthlyRows, dailyRows, portfolioRows] = await Promise.all([
      this.forecast.companyTarget(year, month, calendar.status),
      this.profit.selectQuery(PROFIT_SELLER_MONTHLY_SQL, 20000, { desde: historyStart, hasta: monthlyHasta }),
      dailyPromise,
      portfolioPromise,
    ]);

    const assignmentAvailable = portfolioRows.length > 0;
    const attribution: ForecastSellerAttribution =
      query.attribution === 'PORTFOLIO' && assignmentAvailable ? 'PORTFOLIO' : 'NOTE';

    const portfolioSellers = new Map<string, SellerAccum>();
    const noteSellers = new Map<string, SellerAccum>();
    const companyHistory = new Map<string, number>();
    const portfolioClients = new Set<string>();
    // Conteo por vendedor de la cartera leída en Profit. Se lleva aparte para
    // no mezclarlo con clientes que solo aparecen en las notas (inactivos).
    const portfolioAssignmentCounts = new Map<string, number>();
    const windowClients = new Set<string>();
    const activeClients = new Set<string>();

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
          otherSellers: new Set(),
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
    }

    // 2) Ventas: se acumulan por cartera y por nota al mismo tiempo.
    for (const raw of monthlyRows) {
      const rowYear = num(raw.anio);
      const rowMonth = num(raw.mes);
      if (!rowYear || !rowMonth) continue;
      const key = monthKey(rowYear, rowMonth);
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
        portfolioSeller.otherSellerKg += kg;
        portfolioClient.otherSellerKg += kg;
        if (notaName) portfolioClient.otherSellers.add(notaName);
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
    const sellerList = attribution === 'PORTFOLIO' ? portfolioSellerList : noteSellerList;
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

    const companyActual = roundTo(sellerList.reduce((acc, seller) => acc + seller.currentKg, 0));
    const companyUnits = roundTo(sellerList.reduce((acc, seller) => acc + seller.currentUnits, 0));
    const companyInvoices = sellerList.reduce((acc, seller) => acc + seller.currentInvoices, 0);
    const companyLastInvoice =
      sellerList
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
          return {
            clientCode: code === NO_CLIENT ? '' : code,
            clientName: baseClient?.name ?? code,
            customerType: baseClient?.customerType ?? null,
            assignedSellerCode: assignedCode === NO_SELLER ? '' : assignedCode,
            assignedSellerName: assignedName,
            otherSellerKg: roundTo(carteraClient?.otherSellerKg ?? 0),
            otherSellerNames: [...(carteraClient?.otherSellers ?? [])].sort((a, b) => a.localeCompare(b, 'es')),
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
            lastInvoiceDate: lastDates.at(-1) ?? null,
            isNew: chosenClientHistory <= 0 && chosenClientCurrent > 0,
            ...clientMetrics,
          };
        })
        .sort((a, b) => b.targetKg - a.targetKg || b.actualKg - a.actualKg || a.clientName.localeCompare(b.clientName, 'es'));

      const carteraHistory = historySeriesOf(carteraSeller);
      const noteHistory = historySeriesOf(noteSeller);
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
        carteraHistory,
        noteHistory,
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
        clients,
      };
    });

    rows.sort(
      (a, b) => b.targetKg - a.targetKg || b.actualKg - a.actualKg || a.sellerName.localeCompare(b.sellerName, 'es'),
    );

    const companyHistorySeries = historyMonths.map(
      (entry) => companyHistory.get(monthKey(entry.year, entry.month)) ?? 0,
    );
    const totalsMetrics = computeRunRate({
      actualKg: companyActual,
      forecastKg: company.totalKg,
      calendar,
      history: companyHistorySeries,
    });

    return {
      year,
      month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: true,
      forecastAvailable: company.available,
      forecastSource: company.source,
      attribution,
      assignmentAvailable,
      allocationBasis,
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
        invoiceCount: companyInvoices,
        lastInvoiceDate: companyLastInvoice,
        sellerCount: rows.length,
        clientCount: attribution === 'PORTFOLIO' ? portfolioClients.size : windowClients.size,
        assignedClientCount: assignmentAvailable ? portfolioClients.size : 0,
        windowClientCount: windowClients.size,
        activeClientCount: activeClients.size,
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
      attribution,
      assignmentAvailable: false,
      allocationBasis: 'NONE',
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
        ...emptyMetrics(),
        invoiceCount: 0,
        lastInvoiceDate: null,
        sellerCount: 0,
        clientCount: 0,
        assignedClientCount: 0,
        windowClientCount: 0,
        activeClientCount: 0,
      },
      daily: [],
      sellers: [],
      generatedAt: new Date().toISOString(),
    };
  }
}

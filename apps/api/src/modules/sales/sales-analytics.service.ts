import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SalesAnalyticsAlert,
  SalesAnalyticsComparison,
  SalesAnalyticsCustomer,
  SalesAnalyticsCustomersQuery,
  SalesAnalyticsCustomersResponse,
  SalesAnalyticsMonth,
  SalesAnalyticsProduct,
  SalesAnalyticsQuery,
  SalesAnalyticsResponse,
  SalesAnalyticsSort,
  SalesAnalyticsStatusBucket,
  SalesAnalyticsTopCustomer,
  SalesAnalyticsTotals,
  SalesAnalyticsVendor,
  SalesAnalyticsYear,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import {
  addMonths,
  dayKey,
  dayRangeInMonth,
  daysBetween,
  daysInMonth,
  lastDayKeyOfMonth,
  monthKeyFromDate,
  monthKeyFromParts,
  monthKeysOfYear,
  monthLabel,
  pctChange,
  round1,
  round2,
  sharePct,
  toNumber,
  toNumberOrNull,
} from './sales-analytics.calculations';

// ============================================================
// Analítica comercial de Pedidos (solo lectura).
//
// Tres fuentes deliberadamente separadas:
//   1. VENTAS/DESPACHOS: notas de entrega de Profit (`not_ent` + `reng_nde`).
//      Es la misma base del Forecast, así los kg cuadran entre módulos.
//   2. FACTURACIÓN: documentos de CxC (`docum_cc`), con conversión USD/Bs.
//      Puede ser parcial si un documento no trae tasa.
//   3. PEDIDOS LOCALES: cartera viva (pendiente) y cierres del ciclo de vida
//      (procesado / cancelado). Nunca se usan para el histórico largo.
//
// La comparación se hace contra el MISMO tramo del año anterior: un mes en
// curso contra los mismos días del año pasado, no contra un mes completo.
// ============================================================

export const SALES_ANALYTICS_MONTHLY_SQL = `
SELECT /* nexo:sales_analytics_monthly */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(f.co_cli) AS co_cli,
  RTRIM(ISNULL(c.cli_des, '')) AS cli_des,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven,
  RTRIM(ISNULL(v.ven_des, '')) AS ven_des,
  RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, '')) AS tipo,
  SUM(r.total_art) AS unid,
  SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) = 'SAC' THEN r.total_art ELSE 0 END) AS sacos,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas,
  MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.vendedor AS v ON v.co_ven = f.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (@vendor = '' OR RTRIM(ISNULL(v.ven_des, '')) = @vendor)
  AND (
    @tipo = ''
    OR RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, '')) = @tipo
  )
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), RTRIM(f.co_cli), RTRIM(ISNULL(c.cli_des, '')),
         RTRIM(ISNULL(f.co_ven, '')), RTRIM(ISNULL(v.ven_des, '')),
         RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, ''))
`;

export const SALES_ANALYTICS_BILLING_SQL = `
SELECT /* nexo:sales_analytics_billing */
  YEAR(cc.fec_emis) AS anio,
  MONTH(cc.fec_emis) AS mes,
  RTRIM(cc.co_cli) AS co_cli,
  SUM(CASE WHEN RTRIM(cc.tipo_doc) IN ('FACT', 'N/DB')
           THEN CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2) ELSE cc.monto_net END
           ELSE 0 END) AS facturado,
  SUM(CASE WHEN RTRIM(cc.tipo_doc) = 'N/CR'
           THEN CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2) ELSE cc.monto_net END
           ELSE 0 END) AS creditos,
  COUNT(DISTINCT cc.nro_doc) AS documentos,
  SUM(CASE WHEN @moneda = 'USD' AND (cc.tasa IS NULL OR cc.tasa = 0) THEN 1 ELSE 0 END) AS sin_tasa
FROM dbo.docum_cc AS cc
LEFT JOIN dbo.clientes AS c ON c.co_cli = cc.co_cli
LEFT JOIN dbo.vendedor AS v ON v.co_ven = c.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE cc.anulado = 0
  AND cc.fec_emis >= @desde
  AND cc.fec_emis < @hasta
  AND (@vendor = '' OR RTRIM(ISNULL(v.ven_des, '')) = @vendor)
  AND (
    @tipo = ''
    OR RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, '')) = @tipo
  )
GROUP BY YEAR(cc.fec_emis), MONTH(cc.fec_emis), RTRIM(cc.co_cli)
`;

export const SALES_ANALYTICS_PRODUCTS_SQL = `
SELECT /* nexo:sales_analytics_products */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  SUM(r.total_art) AS unid,
  SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) = 'SAC' THEN r.total_art ELSE 0 END) AS sacos,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.vendedor AS v ON v.co_ven = f.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (@vendor = '' OR RTRIM(ISNULL(v.ven_des, '')) = @vendor)
  AND (
    @tipo = ''
    OR RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, '')) = @tipo
  )
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), RTRIM(r.co_art), RTRIM(a.art_des)
`;

export const SALES_ANALYTICS_DAILY_SQL = `
SELECT /* nexo:sales_analytics_daily */
  CAST(f.fec_emis AS date) AS fecha,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  SUM(r.total_art) AS unid,
  COUNT(DISTINCT f.fact_num) AS notas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
LEFT JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.vendedor AS v ON v.co_ven = f.co_ven
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
  AND (@vendor = '' OR RTRIM(ISNULL(v.ven_des, '')) = @vendor)
  AND (
    @tipo = ''
    OR RTRIM(ISNULL(c.tipo, '') + ' ' + ISNULL(tc.des_tipo, '')) = @tipo
  )
GROUP BY CAST(f.fec_emis AS date)
`;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 60;
const MONTHLY_QUERY_LIMIT = 60_000;
const BILLING_QUERY_LIMIT = 60_000;
const PRODUCT_QUERY_LIMIT = 30_000;
const DAILY_QUERY_LIMIT = 4_000;
const TOP_CUSTOMERS = 10;
const TOP_PRODUCTS = 10;
const ALERT_LIMIT = 6;
const DROP_THRESHOLD_KG = 5_000;
const DROP_PCT = -20;

interface VolumeRow {
  month: string;
  code: string;
  name: string;
  vendor: string;
  customerType: string;
  units: number;
  sacks: number;
  kg: number;
  notes: number;
  lastSaleDate: string | null;
}

interface BillingRow {
  month: string;
  code: string;
  billed: number;
  documents: number;
  missingRate: number;
}

interface ProductRow {
  month: string;
  code: string;
  description: string;
  units: number;
  sacks: number;
  kg: number;
  notes: number;
}

interface DailyRow {
  date: string;
  kg: number;
  units: number;
  notes: number;
}

interface LocalOrderRow {
  month: string;
  code: string;
  name: string;
  vendor: string;
  customerType: string;
  kg: number;
  orderNumber: string;
  status: string;
  billingStatus: string;
}

interface PendingOrderRow {
  code: string;
  name: string;
  vendor: string;
  customerType: string;
  kg: number;
  orderNumber: string;
  requestedDate: string | null;
}

interface CustomerAccumulator {
  code: string;
  name: string;
  vendor: string | null;
  customerType: string | null;
  kg: number;
  sacks: number;
  notes: number;
  billed: number | null;
  lastSaleDate: string | null;
  prevYearKg: number;
  prevBilled: number | null;
  pendingKg: number;
  pendingOrders: Set<string>;
}

interface ComputedAnalytics {
  response: SalesAnalyticsResponse;
  customers: SalesAnalyticsCustomer[];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText ? valueText : null;
}

function day(value: unknown): string | null {
  return dayKey(value);
}

function monthOfRow(raw: Record<string, unknown>): string | null {
  return monthKeyFromParts(raw.anio, raw.mes) || monthKeyFromDate(raw.fecha);
}

@Injectable()
export class SalesAnalyticsService {
  private readonly logger = new Logger(SalesAnalyticsService.name);
  private readonly cache = new Map<string, { at: number; value: ComputedAnalytics }>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  // ---------- API pública ----------

  async get(query: SalesAnalyticsQuery): Promise<SalesAnalyticsResponse> {
    return (await this.compute(query)).response;
  }

  async customers(query: SalesAnalyticsCustomersQuery): Promise<SalesAnalyticsCustomersResponse> {
    const computed = await this.compute(query);
    const search = (query.q ?? '').trim().toLowerCase();
    let rows = computed.customers;

    // Cruce CxC: acota la respuesta a los códigos que pidió el frontend.
    const codes = new Set(
      (query.codes ?? '')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean)
        .slice(0, 200),
    );
    if (codes.size > 0) {
      rows = rows.filter((row) => codes.has(row.code));
    }

    if (search) {
      rows = rows.filter(
        (row) =>
          row.code.toLowerCase().includes(search) ||
          row.name.toLowerCase().includes(search) ||
          (row.vendor ?? '').toLowerCase().includes(search),
      );
    }

    rows = sortCustomers(rows, query.sort);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;

    return {
      items: rows.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total,
      available: computed.response.available,
      asOf: computed.response.asOf,
    };
  }

  /** Solo para pruebas/operación: fuerza la próxima lectura. */
  invalidate(): void {
    this.cache.clear();
  }

  // ---------- Carga y caché ----------

  private async compute(query: SalesAnalyticsQuery): Promise<ComputedAnalytics> {
    const year = this.resolveYear(query.year);
    const currency = query.currency;
    const vendor = (query.vendor ?? '').trim();
    const customerType = (query.customerType ?? '').trim();
    const key = `${year}|${currency}|${vendor}|${customerType}`;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const value = await this.load(year, currency, vendor, customerType);
    this.remember(key, value);
    return value;
  }

  private resolveYear(raw?: number): number {
    const current = new Date().getUTCFullYear();
    if (!raw) return current;
    return Math.min(Math.max(2020, Math.trunc(raw)), current);
  }

  private remember(key: string, value: ComputedAnalytics): void {
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size <= CACHE_MAX_ENTRIES) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) this.cache.delete(oldest);
  }

  private async load(
    year: number,
    currency: SalesAnalyticsQuery['currency'],
    vendor: string,
    customerType: string,
  ): Promise<ComputedAnalytics> {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const todayKey = now.toISOString().slice(0, 10);
    const isCurrentYear = year === currentYear;
    const focusMonthKey = isCurrentYear
      ? `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      : `${year}-12`;

    // Ventana de lectura: el año de foco y el anterior completos (o hasta hoy).
    const desde = new Date(Date.UTC(year - 1, 0, 1));
    const hasta = isCurrentYear
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      : new Date(Date.UTC(year + 1, 0, 1));

    const sameMonthPrevYearKey = addMonths(focusMonthKey, -12);
    const prevMonthKey = addMonths(focusMonthKey, -1);
    const elapsedDay = isCurrentYear && focusMonthKey === `${currentYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      ? now.getUTCDate()
      : daysInMonth(focusMonthKey);

    // Para comparar el mes en curso contra el mismo tramo del año anterior se
    // necesita el detalle diario. En años cerrados no hace falta.
    const dailyFrom = isCurrentYear
      ? `${sameMonthPrevYearKey}-01`
      : null;
    const dailyTo = isCurrentYear ? `${todayKey}` : null;

    const params = { desde, hasta, vendor, tipo: customerType, moneda: currency };

    const [volumeRes, billingRes, productsRes, dailyRes, localRes] = await Promise.allSettled([
      this.profit.selectQuery(SALES_ANALYTICS_MONTHLY_SQL, MONTHLY_QUERY_LIMIT, params),
      this.profit.selectQuery(SALES_ANALYTICS_BILLING_SQL, BILLING_QUERY_LIMIT, params),
      this.profit.selectQuery(SALES_ANALYTICS_PRODUCTS_SQL, PRODUCT_QUERY_LIMIT, params),
      dailyFrom && dailyTo
        ? this.profit.selectQuery(SALES_ANALYTICS_DAILY_SQL, DAILY_QUERY_LIMIT, {
            desde: new Date(`${dailyFrom}T00:00:00.000Z`),
            hasta: new Date(Date.parse(`${dailyTo}T00:00:00.000Z`) + 86_400_000),
            vendor,
            tipo: customerType,
          })
        : Promise.resolve([] as Record<string, unknown>[]),
      this.loadLocalOrders(year, vendor, customerType),
    ]);

    const volumeAvailable = volumeRes.status === 'fulfilled';
    const billingAvailable = billingRes.status === 'fulfilled';
    if (volumeRes.status === 'rejected') {
      this.logger.error(
        `No se pudieron leer las ventas de Pedidos en Profit: ${
          volumeRes.reason instanceof Error ? volumeRes.reason.message : String(volumeRes.reason)
        }`,
      );
    }
    if (billingRes.status === 'rejected') {
      this.logger.warn(
        `No se pudo leer la facturación de Pedidos en Profit: ${
          billingRes.reason instanceof Error ? billingRes.reason.message : String(billingRes.reason)
        }`,
      );
    }
    if (productsRes.status === 'rejected') {
      this.logger.warn(
        `No se pudieron leer los productos vendidos: ${
          productsRes.reason instanceof Error ? productsRes.reason.message : String(productsRes.reason)
        }`,
      );
    }

    const volume = this.parseVolume(volumeRes.status === 'fulfilled' ? volumeRes.value : []);
    const billing = this.parseBilling(billingRes.status === 'fulfilled' ? billingRes.value : []);
    const products = this.parseProducts(productsRes.status === 'fulfilled' ? productsRes.value : []);
    const daily = this.parseDaily(dailyRes.status === 'fulfilled' ? dailyRes.value : []);
    const local = localRes.status === 'fulfilled'
      ? localRes.value
      : { closed: [] as LocalOrderRow[], pending: [] as PendingOrderRow[], pendingKg: 0, pendingOrders: 0, pendingCustomers: 0, nextDeliveryDate: null as string | null };

    const yearMonths = monthKeysOfYear(year);
    const volumeByMonth = new Map<string, { kg: number; sacks: number; notes: number; customers: Set<string>; last: string | null }>();
    const prevVolumeByMonth = new Map<string, { kg: number; sacks: number; notes: number; billed: number | null }>();
    const billingByMonth = new Map<string, { billed: number; documents: number; missingRate: number }>();
    const prevBillingByMonth = new Map<string, { billed: number; documents: number }>();
    const customers = new Map<string, CustomerAccumulator>();
    const vendors = new Map<string, { kg: number; sacks: number; notes: number; customers: Set<string>; billed: number | null; prevYearKg: number }>();
    const productFocus = new Map<string, { description: string; kg: number; sacks: number; notes: number }>();
    const productPrev = new Map<string, number>();

    const focusYearPrefix = `${year}-`;
    const prevYearPrefix = `${year - 1}-`;

    for (const row of volume) {
      const bucket = volumeByMonth.get(row.month) ?? { kg: 0, sacks: 0, notes: 0, customers: new Set<string>(), last: null };
      if (row.month.startsWith(focusYearPrefix)) {
        bucket.kg += row.kg;
        bucket.sacks += row.sacks;
        bucket.notes += row.notes;
        bucket.customers.add(row.code);
        if (!bucket.last || (row.lastSaleDate && row.lastSaleDate > bucket.last)) bucket.last = row.lastSaleDate;
      }
      volumeByMonth.set(row.month, bucket);

      if (row.month.startsWith(prevYearPrefix)) {
        const prev = prevVolumeByMonth.get(row.month) ?? { kg: 0, sacks: 0, notes: 0, billed: null };
        prev.kg += row.kg;
        prev.sacks += row.sacks;
        prev.notes += row.notes;
        prevVolumeByMonth.set(row.month, prev);
      }

      if (row.month.startsWith(focusYearPrefix) || row.month.startsWith(prevYearPrefix)) {
        const entry = customers.get(row.code) ?? {
          code: row.code,
          name: row.name || row.code,
          vendor: row.vendor || null,
          customerType: row.customerType || null,
          kg: 0,
          sacks: 0,
          notes: 0,
          billed: 0,
          lastSaleDate: null,
          prevYearKg: 0,
          prevBilled: 0,
          pendingKg: 0,
          pendingOrders: new Set<string>(),
        };
        if (row.name) entry.name = row.name;
        if (row.vendor) entry.vendor = row.vendor;
        if (row.customerType) entry.customerType = row.customerType;
        if (row.month.startsWith(focusYearPrefix)) {
          entry.kg += row.kg;
          entry.sacks += row.sacks;
          entry.notes += row.notes;
          if (!entry.lastSaleDate || (row.lastSaleDate && row.lastSaleDate > entry.lastSaleDate)) {
            entry.lastSaleDate = row.lastSaleDate;
          }
        } else {
          entry.prevYearKg += row.kg;
        }
        customers.set(row.code, entry);
      }

      if (row.month.startsWith(focusYearPrefix)) {
        const vendorEntry = vendors.get(row.vendor || 'Sin vendedor') ?? {
          kg: 0,
          sacks: 0,
          notes: 0,
          customers: new Set<string>(),
          billed: null as number | null,
          prevYearKg: 0,
        };
        vendorEntry.kg += row.kg;
        vendorEntry.sacks += row.sacks;
        vendorEntry.notes += row.notes;
        vendorEntry.customers.add(row.code);
        vendors.set(row.vendor || 'Sin vendedor', vendorEntry);
      } else if (row.month.startsWith(prevYearPrefix)) {
        const vendorEntry = vendors.get(row.vendor || 'Sin vendedor') ?? {
          kg: 0,
          sacks: 0,
          notes: 0,
          customers: new Set<string>(),
          billed: null as number | null,
          prevYearKg: 0,
        };
        vendorEntry.prevYearKg += row.kg;
        vendors.set(row.vendor || 'Sin vendedor', vendorEntry);
      }
    }

    for (const row of billing) {
      if (row.month.startsWith(focusYearPrefix)) {
        const bucket = billingByMonth.get(row.month) ?? { billed: 0, documents: 0, missingRate: 0 };
        bucket.billed += row.billed;
        bucket.documents += row.documents;
        bucket.missingRate += row.missingRate;
        billingByMonth.set(row.month, bucket);
        const customer = customers.get(row.code);
        if (customer) customer.billed = (customer.billed ?? 0) + row.billed;
      } else if (row.month.startsWith(prevYearPrefix)) {
        const bucket = prevBillingByMonth.get(row.month) ?? { billed: 0, documents: 0 };
        bucket.billed += row.billed;
        bucket.documents += row.documents;
        prevBillingByMonth.set(row.month, bucket);
        const customer = customers.get(row.code);
        if (customer) customer.prevBilled = (customer.prevBilled ?? 0) + row.billed;
      }
    }

    for (const row of products) {
      if (row.month.startsWith(focusYearPrefix)) {
        const entry = productFocus.get(row.code) ?? { description: row.description, kg: 0, sacks: 0, notes: 0 };
        entry.kg += row.kg;
        entry.sacks += row.sacks;
        entry.notes += row.notes;
        productFocus.set(row.code, entry);
      } else if (row.month.startsWith(prevYearPrefix)) {
        productPrev.set(row.code, (productPrev.get(row.code) ?? 0) + row.kg);
      }
    }

    for (const order of local.closed) {
      const customer = customers.get(order.code) ?? {
        code: order.code,
        name: order.name || order.code,
        vendor: order.vendor || null,
        customerType: order.customerType || null,
        kg: 0,
        sacks: 0,
        notes: 0,
        billed: 0,
        lastSaleDate: null,
        prevYearKg: 0,
        prevBilled: 0,
        pendingKg: 0,
        pendingOrders: new Set<string>(),
      };
      customers.set(order.code, customer);
    }

    for (const order of local.pending) {
      const customer = customers.get(order.code) ?? {
        code: order.code,
        name: order.name || order.code,
        vendor: order.vendor || null,
        customerType: order.customerType || null,
        kg: 0,
        sacks: 0,
        notes: 0,
        billed: 0,
        lastSaleDate: null,
        prevYearKg: 0,
        prevBilled: 0,
        pendingKg: 0,
        pendingOrders: new Set<string>(),
      };
      customer.pendingKg += order.kg;
      customer.pendingOrders.add(order.orderNumber);
      if (!customer.name && order.name) customer.name = order.name;
      if (!customer.vendor && order.vendor) customer.vendor = order.vendor;
      if (!customer.customerType && order.customerType) customer.customerType = order.customerType;
      customers.set(order.code, customer);
    }

    // Ventas por vendedor: la facturación se reparte por la cartera del cliente.
    for (const row of billing) {
      if (!row.month.startsWith(focusYearPrefix)) continue;
      const customer = customers.get(row.code);
      if (!customer) continue;
      const key = customer.vendor || 'Sin vendedor';
      const vendorEntry = vendors.get(key);
      if (!vendorEntry) continue;
      vendorEntry.billed = (vendorEntry.billed ?? 0) + row.billed;
    }

    // Un año en curso no dibuja meses futuros: evita la falsa caída del 100 %
    // en diciembre cuando todavía no ha ocurrido.
    const focusMonths = isCurrentYear
      ? yearMonths.slice(0, now.getUTCMonth() + 1)
      : yearMonths;
    const monthly: SalesAnalyticsMonth[] = focusMonths.map((month) => {
      const bucket = volumeByMonth.get(month);
      const prevMonth = prevVolumeByMonth.get(`${year - 1}-${month.slice(5)}`);
      const billingBucket = billingByMonth.get(month);
      const prevBilling = prevBillingByMonth.get(`${year - 1}-${month.slice(5)}`);
      const isCurrent = isCurrentYear && month === focusMonthKey;
      const kg = round2(
        isCurrent
          ? this.monthKgFromDailyOrBucket(daily, month, elapsedDay, bucket?.kg ?? 0)
          : bucket?.kg ?? 0,
      );
      const prevYearKg = prevMonth ? round2(prevMonth.kg) : null;
      // En el mes en curso la línea del año anterior se dibuja completa, pero
      // la variación se calcula contra los mismos días para no comparar un
      // tramo parcial con un mes entero.
      const prevComparable = isCurrent
        ? this.sumDailyRange(
            daily,
            `${year - 1}-${month.slice(5)}`,
            elapsedDay,
            (prevMonth?.kg ?? 0) * (elapsedDay / Math.max(1, daysInMonth(month))),
          )
        : prevYearKg ?? 0;
      return {
        month,
        label: monthLabel(month),
        kg,
        sacks: round2(bucket?.sacks ?? 0),
        notes: Math.trunc(bucket?.notes ?? 0),
        customers: bucket?.customers.size ?? 0,
        billed: billingBucket ? round2(billingBucket.billed) : null,
        prevYearKg,
        prevYearBilled: prevBilling ? round2(prevBilling.billed) : null,
        yoyPct: pctChange(kg, prevComparable),
        isPartial: isCurrent,
        isCurrent,
      };
    });

    const comparison = this.buildComparison({
      year,
      focusMonthKey,
      prevMonthKey,
      sameMonthPrevYearKey,
      elapsedDay,
      monthly,
      daily,
      billingAvailable,
      isCurrentYear,
      todayKey,
    });

    const annual: SalesAnalyticsYear[] = [year - 1, year].map((entryYear) => {
      const months = monthKeysOfYear(entryYear);
      const kg = months.reduce((acc, month) => {
        if (entryYear === year) return acc + (monthly.find((item) => item.month === month)?.kg ?? 0);
        return acc + (prevVolumeByMonth.get(month)?.kg ?? 0);
      }, 0);
      const sacks = months.reduce((acc, month) => {
        if (entryYear === year) return acc + (monthly.find((item) => item.month === month)?.sacks ?? 0);
        return acc + (prevVolumeByMonth.get(month)?.sacks ?? 0);
      }, 0);
      const notes = months.reduce((acc, month) => {
        if (entryYear === year) return acc + (monthly.find((item) => item.month === month)?.notes ?? 0);
        return acc + (prevVolumeByMonth.get(month)?.notes ?? 0);
      }, 0);
      const billed = months.reduce((acc, month) => {
        if (entryYear === year) return acc + (monthly.find((item) => item.month === month)?.billed ?? 0);
        return acc + (prevBillingByMonth.get(month)?.billed ?? 0);
      }, 0);
      return {
        year: entryYear,
        label: String(entryYear),
        kg: round2(kg),
        sacks: round2(sacks),
        notes: Math.trunc(notes),
        billed: billingAvailable ? round2(billed) : null,
        ytd: entryYear === year && isCurrentYear,
        yoyPct: entryYear === year ? comparison.ytdPct : null,
      };
    });

    const totals = this.buildTotals(monthly, customers, billingAvailable, focusYearPrefix, volume);
    const pending = this.buildPending(local, monthly, focusMonthKey);
    const statusMix = this.buildStatusMix(local, year);
    const customerRows = this.buildCustomerRows(customers, todayKey);
    totals.newCustomers = customerRows.filter((row) => row.status === 'NUEVO').length;
    totals.lostCustomers = customerRows.filter((row) => row.status === 'PERDIDO').length;
    totals.atRiskCustomers = customerRows.filter((row) => row.status === 'EN_RIESGO').length;
    const topCustomers = this.buildTopCustomers(customerRows, totals.kg);
    const topProducts = this.buildTopProducts(productFocus, productPrev, totals.kg);
    const vendorRows = this.buildVendors(vendors, totals.kg);
    const alerts = this.buildAlerts(customerRows, topCustomers, pending);

    const notes: string[] = [
      'Ventas y despachos se miden por nota de entrega de Profit, no por factura.',
      'La facturación sale de CxC (docum_cc) y puede diferir 1–2 % del despacho.',
      'El histórico local de cierres arranca con el ciclo de vida; para años anteriores manda Profit.',
    ];
    if (billingAvailable && Array.from(billingByMonth.values()).some((entry) => entry.missingRate > 0)) {
      notes.push('Hay documentos sin tasa: el total en USD es parcial.');
    }
    if (isCurrentYear) {
      notes.push('El mes en curso se compara contra los mismos días del año anterior.');
    }

    const response: SalesAnalyticsResponse = {
      asOf: new Date().toISOString(),
      year,
      currency,
      period: {
        from: `${year}-01-01`,
        to: isCurrentYear ? todayKey : `${year}-12-31`,
        label: isCurrentYear ? `Año ${year} al día ${todayKey.slice(8, 10)}` : `Año ${year}`,
      },
      available: volumeAvailable,
      billingAvailable,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
      totals,
      comparison,
      monthly,
      annual,
      statusMix,
      pending,
      topCustomers,
      topProducts,
      vendors: vendorRows,
      alerts,
      dataNotes: notes,
    };

    return { response, customers: customerRows };
  }

  // ---------- Parseo ----------

  private parseVolume(rows: Record<string, unknown>[]): VolumeRow[] {
    const parsed: VolumeRow[] = [];
    for (const raw of rows) {
      const month = monthOfRow(raw);
      const code = text(raw.co_cli);
      if (!month || !code) continue;
      parsed.push({
        month,
        code,
        name: text(raw.cli_des) || code,
        vendor: text(raw.ven_des),
        customerType: text(raw.tipo),
        units: toNumber(raw.unid),
        sacks: toNumber(raw.sacos),
        kg: toNumber(raw.kg),
        notes: Math.trunc(toNumber(raw.notas)),
        lastSaleDate: day(raw.ultima),
      });
    }
    return parsed;
  }

  private parseBilling(rows: Record<string, unknown>[]): BillingRow[] {
    const parsed: BillingRow[] = [];
    for (const raw of rows) {
      const month = monthOfRow(raw);
      const code = text(raw.co_cli);
      if (!month || !code) continue;
      parsed.push({
        month,
        code,
        billed: round2(toNumber(raw.facturado) - toNumber(raw.creditos)),
        documents: Math.trunc(toNumber(raw.documentos)),
        missingRate: Math.trunc(toNumber(raw.sin_tasa)),
      });
    }
    return parsed;
  }

  private parseProducts(rows: Record<string, unknown>[]): ProductRow[] {
    const parsed: ProductRow[] = [];
    for (const raw of rows) {
      const month = monthOfRow(raw);
      const code = text(raw.co_art);
      if (!month || !code) continue;
      parsed.push({
        month,
        code,
        description: text(raw.art_des) || code,
        units: toNumber(raw.unid),
        sacks: toNumber(raw.sacos),
        kg: toNumber(raw.kg),
        notes: Math.trunc(toNumber(raw.notas)),
      });
    }
    return parsed;
  }

  private parseDaily(rows: Record<string, unknown>[]): DailyRow[] {
    const parsed: DailyRow[] = [];
    for (const raw of rows) {
      const date = day(raw.fecha);
      if (!date) continue;
      parsed.push({
        date,
        kg: toNumber(raw.kg),
        units: toNumber(raw.unid),
        notes: Math.trunc(toNumber(raw.notas)),
      });
    }
    return parsed;
  }

  // ---------- Datos locales (cartera y cierres) ----------

  private async loadLocalOrders(year: number, vendor: string, customerType: string) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const filters = {
      ...(vendor ? { vendor } : {}),
      ...(customerType ? { customerType } : {}),
    };

    const now = new Date();
    const [closedOrders, pendingOrders] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          status: { in: ['NOTA_ENTREGA', 'CERRADO', 'CANCELADO'] },
          ...filters,
          OR: [
            { closedAt: { gte: from, lt: to } },
            { closedAt: null, orderDate: { gte: from, lt: to } },
          ],
        },
        select: {
          externalNumber: true,
          customerCode: true,
          customerName: true,
          customerType: true,
          vendor: true,
          status: true,
          billingStatus: true,
          closedAt: true,
          orderDate: true,
          lines: { select: { pendingKg: true, quantity: true } },
        },
      }),
      this.prisma.salesOrder.findMany({
        where: { isActive: true, ...filters },
        select: {
          externalNumber: true,
          customerCode: true,
          customerName: true,
          customerType: true,
          vendor: true,
          requestedDate: true,
          lines: { select: { pendingKg: true } },
        },
      }),
    ]);

    const closed: LocalOrderRow[] = closedOrders.map((order) => {
      const effective = order.closedAt ?? order.orderDate;
      const kg = order.lines.reduce(
        (acc, line) => acc + (toNumberOrNull(line.pendingKg) ?? 0),
        0,
      );
      return {
        month: effective ? effective.toISOString().slice(0, 7) : `${year}-01`,
        code: order.customerCode ?? '—',
        name: order.customerName ?? order.customerCode ?? '—',
        vendor: order.vendor ?? '',
        customerType: order.customerType ?? '',
        kg: round2(kg),
        orderNumber: order.externalNumber,
        status: order.status,
        billingStatus: order.billingStatus ?? 'PENDIENTE',
      };
    });

    const pending: PendingOrderRow[] = pendingOrders.map((order) => {
      const kg = order.lines.reduce((acc, line) => acc + toNumber(line.pendingKg), 0);
      return {
        code: order.customerCode ?? '—',
        name: order.customerName ?? order.customerCode ?? '—',
        vendor: order.vendor ?? '',
        customerType: order.customerType ?? '',
        kg: round2(kg),
        orderNumber: order.externalNumber,
        requestedDate: order.requestedDate ? order.requestedDate.toISOString().slice(0, 10) : null,
      };
    });

    const pendingKg = pending.reduce((acc, order) => acc + order.kg, 0);
    const pendingOrderNumbers = new Set(pending.map((order) => order.orderNumber));
    const pendingCustomerCodes = new Set(pending.map((order) => order.code));
    // «Próxima entrega» es la primera fecha futura; las fechas vencidas no se
    // disfrazan de próximas (el simulador las muestra con su semáforo).
    const today = now.toISOString().slice(0, 10);
    let nextDeliveryDate: string | null = null;
    for (const order of pending) {
      if (!order.requestedDate || order.requestedDate < today) continue;
      if (!nextDeliveryDate || order.requestedDate < nextDeliveryDate) nextDeliveryDate = order.requestedDate;
    }

    return {
      closed,
      pending,
      pendingKg: round2(pendingKg),
      pendingOrders: pendingOrderNumbers.size,
      pendingCustomers: pendingCustomerCodes.size,
      nextDeliveryDate,
    };
  }

  // ---------- Agregados ----------

  private monthKgFromDailyOrBucket(
    daily: DailyRow[],
    month: string,
    elapsedDay: number,
    fallback: number,
  ): number {
    if (daily.length === 0) return fallback;
    const from = `${month}-01`;
    const to = `${month}-${String(elapsedDay).padStart(2, '0')}`;
    let kg = 0;
    let found = false;
    for (const row of daily) {
      if (row.date >= from && row.date <= to) {
        kg += row.kg;
        found = true;
      }
    }
    return found ? kg : fallback;
  }

  private buildTotals(
    monthly: SalesAnalyticsMonth[],
    customers: Map<string, CustomerAccumulator>,
    billingAvailable: boolean,
    focusYearPrefix: string,
    volume: VolumeRow[],
  ): SalesAnalyticsTotals {
    const kg = monthly.reduce((acc, month) => acc + month.kg, 0);
    const sacks = monthly.reduce((acc, month) => acc + month.sacks, 0);
    const notes = monthly.reduce((acc, month) => acc + month.notes, 0);
    const activeCustomers = [...customers.values()].filter((entry) => entry.kg > 0).length;
    const billed = billingAvailable ? monthly.reduce((acc, month) => acc + (month.billed ?? 0), 0) : null;
    let lastSaleDate: string | null = null;
    for (const row of volume) {
      if (!row.month.startsWith(focusYearPrefix) || !row.lastSaleDate) continue;
      if (!lastSaleDate || row.lastSaleDate > lastSaleDate) lastSaleDate = row.lastSaleDate;
    }
    return {
      kg: round2(kg),
      sacks: round2(sacks),
      notes,
      customers: activeCustomers,
      billed: billed === null ? null : round2(billed),
      avgKgPerNote: notes > 0 ? round2(kg / notes) : null,
      avgBilledPerNote: billed !== null && notes > 0 ? round2(billed / notes) : null,
      lastSaleDate,
      newCustomers: 0,
      lostCustomers: 0,
      atRiskCustomers: 0,
    };
  }

  private buildComparison(input: {
    year: number;
    focusMonthKey: string;
    prevMonthKey: string;
    sameMonthPrevYearKey: string;
    elapsedDay: number;
    monthly: SalesAnalyticsMonth[];
    daily: DailyRow[];
    billingAvailable: boolean;
    isCurrentYear: boolean;
    todayKey: string;
  }): SalesAnalyticsComparison {
    const {
      year,
      focusMonthKey,
      prevMonthKey,
      sameMonthPrevYearKey,
      elapsedDay,
      monthly,
      daily,
      billingAvailable,
      isCurrentYear,
      todayKey,
    } = input;

    const focusIndex = Number(focusMonthKey.slice(5, 7)) - 1;
    const currentMonth = monthly[focusIndex];
    const monthKg = currentMonth?.kg ?? 0;
    // Sin detalle diario (año cerrado) se prorratea el mes completo para no
    // comparar un tramo parcial contra un mes entero.
    const sameMonthFallback = currentMonth?.prevYearKg
      ? currentMonth.prevYearKg * (elapsedDay / Math.max(1, daysInMonth(focusMonthKey)))
      : 0;
    const sameMonthPrevYearKg = this.sumDailyRange(
      daily,
      sameMonthPrevYearKey,
      elapsedDay,
      sameMonthFallback,
    );
    const prevMonthDays = Math.min(elapsedDay, daysInMonth(prevMonthKey));
    const prevMonthEntry = monthly.find((entry) => entry.month === prevMonthKey);
    const prevMonthFallback = prevMonthEntry
      ? prevMonthEntry.kg * (prevMonthDays / Math.max(1, daysInMonth(prevMonthKey)))
      : 0;
    const prevMonthKg = this.sumDailyRange(
      daily,
      prevMonthKey,
      prevMonthDays,
      prevMonthFallback,
    );

    const ytdKg = monthly.slice(0, focusIndex + 1).reduce((acc, entry) => acc + entry.kg, 0);
    const prevYearYtdFull = monthly
      .slice(0, focusIndex)
      .reduce((acc, entry) => acc + (entry.prevYearKg ?? 0), 0);
    const prevYtdKg = prevYearYtdFull + sameMonthPrevYearKg;

    const ytdBilled = billingAvailable
      ? monthly.slice(0, focusIndex + 1).reduce((acc, entry) => acc + (entry.billed ?? 0), 0)
      : null;
    // Facturación comparable: meses cerrados completos + el mes en curso
    // prorrateado a los mismos días del año anterior (CxC no tiene detalle
    // diario como las notas).
    const prevYtdBilled = billingAvailable
      ? monthly.slice(0, focusIndex).reduce((acc, entry) => acc + (entry.prevYearBilled ?? 0), 0) +
        (currentMonth?.prevYearBilled ?? 0) *
          (elapsedDay / Math.max(1, daysInMonth(focusMonthKey)))
      : null;

    const yearStart = `${year}-01-01`;
    const elapsedDaysYear = daysBetween(yearStart, isCurrentYear ? todayKey : lastDayKeyOfMonth(focusMonthKey)).length;

    return {
      ytdKg: round2(ytdKg),
      prevYtdKg: round2(prevYtdKg),
      ytdPct: pctChange(ytdKg, prevYtdKg),
      ytdBilled: ytdBilled === null ? null : round2(ytdBilled),
      prevYtdBilled: prevYtdBilled === null ? null : round2(prevYtdBilled),
      ytdBilledPct: ytdBilled !== null && prevYtdBilled !== null ? pctChange(ytdBilled, prevYtdBilled) : null,
      monthKg: round2(monthKg),
      prevMonthKg: round2(prevMonthKg),
      momPct: pctChange(monthKg, prevMonthKg),
      sameMonthPrevYearKg: round2(sameMonthPrevYearKg),
      sameMonthYoyPct: pctChange(monthKg, sameMonthPrevYearKg),
      monthLabel: monthLabel(focusMonthKey),
      prevMonthLabel: monthLabel(prevMonthKey),
      elapsedDays: Math.max(1, elapsedDaysYear),
      projectedKg:
        isCurrentYear && elapsedDaysYear > 0
          ? round2((ytdKg / elapsedDaysYear) * 365)
          : null,
    };
  }

  private sumDailyRange(daily: DailyRow[], month: string, elapsedDay: number, fallback: number): number {
    if (daily.length === 0) return fallback;
    const range = dayRangeInMonth(month, 1, elapsedDay);
    let total = 0;
    let found = false;
    for (const row of daily) {
      if (row.date >= range.from && row.date <= range.to) {
        total += row.kg;
        found = true;
      }
    }
    return found ? total : fallback;
  }

  private buildPending(
    local: Awaited<ReturnType<SalesAnalyticsService['loadLocalOrders']>>,
    monthly: SalesAnalyticsMonth[],
    focusMonthKey: string,
  ): SalesAnalyticsResponse['pending'] {
    const completeMonths = monthly
      .filter((entry) => entry.month < focusMonthKey && entry.kg > 0)
      .slice(-3);
    const avgMonthlyKg = completeMonths.length
      ? round2(completeMonths.reduce((acc, entry) => acc + entry.kg, 0) / completeMonths.length)
      : null;
    return {
      orders: local.pendingOrders,
      customers: local.pendingCustomers,
      kg: local.pendingKg,
      nextDeliveryDate: local.nextDeliveryDate,
      avgMonthlyKg,
      monthsOfCover: avgMonthlyKg && avgMonthlyKg > 0 ? round1(local.pendingKg / avgMonthlyKg) : null,
    };
  }

  private buildStatusMix(
    local: Awaited<ReturnType<SalesAnalyticsService['loadLocalOrders']>>,
    year: number,
  ): SalesAnalyticsResponse['statusMix'] {
    const prefix = `${year}-`;
    const closed = local.closed.filter((order) => order.month.startsWith(prefix) && order.status !== 'CANCELADO');
    const canceled = local.closed.filter((order) => order.month.startsWith(prefix) && order.status === 'CANCELADO');
    return {
      open: {
        orders: local.pendingOrders,
        kg: local.pendingKg,
      },
      closed: bucketOf(closed),
      canceled: bucketOf(canceled),
    };
  }

  private buildCustomerRows(
    customers: Map<string, CustomerAccumulator>,
    todayKey: string,
  ): SalesAnalyticsCustomer[] {
    const rows: SalesAnalyticsCustomer[] = [];
    const riskCutoff = new Date(Date.parse(`${todayKey}T00:00:00.000Z`) - 60 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    for (const entry of customers.values()) {
      const status: SalesAnalyticsCustomer['status'] =
        entry.kg > 0 && entry.prevYearKg === 0
          ? 'NUEVO'
          : entry.kg === 0 && entry.prevYearKg > 0
            ? 'PERDIDO'
            : entry.kg > 0 && entry.lastSaleDate && entry.lastSaleDate < riskCutoff
              ? 'EN_RIESGO'
              : 'ACTIVO';
      rows.push({
        code: entry.code,
        name: entry.name,
        vendor: entry.vendor,
        customerType: entry.customerType,
        kg: round2(entry.kg),
        sacks: round2(entry.sacks),
        notes: entry.notes,
        billed: entry.billed === null ? null : round2(entry.billed),
        lastSaleDate: entry.lastSaleDate,
        prevYearKg: round2(entry.prevYearKg),
        yoyPct: pctChange(entry.kg, entry.prevYearKg),
        pendingKg: round2(entry.pendingKg),
        pendingOrders: entry.pendingOrders.size,
        status,
      });
    }

    return rows.sort((a, b) => b.kg - a.kg || a.name.localeCompare(b.name));
  }

  private buildTopCustomers(
    rows: SalesAnalyticsCustomer[],
    totalKg: number,
  ): SalesAnalyticsTopCustomer[] {
    return rows
      .filter((row) => row.kg > 0)
      .slice(0, TOP_CUSTOMERS)
      .map((row) => ({ ...row, sharePct: sharePct(row.kg, totalKg) }));
  }

  private buildTopProducts(
    focus: Map<string, { description: string; kg: number; sacks: number; notes: number }>,
    prev: Map<string, number>,
    totalKg: number,
  ): SalesAnalyticsProduct[] {
    return [...focus.entries()]
      .map(([code, entry]) => ({
        code,
        description: entry.description,
        kg: round2(entry.kg),
        sacks: round2(entry.sacks),
        notes: entry.notes,
        sharePct: sharePct(entry.kg, totalKg),
        prevYearKg: round2(prev.get(code) ?? 0),
        yoyPct: pctChange(entry.kg, prev.get(code) ?? 0),
      }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, TOP_PRODUCTS);
  }

  private buildVendors(
    vendors: Map<string, { kg: number; sacks: number; notes: number; customers: Set<string>; billed: number | null; prevYearKg: number }>,
    totalKg: number,
  ): SalesAnalyticsVendor[] {
    return [...vendors.entries()]
      .map(([name, entry]) => ({
        name,
        kg: round2(entry.kg),
        sacks: round2(entry.sacks),
        notes: entry.notes,
        customers: entry.customers.size,
        billed: entry.billed === null ? null : round2(entry.billed),
        sharePct: sharePct(entry.kg, totalKg),
        prevYearKg: round2(entry.prevYearKg),
        yoyPct: pctChange(entry.kg, entry.prevYearKg),
      }))
      .sort((a, b) => b.kg - a.kg);
  }

  private buildAlerts(
    customers: SalesAnalyticsCustomer[],
    topCustomers: SalesAnalyticsTopCustomer[],
    pending: SalesAnalyticsResponse['pending'],
  ): SalesAnalyticsAlert[] {
    const alerts: SalesAnalyticsAlert[] = [];

    const dropped = customers
      .filter(
        (row) =>
          row.kg > 0 &&
          row.prevYearKg >= DROP_THRESHOLD_KG &&
          row.yoyPct !== null &&
          row.yoyPct <= DROP_PCT,
      )
      .sort((a, b) => (a.yoyPct ?? 0) - (b.yoyPct ?? 0))
      .slice(0, 3);
    for (const row of dropped) {
      alerts.push({
        kind: 'DROP',
        title: `${row.name} cayó ${Math.abs(row.yoyPct ?? 0)} %`,
        detail: `${formatTonnes(row.kg)} vs ${formatTonnes(row.prevYearKg)} el año anterior.`,
        customerCode: row.code,
        customerName: row.name,
        severity: 'danger',
      });
    }

    const newcomers = customers
      .filter((row) => row.status === 'NUEVO' && row.kg >= DROP_THRESHOLD_KG)
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 2);
    for (const row of newcomers) {
      alerts.push({
        kind: 'NEW',
        title: `${row.name} entró al año`,
        detail: `${formatTonnes(row.kg)} sin compras el año anterior.`,
        customerCode: row.code,
        customerName: row.name,
        severity: 'info',
      });
    }

    const lost = customers
      .filter((row) => row.status === 'PERDIDO' && row.prevYearKg >= DROP_THRESHOLD_KG)
      .sort((a, b) => b.prevYearKg - a.prevYearKg)
      .slice(0, 2);
    for (const row of lost) {
      alerts.push({
        kind: 'LOST',
        title: `${row.name} no ha comprado este año`,
        detail: `Venía de ${formatTonnes(row.prevYearKg)} el año anterior.`,
        customerCode: row.code,
        customerName: row.name,
        severity: 'warning',
      });
    }

    const leader = topCustomers[0];
    if (leader && (leader.sharePct ?? 0) >= 30) {
      alerts.push({
        kind: 'CONCENTRATION',
        title: `Concentración en ${leader.name}`,
        detail: `${leader.sharePct} % de la venta del año.`,
        customerCode: leader.code,
        customerName: leader.name,
        severity: 'warning',
      });
    }

    if (pending.monthsOfCover !== null && pending.monthsOfCover >= 1.5) {
      alerts.push({
        kind: 'PENDING',
        title: `${formatTonnes(pending.kg)} en cartera`,
        detail: `${pending.monthsOfCover} meses de venta promedio comprometidos.`,
        customerCode: null,
        customerName: null,
        severity: 'info',
      });
    }

    return alerts.slice(0, ALERT_LIMIT);
  }
}

// ---------- Utilidades locales ----------

function bucketOf(orders: LocalOrderRow[]): SalesAnalyticsStatusBucket {
  return {
    orders: new Set(orders.map((order) => order.orderNumber)).size,
    kg: round2(orders.reduce((acc, order) => acc + order.kg, 0)),
  };
}

function sortCustomers(rows: SalesAnalyticsCustomer[], sort: SalesAnalyticsSort): SalesAnalyticsCustomer[] {
  const sorted = [...rows];
  switch (sort) {
    case 'kg_asc':
      return sorted.sort((a, b) => a.kg - b.kg || a.name.localeCompare(b.name));
    case 'yoy_desc':
      return sorted.sort((a, b) => (b.yoyPct ?? -Infinity) - (a.yoyPct ?? -Infinity) || b.kg - a.kg);
    case 'yoy_asc':
      return sorted.sort((a, b) => (a.yoyPct ?? Infinity) - (b.yoyPct ?? Infinity) || b.kg - a.kg);
    case 'pending_desc':
      return sorted.sort((a, b) => b.pendingKg - a.pendingKg || b.kg - a.kg);
    case 'recent_desc':
      return sorted.sort((a, b) => (b.lastSaleDate ?? '').localeCompare(a.lastSaleDate ?? '') || b.kg - a.kg);
    case 'name_asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'kg_desc':
    default:
      return sorted.sort((a, b) => b.kg - a.kg || a.name.localeCompare(b.name));
  }
}

function formatTonnes(kg: number): string {
  return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(kg / 1000)} t`;
}

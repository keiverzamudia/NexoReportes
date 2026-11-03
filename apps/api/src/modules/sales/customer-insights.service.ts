import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CustomerInsightAccount,
  CustomerInsightOrders,
  CustomerInsightQuery,
  CustomerInsightResponse,
  CustomerInsightSimilar,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
import {
  buildCustomerInsights,
  buildInsightWindows,
  dateKey,
  InsightBillingRow,
  InsightVolumeRow,
  round1,
  round2,
  toNumber,
  toNumberOrNull,
} from './customer-insights.calculations';
import { normalizeCustomerCode } from './customer-code';
import { CustomerStatementService } from './customer-statement.service';
import { DeliveryDatesService, deliveryDateKey } from './delivery-dates.service';

// ============================================================
// Ficha 360 de clientes (solo lectura).
//
// · Volumen: notas de entrega (`not_ent` + `reng_nde`) de la línea ABA.
// · Dinero: facturación neta de `docum_cc` (FACT + N/DB − N/CR).
// · Pedidos y cuenta: capa local + estado de cuenta ya existente.
//
// Se consulta al abrir la ficha y se cachea 5 minutos por cliente/ventana.
// Si Profit falla, la respuesta sigue trayendo pedidos y cartera; la UI
// muestra el aviso y no pinta ceros como si fueran ventas reales.
// ============================================================

export const CUSTOMER_INSIGHTS_VOLUME_SQL = `
SELECT /* nexo:customer_insights_products */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  CAST(f.fact_num AS varchar(30)) AS nota,
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  a.uni_relac AS uni_relac,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  MAX(f.fec_emis) AS fecha
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND RTRIM(f.co_cli) = @co_cli
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY YEAR(f.fec_emis), MONTH(f.fec_emis), CAST(f.fact_num AS varchar(30)), RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(ISNULL(a.uni_venta, '')), a.uni_relac
`;

export const CUSTOMER_INSIGHTS_BILLING_SQL = `
SELECT /* nexo:customer_insights_billing */
  YEAR(cc.fec_emis) AS anio,
  MONTH(cc.fec_emis) AS mes,
  SUM(CASE WHEN RTRIM(cc.tipo_doc) IN ('FACT', 'N/DB')
           THEN CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2) ELSE cc.monto_net END
           ELSE 0 END) AS facturado,
  SUM(CASE WHEN RTRIM(cc.tipo_doc) = 'N/CR'
           THEN CASE WHEN @moneda = 'USD' THEN ROUND(cc.monto_net / NULLIF(cc.tasa, 0), 2) ELSE cc.monto_net END
           ELSE 0 END) AS creditos,
  COUNT(DISTINCT cc.nro_doc) AS documentos,
  SUM(CASE WHEN @moneda = 'USD' AND (cc.tasa IS NULL OR cc.tasa = 0) THEN 1 ELSE 0 END) AS sin_tasa
FROM dbo.docum_cc AS cc
WHERE RTRIM(cc.co_cli) = @co_cli
  AND cc.anulado = 0
  AND cc.fec_emis >= @desde
  AND cc.fec_emis < @hasta
GROUP BY YEAR(cc.fec_emis), MONTH(cc.fec_emis)
`;

export const CUSTOMER_INSIGHTS_SIMILAR_SQL = `
SELECT /* nexo:customer_insights_similar */
  RTRIM(r.co_art) AS co_art,
  RTRIM(a.art_des) AS art_des,
  RTRIM(ISNULL(a.uni_venta, '')) AS uni_venta,
  a.uni_relac AS uni_relac,
  COUNT(DISTINCT RTRIM(f.co_cli)) AS clientes,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  (SELECT COUNT(DISTINCT RTRIM(f2.co_cli))
     FROM dbo.not_ent AS f2
     INNER JOIN dbo.reng_nde AS r2 ON r2.fact_num = f2.fact_num
     INNER JOIN dbo.art AS a2 ON a2.co_art = r2.co_art
     INNER JOIN dbo.clientes AS c2 ON c2.co_cli = f2.co_cli
     LEFT JOIN dbo.tipo_cli AS tc2 ON tc2.tip_cli = c2.tipo
   WHERE f2.anulada = 0
     AND a2.anulado = 0
     AND a2.co_lin = 'ABA'
     AND RTRIM(c2.tipo) + ' ' + RTRIM(tc2.des_tipo) = @tipo
     AND f2.fec_emis >= @desde
     AND f2.fec_emis < @hasta) AS total_tipo
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
INNER JOIN dbo.clientes AS c ON c.co_cli = f.co_cli
LEFT JOIN dbo.tipo_cli AS tc ON tc.tip_cli = c.tipo
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND RTRIM(c.tipo) + ' ' + RTRIM(tc.des_tipo) = @tipo
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY RTRIM(r.co_art), RTRIM(a.art_des), RTRIM(ISNULL(a.uni_venta, '')), a.uni_relac
`;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const VOLUME_QUERY_LIMIT = 20_000;
const BILLING_QUERY_LIMIT = 5_000;
const SIMILAR_QUERY_LIMIT = 200;
const SIMILAR_RESULT_LIMIT = 6;

interface CachedInsight {
  at: number;
  result: CustomerInsightResponse;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function monthOf(year: unknown, month: unknown, fallbackDate: string | null): string | null {
  const y = Math.trunc(toNumber(year));
  const m = Math.trunc(toNumber(month));
  if (y > 1900 && m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, '0')}`;
  return fallbackDate ? fallbackDate.slice(0, 7) : null;
}

function lastDayOfMonth(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month, 0));
  return dateKey(date);
}

function emptyOrders(): CustomerInsightOrders {
  return { activeCount: 0, pendingQty: 0, pendingKg: 0, nextDeliveryDate: null };
}

@Injectable()
export class CustomerInsightsService {
  private readonly logger = new Logger(CustomerInsightsService.name);
  private readonly cache = new Map<string, CachedInsight>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
    private readonly statements: CustomerStatementService,
    private readonly deliveryDates: DeliveryDatesService,
  ) {}

  async get(codeRaw: string, query: CustomerInsightQuery): Promise<CustomerInsightResponse> {
    const code = normalizeCustomerCode(codeRaw);
    const months = query.months;
    const currency = query.currency;
    const cacheKey = `${code}|${months}|${currency}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

    const windows = buildInsightWindows(months);

    // Metadata local: nunca debe impedir la ficha si la BD está lenta.
    let local: { name: string; customerType: string | null; vendor: string | null; isActive: boolean } | null = null;
    try {
      local = await this.prisma.customer.findUnique({
        where: { externalCode: code },
        select: { name: true, customerType: true, vendor: true, isActive: true },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el cliente ${code} en la BD local: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const customerType = local?.customerType?.trim() || null;

    const [volumeRes, billingRes, similarRes, ordersRes, accountRes] = await Promise.allSettled([
      this.profit.selectQuery(CUSTOMER_INSIGHTS_VOLUME_SQL, VOLUME_QUERY_LIMIT, {
        co_cli: code,
        desde: windows.from,
        hasta: windows.to,
      }),
      this.profit.selectQuery(CUSTOMER_INSIGHTS_BILLING_SQL, BILLING_QUERY_LIMIT, {
        co_cli: code,
        desde: windows.from,
        hasta: windows.to,
        moneda: currency,
      }),
      customerType
        ? this.profit.selectQuery(CUSTOMER_INSIGHTS_SIMILAR_SQL, SIMILAR_QUERY_LIMIT, {
            tipo: customerType,
            desde: new Date(`${windows.currentFromKey}-01T00:00:00.000Z`),
            hasta: windows.to,
          })
        : Promise.resolve([] as Record<string, unknown>[]),
      this.loadOrders(code),
      this.loadAccount(code, currency),
    ]);

    const volumeRows = volumeRes.status === 'fulfilled' ? volumeRes.value : [];
    const volumeOk = volumeRes.status === 'fulfilled';
    if (volumeRes.status === 'rejected') {
      this.logger.error(
        `No se pudo leer el volumen de ${code} en Profit: ${
          volumeRes.reason instanceof Error ? volumeRes.reason.message : String(volumeRes.reason)
        }`,
      );
    }

    const billingRows = billingRes.status === 'fulfilled' ? billingRes.value : [];
    const billingOk = billingRes.status === 'fulfilled';
    if (billingRes.status === 'rejected') {
      this.logger.error(
        `No se pudo leer la facturación de ${code} en Profit: ${
          billingRes.reason instanceof Error ? billingRes.reason.message : String(billingRes.reason)
        }`,
      );
    }

    const similarRaw = similarRes.status === 'fulfilled' ? similarRes.value : [];
    if (similarRes.status === 'rejected') {
      this.logger.warn(
        `No se pudo leer el surtido del segmento de ${code}: ${
          similarRes.reason instanceof Error ? similarRes.reason.message : String(similarRes.reason)
        }`,
      );
    }

    const orders = ordersRes.status === 'fulfilled' ? ordersRes.value : emptyOrders();
    if (ordersRes.status === 'rejected') {
      this.logger.warn(
        `No se pudieron leer los pedidos de ${code}: ${
          ordersRes.reason instanceof Error ? ordersRes.reason.message : String(ordersRes.reason)
        }`,
      );
    }

    const account = accountRes.status === 'fulfilled' ? accountRes.value : null;
    if (accountRes.status === 'rejected') {
      this.logger.warn(
        `No se pudo leer la cartera de ${code}: ${
          accountRes.reason instanceof Error ? accountRes.reason.message : String(accountRes.reason)
        }`,
      );
    }

    const rows = this.parseVolumeRows(volumeRows);
    const parsedBilling = this.parseBillingRows(billingRows);
    const similarProducts = this.parseSimilar(
      similarRaw,
      new Set(rows.map((row) => row.productCode)),
    );

    const built = buildCustomerInsights({
      rows,
      billingRows: parsedBilling.rows,
      billingAvailable: billingOk,
      billingPartial: parsedBilling.partial,
      windows,
      account,
      similar: similarProducts,
      truncated: rows.length >= VOLUME_QUERY_LIMIT,
    });

    const result: CustomerInsightResponse = {
      customer: {
        code,
        name: local?.name?.trim() || code,
        customerType,
        vendor: local?.vendor?.trim() || null,
        isActive: local?.isActive ?? true,
      },
      asOf: new Date().toISOString(),
      currency,
      months,
      currentPeriod: {
        from: `${windows.currentFromKey}-01`,
        to: windows.todayKey,
      },
      previousPeriod:
        windows.previousFromKey && windows.previousToKey
          ? {
              from: `${windows.previousFromKey}-01`,
              to: lastDayOfMonth(windows.previousToKey),
            }
          : null,
      totals: built.totals,
      previousTotals: built.previousTotals,
      trend: built.trend,
      monthly: built.monthly,
      annual: built.annual,
      products: built.products,
      lostProducts: built.lostProducts,
      similarProducts,
      cadence: built.cadence,
      account,
      orders,
      alerts: built.alerts,
      available: volumeOk,
      billingAvailable: billingOk,
      billingPartial: parsedBilling.partial,
      productBillingEstimated: billingOk && built.products.some((product) => product.current.billed !== null),
      truncated: rows.length >= VOLUME_QUERY_LIMIT,
      source: this.profit.dialect === 'mssql' ? 'profit' : 'fixtures',
    };

    // Solo se cachea una respuesta completa: si Profit falló, el siguiente
    // intento vuelve a consultar en vez de fijar el error por 5 minutos.
    if (result.available && result.billingAvailable) {
      this.remember(cacheKey, result);
    }

    return result;
  }

  /** Solo para pruebas/operación: fuerza la próxima lectura. */
  invalidate(): void {
    this.cache.clear();
  }

  private remember(key: string, result: CustomerInsightResponse): void {
    this.cache.set(key, { at: Date.now(), result });
    if (this.cache.size <= CACHE_MAX_ENTRIES) return;
    const oldest = this.cache.keys().next().value;
    if (oldest) this.cache.delete(oldest);
  }

  private parseVolumeRows(rawRows: Record<string, unknown>[]): InsightVolumeRow[] {
    const rows: InsightVolumeRow[] = [];
    for (const raw of rawRows) {
      const code = text(raw.co_art);
      if (!code) continue;
      const date = day(raw.fecha);
      const month = monthOf(raw.anio, raw.mes, date);
      if (!month || !date) continue;
      rows.push({
        month,
        year: Number(month.slice(0, 4)),
        note: text(raw.nota) || `${month}-${code}`,
        productCode: code,
        description: text(raw.art_des) || null,
        uom: text(raw.uni_venta) || null,
        kgPerUom: toNumberOrNull(raw.uni_relac),
        units: toNumber(raw.unid),
        kg: toNumber(raw.kg),
        date,
      });
    }
    return rows;
  }

  private parseBillingRows(rawRows: Record<string, unknown>[]): { rows: InsightBillingRow[]; partial: boolean } {
    const rows: InsightBillingRow[] = [];
    let partial = false;
    for (const raw of rawRows) {
      const date = day(raw.fecha);
      const month = monthOf(raw.anio, raw.mes, date);
      if (!month) continue;
      const billed = round2(toNumber(raw.facturado) - toNumber(raw.creditos));
      const missingRate = Math.trunc(toNumber(raw.sin_tasa));
      if (missingRate > 0) partial = true;
      rows.push({
        month,
        billed,
        documents: Math.trunc(toNumber(raw.documentos)),
        missingRate,
      });
    }
    return { rows, partial };
  }

  private parseSimilar(rawRows: Record<string, unknown>[], bought: Set<string>): CustomerInsightSimilar[] {
    const totalType = Math.max(0, ...rawRows.map((raw) => Math.trunc(toNumber(raw.total_tipo))));
    const out: CustomerInsightSimilar[] = [];
    for (const raw of rawRows) {
      const code = text(raw.co_art);
      if (!code || bought.has(code)) continue;
      const adopters = Math.trunc(toNumber(raw.clientes));
      const kg = toNumber(raw.kg);
      if (adopters <= 0 || kg <= 0) continue;
      out.push({
        code,
        description: text(raw.art_des) || null,
        uom: text(raw.uni_venta) || null,
        kgPerUom: toNumberOrNull(raw.uni_relac),
        adopters,
        adoptersPct: totalType > 0 ? round1((adopters / totalType) * 100) : null,
        avgTonnes: round2(kg / adopters / 1000),
        totalTonnes: round2(kg / 1000),
      });
    }
    return out
      .sort((a, b) => b.adopters - a.adopters || b.totalTonnes - a.totalTonnes || a.code.localeCompare(b.code))
      .slice(0, SIMILAR_RESULT_LIMIT);
  }

  private async loadOrders(code: string): Promise<CustomerInsightOrders> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { customerCode: code, isActive: true },
      select: {
        externalNumber: true,
        requestedDate: true,
        lines: { select: { productCode: true, pendingQty: true, pendingKg: true } },
      },
    });
    if (orders.length === 0) return emptyOrders();

    let pendingQty = 0;
    let pendingKg = 0;
    const items: { orderNumber: string; productCode: string }[] = [];
    for (const order of orders) {
      for (const line of order.lines) {
        pendingQty += toNumber(line.pendingQty);
        pendingKg += toNumber(line.pendingKg);
        items.push({ orderNumber: order.externalNumber, productCode: line.productCode });
      }
    }

    let tentative = new Map<string, string>();
    try {
      tentative = await this.deliveryDates.resolveForLines(items);
    } catch (error) {
      this.logger.warn(
        `No se pudieron resolver las fechas tentativas de ${code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let next: string | null = null;
    for (const order of orders) {
      for (const line of order.lines) {
        const effective =
          tentative.get(deliveryDateKey(order.externalNumber, line.productCode)) ??
          (order.requestedDate ? order.requestedDate.toISOString() : null);
        if (!effective) continue;
        const value = effective.slice(0, 10);
        if (!next || value < next) next = value;
      }
    }

    return {
      activeCount: orders.length,
      pendingQty: round2(pendingQty),
      pendingKg: round2(pendingKg),
      nextDeliveryDate: next,
    };
  }

  private async loadAccount(code: string, currency: CustomerInsightQuery['currency']): Promise<CustomerInsightAccount | null> {
    const summary = await this.statements.summaries(code, { moneda: currency });
    const item = summary.items.find((entry) => entry.code.toUpperCase() === code);
    if (!item) return null;
    return {
      saldo: round2(item.saldo),
      saldoVencido: round2(item.saldoVencido),
      credito: round2(item.credito),
      limiteCredito: item.limiteCredito,
      documentos: item.documentos,
      vencidos: item.vencidos,
    };
  }
}

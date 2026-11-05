import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ForecastSalesDaily,
  ForecastSalesQuery,
  ForecastSellerClientRow,
  ForecastSellerHistory,
  ForecastSellerRow,
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
// Vendedoras vs Forecast (solo lectura).
//
//  �� La venta se atribuye al VENDEDOR DE LA NOTA (`not_ent.co_ven`). No se usa
//    `clientes.co_ven`: en este Profit el 39 % del volumen se despacha con un
//    vendedor distinto al asignado a la cartera, y la evaluación debe reflejar
//    quién ejecutó la venta.
//  �� La meta de la empresa es EXACTAMENTE la del informe «Ventas vs Forecast»
//    (`ForecastService.companyTarget`).
//  �� La cuota de cada vendedora es su participación en los kg de los meses
//    cerrados de la ventana (`months`, 6 por defecto). La meta del cliente es
//    su participación en la venta histórica de su vendedora.
//  �� Σ cuotas = 100 % y Σ metas = meta de la empresa (redondeo por mayor
//    residuo). Sin histórico se reparte en partes iguales y se marca
//    `EQUAL_FALLBACK`; sin meta los porcentajes quedan en `null`.
//  �� Corte, días hábiles y proyección reutilizan el mismo motor que Ventas vs
//    Forecast (corte a ayer, lunes a sábado, zona America/Caracas).
// ============================================================

export const PROFIT_SELLER_MONTHLY_SQL = `
SELECT /* nexo:seller_sales_monthly */
  YEAR(f.fec_emis) AS anio,
  MONTH(f.fec_emis) AS mes,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven,
  RTRIM(ISNULL(v.ven_des, '')) AS ven_des,
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
LEFT JOIN dbo.vendedor AS v ON v.co_ven = f.co_ven
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY
  YEAR(f.fec_emis),
  MONTH(f.fec_emis),
  RTRIM(ISNULL(f.co_ven, '')),
  RTRIM(ISNULL(v.ven_des, '')),
  RTRIM(f.co_cli),
  RTRIM(ISNULL(c.cli_des, '')),
  RTRIM(LTRIM(RTRIM(ISNULL(c.tipo, '')) + ' ' + RTRIM(ISNULL(tc.des_tipo, ''))))
`;

export const PROFIT_SELLER_DAILY_SQL = `
SELECT /* nexo:seller_sales_daily */
  CAST(f.fec_emis AS date) AS fecha,
  RTRIM(ISNULL(f.co_ven, '')) AS co_ven,
  SUM(r.total_art) AS unid,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg,
  COUNT(DISTINCT f.fact_num) AS notas
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY CAST(f.fec_emis AS date), RTRIM(ISNULL(f.co_ven, ''))
`;

const BUSINESS_TIME_ZONE = 'America/Caracas';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 40;
const NO_SELLER = '__sin_vendedor__';
const NO_SELLER_LABEL = 'Sin vendedor';
const NO_CLIENT = '__sin_cliente__';
const NO_CLIENT_LABEL = 'Sin cliente';

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
  history: Map<string, number>;
  currentKg: number;
  currentUnits: number;
  currentInvoices: number;
  lastInvoiceDate: string | null;
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

  async sellersReport(query: ForecastSalesQuery): Promise<ForecastSellersResponse> {
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
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

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
      return this.empty(calendar);
    }
  }

  private async build(query: ForecastSalesQuery, calendar: MonthCalendar): Promise<ForecastSellersResponse> {
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

    const [company, monthlyRows, dailyRows] = await Promise.all([
      this.forecast.companyTarget(year, month, calendar.status),
      this.profit.selectQuery(PROFIT_SELLER_MONTHLY_SQL, 20000, { desde: historyStart, hasta: monthlyHasta }),
      dailyPromise,
    ]);

    const sellers = new Map<string, SellerAccum>();
    const companyHistory = new Map<string, number>();
    const allClients = new Set<string>();

    const sellerOf = (codeRaw: unknown, nameRaw: unknown): SellerAccum => {
      const code = text(codeRaw) || NO_SELLER;
      const name = text(nameRaw) || (code === NO_SELLER ? NO_SELLER_LABEL : code);
      let seller = sellers.get(code);
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
        };
        sellers.set(code, seller);
      }
      return seller;
    };

    const clientOf = (seller: SellerAccum, codeRaw: unknown, nameRaw: unknown, typeRaw: unknown): SellerClientAccum => {
      const code = text(codeRaw) || NO_CLIENT;
      const name = text(nameRaw) || (code === NO_CLIENT ? NO_CLIENT_LABEL : code);
      const customerType = text(typeRaw) || null;
      let client = seller.clients.get(code);
      if (!client) {
        client = {
          code,
          name,
          customerType,
          history: new Map(),
          currentKg: 0,
          currentUnits: 0,
          currentInvoices: 0,
          lastInvoiceDate: null,
        };
        seller.clients.set(code, client);
      } else if (!client.customerType && customerType) {
        client.customerType = customerType;
      }
      return client;
    };

    for (const raw of monthlyRows) {
      const rowYear = num(raw.anio);
      const rowMonth = num(raw.mes);
      if (!rowYear || !rowMonth) continue;
      const key = monthKey(rowYear, rowMonth);
      if (key !== reportKey && !historyKeys.has(key)) continue;

      const seller = sellerOf(raw.co_ven, raw.ven_des);
      const client = clientOf(seller, raw.co_cli, raw.cli_des, raw.tipo);
      const kg = num(raw.kg);
      const units = num(raw.unid);
      const invoices = Math.trunc(num(raw.notas));
      const last = isoDayOf(raw.ultima);

      allClients.add(client.code);

      if (last && (!client.lastInvoiceDate || last > client.lastInvoiceDate)) client.lastInvoiceDate = last;
      if (last && (!seller.lastInvoiceDate || last > seller.lastInvoiceDate)) seller.lastInvoiceDate = last;

      if (key === reportKey) {
        seller.currentKg += kg;
        seller.currentUnits += units;
        seller.currentInvoices += invoices;
        client.currentKg += kg;
        client.currentUnits += units;
        client.currentInvoices += invoices;
      } else {
        seller.history.set(key, (seller.history.get(key) ?? 0) + kg);
        client.history.set(key, (client.history.get(key) ?? 0) + kg);
        companyHistory.set(key, (companyHistory.get(key) ?? 0) + kg);
      }
    }

    // Serie diaria por vendedor (y de la red). Se usa el vendedor de la nota.
    const companyByDay = new Map<number, { kg: number; units: number; invoices: number }>();
    for (const raw of dailyRows) {
      const day = isoDayOf(raw.fecha);
      if (!day) continue;
      const dayNumber = Number(day.slice(8, 10));
      if (!Number.isFinite(dayNumber)) continue;
      const seller = sellerOf(raw.co_ven, null);
      const kg = num(raw.kg);
      const units = num(raw.unid);
      const invoices = Math.trunc(num(raw.notas));

      const sellerBucket = seller.daily.get(dayNumber) ?? { kg: 0, units: 0, invoices: 0 };
      sellerBucket.kg += kg;
      sellerBucket.units += units;
      sellerBucket.invoices += invoices;
      seller.daily.set(dayNumber, sellerBucket);

      const companyBucket = companyByDay.get(dayNumber) ?? { kg: 0, units: 0, invoices: 0 };
      companyBucket.kg += kg;
      companyBucket.units += units;
      companyBucket.invoices += invoices;
      companyByDay.set(dayNumber, companyBucket);
    }

    // Vendedores con venta en la ventana (histórico o mes del informe).
    const sellerList = [...sellers.values()].filter(
      (seller) => seller.currentKg > 0 || seller.history.size > 0,
    );
    const historyTotal = [...companyHistory.values()].reduce((acc, kg) => acc + kg, 0);

    const sellerWeights = new Map<string, number>();
    for (const seller of sellerList) {
      const total = [...seller.history.values()].reduce((acc, kg) => acc + kg, 0);
      sellerWeights.set(seller.code, total);
    }

    const allocationBasis =
      company.totalKg <= 0 || sellerList.length === 0
        ? 'NONE'
        : historyTotal > 0
          ? 'HISTORY'
          : 'EQUAL_FALLBACK';

    const sellerTargets =
      company.totalKg > 0
        ? allocateByWeight(sellerWeights, company.totalKg, {
            equalWhenEmpty: allocationBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();

    // Cuotas en PUNTOS porcentuales, con el mismo reparto y el mismo ajuste de
    // residuo que las metas: así la columna «Cuota %» suma 100,0 % aunque cada
    // meta se redondee a un decimal.
    const sellerQuotas =
      company.totalKg > 0
        ? allocateByWeight(sellerWeights, 100, {
            equalWhenEmpty: allocationBasis === 'EQUAL_FALLBACK',
          })
        : new Map<string, number>();

    const companyActual = roundTo(sellerList.reduce((acc, seller) => acc + seller.currentKg, 0));
    const companyUnits = roundTo(sellerList.reduce((acc, seller) => acc + seller.currentUnits, 0));
    const companyInvoices = sellerList.reduce((acc, seller) => acc + seller.currentInvoices, 0);
    const companyLastInvoice = sellerList
      .map((seller) => seller.lastInvoiceDate)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

    const rows: ForecastSellerRow[] = sellerList.map((seller) => {
      const sellerHistory = [...seller.history.values()].reduce((acc, kg) => acc + kg, 0);
      const targetKg = roundTo(sellerTargets.get(seller.code) ?? 0, 1);
      const historySeries = historyMonths.map((entry) => seller.history.get(monthKey(entry.year, entry.month)) ?? 0);
      const metrics = computeRunRate({
        actualKg: seller.currentKg,
        forecastKg: targetKg,
        calendar,
        history: historySeries,
      });

      const clientWeights = new Map<string, number>();
      for (const client of seller.clients.values()) {
        const total = [...client.history.values()].reduce((acc, kg) => acc + kg, 0);
        clientWeights.set(client.code, total);
      }
      const clientTargets =
        targetKg > 0
          ? allocateByWeight(clientWeights, targetKg, {
              // Una vendedora sin base histórica pero con cuota (reparto
              // igualitario de la red) reparte su meta entre sus clientes.
              equalWhenEmpty: sellerHistory <= 0,
            })
          : new Map<string, number>();

      const clientQuotas =
        targetKg > 0
          ? allocateByWeight(clientWeights, sellerQuotas.get(seller.code) ?? 0, {
              equalWhenEmpty: sellerHistory <= 0,
            })
          : new Map<string, number>();

      const clients: ForecastSellerClientRow[] = [...seller.clients.values()]
        .map((client) => {
          const clientHistory = [...client.history.values()].reduce((acc, kg) => acc + kg, 0);
          const clientTarget = roundTo(clientTargets.get(client.code) ?? 0, 1);
          const clientHistorySeries = historyMonths.map(
            (entry) => client.history.get(monthKey(entry.year, entry.month)) ?? 0,
          );
          const clientMetrics = computeRunRate({
            actualKg: client.currentKg,
            forecastKg: clientTarget,
            calendar,
            history: clientHistorySeries,
          });
          return {
            clientCode: client.code === NO_CLIENT ? '' : client.code,
            clientName: client.name,
            customerType: client.customerType,
            historicalKg: roundTo(clientHistory),
            shareOfSellerPct: sharePct(clientHistory, sellerHistory),
            quotaPct: company.totalKg > 0 ? roundTo(clientQuotas.get(client.code) ?? 0, 1) : null,
            targetKg: clientTarget,
            actualKg: roundTo(client.currentKg),
            actualUnits: roundTo(client.currentUnits),
            invoiceCount: client.currentInvoices,
            lastInvoiceDate: client.lastInvoiceDate,
            isNew: clientHistory <= 0 && client.currentKg > 0,
            ...clientMetrics,
          };
        })
        .sort((a, b) => b.targetKg - a.targetKg || b.actualKg - a.actualKg || a.clientName.localeCompare(b.clientName, 'es'));

      const history: ForecastSellerHistory[] = historyMonths.map((entry) => ({
        year: entry.year,
        month: entry.month,
        actualKg: roundTo(seller.history.get(monthKey(entry.year, entry.month)) ?? 0),
      }));

      return {
        sellerCode: seller.code === NO_SELLER ? '' : seller.code,
        sellerName: seller.name,
        clientCount: seller.clients.size,
        activeClientCount: [...seller.clients.values()].filter((client) => client.currentKg > 0).length,
        invoiceCount: seller.currentInvoices,
        historicalKg: roundTo(sellerHistory),
        sharePct: sharePct(sellerHistory, historyTotal),
        currentSharePct: sharePct(seller.currentKg, companyActual),
        quotaPct: company.totalKg > 0 ? roundTo(sellerQuotas.get(seller.code) ?? 0, 1) : null,
        targetKg,
        actualKg: roundTo(seller.currentKg),
        actualUnits: roundTo(seller.currentUnits),
        lastInvoiceDate: seller.lastInvoiceDate,
        ...metrics,
        history,
        daily: this.buildDaily(calendar, seller.daily, targetKg),
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
        clientCount: allClients.size,
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

  private empty(calendar: MonthCalendar): ForecastSellersResponse {
    return {
      year: calendar.year,
      month: calendar.month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: false,
      forecastAvailable: false,
      forecastSource: 'NONE',
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
      },
      daily: [],
      sellers: [],
      generatedAt: new Date().toISOString(),
    };
  }
}

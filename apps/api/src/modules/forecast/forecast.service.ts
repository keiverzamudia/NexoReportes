import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  FORECAST_WEEK_INDEXES,
  ForecastPlanResponse,
  ForecastPlanRow,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastRow,
  ForecastSalesDaily,
  ForecastSalesHistory,
  ForecastSalesQuery,
  ForecastSalesResponse,
  ForecastSalesRow,
  ForecastSalesSource,
  ForecastSetWeeks,
  ForecastWeekRange,
  ForecastWeekRow,
  InventoryByWarehouse,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { computeAvailability } from '../availability/availability.engine';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';
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
//  · El FORECAST MENSUAL por artículo se lee de Profit (`dbo.xart_fore`) TAL
//    CUAL, sin conversión: `kg_mes` está en KILOGRAMOS (no en sacos). Es solo
//    lectura; Nexo nunca lo escribe.
//  · `xart_fore` no tiene código ni mes: se cruza por descripción y aplica al
//    mes en curso.
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

// Forecast mensual mantenido por producción en Profit (`COR_A3.dbo.xart_fore`).
// `kg_mes` está en KILOGRAMOS y se usa TAL CUAL (sin convertir). `kg_sem` no se
// usa: las semanas se reparten en Nexo como mensual / 4 y se ajustan aquí. La
// tabla no tiene código ni mes, por eso se cruza por descripción (RTRIM) y se
// aplica solo al mes en curso.
const PROFIT_FORECAST_SQL = `
SELECT RTRIM(a.co_art) AS co_art, f.kg_mes AS forecast_mes
FROM dbo.xart_fore AS f
INNER JOIN dbo.art AS a
        ON RTRIM(LTRIM(a.art_des)) = RTRIM(LTRIM(f.nom))
       AND a.anulado = 0
`;

// ============================================================
// Ventas reales vs forecast (solo lectura).
//
// La venta se mide por NOTA DE ENTREGA (despacho), no por factura: encabezado
// `dbo.not_ent` + renglones `dbo.reng_nde`. En este Profit ambas tablas usan
// `fact_num` como llave (NO `not_num`): es el número de documento del módulo,
// por eso el JOIN es `r.fact_num = f.fact_num`. `kg_mes` de `xart_fore` está en
// KILOGRAMOS, por eso la comparación global es en kg/t y la de producto añade
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

interface SalesMonthBucket {
  kg: number;
  units: number;
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

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);
  // Ventas vs forecast: la pestaña se refresca seguido y Profit es un recurso
  // único; 5 minutos por combinación evitan ráfagas de consultas.
  private readonly salesCache = new Map<string, { at: number; data: ForecastSalesResponse }>();
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
      throw new ServiceUnavailableException('No se pudo leer el forecast de Profit (xart_fore). Intenta de nuevo.');
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

    const [monthlyRows, dailyRows, forecast] = await Promise.all([
      this.profit.selectQuery(PROFIT_SALES_MONTHLY_SQL, 20000, { desde: historyStart, hasta: monthlyHasta }),
      dailyHasta
        ? this.profit.selectQuery(PROFIT_SALES_DAILY_SQL, 3000, { desde: reportStart, hasta: dailyHasta })
        : Promise.resolve([] as Record<string, unknown>[]),
      this.profitForecastIndex(year, month),
    ]);

    const reportKey = monthKey(year, month);
    const globalByMonth = new Map<string, SalesMonthBucket>();
    const byCodeMonth = new Map<string, Map<string, SalesMonthBucket>>();
    const salesMeta = new Map<string, SalesProductMeta>();

    // La meta viva solo existe para el mes en curso. Mientras se lee, se guarda
    // como snapshot para que el mes se pueda comparar cuando cierre.
    if (calendar.status === 'OPEN' && forecast.available && forecast.byCode.size > 0) {
      await this.persistForecastTargets(year, month, forecast.byCode);
    }

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

    // Filas = artículos con venta EN ESTE MES + artículos con meta (viva en el
    // mes en curso, snapshot en un mes cerrado). Un artículo que solo vendió
    // meses atrás no ensucia el informe con 0/0.
    const currentSalesCodes = [...byCodeMonth.entries()]
      .filter(([, months]) => months.has(reportKey))
      .map(([code]) => code);
    const historyMonths = previousMonths(year, month, query.months);
    // El mes del informe entra a la consulta de snapshots salvo cuando su meta
    // es viva; el histórico siempre se compara contra la meta guardada.
    const targetMonths = calendar.status === 'OPEN' ? historyMonths : [{ year, month }, ...historyMonths];
    const targetsByMonth = await this.forecastTargetIndex(targetMonths);
    const reportTargets = targetsByMonth.get(reportKey) ?? new Map<string, number>();
    const isLive = calendar.status === 'OPEN';
    const forecastCodes = isLive ? forecast.byCode.keys() : reportTargets.keys();
    const codes = new Set<string>([...currentSalesCodes, ...forecastCodes]);
    const productRows = await this.productMeta([...codes].filter((code) => !salesMeta.has(code)));

    const rows: ForecastSalesRow[] = [...codes].map((code) => {
      const info = salesMeta.get(code);
      const product = productRows.get(code);
      const uom = info?.uom ?? product?.uom ?? 'KG';
      const kgPerUom = info?.kgPerUom ?? product?.kgPerUom ?? null;
      const agg = byCodeMonth.get(code)?.get(reportKey) ?? { kg: 0, units: 0 };
      const forecastKg = roundTo(isLive ? (forecast.byCode.get(code) ?? 0) : (reportTargets.get(code) ?? 0));
      const rowHistory = historyMonths.map((entry) => {
        const key = monthKey(entry.year, entry.month);
        const bucket = byCodeMonth.get(code)?.get(key);
        const target = targetsByMonth.get(key);
        return {
          year: entry.year,
          month: entry.month,
          kg: bucket?.kg ?? 0,
          units: bucket?.units ?? 0,
          forecastKg: target?.has(code) ? roundTo(target.get(code) ?? 0) : null,
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
      return {
        year: entry.year,
        month: entry.month,
        actualKg: roundTo(bucket?.kg ?? 0),
        actualUnits: roundTo(bucket?.units ?? 0),
        forecastKg:
          targets && targets.size > 0 ? roundTo([...targets.values()].reduce((acc, kg) => acc + kg, 0)) : null,
      };
    });

    // Origen de la meta del mes del informe. `NONE` no es un error: un mes
    // cerrado sin snapshot (o un mes futuro) simplemente no tiene meta.
    const forecastSource: ForecastSalesSource = isLive
      ? forecast.available && forecast.byCode.size > 0
        ? 'LIVE'
        : 'NONE'
      : reportTargets.size > 0
        ? 'SNAPSHOT'
        : 'NONE';

    return {
      year,
      month,
      asOf: calendar.cut,
      basis: calendar.basis,
      status: calendar.status,
      salesAvailable: true,
      forecastAvailable: isLive ? forecast.available : true,
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
        ...totals,
        invoiceCount,
        lastInvoiceDate,
      },
      daily: this.buildDailySeries(calendar, dailyRows, totalForecastKg),
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
    forecastKg: number,
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

      series.push({
        date: isoDay(calendar.year, calendar.month, day),
        actualKg,
        actualUnits: roundTo(bucket?.units ?? 0),
        invoiceCount: Math.trunc(bucket?.invoices ?? 0),
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
  // `xart_fore` no tiene histórico: para poder comparar un mes cerrado hay que
  // guardar la meta mientras el mes está vigente. La captura es idempotente y
  // NUNCA escribe en Profit; si falla, el informe sigue funcionando.
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
  }> {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const forecast = await this.profitForecastIndex(year, month);
    if (!forecast.available) {
      return { year, month, products: 0, captured: false };
    }
    await this.persistForecastTargets(year, month, forecast.byCode);
    return { year, month, products: forecast.byCode.size, captured: true };
  }

  /** Upsert por artículo; solo escribe si la meta cambió o hay filas nuevas. */
  private async persistForecastTargets(year: number, month: number, byCode: Map<string, number>): Promise<void> {
    const entries = [...byCode.entries()].filter(([code]) => code.length > 0);
    if (entries.length === 0) return;

    try {
      const existing = await this.prisma.forecastTarget.findMany({
        where: { year, month },
        select: { productCode: true, targetKg: true },
      });
      const unchanged =
        existing.length === entries.length &&
        entries.every(([code, kg]) => {
          const found = existing.find((row) => row.productCode === code);
          return found !== undefined && Math.abs(num(found.targetKg) - kg) < 0.001;
        });
      if (unchanged) return;

      for (const [productCode, targetKg] of entries) {
        await this.prisma.forecastTarget.upsert({
          where: { year_month_productCode: { year, month, productCode } },
          update: { targetKg, capturedAt: new Date() },
          create: { year, month, productCode, targetKg },
        });
      }
      this.logger.log(`ForecastTarget ${year}-${pad2(month)}: ${entries.length} metas guardadas/actualizadas.`);
    } catch (error) {
      // La captura es un extra: si la BD local falla, el informe sigue en pie.
      this.logger.warn(
        `No se pudo guardar el snapshot de la meta ${year}-${pad2(month)}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  /** Metas por mes (`yyyy-mm` → código → kg). Si la consulta falla, vacío. */
  private async forecastTargetIndex(
    months: { year: number; month: number }[],
  ): Promise<Map<string, Map<string, number>>> {
    const map = new Map<string, Map<string, number>>();
    if (months.length === 0) return map;
    try {
      const rows = await this.prisma.forecastTarget.findMany({
        where: { OR: months.map((entry) => ({ year: entry.year, month: entry.month })) },
        select: { year: true, month: true, productCode: true, targetKg: true },
      });
      for (const row of rows) {
        const key = monthKey(row.year, row.month);
        let perCode = map.get(key);
        if (!perCode) {
          perCode = new Map();
          map.set(key, perCode);
        }
        perCode.set(row.productCode, num(row.targetKg));
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
  private async productMeta(codes: string[]) {    const map = new Map<string, { description: string; uom: string; kgPerUom: number | null }>();
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

  // `xart_fore` es una foto del mes en curso (no tiene columna de mes). Para
  // cualquier otro mes se devuelve 0 sin consultar Profit. Se compara contra la
  // fecha del NEGOCIO (America/Caracas), no la del servidor.
  private isCurrentMonth(year: number, month: number): boolean {
    const today = todayInTimeZone(BUSINESS_TIME_ZONE);
    return Number(today.slice(0, 4)) === year && Number(today.slice(5, 7)) === month;
  }

  // Forecast mensual por artículo desde Profit (`xart_fore.kg_mes`), SIN conversión.
  // Si la consulta falla, se devuelve el mapa vacío y `available=false` para que
  // la UI avise en lugar de mostrar valores inventados.
  private async profitForecastIndex(year: number, month: number): Promise<{ byCode: Map<string, number>; available: boolean }> {
    if (!this.isCurrentMonth(year, month)) {
      return { byCode: new Map(), available: true };
    }
    try {
      const rows = await this.profit.selectQuery(PROFIT_FORECAST_SQL, 5000);
      const byCode = new Map<string, number>();
      for (const raw of rows) {
        const code = String(raw.co_art ?? '').trim();
        if (!code) continue;
        if (byCode.has(code)) {
          this.logger.warn(`xart_fore trae más de una fila para ${code}; se usa la última.`);
        }
        byCode.set(code, num(raw.forecast_mes));
      }
      return { byCode, available: true };
    } catch (error) {
      this.logger.warn(`No se pudo leer el forecast de Profit (xart_fore): ${error instanceof Error ? error.message : 'error desconocido'}`);
      return { byCode: new Map(), available: false };
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

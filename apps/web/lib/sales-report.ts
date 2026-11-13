import type {
  ForecastCustomerSalesResponse,
  ForecastCustomerSalesRow,
  ForecastSalesDayCustomer,
  ForecastSalesResponse,
  ForecastSalesRow,
  ForecastWeekRange,
} from '@nexo/contracts';

// ============================================================
// Utilidades puras de «Ventas vs Forecast» (probadas con vitest).
//
// La UI no calcula proyecciones: solo da formato, semáforo y CSV a partir de
// la respuesta del API. Así las cifras del informe y del archivo descargado
// siempre coinciden.
// ============================================================

export type SalesTone = 'good' | 'warn' | 'bad' | 'none';

// Verde ≥ 100 %, ámbar 85–99 %, rojo < 85 %. Sin meta no hay semáforo.
export const SALES_THRESHOLDS = { good: 100, warn: 85 } as const;

export const SALES_TONE_LABEL: Record<SalesTone, string> = {
  good: 'Cumplido',
  warn: 'En riesgo',
  bad: 'Crítico',
  none: 'Sin meta',
};

export function salesTone(pct: number | null | undefined): SalesTone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'none';
  if (pct >= SALES_THRESHOLDS.good) return 'good';
  if (pct >= SALES_THRESHOLDS.warn) return 'warn';
  return 'bad';
}

export function fmtPct(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(pct)} %`;
}

export function fmtKg(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Porcentaje con signo explícito («+12,4 %» / «-3,0 %»). */
export function fmtSignedPct(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const formatted = fmtPct(pct, decimals);
  return pct > 0 ? `+${formatted}` : formatted;
}

/**
 * Variación % de cada mes contra el anterior: (mes ÷ mes previo − 1) × 100.
 * `null` en el primer mes y cuando el mes previo no vendió (no hay base de
 * comparación). El mes en curso entra con su venta parcial, así el punto se
 * mueve a medida que avanza el mes.
 */
export function monthOverMonthPct(values: Array<number | null | undefined>): Array<number | null> {
  return values.map((value, index) => {
    if (index === 0) return null;
    const previous = values[index - 1];
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(value) ||
      previous === null ||
      previous === undefined ||
      !Number.isFinite(previous) ||
      previous <= 0
    ) {
      return null;
    }
    // Un decimal, como el resto de porcentajes del informe.
    return Math.round((value / previous - 1) * 1000) / 10;
  });
}

/** Toneladas con un decimal («1.777,5 t»). */
export function fmtTonnes(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  return fmtKg(kg / 1000, 1);
}

/**
 * Frase ejecutiva del informe: venta acumulada, meta, cierre estimado y brecha.
 * Se calcula del propio payload para que nunca quede desactualizada.
 */
export function buildNarrative(report: ForecastSalesResponse): string {
  const totals = report.totals;
  const month = monthLabel(report.year, report.month);

  if (report.status === 'FUTURE') {
    return totals.forecastKg > 0
      ? `Meta de ${fmtKg(totals.forecastKg)} kg para ${month}. Todavía no hay entregas.`
      : `Sin meta ni entregas registradas para ${month}.`;
  }

  if (totals.forecastKg <= 0) {
    return `Llevamos ${fmtKg(totals.actualKg)} kg vendidos; Profit no tiene meta cargada para ${month}.`;
  }

  if (totals.projectedKg === null || totals.projectedAttainmentPct === null) {
    return `Llevamos ${fmtKg(totals.actualKg)} kg de una meta de ${fmtKg(totals.forecastKg)} kg.`;
  }

  const gap = totals.gapKg ?? 0;
  const closing = gap < 0 ? `faltarían ~${fmtKg(Math.abs(gap))} kg` : `iríamos ~${fmtKg(gap)} kg por encima`;

  return `Llevamos ${fmtKg(totals.actualKg)} kg de una meta de ${fmtKg(totals.forecastKg)} kg; al ritmo actual cerraríamos en ~${fmtKg(
    totals.projectedKg,
  )} kg (${fmtPct(totals.projectedAttainmentPct)}), así que ${closing}.`;
}

export const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const MONTHS_ES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

export function monthLabel(year: number, month: number, short = false): string {
  const names = short ? MONTHS_ES_SHORT : MONTHS_ES;
  return `${names[month - 1] ?? ''} ${year}`;
}

export function dayLabel(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  const month = Number(isoDate.slice(5, 7));
  const year = Number(isoDate.slice(0, 4));
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-VE', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  return `${weekday} ${day}`;
}

export interface SalesFilters {
  unit: 'ALL' | 'SAC' | 'KG';
  search: string;
  onlyWithSales: boolean;
  onlyWithForecast: boolean;
  /** Oculta los artículos del catálogo que no tienen meta ni venta. */
  onlyWithData: boolean;
}

export function filterSalesRows(rows: ForecastSalesRow[], filters: SalesFilters): ForecastSalesRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.unit === 'ALL' || row.uom === filters.unit) &&
      (!filters.onlyWithSales || row.actualKg > 0) &&
      (!filters.onlyWithForecast || row.forecastKg > 0) &&
      (!filters.onlyWithData ||
        row.forecastKg > 0 ||
        row.actualKg > 0 ||
        (row.forecastCapturedKg ?? 0) > 0) &&
      (!needle ||
        row.productCode.toLowerCase().includes(needle) ||
        row.description.toLowerCase().includes(needle)),
  );
}

// ---------- Participación por cliente ----------

export interface CustomerSalesFilters {
  search: string;
  /** Oculta los clientes del catálogo que no vendieron en el mes. */
  onlyWithSales: boolean;
}

export function filterCustomerSalesRows(
  rows: ForecastCustomerSalesRow[],
  filters: CustomerSalesFilters,
): ForecastCustomerSalesRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!filters.onlyWithSales || row.actualKg > 0) &&
      (!needle ||
        row.customerCode.toLowerCase().includes(needle) ||
        row.customerName.toLowerCase().includes(needle)),
  );
}

export interface CumulativePoint {
  label: string;
  date: string;
  actual: number | null;
  projected: number | null;
  pace: number | null;
}

/**
 * Serie lista para ECharts: etiqueta del día, acumulado real (null tras el
 * corte), proyección (null antes del corte) y ritmo uniforme del forecast.
 */
export function buildCumulativeSeries(report: ForecastSalesResponse): CumulativePoint[] {
  return report.daily.map((day) => ({
    label: String(Number(day.date.slice(8, 10))),
    date: day.date,
    actual: day.cumulativeKg,
    projected: day.projectedCumulativeKg,
    pace: day.forecastCumulativeKg,
  }));
}

// ---------- Ventas del día (panel bajo la gráfica) ----------

export interface SalesDayWithSales {
  date: string;
  dayNumber: number;
  kg: number;
  units: number;
  invoices: number;
  /** Acumulado del mes hasta ese día (incluido). */
  cumulativeKg: number;
  /** Día posterior al corte: se está vendiendo en este momento. */
  partial: boolean;
}

/** Días del mes que ya tienen despachos, en orden cronológico. */
export function salesDaysWithSales(report: ForecastSalesResponse): SalesDayWithSales[] {
  const cut = report.asOf;
  let running = 0;
  const days: SalesDayWithSales[] = [];

  for (const day of report.daily) {
    if (day.actualKg <= 0) continue;
    running += day.actualKg;
    days.push({
      date: day.date,
      dayNumber: Number(day.date.slice(8, 10)),
      kg: day.actualKg,
      units: day.actualUnits,
      invoices: day.invoiceCount,
      cumulativeKg: running,
      partial: cut !== null && day.date > cut,
    });
  }

  return days;
}

// ---------- Barras diarias (ventas por día) ----------

export interface SalesDayBar {
  date: string;
  dayNumber: number;
  kg: number;
  units: number;
  invoices: number;
  /** Kg comprometidos en pedidos con entrega efectiva ese día (pronóstico). */
  pendingKg: number;
  /** Pedidos distintos que aportan ese pronóstico. */
  pendingOrders: number;
  /** Día posterior al corte: todavía se está vendiendo. */
  partial: boolean;
  /** Día que aún no llega: la ranura queda vacía. */
  future: boolean;
  isToday: boolean;
}

/**
 * Una entrada por cada día del mes (también los de 0 kg): la tira de barras
 * necesita las ranuras vacías para mostrar el mes que falta por transcurrir.
 */
export function buildDayBars(report: ForecastSalesResponse): SalesDayBar[] {
  const cut = report.asOf;
  const today = report.days.today;

  return report.daily.map((day) => ({
    date: day.date,
    dayNumber: Number(day.date.slice(8, 10)),
    kg: day.actualKg,
    units: day.actualUnits,
    invoices: day.invoiceCount,
    pendingKg: day.pendingKg ?? 0,
    pendingOrders: day.pendingOrders ?? 0,
    partial: cut !== null && day.date > cut && day.date <= today,
    future: day.date > today,
    isToday: day.date === today,
  }));
}

export interface DailySalesScale {
  /** Tope de la pista en kg/día (incluye la meta diaria cuando la hay). */
  maxKg: number;
  /** Meta uniforme por día del forecast; null si el mes no tiene meta. */
  goalKg: number | null;
}

/** Redondeo «amable» para el eje (1, 1,2, 1,5, 2, 2,5… × 10^n). */
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * Escala de la tira diaria. La meta por día usa la misma pendiente que la
 * línea «Ritmo forecast» del acumulado (forecast ÷ días del mes). El tope mide
 * la barra apilada (venta real + pronóstico de pedidos).
 */
export function dailySalesScale(report: ForecastSalesResponse, bars: SalesDayBar[]): DailySalesScale {
  const peak = bars.reduce((max, bar) => Math.max(max, bar.kg + bar.pendingKg), 0);
  const goalKg =
    report.totals.forecastKg > 0 && report.days.workingInMonth > 0
      ? report.totals.forecastKg / report.days.workingInMonth
      : null;
  const base = Math.max(peak, goalKg ?? 0);
  // 5 % de aire: el día más alto no toca el borde de la pista.
  return { maxKg: base > 0 ? niceCeil(base * 1.05) : 1, goalKg };
}

/** % del forecast del mes ya comprometido en pedidos pendientes. */
export function pendingCoveragePct(report: ForecastSalesResponse): number | null {
  const forecastKg = report.totals.forecastKg;
  if (!Number.isFinite(forecastKg) || forecastKg <= 0) return null;
  return (report.totals.pendingKg / forecastKg) * 100;
}

/** % que el pronóstico representa dentro del día (real + pendiente). */
export function dayPendingSharePct(bar: SalesDayBar): number | null {
  const total = bar.kg + bar.pendingKg;
  if (total <= 0) return null;
  return (bar.pendingKg / total) * 100;
}

// ---------- Brecha del mes y del día ----------

export type SalesGapScope = 'month' | 'day';

export interface SalesGapSnapshot {
  /** Brecha del mes: venta acumulada − forecast (negativa = falta). */
  monthGapKg: number | null;
  /** Avance del mes: venta acumulada ÷ forecast. */
  monthPct: number | null;
  /** Objetivo del día: el ritmo necesario del hero (kg/día). */
  dayGoalKg: number | null;
  /** Venta registrada hoy (el día en curso entra parcial). */
  todayKg: number;
  /** Lo que falta hoy para el ritmo necesario; ≤ 0 si ya se cumplió. */
  dayGapKg: number | null;
  /** Avance del día: venta de hoy ÷ ritmo necesario. */
  dayPct: number | null;
}

/**
 * Cifras de la tarjeta «Brecha». El mes compara la venta acumulada contra el
 * forecast; el día compara la venta de hoy contra el ritmo necesario que
 * publica el API (`totals.requiredDailyKg`), es decir, lo que hay que vender
 * por día para cerrar el mes en meta.
 */
export function salesGap(report: ForecastSalesResponse): SalesGapSnapshot {
  const forecastKg = report.totals.forecastKg;
  const actualKg = report.totals.actualKg;
  const todayKg = report.daily.find((day) => day.date === report.days.today)?.actualKg ?? 0;
  const dayGoalKg = report.status === 'OPEN' ? report.totals.requiredDailyKg : null;

  return {
    monthGapKg: forecastKg > 0 ? actualKg - forecastKg : null,
    monthPct: forecastKg > 0 ? report.totals.attainmentPct : null,
    dayGoalKg,
    todayKg,
    dayGapKg: dayGoalKg === null ? null : dayGoalKg - todayKg,
    // Meta 0 = el mes ya está cubierto: el día cuenta como cumplido.
    dayPct:
      dayGoalKg === null ? null : dayGoalKg > 0 ? roundPct((todayKg / dayGoalKg) * 100) : 100,
  };
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------- Desglose del día (tabla del panel) ----------

export interface SalesDayProductLine {
  productCode: string;
  description: string;
  uom: string;
  kg: number;
  units: number;
  sacks: number | null;
}

/**
 * Artículos despachados en un día. El desglose del API solo trae código, kg y
 * unidades; la descripción, la UOM y los sacos salen de `rows` (el mismo
 * informe), así el payload no duplica el catálogo.
 */
export function productsForDay(report: ForecastSalesResponse, date: string): SalesDayProductLine[] {
  const day = report.daily.find((entry) => entry.date === date);
  if (!day) return [];

  const rowsByCode = new Map(report.rows.map((row) => [row.productCode, row]));

  return day.products
    .map((product) => {
      const row = rowsByCode.get(product.productCode);
      const kgPerUom = row?.kgPerUom ?? null;
      const isSack = row?.uom === 'SAC';
      return {
        productCode: product.productCode,
        description: row?.description ?? product.productCode,
        uom: row?.uom ?? '',
        kg: product.kg,
        units: product.units,
        sacks:
          isSack && kgPerUom !== null && kgPerUom > 0
            ? product.kg / kgPerUom
            : isSack
              ? product.units
              : null,
      };
    })
    .sort((a, b) => b.kg - a.kg || a.productCode.localeCompare(b.productCode));
}

// ---------- Detalle del día (modal «Desglose del día») ----------

/**
 * Participación de `part` sobre `total`, en % con un decimal. Devuelve null
 * cuando no hay base (día sin venta), nunca Infinity.
 */
export function sharePct(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

export interface DayProductClient {
  customerCode: string;
  customerName: string;
  kg: number;
  units: number;
  /** Participación del cliente sobre el total del PRODUCTO (no del día). */
  sharePct: number | null;
}

/**
 * Clientes que compraron un producto del día, con su participación sobre el
 * total del producto. Se usa al expandir una fila de la pestaña «Productos».
 */
export function clientsForProduct(
  customers: ForecastSalesDayCustomer[],
  productCode: string,
): DayProductClient[] {
  const rows: Array<Omit<DayProductClient, 'sharePct'>> = [];
  for (const customer of customers) {
    const line = customer.products.find((product) => product.productCode === productCode);
    if (!line) continue;
    rows.push({
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      kg: line.kg,
      units: line.units,
    });
  }
  const total = rows.reduce((acc, row) => acc + row.kg, 0);
  return rows
    .map((row) => ({ ...row, sharePct: sharePct(row.kg, total) }))
    .sort((a, b) => b.kg - a.kg || a.customerName.localeCompare(b.customerName));
}

// ---------- Forecast semanal del producto ----------

export interface WeeklyForecastTile {
  weekIndex: number;
  from: string;
  to: string;
  /** Rango corto para la etiqueta: «08–14». */
  rangeLabel: string;
  kg: number;
  /** Peso de la semana sobre el forecast mensual. */
  pctOfMonth: number | null;
  /** Equivalente en sacos (solo artículos SAC). */
  sacks: number | null;
  /** La fecha de hoy cae dentro de la semana. */
  isCurrent: boolean;
}

export interface WeeklyForecast {
  tiles: WeeklyForecastTile[];
  totalKg: number;
  /** false = Profit no trajo desglose para el mes: no se pintan ceros falsos. */
  hasSplit: boolean;
}

/**
 * Reparte el forecast del producto en sus 4 semanas con las cantidades del
 * Asignador (`weeks[].qty`, ya en kg) y los rangos que devuelve el API.
 */
export function weeklyForecast({
  monthKg,
  weeks,
  weekRanges,
  today = null,
  kgPerUom = null,
}: {
  monthKg: number;
  weeks: ReadonlyArray<{ weekIndex: number; qty: number }>;
  weekRanges: ReadonlyArray<ForecastWeekRange>;
  /** Día de hoy (yyyy-mm-dd) para marcar la semana en curso. */
  today?: string | null;
  /** Kg por saco de los artículos SAC; null en granel. */
  kgPerUom?: number | null;
}): WeeklyForecast {
  const byWeek = new Map(
    weeks.map((week) => [week.weekIndex, Number.isFinite(week.qty) ? Math.max(0, week.qty) : 0]),
  );
  const tiles = weekRanges.map((range) => {
    const kg = byWeek.get(range.weekIndex) ?? 0;
    return {
      weekIndex: range.weekIndex,
      from: range.from,
      to: range.to,
      rangeLabel: `${range.from.slice(8, 10)}–${range.to.slice(8, 10)}`,
      kg,
      pctOfMonth: sharePct(kg, monthKg),
      sacks: kgPerUom !== null && kgPerUom > 0 ? kg / kgPerUom : null,
      isCurrent: Boolean(today && today >= range.from && today <= range.to),
    };
  });
  const totalKg = tiles.reduce((acc, tile) => acc + tile.kg, 0);
  return { tiles, totalKg, hasSplit: totalKg > 0 };
}

// ---------- Barras de desviación por producto ----------

/**
 * Posición del marcador de meta dentro de la pista (%). El resto de la pista
 * (30 %) queda libre para ver cuánto superó la venta o la proyección a la meta.
 * Al ser fija, todos los productos comparten la misma referencia visual: 100 %.
 */
export const META_MARKER_PCT = 70;

export interface DeviationGeometry {
  /** false = el artículo no tiene meta: no existe un 100 % de referencia. */
  hasMeta: boolean;
  /** Posición fija del marcador (100 % de la meta) en % del ancho de la pista. */
  markerPct: number;
  /** Ancho de la barra real en % de la pista (recortado a 100). */
  actualWidthPct: number;
  /** Ancho de la barra de proyección en % de la pista (recortado a 100). */
  projectedWidthPct: number;
  /** Venta real como % de la meta (sin recortar; null si no hay meta). */
  actualPctOfMeta: number | null;
  /** Proyección como % de la meta (sin recortar; null si no hay meta). */
  projectedPctOfMeta: number | null;
  /** La barra llegó al borde de la pista: el exceso se informa con texto. */
  actualClipped: boolean;
  projectedClipped: boolean;
}

/**
 * Geometría de una barra de desviación. La pista se normaliza por producto:
 * `meta = markerPct % del ancho`, así el marcador cae siempre en el mismo
 * punto y las barras se leen como «% de la meta» (y no contra el artículo más
 * grande, que además cambiaba al filtrar).
 */
export function salesDeviationGeometry(
  row: Pick<ForecastSalesRow, 'forecastKg' | 'actualKg' | 'projectedKg'>,
  markerPct: number = META_MARKER_PCT,
): DeviationGeometry {
  // Entre 5 % y 95 %: siempre hace falta algo de pista a ambos lados.
  const marker = Math.min(95, Math.max(5, markerPct));
  const forecastKg = Number.isFinite(row.forecastKg) ? row.forecastKg : 0;

  if (forecastKg <= 0) {
    return {
      hasMeta: false,
      markerPct: marker,
      actualWidthPct: 0,
      projectedWidthPct: 0,
      actualPctOfMeta: null,
      projectedPctOfMeta: null,
      actualClipped: false,
      projectedClipped: false,
    };
  }

  // En un mes futuro no hay proyección: se usa la venta real (0).
  const projectedKg = row.projectedKg ?? row.actualKg;
  const actualPctOfMeta = (Math.max(0, row.actualKg) / forecastKg) * 100;
  const projectedPctOfMeta = (Math.max(0, projectedKg) / forecastKg) * 100;
  const toWidth = (pctOfMeta: number) => Math.max(0, Math.min(100, (pctOfMeta / 100) * marker));
  const clips = (pctOfMeta: number) => (pctOfMeta / 100) * marker >= 100;

  return {
    hasMeta: true,
    markerPct: marker,
    actualWidthPct: toWidth(actualPctOfMeta),
    projectedWidthPct: toWidth(projectedPctOfMeta),
    actualPctOfMeta,
    projectedPctOfMeta,
    actualClipped: clips(actualPctOfMeta),
    projectedClipped: clips(projectedPctOfMeta),
  };
}

// ---------- CSV ----------

export const SALES_CSV_HEADERS = [
  'Código',
  'Descripción',
  'UOM',
  'Kg/unidad',
  'Forecast kg',
  'Venta kg',
  'Unidades',
  'Sacos',
  'Avance %',
  'Promedio/día kg',
  'Proyección kg',
  '% vs forecast',
  'Ritmo necesario kg/día',
  'Histórico kg',
  '% vs histórico',
  'Última factura',
  'Semáforo',
] as const;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(decimals)));
}

/** CSV con BOM (Excel en español) y fila final de totales globales. */
export function buildSalesCsv(report: ForecastSalesResponse): string {
  const lines: string[] = [SALES_CSV_HEADERS.map(csvCell).join(',')];

  for (const row of report.rows) {
    lines.push(
      [
        row.productCode,
        row.description,
        row.uom,
        csvNumber(row.kgPerUom, 3),
        csvNumber(row.forecastKg),
        csvNumber(row.actualKg),
        csvNumber(row.actualUnits),
        csvNumber(row.actualSacks),
        csvNumber(row.attainmentPct),
        csvNumber(row.dailyAvgKg),
        csvNumber(row.projectedKg),
        csvNumber(row.projectedAttainmentPct),
        csvNumber(row.requiredDailyKg),
        csvNumber(row.historicalAvgKg),
        csvNumber(row.vsHistoricalPct),
        row.lastInvoiceDate ?? '',
        SALES_TONE_LABEL[salesTone(row.projectedAttainmentPct ?? row.attainmentPct)],
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const totals = report.totals;
  lines.push(
    [
      'TOTALES',
      '',
      '',
      '',
      csvNumber(totals.forecastKg),
      csvNumber(totals.actualKg),
      csvNumber(totals.actualUnits),
      // No se suman sacos con kg: la columna queda vacía en el total.
      '',
      csvNumber(totals.attainmentPct),
      csvNumber(totals.dailyAvgKg),
      csvNumber(totals.projectedKg),
      csvNumber(totals.projectedAttainmentPct),
      csvNumber(totals.requiredDailyKg),
      csvNumber(totals.historicalAvgKg),
      csvNumber(totals.vsHistoricalPct),
      totals.lastInvoiceDate ?? '',
      SALES_TONE_LABEL[salesTone(totals.projectedAttainmentPct ?? totals.attainmentPct)],
    ]
      .map(csvCell)
      .join(','),
  );

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function salesCsvFileName(report: ForecastSalesResponse): string {
  return `ventas-vs-forecast-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

// ============================================================
// CSV de participación por cliente.
//
// Dos niveles: una fila CLIENTE con su venta y participación total, y debajo
// una fila PRODUCTO con kg, sacos y sus dos porcentajes. No hay metas ni
// histórico: todo sale de la venta real del mes a la fecha.
// ============================================================

export const CUSTOMER_SALES_CSV_HEADERS = [
  'Nivel',
  'Código cliente',
  'Cliente',
  'Tipo',
  'Vendedor',
  'Código producto',
  'Producto',
  'UOM',
  'Venta kg',
  'Unidades',
  'Sacos',
  'Participación cliente %',
  '% del cliente',
  '% del producto',
  'Última entrega',
] as const;

export function buildCustomerSalesCsv(report: ForecastCustomerSalesResponse): string {
  const lines: string[] = [CUSTOMER_SALES_CSV_HEADERS.map(csvCell).join(',')];

  for (const customer of report.customers) {
    lines.push(
      [
        'CLIENTE',
        customer.customerCode,
        customer.customerName,
        customer.customerType ?? '',
        customer.vendor ?? '',
        '',
        '',
        '',
        csvNumber(customer.actualKg),
        csvNumber(customer.actualUnits),
        '',
        csvNumber(customer.sharePct),
        '',
        '',
        customer.lastInvoiceDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    );

    for (const product of customer.products) {
      lines.push(
        [
          'PRODUCTO',
          customer.customerCode,
          customer.customerName,
          customer.customerType ?? '',
          customer.vendor ?? '',
          product.productCode,
          product.description,
          product.uom,
          csvNumber(product.kg),
          csvNumber(product.units),
          csvNumber(product.sacks),
          '',
          csvNumber(product.shareOfCustomerPct),
          csvNumber(product.shareOfProductPct),
          '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }

  const totals = report.totals;
  lines.push(
    [
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      csvNumber(totals.actualKg),
      csvNumber(totals.actualUnits),
      '',
      '100',
      '',
      '',
      totals.lastInvoiceDate ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function customerSalesCsvFileName(report: ForecastCustomerSalesResponse): string {
  return `participacion-clientes-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

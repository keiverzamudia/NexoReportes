import type { ForecastSalesResponse, ForecastSalesRow } from '@nexo/contracts';

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
}

export function filterSalesRows(rows: ForecastSalesRow[], filters: SalesFilters): ForecastSalesRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.unit === 'ALL' || row.uom === filters.unit) &&
      (!filters.onlyWithSales || row.actualKg > 0) &&
      (!filters.onlyWithForecast || row.forecastKg > 0) &&
      (!needle ||
        row.productCode.toLowerCase().includes(needle) ||
        row.description.toLowerCase().includes(needle)),
  );
}

/** Los N artículos con mayor meta (y, a igualdad, mayor venta). */
export function topSalesRows(rows: ForecastSalesRow[], limit = 10): ForecastSalesRow[] {
  return [...rows]
    .filter((row) => row.forecastKg > 0 || row.actualKg > 0)
    .sort((a, b) => b.forecastKg - a.forecastKg || b.actualKg - a.actualKg)
    .slice(0, limit);
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

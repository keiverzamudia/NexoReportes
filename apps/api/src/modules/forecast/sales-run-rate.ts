import type { ForecastSalesBasis, ForecastSalesStatus } from '@nexo/contracts';

// ============================================================
// Motor PURO de «Ventas del mes vs Forecast».
//
// Sin Prisma, sin HTTP y sin `new Date()` implícito: todo se calcula a partir
// de un calendario explícito. Así se puede probar al 100 % y el servidor puede
// correr en UTC sin desplazar el corte del negocio (America/Caracas).
//
// Reglas:
//  · Corte por defecto a AYER: el día en curso está incompleto y hundiría la
//    proyección si entrara al promedio.
//  · Días hábiles = lunes a sábado (el domingo casi no se factura).
//  · Nunca se divide por cero ni se devuelve Infinity: sin meta (`forecast=0`)
//    los porcentajes son `null`.
// ============================================================

export interface MonthCalendarInput {
  year: number;
  /** 1–12. */
  month: number;
  basis: ForecastSalesBasis;
  /** Fuera del promedio por defecto; `true` incluye el día en curso. */
  includeToday?: boolean;
  /** Hoy en la zona del negocio, `yyyy-mm-dd`. */
  today: string;
}

export interface MonthCalendar {
  year: number;
  month: number;
  basis: ForecastSalesBasis;
  status: ForecastSalesStatus;
  today: string;
  firstDay: string;
  lastDay: string;
  /** Último día contado (null en un mes futuro). */
  cut: string | null;
  inMonth: number;
  elapsed: number;
  remaining: number;
  workingInMonth: number;
  workingElapsed: number;
  workingRemaining: number;
}

export interface RunRateMetrics {
  dailyAvgKg: number;
  projectedKg: number | null;
  attainmentPct: number | null;
  projectedAttainmentPct: number | null;
  gapKg: number | null;
  requiredDailyKg: number | null;
  historicalAvgKg: number | null;
  vsHistoricalPct: number | null;
}

export interface RunRateInput {
  actualKg: number;
  forecastKg: number;
  calendar: MonthCalendar;
  /** kg de los últimos N meses CERRADOS (incluye ceros). */
  history?: number[];
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Día de la semana en UTC (0 = domingo). */
export function weekdayUtc(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Lunes a sábado. */
export function isWorkingDay(year: number, month: number, day: number): boolean {
  return weekdayUtc(year, month, day) !== 0;
}

/** Cuenta días hábiles lun–sáb entre `from` y `to`, ambos incluidos. */
export function countWorkingDays(year: number, month: number, from: number, to: number): number {
  const last = Math.min(to, daysInMonth(year, month));
  let count = 0;
  for (let day = Math.max(1, from); day <= last; day += 1) {
    if (isWorkingDay(year, month, day)) count += 1;
  }
  return count;
}

/**
 * Hoy en la zona horaria indicada. Con `Intl` no depende de la hora del
 * servidor (un contenedor en UTC cambiaría de día a las 20:00 de Caracas).
 */
export function todayInTimeZone(timeZone = 'America/Caracas', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/**
 * Calendario del mes del informe: días del mes, días transcurridos hasta el
 * corte y días hábiles. `status` distingue mes en curso, cerrado y futuro.
 */
export function monthCalendar(input: MonthCalendarInput): MonthCalendar {
  const { year, month, basis, includeToday = false, today } = input;
  const inMonth = daysInMonth(year, month);
  const workingInMonth = countWorkingDays(year, month, 1, inMonth);
  const target = monthKey(year, month);
  const current = today.slice(0, 7);
  const status: ForecastSalesStatus = target < current ? 'CLOSED' : target > current ? 'FUTURE' : 'OPEN';

  let elapsed = 0;
  let workingElapsed = 0;
  let cut: string | null = null;

  if (status === 'CLOSED') {
    elapsed = inMonth;
    workingElapsed = workingInMonth;
    cut = isoDay(year, month, inMonth);
  } else if (status === 'OPEN') {
    const todayDay = Math.min(Math.max(1, Number(today.slice(8, 10)) || 1), inMonth);
    const cutDay = includeToday ? todayDay : todayDay - 1;
    elapsed = Math.max(0, Math.min(cutDay, inMonth));
    workingElapsed = elapsed > 0 ? countWorkingDays(year, month, 1, elapsed) : 0;
    cut = elapsed > 0 ? isoDay(year, month, elapsed) : null;
  }

  return {
    year,
    month,
    basis,
    status,
    today,
    firstDay: isoDay(year, month, 1),
    lastDay: isoDay(year, month, inMonth),
    cut,
    inMonth,
    elapsed,
    remaining: inMonth - elapsed,
    workingInMonth,
    workingElapsed,
    workingRemaining: workingInMonth - workingElapsed,
  };
}

/** Días usados como denominador según la base elegida. */
export function basisDays(calendar: MonthCalendar): number {
  return calendar.basis === 'WORKING' ? calendar.workingInMonth : calendar.inMonth;
}

/** Días ya contados según la base elegida. */
export function basisElapsed(calendar: MonthCalendar): number {
  return calendar.basis === 'WORKING' ? calendar.workingElapsed : calendar.elapsed;
}

/** Días restantes según la base elegida. */
export function basisRemaining(calendar: MonthCalendar): number {
  return calendar.basis === 'WORKING' ? calendar.workingRemaining : calendar.remaining;
}

/** Avanza (o retrocede) un mes conservando año/mes válidos. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Los `count` meses cerrados inmediatamente anteriores al mes indicado. */
export function previousMonths(year: number, month: number, count: number): { year: number; month: number }[] {
  const list: { year: number; month: number }[] = [];
  for (let i = count; i >= 1; i -= 1) list.push(shiftMonth(year, month, -i));
  return list;
}

export function roundTo(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundPct(value: number): number {
  return roundTo(value, 1);
}

function mean(values: number[]): number | null {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((acc, value) => acc + value, 0) / valid.length;
}

/**
 * Métricas de run-rate para un artículo o para el total global.
 *
 * Mes futuro  → `projectedKg = null` (no hay venta todavía).
 * Mes cerrado → `projectedKg = actualKg`, sin ritmo necesario.
 * Día 1       → sin días contados, la proyección es la venta actual.
 */
export function computeRunRate(input: RunRateInput): RunRateMetrics {
  const actualKg = roundTo(Number.isFinite(input.actualKg) ? input.actualKg : 0);
  const forecastKg = roundTo(Number.isFinite(input.forecastKg) ? input.forecastKg : 0);
  const calendar = input.calendar;
  const historicalAvgKg = mean(input.history ?? []);
  const historyAvg = historicalAvgKg === null ? null : roundTo(historicalAvgKg, 1);

  if (calendar.status === 'FUTURE') {
    return {
      dailyAvgKg: 0,
      projectedKg: null,
      attainmentPct: null,
      projectedAttainmentPct: null,
      gapKg: null,
      requiredDailyKg: null,
      historicalAvgKg: historyAvg,
      vsHistoricalPct: null,
    };
  }

  const elapsed = basisElapsed(calendar);
  const total = basisDays(calendar);
  const remaining = basisRemaining(calendar);
  const dailyAvgKg = elapsed > 0 ? roundTo(actualKg / elapsed) : 0;
  const projectedKg =
    calendar.status === 'CLOSED' ? actualKg : elapsed > 0 ? roundTo(dailyAvgKg * total) : actualKg;

  const attainmentPct = forecastKg > 0 ? roundPct((actualKg / forecastKg) * 100) : null;
  const projectedAttainmentPct = forecastKg > 0 ? roundPct((projectedKg / forecastKg) * 100) : null;
  const gapKg = forecastKg > 0 ? roundTo(projectedKg - forecastKg) : null;
  const requiredDailyKg =
    calendar.status === 'OPEN' && forecastKg > 0
      ? roundTo(Math.max(0, forecastKg - actualKg) / Math.max(1, remaining), 1)
      : null;
  const vsHistoricalPct =
    historyAvg !== null && historyAvg > 0 ? roundPct((projectedKg / historyAvg) * 100 - 100) : null;

  return {
    dailyAvgKg,
    projectedKg,
    attainmentPct,
    projectedAttainmentPct,
    gapKg,
    requiredDailyKg,
    historicalAvgKg: historyAvg,
    vsHistoricalPct,
  };
}

/** kg por día hábil (lun–sáb) del mes, útil para el ritmo del forecast. */
export function workingDayFlags(year: number, month: number): boolean[] {
  const total = daysInMonth(year, month);
  return Array.from({ length: total }, (_, index) => isWorkingDay(year, month, index + 1));
}

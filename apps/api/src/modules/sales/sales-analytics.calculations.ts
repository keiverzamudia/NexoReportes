// ============================================================
// Cálculos puros de la analítica comercial de Pedidos.
//
// Aquí no se consulta Profit ni Prisma: entran filas ya normalizadas y salen
// series, variaciones y agregados. Así los casos de borde (mes en curso,
// división por cero, año sin ventas) se prueban sin base de datos.
// ============================================================

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Variación porcentual. null cuando la base es cero (no se inventa 100 %). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return round1(((current - previous) / previous) * 100);
}

export function sharePct(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return round1((part / total) * 100);
}

/** `yyyy-MM` a partir de año y mes (1–12). */
export function monthKey(year: number, month: number): string {
  const y = Math.trunc(year);
  const m = Math.trunc(month);
  if (y < 1900 || m < 1 || m > 12) return '';
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthKeyFromParts(year: unknown, month: unknown): string {
  return monthKey(toNumber(year), toNumber(month));
}

/** `yyyy-MM` de una fecha ISO (`yyyy-MM-dd` o ISO completa). */
export function monthKeyFromDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 7);
  }
  const raw = String(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null;
}

export function dayKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function addMonths(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  if (!year || !month) return '';
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

export function monthKeysOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => monthKey(year, index + 1));
}

export function daysInMonth(key: string): number {
  const [year, month] = key.split('-').map(Number) as [number, number];
  if (!year || !month) return 0;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastDayKeyOfMonth(key: string): string {
  const days = daysInMonth(key);
  return days > 0 ? `${key}-${String(days).padStart(2, '0')}` : '';
}

/** Etiqueta corta en español: `ene 26`. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  if (!year || !month) return key;
  const label = new Intl.DateTimeFormat('es-VE', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return `${label.replace('.', '')} ${String(year).slice(2)}`;
}

/** Rango de días [fromDay, toDay] dentro de un mes, acotado al mes real. */
export function dayRangeInMonth(key: string, fromDay = 1, toDay = 31): { from: string; to: string } {
  const days = daysInMonth(key);
  const start = Math.max(1, Math.min(days || 1, Math.trunc(fromDay)));
  const end = Math.max(start, Math.min(days || 31, Math.trunc(toDay)));
  return {
    from: `${key}-${String(start).padStart(2, '0')}`,
    to: `${key}-${String(end).padStart(2, '0')}`,
  };
}

export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

/**
 * ¿El día cae dentro del tramo comparable del año anterior?
 * El 29 de febrero se compara contra el 28 para no perder el día.
 */
export function sameDayPreviousYear(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  if (!year || !month || !date) return day;
  const previousYear = year - 1;
  const max = daysInMonth(monthKey(previousYear, month));
  const safeDate = Math.min(date, max || date);
  return `${previousYear}-${String(month).padStart(2, '0')}-${String(safeDate).padStart(2, '0')}`;
}

/** Fechas de un rango inclusivo `yyyy-MM-dd`. */
export function daysBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const days: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

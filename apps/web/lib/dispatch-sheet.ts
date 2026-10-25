'use client';

// ============================================================
// Despacho de almacén: lógica PURA (sin React ni red).
//
// Traduce los estados del servidor a lenguaje de piso de planta, calcula el
// avance de la carga y arma la hoja de despacho exportable. Todo lo que se
// pueda probar sin navegador vive aquí (`dispatch-sheet.spec.ts`).
// ============================================================

import type {
  DispatchLineStatus,
  DispatchSheetDetail,
  DispatchSheetLine,
  DispatchSheetStatus,
  DispatchSheetSummary,
} from '@nexo/contracts';

export type SheetTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export const SHEET_STATUS_META: Record<DispatchSheetStatus, { label: string; short: string; tone: SheetTone }> = {
  ENVIADO: { label: 'Sin abrir', short: 'Enviado', tone: 'warning' },
  RECIBIDO: { label: 'Recibido', short: 'Recibido', tone: 'primary' },
  EN_PROCESO: { label: 'En carga', short: 'En carga', tone: 'primary' },
  CON_NOVEDAD: { label: 'Con novedad', short: 'Novedad', tone: 'danger' },
  DESPACHADO: { label: 'Despachado', short: 'Despachado', tone: 'success' },
  CANCELADO: { label: 'Anulado', short: 'Anulado', tone: 'muted' },
};

export const LINE_STATUS_META: Record<DispatchLineStatus, { label: string; tone: SheetTone }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'muted' },
  CARGADO: { label: 'Cargado', tone: 'success' },
  PARCIAL: { label: 'Parcial', tone: 'warning' },
  FALTANTE: { label: 'Faltante', tone: 'danger' },
  NOVEDAD: { label: 'Novedad', tone: 'danger' },
};

export function sheetStatusMeta(status: DispatchSheetStatus) {
  return SHEET_STATUS_META[status];
}

export function lineStatusMeta(status: DispatchLineStatus) {
  return LINE_STATUS_META[status];
}

// ---------- Formato ----------

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatBusinessDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function humanAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'nunca';
  if (seconds < 60) return 'ahora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

/** «hace 12 min», «hace 2 h», «ayer» o fecha corta si es viejo. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return formatDateTime(iso);
}

// ---------- Carga ----------

/** Sugiere el estado del renglón a partir de lo que el almacén digitó. */
export function lineStatusFrom(loadedQty: number, plannedQty: number): DispatchLineStatus {
  if (loadedQty <= 0) return 'FALTANTE';
  if (plannedQty > 0 && loadedQty < plannedQty) return 'PARCIAL';
  return 'CARGADO';
}

/** Kg reales del renglón: el servidor los guarda; si faltan, se derivan del ratio. */
export function lineLoadedKg(line: Pick<DispatchSheetLine, 'loadedQty' | 'loadedKg' | 'plannedQty' | 'plannedKg'>): number {
  if (line.loadedKg !== null && line.loadedKg !== undefined) return line.loadedKg;
  if (line.loadedQty === null || line.loadedQty === undefined) return 0;
  return line.plannedQty > 0 ? (line.loadedQty * line.plannedKg) / line.plannedQty : line.loadedQty;
}

export interface SheetTotals {
  lines: number;
  done: number;
  progress: number;
  plannedSacks: number;
  plannedKg: number;
  loadedSacks: number;
  loadedKg: number;
  /** Diferencia contra lo planificado de los renglones ya confirmados. */
  differenceKg: number;
}

export function computeTotals(lines: DispatchSheetLine[]): SheetTotals {
  let plannedSacks = 0;
  let plannedKg = 0;
  let loadedSacks = 0;
  let loadedKg = 0;
  let checkedPlannedKg = 0;
  let done = 0;
  for (const line of lines) {
    if (line.uom === 'SAC') {
      plannedSacks += line.plannedQty;
      loadedSacks += line.loadedQty ?? 0;
    }
    plannedKg += line.plannedKg;
    loadedKg += lineLoadedKg(line);
    if (line.status !== 'PENDIENTE') {
      done += 1;
      checkedPlannedKg += line.plannedKg;
    }
  }
  return {
    lines: lines.length,
    done,
    progress: lines.length > 0 ? done / lines.length : 0,
    plannedSacks: Math.round(plannedSacks * 100) / 100,
    plannedKg: Math.round(plannedKg * 100) / 100,
    loadedSacks: Math.round(loadedSacks * 100) / 100,
    loadedKg: Math.round(loadedKg * 100) / 100,
    differenceKg: Math.round((loadedKg - checkedPlannedKg) * 100) / 100,
  };
}

export interface CustomerGroup {
  key: string;
  name: string;
  lines: DispatchSheetLine[];
  plannedKg: number;
  loadedKg: number;
  pendingLines: number;
}

/** Agrupa los renglones por cliente (para la vista de carga en móvil). */
export function groupByCustomer(lines: DispatchSheetLine[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();
  for (const line of lines) {
    const key = line.customerCode ?? line.customerName ?? '—';
    let group = map.get(key);
    if (!group) {
      group = { key, name: line.customerName ?? 'Cliente sin nombre', lines: [], plannedKg: 0, loadedKg: 0, pendingLines: 0 };
      map.set(key, group);
    }
    group.lines.push(line);
    group.plannedKg += line.plannedKg;
    group.loadedKg += lineLoadedKg(line);
    if (line.status === 'PENDIENTE') group.pendingLines += 1;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ---------- Bandeja ----------

const SHEET_PRIORITY: Record<DispatchSheetStatus, number> = {
  ENVIADO: 0,
  RECIBIDO: 1,
  EN_PROCESO: 2,
  CON_NOVEDAD: 3,
  DESPACHADO: 4,
  CANCELADO: 5,
};

/** Orden de trabajo del piso: lo que nadie ha abierto primero, y por entrega. */
export function sortSheets(sheets: DispatchSheetSummary[]): DispatchSheetSummary[] {
  return [...sheets].sort((a, b) => {
    const byStatus = SHEET_PRIORITY[a.status] - SHEET_PRIORITY[b.status];
    if (byStatus !== 0) return byStatus;
    const byDate = (a.nextDeliveryDate ?? '9999-12-31').localeCompare(b.nextDeliveryDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return a.sentAt.localeCompare(b.sentAt);
  });
}

// ---------- Cinta de acuses (el túnel, hecho visible) ----------

export interface TimelineStep {
  key: string;
  label: string;
  at: string | null;
  by: string | null;
  state: 'done' | 'current' | 'todo' | 'canceled';
}

export function timelineSteps(sheet: DispatchSheetSummary): TimelineStep[] {
  const steps: Omit<TimelineStep, 'state'>[] = [
    { key: 'ENVIADO', label: 'Enviado', at: sheet.sentAt, by: sheet.createdByName },
    { key: 'RECIBIDO', label: 'Recibido', at: sheet.receivedAt, by: sheet.receivedByName },
    { key: 'EN_PROCESO', label: 'En carga', at: sheet.startedAt, by: sheet.claimedByName ?? sheet.receivedByName },
    { key: 'DESPACHADO', label: 'Despachado', at: sheet.completedAt, by: sheet.completedByName },
  ];

  if (sheet.status === 'CANCELADO') {
    const canceledAt = sheet.canceledAt;
    return [
      ...steps.slice(0, 1).map((step) => ({ ...step, state: 'done' as const })),
      { key: 'CANCELADO', label: 'Anulado', at: canceledAt, by: null, state: 'canceled' as const },
    ];
  }

  const firstPending = steps.findIndex((step) => step.at === null);
  return steps.map((step, index) => ({
    ...step,
    state: step.at !== null ? 'done' : index === firstPending ? 'current' : 'todo',
  }));
}

// ---------- Exportación ----------

export const SHEET_EXPORT_HEADERS = [
  'Turno',
  'Pedido',
  'Código',
  'Artículo',
  'Cliente',
  'Almacén',
  'Entrega',
  'Unid.',
  'Planificado',
  'Kg plan',
  'Cargado',
  'Kg real',
  'Estado',
  'Nota',
];

const SHEET_EXPORT_WIDTHS = [7, 11, 14, 40, 34, 10, 11, 7, 12, 10, 11, 10, 12, 30];

export interface SheetExport {
  aoa: (string | number)[][];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  widths: number[];
  sheetName: string;
}

/** Hoja de despacho lista para xlsx (mismo criterio que el export del plan). */
export function sheetExport(detail: DispatchSheetDetail, generatedAt: Date = new Date()): SheetExport {
  const totals = computeTotals(detail.lines);
  const meta = sheetStatusMeta(detail.status);
  const lastColumn = SHEET_EXPORT_HEADERS.length - 1;
  const aoa: (string | number)[][] = [];
  const merges: SheetExport['merges'] = [];

  aoa.push([`HOJA DE DESPACHO ${detail.number}`]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } });
  aoa.push([`${detail.title} · ${meta.label} · ${detail.customers.join(' / ') || 'sin cliente'}`]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } });
  aoa.push([
    `Publicado ${formatDateTime(detail.sentAt)} por ${detail.createdByName ?? '—'} · Destino: ${
      detail.assignedToName ?? 'todo el almacén'
    } · ${totals.done}/${totals.lines} renglones · ${formatNumber(totals.plannedSacks)} sacos · ${formatNumber(
      totals.plannedKg,
    )} kg`,
  ]);
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: lastColumn } });
  if (detail.instructions) {
    aoa.push([`Instrucciones: ${detail.instructions}`]);
    merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: lastColumn } });
  }
  aoa.push([]);
  aoa.push(SHEET_EXPORT_HEADERS);

  for (const line of detail.lines) {
    aoa.push([
      line.position,
      line.orderNumber,
      line.productCode,
      line.description ?? '—',
      line.customerName ?? '—',
      line.warehouseCode ?? '—',
      line.effectiveDate ? formatBusinessDate(line.effectiveDate) : '—',
      line.uom ?? '—',
      line.plannedQty,
      Math.round(line.plannedKg),
      line.loadedQty ?? '',
      line.loadedQty === null ? '' : Math.round(lineLoadedKg(line)),
      lineStatusMeta(line.status).label,
      line.note ?? '',
    ]);
  }

  const totalRow = aoa.length;
  aoa.push([
    `TOTAL · ${totals.lines} renglón(es) · planificado ${formatNumber(totals.plannedSacks)} sacos / ${formatNumber(
      totals.plannedKg,
    )} kg · cargado ${formatNumber(totals.loadedSacks)} sacos / ${formatNumber(totals.loadedKg)} kg · diferencia ${formatNumber(
      totals.differenceKg,
    )} kg`,
  ]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: lastColumn } });
  aoa.push([`Generado ${formatDateTime(generatedAt.toISOString())} · CORPOAGRO · solo lectura`]);
  merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: lastColumn } });

  return {
    aoa,
    merges,
    widths: SHEET_EXPORT_WIDTHS,
    sheetName: `Despacho ${detail.number}`.slice(0, 31),
  };
}

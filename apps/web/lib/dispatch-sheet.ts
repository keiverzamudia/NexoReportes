'use client';

// ============================================================
// Despacho de almacén: lógica PURA (sin React ni red).
//
// Traduce los estados del servidor a lenguaje de piso de planta, calcula el
// avance de la carga y arma la hoja de despacho exportable. Todo lo que se
// pueda probar sin navegador vive aquí (`dispatch-sheet.spec.ts`).
// ============================================================

import type {
  DispatchCustomerProgress,
  DispatchLineStatus,
  DispatchSheetDetail,
  DispatchSheetLine,
  DispatchSheetStatus,
  DispatchSheetSummary,
} from '@nexo/contracts';

export type SheetTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export const SHEET_STATUS_META: Record<DispatchSheetStatus, { label: string; short: string; tone: SheetTone }> = {
  ENVIADO: { label: 'Pendiente', short: 'Pendiente', tone: 'warning' },
  // Estado legado del acuse: se muestra como «En carga».
  RECIBIDO: { label: 'En carga', short: 'En carga', tone: 'primary' },
  EN_PROCESO: { label: 'En carga', short: 'En carga', tone: 'primary' },
  CON_NOVEDAD: { label: 'Con novedad', short: 'Novedad', tone: 'danger' },
  DESPACHADO: { label: 'Despachado', short: 'Despachado', tone: 'success' },
  CANCELADO: { label: 'Anulado', short: 'Anulado', tone: 'muted' },
};

export const LINE_STATUS_META: Record<DispatchLineStatus, { label: string; tone: SheetTone }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'muted' },
  CARGADO: { label: 'Cargado', tone: 'success' },
  PARCIAL: { label: 'Parcial', tone: 'warning' },
  FALTANTE: { label: 'No cargado', tone: 'danger' },
  // Estado heredado: se conserva para leer hojas históricas.
  NOVEDAD: { label: 'Novedad', tone: 'danger' },
  // Renglón retirado del plan antes de cargarse (soft-delete con autor).
  ANULADO: { label: 'Anulado', tone: 'muted' },
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

// ---------- Tiempos ----------

/** Minutos entre dos instantes ISO; null si falta alguno. */
export function minutesBetween(startIso: string | null | undefined, endIso: string | null | undefined): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** «42 min», «3 h 15 min», «1 d 4 h». */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}

export function formatDurationBetween(startIso: string | null | undefined, endIso: string | null | undefined): string {
  return formatMinutes(minutesBetween(startIso, endIso));
}

/** «+3 min», «+2 h 10 min». Para mostrar saltos entre hitos. */
export function formatDelta(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  return `+${formatMinutes(Math.max(0, minutes))}`;
}

// ============================================================
// Línea de tiempos por cliente.
//
// Modelo acordado: T0 = salida de la simulación (`sentAt`). No depende de
// «Iniciar carga», que en la práctica casi nunca se pulsa y dejaba cargas de
// «0 min». La carga termina con el último producto marcado y el tiempo total
// culmina cuando se entrega la factura del cliente.
//
//   · carga         → envío hasta el último producto cerrado
//   · esperaFactura → último producto cerrado hasta la factura
//   · total         → envío hasta la factura
// ============================================================

export interface CustomerTimeline {
  sentAt: string | null;
  /** Primera marca del almacén (referencia de respuesta). */
  firstMarkAt: string | null;
  /** «Iniciar carga» declarado; solo informativo, no mide nada. */
  declaredStartAt: string | null;
  lastCloseAt: string | null;
  invoiceAt: string | null;
  invoiceRef: string | null;
  invoiceByName: string | null;
  loadMinutes: number | null;
  invoiceWaitMinutes: number | null;
  totalMinutes: number | null;
  pendingClose: boolean;
  pendingInvoice: boolean;
}

/** Hitos y duraciones de un cliente dentro de la hoja. */
export function customerTimeline(
  sentAt: string | null | undefined,
  progress: DispatchCustomerProgress | null | undefined,
  lines: Pick<DispatchSheetLine, 'checkedAt' | 'loadClosedAt' | 'status'>[],
): CustomerTimeline {
  const checked = lines
    .map((line) => line.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b));
  const firstMark = checked[0] ?? null;
  const lastMark = checked[checked.length - 1] ?? null;
  // Mientras quede un producto pendiente la carga sigue abierta: no se
  // inventa un cierre con el último producto ya marcado.
  const closedMark = lines.some((line) => line.status === 'PENDIENTE') ? null : lastMark;
  const lastCloseAt = progress?.loadClosedAt ?? closedMark;
  const invoiceAt = progress?.invoiceDeliveredAt ?? null;
  return {
    sentAt: sentAt ?? null,
    firstMarkAt: firstMark,
    declaredStartAt: progress?.loadStartedAt ?? null,
    lastCloseAt,
    invoiceAt,
    invoiceRef: progress?.invoiceRef ?? null,
    invoiceByName: progress?.invoiceDeliveredByName ?? null,
    loadMinutes: minutesBetween(sentAt, lastCloseAt),
    invoiceWaitMinutes: minutesBetween(lastCloseAt, invoiceAt),
    totalMinutes: minutesBetween(sentAt, invoiceAt),
    pendingClose: !lastCloseAt,
    pendingInvoice: !invoiceAt,
  };
}

/** Clave del cliente: mismo criterio que el servidor. */
export function customerKeyOf(line: Pick<DispatchSheetLine, 'customerCode' | 'customerName'>): string {
  return line.customerCode?.trim() || line.customerName?.trim() || 'SIN_CLIENTE';
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

/** Kg reales del renglón: el servidor los guarda; si faltan, se derivan del ratio. */
export function lineLoadedKg(line: Pick<DispatchSheetLine, 'loadedQty' | 'loadedKg' | 'plannedQty' | 'plannedKg'>): number {
  if (line.loadedKg !== null && line.loadedKg !== undefined) return line.loadedKg;
  if (line.loadedQty === null || line.loadedQty === undefined) return 0;
  return line.plannedQty > 0 ? (line.loadedQty * line.plannedKg) / line.plannedQty : line.loadedQty;
}

// ============================================================
// Cantidad digitada en la fila.
//
// El almacén escribe directamente lo que cargó. El servidor decide la marca:
//   · igual al plan → cargado
//   · menos que el plan y > 0 → parcial (con motivo)
//   · 0 → no cargado (con motivo)
// Vacío o inválido no toca la marca: evita cargas accidentales al salir.
// ============================================================

export type TypedQuantityResolution =
  | { kind: 'UNCHANGED' }
  | { kind: 'FULL' }
  | { kind: 'PARTIAL'; loadedQty: number }
  | { kind: 'MISSING' };

export function resolveTypedQuantity(plannedQty: number, raw: string): TypedQuantityResolution {
  const text = raw.trim();
  if (text === '') return { kind: 'UNCHANGED' };
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) return { kind: 'UNCHANGED' };
  const qty = Math.round(Math.min(Math.max(parsed, 0), plannedQty) * 100) / 100;
  if (qty >= plannedQty) return { kind: 'FULL' };
  if (qty <= 0) return { kind: 'MISSING' };
  return { kind: 'PARTIAL', loadedQty: qty };
}

/** Cantidad que representa el estado actual del renglón en el input. */
export function lineEffectiveQty(
  line: Pick<DispatchSheetLine, 'plannedQty' | 'loadedQty' | 'status'>,
): number {
  return line.status === 'PENDIENTE' ? line.plannedQty : line.loadedQty ?? 0;
}


export interface SheetTotals {
  lines: number;
  /** Renglones resueltos: cargados, parciales o no cargados. */
  done: number;
  progress: number;
  /** Desglose por marca. */
  loaded: number;
  partial: number;
  missing: number;
  plannedSacks: number;
  plannedKg: number;
  loadedSacks: number;
  loadedKg: number;
  /** Diferencia contra lo planificado de los renglones ya confirmados. */
  differenceKg: number;
}

export function computeTotals(lines: DispatchSheetLine[]): SheetTotals {
  const active = lines.filter((line) => line.status !== 'ANULADO');
  let plannedSacks = 0;
  let plannedKg = 0;
  let loadedSacks = 0;
  let loadedKg = 0;
  let checkedPlannedKg = 0;
  let done = 0;
  let loaded = 0;
  let partial = 0;
  let missing = 0;
  for (const line of active) {
    if (line.uom === 'SAC') {
      plannedSacks += line.plannedQty;
      loadedSacks += line.loadedQty ?? 0;
    }
    plannedKg += line.plannedKg;
    loadedKg += lineLoadedKg(line);
    // Cargado, parcial y no cargado resuelven el renglón; solo pendiente
    // bloquea el cierre. La diferencia pesa sobre lo confirmado.
    if (line.status === 'CARGADO') {
      loaded += 1;
      done += 1;
    } else if (line.status === 'PARCIAL') {
      partial += 1;
      done += 1;
    } else if (line.status === 'FALTANTE' || line.status === 'NOVEDAD') {
      missing += 1;
      done += 1;
    }
    if (line.status !== 'PENDIENTE') checkedPlannedKg += line.plannedKg;
  }
  return {
    lines: active.length,
    done,
    progress: active.length > 0 ? done / active.length : 0,
    loaded,
    partial,
    missing,
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
  /** Renglones aún sin resolver: solo pendientes. */
  pendingLines: number;
  completedLines: number;
  partialLines: number;
  missingLines: number;
}

/** Agrupa los renglones activos por cliente (para la vista de carga). */
export function groupByCustomer(lines: DispatchSheetLine[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();
  for (const line of lines) {
    if (line.status === 'ANULADO') continue;
    const key = line.customerCode ?? line.customerName ?? '—';
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        name: line.customerName ?? 'Cliente sin nombre',
        lines: [],
        plannedKg: 0,
        loadedKg: 0,
        pendingLines: 0,
        completedLines: 0,
        partialLines: 0,
        missingLines: 0,
      };
      map.set(key, group);
    }
    group.lines.push(line);
    group.plannedKg += line.plannedKg;
    group.loadedKg += lineLoadedKg(line);
    if (line.status === 'CARGADO') group.completedLines += 1;
    else if (line.status === 'PARCIAL') group.partialLines += 1;
    else if (line.status === 'FALTANTE' || line.status === 'NOVEDAD') group.missingLines += 1;
    else group.pendingLines += 1;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Renglones que siguen en la operación (excluye anulados). */
export function activeLines(lines: DispatchSheetLine[]): DispatchSheetLine[] {
  return lines.filter((line) => line.status !== 'ANULADO');
}

/** Renglones retirados del plan, para el bloque «Anulados». */
export function annulledLines(lines: DispatchSheetLine[]): DispatchSheetLine[] {
  return lines.filter((line) => line.status === 'ANULADO');
}

// ---------- Reporte de cierre ----------

export interface DispatchReportCounts {
  lines: number;
  sacks: number;
  kg: number;
}

export interface DispatchReport {
  totals: SheetTotals;
  groups: CustomerGroup[];
  /** Renglones resueltos por marca. */
  completed: DispatchReportCounts;
  partial: DispatchReportCounts;
  missing: DispatchReportCounts;
  pending: DispatchReportCounts;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Reporte completo de la hoja: todos los renglones agrupados por cliente y
 * los conteos de cargados, parciales, no cargados y pendientes. Se usa en el
 * modal de cierre y en la tarjeta de una hoja ya despachada.
 */
export function buildDispatchReport(lines: DispatchSheetLine[]): DispatchReport {
  const completed: DispatchReportCounts = { lines: 0, sacks: 0, kg: 0 };
  const partial: DispatchReportCounts = { lines: 0, sacks: 0, kg: 0 };
  const missing: DispatchReportCounts = { lines: 0, sacks: 0, kg: 0 };
  const pending: DispatchReportCounts = { lines: 0, sacks: 0, kg: 0 };
  for (const line of lines) {
    if (line.status === 'ANULADO') continue;
    const bucket =
      line.status === 'CARGADO'
        ? completed
        : line.status === 'PARCIAL'
          ? partial
          : line.status === 'PENDIENTE'
            ? pending
            : missing;
    bucket.lines += 1;
    if (line.uom === 'SAC') bucket.sacks += line.plannedQty;
    bucket.kg += line.plannedKg;
  }
  const rounded = (counts: DispatchReportCounts): DispatchReportCounts => ({
    ...counts,
    sacks: round2(counts.sacks),
    kg: round2(counts.kg),
  });
  return {
    totals: computeTotals(lines),
    groups: groupByCustomer(lines),
    completed: rounded(completed),
    partial: rounded(partial),
    missing: rounded(missing),
    pending: rounded(pending),
  };
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
  'Enviado',
  'Último producto',
  'Min envío → cierre',
  'Factura entregada',
  'Total (min)',
  'Factura N°',
  'Nota / motivo',
];

const SHEET_EXPORT_WIDTHS = [7, 11, 14, 40, 34, 10, 11, 7, 12, 10, 11, 10, 12, 12, 12, 10, 12, 10, 14, 30];

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
  aoa.push([
    `Enviado ${formatDateTime(detail.sentAt)} · Último producto ${formatDateTime(
      detail.loadClosedAt,
    )} · Factura entregada ${formatDateTime(detail.invoiceDeliveredAt)} · Total ${
      formatDurationBetween(detail.sentAt, detail.invoiceDeliveredAt)
    } · Pendientes de factura ${detail.pendingInvoiceCustomers} cliente(s)`,
  ]);
  merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: lastColumn } });
  if (detail.instructions) {
    aoa.push([`Instrucciones: ${detail.instructions}`]);
    merges.push({ s: { r: 4, c: 0 }, e: { r: 4, c: lastColumn } });
  }
  aoa.push([]);
  aoa.push(SHEET_EXPORT_HEADERS);

  const progressByKey = new Map((detail.customerProgress ?? []).map((row) => [row.customerKey, row]));
  for (const line of detail.lines.filter((item) => item.status !== 'ANULADO')) {
    const progress = progressByKey.get(customerKeyOf(line));
    // T0 del reporte: la salida de la simulación. El «inicio declarado» ya no
    // mide: cada producto vale por su hora de cierre y el total por la factura.
    const startedAt = detail.sentAt;
    const closedAt = line.loadClosedAt ?? line.checkedAt ?? null;
    const invoiceAt = progress?.invoiceDeliveredAt ?? null;
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
      startedAt ? formatDateTime(startedAt) : '—',
      closedAt ? formatDateTime(closedAt) : '—',
      minutesBetween(startedAt, closedAt) ?? '—',
      invoiceAt ? formatDateTime(invoiceAt) : '—',
      minutesBetween(startedAt, invoiceAt) ?? '—',
      progress?.invoiceRef ?? '—',
      line.note ?? '',
    ]);
  }

  const totalRow = aoa.length;
  aoa.push([
    `TOTAL · ${totals.lines} renglón(es) · planificado ${formatNumber(totals.plannedSacks)} sacos / ${formatNumber(
      totals.plannedKg,
    )} kg · cargado ${formatNumber(totals.loadedSacks)} sacos / ${formatNumber(totals.loadedKg)} kg · parciales ${
      totals.partial
    } · no cargados ${totals.missing} · diferencia ${formatNumber(totals.differenceKg)} kg`,
  ]);
  merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: lastColumn } });

  const annulled = detail.lines.filter((line) => line.status === 'ANULADO');
  if (annulled.length > 0) {
    aoa.push([]);
    aoa.push([`RENGLONES ANULADOS · ${annulled.length} (no cuentan en los totales)`]);
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: lastColumn } });
    aoa.push(['Turno', 'Pedido', 'Código', 'Artículo', 'Cliente', 'Planificado', 'Anulado por', 'Cuándo', 'Motivo']);
    for (const line of annulled) {
      aoa.push([
        line.position,
        line.orderNumber,
        line.productCode,
        line.description ?? '—',
        line.customerName ?? '—',
        `${formatNumber(line.plannedQty)} ${line.uom ?? ''}`,
        line.removedByName ?? '—',
        formatDateTime(line.removedAt),
        line.removalReason ?? '—',
      ]);
    }
  }

  aoa.push([`Generado ${formatDateTime(generatedAt.toISOString())} · CORPOAGRO · solo lectura`]);
  merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: lastColumn } });

  return {
    aoa,
    merges,
    widths: SHEET_EXPORT_WIDTHS,
    sheetName: `Despacho ${detail.number}`.slice(0, 31),
  };
}

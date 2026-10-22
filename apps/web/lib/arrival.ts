'use client';

import type {
  ArrivalIncidentKind,
  ArrivalIncidentSeverity,
  ArrivalStatus,
  ArrivalSummary,
} from '@nexo/contracts';

// ============================================================
// Llegadas de clientes (PCP): etiquetas y cálculos del tablero.
//
// La fuente de verdad es el servidor; aquí solo se decide cómo se ve y cómo
// se ordena la bandeja. Las fechas de negocio son textos yyyy-MM-dd (sin
// zonas horarias) y las horas de llegada son instantes ISO.
// ============================================================

export type ArrivalTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export const ARRIVAL_STATUS_META: Record<ArrivalStatus, { label: string; short: string; tone: ArrivalTone; hint: string }> = {
  ESPERADO: {
    label: 'Esperado',
    short: 'Esperado',
    tone: 'muted',
    hint: 'Todavía no llega. Marca la hora cuando aparezca en portería.',
  },
  EN_PLANTA: {
    label: 'En planta',
    short: 'En planta',
    tone: 'primary',
    hint: 'Ya está en planta; falta cerrar la atención.',
  },
  ATENDIDO: {
    label: 'Atendido',
    short: 'Atendido',
    tone: 'success',
    hint: 'Cargó y se fue. El registro queda cerrado.',
  },
  AUSENTE: {
    label: 'No vino',
    short: 'No vino',
    tone: 'danger',
    hint: 'No se presentó. Queda registrado el motivo si lo escribieron.',
  },
  CON_INCIDENCIA: {
    label: 'Con incidencia',
    short: 'Incidencia',
    tone: 'warning',
    hint: 'Hay algo que resolver con este cliente antes de cerrar.',
  },
  CANCELADO: {
    label: 'Cancelado',
    short: 'Cancelado',
    tone: 'muted',
    hint: 'El despacho que lo originó se anuló.',
  },
};

export const INCIDENT_KIND_META: Record<ArrivalIncidentKind, { label: string; hint: string }> = {
  FALTANTE: { label: 'Faltante', hint: 'Falta producto o sacos de lo planificado.' },
  DEMORA: { label: 'Demora', hint: 'Llegó tarde o la carga se detuvo.' },
  DANO: { label: 'Daño', hint: 'Producto o empaque dañado.' },
  DOCUMENTO: { label: 'Documento', hint: 'Falta guía, factura o permiso.' },
  RECHAZO: { label: 'Rechazo', hint: 'El cliente no acepta lo cargado.' },
  OTRO: { label: 'Otro', hint: 'Cualquier otra novedad; descríbela.' },
};

export const INCIDENT_SEVERITY_META: Record<ArrivalIncidentSeverity, { label: string; tone: ArrivalTone }> = {
  BAJA: { label: 'Baja', tone: 'muted' },
  MEDIA: { label: 'Media', tone: 'warning' },
  ALTA: { label: 'Alta', tone: 'danger' },
};

export function arrivalStatusMeta(status: ArrivalStatus) {
  return ARRIVAL_STATUS_META[status] ?? ARRIVAL_STATUS_META.ESPERADO;
}

/** 14:32 a partir de un instante ISO (hora local del navegador). */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 2026-10-22 → «22 oct» (fecha de negocio, sin desfase de zona). */
export function businessDayLabel(value: string | null | undefined): string {
  if (!value) return 'sin fecha';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
}

/** Hoy en formato de negocio (la misma fecha que usa el plan de despacho). */
export function businessToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function businessTomorrow(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return businessToday(next);
}

const STATUS_ORDER: Record<ArrivalStatus, number> = {
  CON_INCIDENCIA: 0,
  EN_PLANTA: 1,
  ESPERADO: 2,
  ATENDIDO: 3,
  AUSENTE: 4,
  CANCELADO: 5,
};

/**
 * Orden de la bandeja: primero lo que exige acción (incidencias, gente en
 * planta), después lo esperado por hora/fecha, y al final lo cerrado.
 */
export function sortArrivals(items: ArrivalSummary[]): ArrivalSummary[] {
  return [...items].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    const aTime = a.arrivedAt ?? '';
    const bTime = b.arrivedAt ?? '';
    if (aTime && bTime && aTime !== bTime) return aTime.localeCompare(bTime);
    const byDate = (a.expectedDate ?? '9999-12-31').localeCompare(b.expectedDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return a.customerName.localeCompare(b.customerName, 'es');
  });
}

export interface ArrivalPulse {
  expected: number;
  onSite: number;
  attended: number;
  withIncident: number;
  missed: number;
  kgExpected: number;
  /** Esperados + en planta: lo que aún puede llegar o está en patio. */
  waiting: number;
}

/** Contadores del hero. Se calculan en el cliente para que siempre coincidan con la lista visible. */
export function arrivalPulse(items: ArrivalSummary[]): ArrivalPulse {
  const pulse: ArrivalPulse = {
    expected: 0,
    onSite: 0,
    attended: 0,
    withIncident: 0,
    missed: 0,
    kgExpected: 0,
    waiting: 0,
  };
  for (const item of items) {
    if (item.status === 'ESPERADO') pulse.expected += 1;
    if (item.status === 'EN_PLANTA') pulse.onSite += 1;
    if (item.status === 'ATENDIDO') pulse.attended += 1;
    if (item.status === 'CON_INCIDENCIA') pulse.withIncident += 1;
    if (item.status === 'AUSENTE') pulse.missed += 1;
    if (item.status !== 'ATENDIDO' && item.status !== 'AUSENTE' && item.status !== 'CANCELADO') {
      pulse.kgExpected += item.plannedKg;
    }
  }
  pulse.kgExpected = Math.round(pulse.kgExpected * 100) / 100;
  pulse.waiting = pulse.expected + pulse.onSite + pulse.withIncident;
  return pulse;
}

/** Texto corto de la hora: «Llegó 14:32» o «Esperado 22 oct». */
export function arrivalTimeLabel(item: Pick<ArrivalSummary, 'arrivedAt' | 'expectedDate'>): string {
  if (item.arrivedAt) return `Llegó ${clockLabel(item.arrivedAt)}`;
  return `Esperado ${businessDayLabel(item.expectedDate)}`;
}

/** Minutos en planta (para el chip «hace 12 min»). */
export function minutesOnSite(arrivedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!arrivedAt) return null;
  const start = new Date(arrivedAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 60_000));
}

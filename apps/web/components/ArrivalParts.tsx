'use client';

// ============================================================
// Piezas compartidas de la vista de llegadas (PCP).
// Mismo lenguaje visual que DispatchSheetParts: badge de estado, sello de
// hora y bitácora con iconos por tipo de hito.
// ============================================================

import type { ArrivalEvent, ArrivalIncidentKind, ArrivalIncidentSeverity, ArrivalStatus } from '@nexo/contracts';
import {
  AlertTriangle,
  Ban,
  CheckCheck,
  CircleDot,
  ClipboardList,
  DoorOpen,
  MessageSquare,
  PencilLine,
  UserX,
  Truck,
} from 'lucide-react';
import { Badge, cx } from './ui';
import { INCIDENT_KIND_META, INCIDENT_SEVERITY_META, arrivalStatusMeta } from '../lib/arrival';
import { formatNumber } from '../lib/dispatch-sheet';

export function ArrivalStatusBadge({ status, dot = true }: { status: ArrivalStatus; dot?: boolean }) {
  const meta = arrivalStatusMeta(status);
  return (
    <Badge tone={meta.tone} dot={dot}>
      {meta.short}
    </Badge>
  );
}

export function IncidentKindBadge({ kind, severity }: { kind: ArrivalIncidentKind; severity?: ArrivalIncidentSeverity }) {
  const tone = severity ? INCIDENT_SEVERITY_META[severity].tone : 'warning';
  return <Badge tone={tone}>{INCIDENT_KIND_META[kind]?.label ?? kind}</Badge>;
}

const EVENT_STYLE: Record<string, { icon: typeof CircleDot; className: string; label: string }> = {
  CREADO: { icon: ClipboardList, className: 'bg-surface-container-high text-on-surface-variant', label: 'Esperado' },
  LLEGADA: { icon: DoorOpen, className: 'bg-primary-container text-on-primary', label: 'Llegada' },
  INCIDENCIA: { icon: AlertTriangle, className: 'bg-warning-container text-on-warning-container', label: 'Incidencia' },
  INCIDENCIA_RESUELTA: { icon: CheckCheck, className: 'bg-success-container text-on-success-container', label: 'Resuelta' },
  ATENDIDO: { icon: Truck, className: 'bg-success-container text-on-success-container', label: 'Atendido' },
  AUSENTE: { icon: UserX, className: 'bg-critical-container text-on-critical-container', label: 'No vino' },
  EDICION: { icon: PencilLine, className: 'bg-secondary-container text-on-secondary', label: 'Corrección' },
  CANCELADO: { icon: Ban, className: 'bg-surface-container-high text-on-surface-variant', label: 'Cancelado' },
  DESPACHO_ANULADO: { icon: Ban, className: 'bg-surface-container-high text-on-surface-variant', label: 'Despacho anulado' },
  NOTA: { icon: MessageSquare, className: 'bg-surface-container-low text-primary', label: 'Nota' },
  MENSAJE: { icon: MessageSquare, className: 'bg-surface-container-low text-primary', label: 'Mensaje' },
};

function eventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ArrivalTimeline({ events }: { events: ArrivalEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => {
        const style = EVENT_STYLE[event.type] ?? EVENT_STYLE.NOTA!;
        const Icon = style.icon;
        const last = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-space-sm pb-space-md last:pb-0">
            {!last && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-outline-variant/40" />}
            <span className={cx('relative z-10 grid size-8 shrink-0 place-items-center rounded-full shadow-soft', style.className)}>
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-space-xs">
                <span className="text-label-sm font-bold uppercase tracking-wider text-primary">{style.label}</span>
                <span className="text-label-sm normal-case text-outline">{eventTime(event.createdAt)}</span>
                {event.authorName && (
                  <span className="text-label-sm normal-case text-on-surface-variant">· {event.authorName}</span>
                )}
              </div>
              {event.body && <p className="mt-0.5 whitespace-pre-line text-body-md text-on-surface">{event.body}</p>}
            </div>
          </li>
        );
      })}
      {events.length === 0 && (
        <li className="rounded-xl border border-dashed border-outline-variant/50 px-space-sm py-space-md text-center text-body-md text-on-surface-variant">
          Todavía no hay movimientos de este cliente.
        </li>
      )}
    </ol>
  );
}

/** Chip grande con la hora marcada: es el dato que PCP viene a buscar. */
export function ArrivalStamp({
  arrivedAt,
  arrivedByName,
  arrivedByCode,
  status,
}: {
  arrivedAt: string | null;
  arrivedByName: string | null;
  arrivedByCode: string | null;
  status: ArrivalStatus;
}) {
  if (!arrivedAt) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-low/60 px-space-md py-space-sm">
        <p className="text-label-sm font-bold uppercase tracking-wider text-outline">Hora de llegada</p>
        <p className="text-headline-md text-on-surface-variant">Sin marcar</p>
        <p className="text-label-sm normal-case text-on-surface-variant">{arrivalStatusMeta(status).hint}</p>
      </div>
    );
  }

  const date = new Date(arrivedAt);
  const time = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });

  return (
    <div className="relative overflow-hidden rounded-2xl bg-hero px-space-md py-space-sm text-white shadow-hero">
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-secondary-container/20 blur-2xl" />
      <p className="relative text-label-sm font-bold uppercase tracking-[0.14em] text-white/70">Hora de llegada</p>
      <p className="relative flex items-baseline gap-2 tabular-nums text-headline-lg font-black text-secondary-container">
        {time}
        <span className="text-label-sm font-semibold uppercase text-white/60">{day}</span>
      </p>
      <p className="relative text-label-sm normal-case text-white/80">
        Marcada por {arrivedByName ?? 'PCP'}
        {arrivedByCode ? ` · ${arrivedByCode}` : ''}
      </p>
    </div>
  );
}

/** Mini resumen para la tarjeta móvil. */
export function ArrivalTotals({ sacks, kg }: { sacks: number; kg: number }) {
  return (
    <span className="flex items-baseline gap-1 tabular-nums">
      <span className="font-bold text-primary">{formatNumber(sacks)}</span>
      <span className="text-label-sm text-outline">sacos</span>
      <span className="font-bold text-primary">{formatNumber(kg)}</span>
      <span className="text-label-sm text-outline">kg</span>
    </span>
  );
}

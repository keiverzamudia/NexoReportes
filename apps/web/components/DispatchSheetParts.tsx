'use client';

// ============================================================
// Piezas compartidas del despacho: estado, cinta de acuses y bitácora.
//
// La cinta (`AcuseTimeline`) es la traducción visual del túnel: muestra qué
// pasó, cuándo y quién lo hizo. `AcuseSummary` es su versión de una línea para
// las tablas de la bandeja.
// ============================================================

import type { DispatchLineStatus, DispatchSheetEvent, DispatchSheetStatus, DispatchSheetSummary } from '@nexo/contracts';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  Inbox,
  Loader,
  MessageSquare,
  PackagePlus,
  Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, cx } from './ui';
import { formatTime, lineStatusMeta, relativeTime, sheetStatusMeta, timelineSteps } from '../lib/dispatch-sheet';

export function SheetStatusBadge({ status }: { status: DispatchSheetStatus }) {
  const meta = sheetStatusMeta(status);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function LineStatusBadge({ status }: { status: DispatchLineStatus }) {
  const meta = lineStatusMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const TONE_TEXT: Record<string, string> = {
  success: 'text-secondary',
  danger: 'text-error',
  warning: 'text-warning',
  primary: 'text-primary',
  muted: 'text-outline',
  default: 'text-on-surface',
};

/** Resumen de una línea para la bandeja: qué pasó y quién. */
export function AcuseSummary({ sheet }: { sheet: DispatchSheetSummary }) {
  const meta = sheetStatusMeta(sheet.status);
  const detail =
    sheet.status === 'DESPACHADO'
      ? `${sheet.completedByName ?? 'Almacén'} · ${formatTime(sheet.completedAt)}`
      : sheet.status === 'RECIBIDO'
        ? `${sheet.receivedByName ?? 'Almacén'} · ${formatTime(sheet.receivedAt)}`
        : sheet.status === 'EN_PROCESO'
          ? `${sheet.claimedByName ?? sheet.receivedByName ?? 'Almacén'} · ${formatTime(sheet.startedAt)}`
          : sheet.status === 'CON_NOVEDAD'
            ? 'Diferencias reportadas'
            : sheet.status === 'CANCELADO'
              ? 'Anulado por planificación'
              : `Enviado ${relativeTime(sheet.sentAt)}`;
  return (
    <span className="flex flex-col leading-tight">
      <span className={cx('text-label-md font-semibold uppercase tracking-wider', TONE_TEXT[meta.tone])}>{meta.label}</span>
      <span className="text-label-sm normal-case text-outline">{detail}</span>
    </span>
  );
}

/** Cinta de acuses: Enviado → Recibido → En carga → Despachado. */
export function AcuseTimeline({ sheet }: { sheet: DispatchSheetSummary }) {
  const steps = timelineSteps(sheet);
  return (
    <ol className="flex flex-col gap-space-sm sm:flex-row sm:items-stretch" aria-label="Recorrido del despacho">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-start gap-space-sm sm:flex-col sm:gap-space-xs">
          <div className="flex w-full items-center gap-space-sm">
            <span
              className={cx(
                'grid size-7 shrink-0 place-items-center rounded-full border text-label-sm font-black',
                step.state === 'done' && 'border-transparent bg-primary-container text-on-primary',
                step.state === 'current' && 'border-2 border-secondary-container bg-surface-container-lowest text-primary',
                step.state === 'todo' && 'border border-dashed border-outline-variant text-outline',
                step.state === 'canceled' && 'border-transparent bg-critical-container text-on-critical-container',
              )}
            >
              {step.state === 'done' ? (
                <Check aria-hidden className="size-3.5" />
              ) : step.state === 'canceled' ? (
                <Ban aria-hidden className="size-3.5" />
              ) : (
                index + 1
              )}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cx('hidden h-0.5 flex-1 rounded-pill sm:block', step.state === 'done' ? 'bg-primary-container/40' : 'bg-outline-variant/40')}
              />
            )}
          </div>
          <div className="min-w-0 flex-1 sm:mt-space-2xs">
            <p
              className={cx(
                'font-semibold uppercase tracking-wider text-label-md',
                step.state === 'todo' ? 'text-outline' : step.state === 'canceled' ? 'text-error' : 'text-primary',
              )}
            >
              {step.label}
            </p>
            <p className="text-label-sm normal-case text-on-surface-variant">
              {step.at ? `${formatTime(step.at)}${step.by ? ` · ${step.by}` : ''}` : step.state === 'current' ? 'pendiente' : '—'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const EVENT_ICON: Record<string, LucideIcon> = {
  ENVIADO: Send,
  RECIBIDO: Inbox,
  EN_PROCESO: Loader,
  NOVEDAD: AlertTriangle,
  DESPACHADO: CheckCheck,
  CANCELADO: Ban,
  MENSAJE: MessageSquare,
};

const EVENT_TONE: Record<string, string> = {
  ENVIADO: 'bg-primary-fixed text-primary',
  RECIBIDO: 'bg-surface-container-high text-primary',
  EN_PROCESO: 'bg-primary-fixed text-primary',
  NOVEDAD: 'bg-warning-container text-on-warning-container',
  DESPACHADO: 'bg-success-container text-on-success-container',
  CANCELADO: 'bg-critical-container text-on-critical-container',
  MENSAJE: 'bg-secondary-container/40 text-secondary',
};

/** Bitácora: eventos de sistema + conversación entre las partes. */
export function EventTimeline({ events }: { events: DispatchSheetEvent[] }) {
  if (events.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Todavía no hay movimientos registrados.</p>;
  }
  return (
    <ol className="flex flex-col gap-space-sm" aria-label="Bitácora del despacho">
      {events.map((event) => {
        const Icon = EVENT_ICON[event.type] ?? PackagePlus;
        const isMessage = event.kind === 'MESSAGE';
        return (
          <li key={event.id} className={cx('flex items-start gap-space-sm', isMessage && 'rounded-xl bg-surface-container-low/70 p-space-sm')}>
            <span className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', EVENT_TONE[event.type] ?? 'bg-surface-container text-on-surface-variant')}>
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx('text-body-md', isMessage ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>
                {event.body ?? event.type}
              </p>
              <p className="text-label-sm normal-case text-outline">
                {event.authorName ?? 'Sistema'} · {relativeTime(event.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

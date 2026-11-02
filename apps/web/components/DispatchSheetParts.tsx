'use client';

// ============================================================
// Piezas compartidas del despacho: estado de la hoja, estado del renglón y
// bitácora. La cinta de acuses se retiró: el flujo va de enviado a carga.
// ============================================================

import type { DispatchLineStatus, DispatchSheetEvent, DispatchSheetStatus } from '@nexo/contracts';
import {
  AlertTriangle,
  Ban,
  CheckCheck,
  Inbox,
  Loader,
  MessageSquare,
  PackagePlus,
  Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, cx } from './ui';
import { lineStatusMeta, relativeTime, sheetStatusMeta } from '../lib/dispatch-sheet';

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

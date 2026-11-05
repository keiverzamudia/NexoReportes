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
  Clock,
  Inbox,
  Loader,
  MessageSquare,
  PackagePlus,
  Receipt,
  RotateCcw,
  Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, cx } from './ui';
import { formatMinutes, minutesBetween, relativeTime, sheetStatusMeta, lineStatusMeta } from '../lib/dispatch-sheet';

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
  CARGA_INICIADA: Clock,
  CARGA_CERRADA: CheckCheck,
  CARGA_REABIERTA: RotateCcw,
  FACTURA_ENTREGADA: Receipt,
  FACTURADO: Receipt,
  FACTURA_REABIERTA: RotateCcw,
  SIMULACION_ACTUALIZADA: PackagePlus,
};

const EVENT_TONE: Record<string, string> = {
  ENVIADO: 'bg-primary-fixed text-primary',
  RECIBIDO: 'bg-surface-container-high text-primary',
  EN_PROCESO: 'bg-primary-fixed text-primary',
  NOVEDAD: 'bg-warning-container text-on-warning-container',
  DESPACHADO: 'bg-success-container text-on-success-container',
  CANCELADO: 'bg-critical-container text-on-critical-container',
  MENSAJE: 'bg-secondary-container/40 text-secondary',
  CARGA_INICIADA: 'bg-primary-fixed text-primary',
  CARGA_CERRADA: 'bg-success-container text-on-success-container',
  CARGA_REABIERTA: 'bg-warning-container text-on-warning-container',
  FACTURA_ENTREGADA: 'bg-success-container text-on-success-container',
  FACTURADO: 'bg-success-container text-on-success-container',
  FACTURA_REABIERTA: 'bg-warning-container text-on-warning-container',
  SIMULACION_ACTUALIZADA: 'bg-surface-container-high text-primary',
};

/** Cronómetro vivo de un hito; se detiene al recibir `until`. */
export function Elapsed({ since, until }: { since: string | null | undefined; until?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!since || until) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since, until]);

  if (!since) return <span>—</span>;
  // Primer render (SSR y cliente) usa `since` para evitar desajustes de
  // hidratación; el intervalo actualiza el cronómetro después de montar.
  const end = until ? new Date(until).toISOString() : new Date(now ?? new Date(since).getTime()).toISOString();
  const minutes = minutesBetween(since, end);
  if (minutes === null) return <span>—</span>;
  if (!until && minutes < 60) {
    const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(since).getTime()) / 1000));
    return (
      <span className="tabular-nums">
        {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
      </span>
    );
  }
  return <span className="tabular-nums">{formatMinutes(minutes)}</span>;
}

/** Bitácora: eventos de sistema + conversación entre las partes. */
export function EventTimeline({ events }: { events: DispatchSheetEvent[] }) {
  if (events.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Todavía no hay movimientos registrados.</p>;
  }
  return (
    <ol className="flex flex-col gap-space-sm" aria-label="Bitácora del despacho">
      {events.map((event, index) => {
        const Icon = EVENT_ICON[event.type] ?? PackagePlus;
        const isMessage = event.kind === 'MESSAGE';
        const previous = index > 0 ? events[index - 1] : null;
        const gap = previous ? minutesBetween(previous.createdAt, event.createdAt) : null;
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
                {gap !== null && gap > 0 ? ` · +${formatMinutes(gap)}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

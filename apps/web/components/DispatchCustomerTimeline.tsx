'use client';

// ============================================================
// Línea de tiempos de un cliente dentro del despacho.
//
// T0 = salida de la simulación (`sentAt`). La carga termina con el último
// producto marcado y el tiempo total culmina al entregar la factura. Antes
// se medía desde «Iniciar carga», que casi nadie pulsaba: de ahí los «0 min».
//
// Es solo lectura: no altera ninguna máquina de estados.
// ============================================================

import { CheckCheck, Receipt, Send, Timer } from 'lucide-react';
import type { CustomerTimeline } from '../lib/dispatch-sheet';
import { formatDateTime, formatMinutes } from '../lib/dispatch-sheet';
import { Elapsed } from './DispatchSheetParts';
import { cx } from './ui';

export function DispatchCustomerTimeline({
  timeline,
  className,
}: {
  timeline: CustomerTimeline;
  className?: string;
}) {
  const hasMovement = Boolean(timeline.firstMarkAt || timeline.lastCloseAt || timeline.invoiceAt);
  if (!hasMovement) return null;

  return (
    <span
      className={cx(
        'mt-1 flex flex-wrap items-center gap-x-space-sm gap-y-1 text-label-sm text-outline',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <Send aria-hidden className="size-3 shrink-0" />
        <span>
          Enviado <span className="font-semibold text-on-surface-variant">{formatDateTime(timeline.sentAt)}</span>
        </span>
      </span>

      <span aria-hidden className="text-outline-variant">
        →
      </span>

      <span className="inline-flex items-center gap-1">
        <CheckCheck aria-hidden className="size-3 shrink-0" />
        <span>
          Carga{' '}
          <span className="font-semibold text-on-surface-variant">
            {timeline.loadMinutes !== null ? (
              formatMinutes(timeline.loadMinutes)
            ) : timeline.sentAt ? (
              <Elapsed since={timeline.sentAt} />
            ) : (
              '—'
            )}
          </span>
          {timeline.lastCloseAt ? (
            <span className="text-outline"> · último producto {formatDateTime(timeline.lastCloseAt)}</span>
          ) : (
            <span className="text-outline"> · en curso</span>
          )}
        </span>
      </span>

      <span aria-hidden className="text-outline-variant">
        →
      </span>

      <span className="inline-flex items-center gap-1 text-secondary">
        <Receipt aria-hidden className="size-3 shrink-0" />
        <span>
          Factura{' '}
          <span className="font-semibold">
            {timeline.invoiceAt ? formatDateTime(timeline.invoiceAt) : 'pendiente'}
          </span>
          {timeline.invoiceWaitMinutes !== null && (
            <span className="text-outline"> · {formatMinutes(timeline.invoiceWaitMinutes)} después del cierre</span>
          )}
          {timeline.invoiceRef && <span className="text-outline"> · N° {timeline.invoiceRef}</span>}
          {timeline.invoiceByName && <span className="text-outline"> · {timeline.invoiceByName}</span>}
        </span>
      </span>

      <span aria-hidden className="text-outline-variant">
        →
      </span>

      <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-primary">
        <Timer aria-hidden className="size-3 shrink-0" />
        {timeline.totalMinutes !== null ? (
          <span>Total {formatMinutes(timeline.totalMinutes)}</span>
        ) : timeline.sentAt ? (
          <span>
            Total en curso <Elapsed since={timeline.sentAt} />
          </span>
        ) : null}
      </span>
    </span>
  );
}

'use client';

// ============================================================
// Línea de tiempos de un cliente dentro del despacho.
//
// Flujo: Pedidos → «Iniciar carga» → artículos → factura entregada.
//   T1 = envío → iniciar carga
//   T2 = iniciar carga → último artículo
//   T3 = iniciar carga → factura
//
// Es solo lectura: no altera ninguna máquina de estados.
// ============================================================

import { CheckCheck, Play, Receipt, Send } from 'lucide-react';
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
        <Play aria-hidden className="size-3 shrink-0" />
        {timeline.declaredStartAt ? (
          <span>
            Inicio carga{' '}
            <span className="font-semibold text-on-surface-variant">{formatDateTime(timeline.declaredStartAt)}</span>
            {timeline.startWaitMinutes !== null && (
              <span className="text-outline"> · T1 {formatMinutes(timeline.startWaitMinutes)}</span>
            )}
          </span>
        ) : (
          <span className="text-outline">sin iniciar</span>
        )}
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
              <Elapsed since={timeline.declaredStartAt ?? timeline.sentAt} />
            ) : (
              '—'
            )}
          </span>
          {timeline.lastCloseAt ? (
            <span className="text-outline"> · último artículo {formatDateTime(timeline.lastCloseAt)}</span>
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
          {timeline.invoiceMinutes !== null && (
            <span className="text-outline"> · T3 {formatMinutes(timeline.invoiceMinutes)} desde el inicio</span>
          )}
          {timeline.invoiceRef && <span className="text-outline"> · N° {timeline.invoiceRef}</span>}
          {timeline.invoiceByName && <span className="text-outline"> · {timeline.invoiceByName}</span>}
        </span>
      </span>
    </span>
  );
}

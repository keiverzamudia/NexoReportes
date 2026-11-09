'use client';

// ============================================================
// Pendiente de carga — franja compacta de la bandeja de Despacho.
//
// No es una banda editorial ni una fila de tarjetas: es una sola línea que
// responde «¿cuánto falta?». La cifra de pedidos es de PEDIDOS DISTINTOS
// (nº de orden), no de renglones; los renglones van aparte para que nunca se
// confundan con la cantidad de pedidos.
//
// El permiso que la muestra es `despacho:view_summary` (por defecto solo
// ADMIN); la página decide si la monta.
// ============================================================

import type { DispatchPulse } from '@nexo/contracts';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { formatNumber, relativeTime } from '../lib/dispatch-sheet';
import { Card, cx } from './ui';

function formatMetric(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

function Metric({
  value,
  label,
  tone = 'text-primary',
  title,
}: {
  value: number;
  label: string;
  tone?: string;
  title?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5" title={title}>
      <span className={cx('text-label-lg font-bold tabular-nums', tone)}>{formatMetric(value)}</span>
      <span className="text-label-sm text-on-surface-variant">{label}</span>
    </span>
  );
}

function Urgency({
  value,
  label,
  tone,
  dot,
}: {
  value: number;
  label: string;
  tone: string;
  dot: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-1', value > 0 ? 'text-on-surface-variant' : 'text-outline')}>
      <span aria-hidden className={cx('size-1.5 rounded-full', dot)} />
      <span className={cx('font-semibold tabular-nums', value > 0 ? tone : undefined)}>{formatMetric(value)}</span>
      <span>{label}</span>
    </span>
  );
}

export function DispatchPulseStrip({
  pulse,
  loading,
  error,
}: {
  pulse?: DispatchPulse;
  loading: boolean;
  error?: Error | null;
}) {
  if (loading && !pulse) {
    return (
      <Card className="flex items-center gap-2 px-space-md py-space-sm text-label-sm text-on-surface-variant">
        <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />
        Leyendo lo que falta por cargar…
      </Card>
    );
  }

  if (!pulse) {
    return (
      <Card className="flex items-center gap-2 px-space-md py-space-sm text-label-sm text-on-surface-variant">
        <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />
        No se pudo leer el pendiente. Se reintenta automáticamente.
      </Card>
    );
  }

  if (pulse.orders === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-x-3 gap-y-1 px-space-md py-space-sm">
        <span className="inline-flex items-center gap-2 text-label-md font-semibold text-secondary">
          <CheckCheck aria-hidden className="size-4" />
          Al día
        </span>
        <span className="text-label-sm text-on-surface-variant">Sin pedidos por cargar en las hojas abiertas.</span>
        <span className="ml-auto text-label-sm tabular-nums text-outline">0 pedidos · 0 renglones</span>
      </Card>
    );
  }

  return (
    <Card
      className="flex flex-wrap items-center gap-x-5 gap-y-2 px-space-md py-space-sm"
      aria-label="Pendiente de carga"
    >
      <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Pendiente de carga</span>

      <Metric
        value={pulse.orders}
        label="pedidos"
        title={`${formatMetric(pulse.orders)} pedidos distintos en ${formatMetric(pulse.sheets)} despacho(s) abierto(s)`}
      />
      <Metric value={pulse.lines} label="renglones" />
      <Metric value={pulse.sacks} label="sacos pend." />
      <Metric value={pulse.totalKg} label="kg pend." />
      <Metric value={pulse.customers} label="clientes" />

      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-label-sm">
        {pulse.urgency.overdue > 0 && (
          <Urgency value={pulse.urgency.overdue} label="vencidas" tone="text-error" dot="bg-error" />
        )}
        <Urgency value={pulse.urgency.today} label="hoy" tone="text-secondary" dot="bg-secondary-container" />
        <Urgency value={pulse.urgency.week} label="esta semana" tone="text-primary" dot="bg-primary-fixed-dim" />
        {pulse.urgency.later > 0 && (
          <Urgency value={pulse.urgency.later} label="después" tone="text-on-surface-variant" dot="bg-outline-variant" />
        )}
        {pulse.urgency.noDate > 0 && (
          <Urgency value={pulse.urgency.noDate} label="sin fecha" tone="text-on-surface-variant" dot="bg-outline-variant" />
        )}
        <span className="inline-flex items-center gap-1.5 text-outline">
          {error ? (
            <>
              <RefreshCw aria-hidden className="size-3.5 animate-spin" />
              sin actualizar
            </>
          ) : (
            <>
              <span aria-hidden className="animate-pulse-dot size-1.5 rounded-full bg-secondary-container" />
              en vivo · {relativeTime(pulse.generatedAt)}
            </>
          )}
        </span>
      </span>
    </Card>
  );
}

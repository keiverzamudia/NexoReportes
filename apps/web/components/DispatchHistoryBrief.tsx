'use client';

// ============================================================
// Brief del historial — el mismo lenguaje que la cola de carga, pero para
// un período ya cerrado. Responde: ¿cuánto se despachó y cómo se cumplió?
//
//   · Protagonista: despachos cerrados en el período.
//   · Apoyo: pedidos/renglones, volumen, cumplimiento y facturas pendientes.
//   · Termómetro: pedidos a tiempo vs. tarde (fecha planificada).
//   · Pie: abre el reporte completo de tiempos (progressive disclosure).
// ============================================================

import type { DispatchMetricsResponse } from '@nexo/contracts';
import { AlertTriangle, BarChart3, CalendarCheck, CalendarX, CheckCheck, ChevronDown, RefreshCw } from 'lucide-react';
import { formatBusinessDate } from '../lib/dispatch-sheet';
import { BriefStat, BriefStamp, briefNumber, briefPercent, briefPlural } from './DispatchBriefParts';
import { Card, cx } from './ui';

function periodLabel(range: { from: string; to: string }): string {
  return `${formatBusinessDate(range.from)} – ${formatBusinessDate(range.to)}`;
}

function onTimeClass(pct: number | null): string {
  if (pct === null) return 'text-outline';
  if (pct < 70) return 'text-critical';
  if (pct < 90) return 'text-warning';
  return 'text-secondary';
}

export function DispatchHistoryBrief({
  stats,
  loading,
  error,
  range,
  reportOpen,
  onToggleReport,
  onRetry,
}: {
  stats?: DispatchMetricsResponse;
  loading: boolean;
  error?: Error | null;
  range: { from: string; to: string };
  reportOpen: boolean;
  onToggleReport: () => void;
  onRetry?: () => void;
}) {
  const period = periodLabel(range);

  if (loading && !stats) {
    return (
      <Card className="animate-pulse overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_1.5fr]">
          <div className="bg-hero px-space-lg py-space-md">
            <div className="h-3 w-28 rounded-full bg-white/15" />
            <div className="mt-space-sm h-10 w-20 rounded-lg bg-white/15" />
            <div className="mt-space-sm h-3 w-44 rounded-full bg-white/10" />
          </div>
          <div className="grid grid-cols-2 gap-px bg-outline-variant/25 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="bg-surface-container-lowest px-space-sm py-space-sm sm:px-space-md">
                <div className="h-3 w-16 rounded-full bg-surface-container-high" />
                <div className="mt-space-sm h-6 w-20 rounded-lg bg-surface-container-high" />
                <div className="mt-space-xs h-3 w-24 rounded-full bg-surface-container-low" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className="flex flex-wrap items-center gap-space-sm px-space-md py-space-sm">
        <AlertTriangle aria-hidden className="size-4 text-warning" />
        <span className="font-semibold text-on-surface">No se pudo leer el resumen del período.</span>
        <span className="text-label-sm text-on-surface-variant">Se reintenta automáticamente.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto inline-flex h-8 items-center gap-1 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Reintentar
          </button>
        )}
      </Card>
    );
  }

  const summary = stats.summary;
  const onTimeTotal = summary.onTime.orders;
  const late = summary.onTime.late;
  const onTimeCount = Math.max(0, onTimeTotal - late);
  const pct = summary.onTime.pct;
  const onTimeText =
    onTimeTotal > 0
      ? `${briefNumber(onTimeCount)} de ${briefNumber(onTimeTotal)} pedidos a tiempo${late > 0 ? `, ${briefNumber(late)} tarde` : ''}`
      : 'Sin pedidos con fecha de entrega';

  const reportButton = (
    <button
      type="button"
      onClick={onToggleReport}
      aria-expanded={reportOpen}
      className="ml-auto inline-flex items-center gap-1 text-label-md font-semibold text-primary transition-colors hover:text-secondary"
    >
      <BarChart3 aria-hidden className="size-4" />
      {reportOpen ? 'Ocultar reporte' : 'Ver reporte completo'}
      <ChevronDown aria-hidden className={cx('size-3.5 transition-transform', reportOpen && 'rotate-180')} />
    </button>
  );

  if (summary.dispatches === 0) {
    return (
      <Card className="animate-band-in overflow-hidden">
        <div className="flex flex-wrap items-center gap-space-md bg-hero px-space-lg py-space-md text-white">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/70">
            <CalendarX aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-headline-md leading-tight text-secondary-container">Sin despachos cerrados</p>
            <p className="text-label-md text-white/60">
              {period} · Cambia el período o espera a que se cierre un despacho.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-space-sm gap-y-1 border-t border-outline-variant/30 px-space-md py-space-sm">
          <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <CheckCheck aria-hidden className="size-3.5 text-outline" />
            Solo despachos cerrados · resumen por fecha de cierre
          </span>
          {reportButton}
        </div>
      </Card>
    );
  }

  return (
    <Card className="animate-band-in overflow-hidden">
      <div role="group" aria-label="Resumen del historial de despacho">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_1.5fr]">
          {/* Protagonista: cuánto se cerró en el período. */}
          <div className="relative isolate flex h-full flex-col justify-between gap-space-sm overflow-hidden bg-hero px-space-lg py-space-md text-white">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-secondary-container/15 blur-3xl"
            />
            <div className="relative flex flex-wrap items-center gap-x-space-sm gap-y-1">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/10 px-2.5 py-1 text-label-sm font-semibold uppercase tracking-[0.14em] text-white/75">
                <CalendarCheck aria-hidden className="size-3.5 text-secondary-container" />
                Período cerrado
              </span>
              <BriefStamp
                mode="updated"
                generatedAt={stats.generatedAt}
                error={error}
                className="ml-auto text-white/55"
              />
            </div>
            <div className="relative">
              <div className="flex flex-wrap items-end gap-x-space-sm gap-y-1">
                <span className="font-display text-[2.75rem] leading-none tracking-tight tabular-nums text-secondary-container">
                  {briefNumber(summary.dispatches)}
                </span>
                <span className="pb-1 text-label-lg font-semibold text-white/75">
                  {briefPlural(summary.dispatches, 'despacho cerrado', 'despachos cerrados')}
                </span>
              </div>
              <p className="mt-space-2xs text-label-md text-white/60">
                {period} · {briefNumber(summary.customers)} {briefPlural(summary.customers, 'cliente', 'clientes')}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <dl className="grid flex-1 grid-cols-2 gap-px bg-outline-variant/25 lg:grid-cols-4">
              <BriefStat
                className="bg-surface-container-lowest"
                label="Pedidos"
                value={briefNumber(summary.orders)}
                hint={`${briefNumber(summary.lines)} ${briefPlural(summary.lines, 'renglón', 'renglones')}`}
                title="Pedidos distintos (nº de orden) y renglones involucrados en los despachos cerrados del período."
              />
              <BriefStat
                className="bg-surface-container-lowest"
                label="Volumen"
                value={`${briefNumber(summary.kg)} kg`}
                hint="planificados"
                title="Kg planificados en los despachos cerrados del período."
              />
              <BriefStat
                className="bg-surface-container-lowest"
                label="A tiempo"
                value={pct === null ? '—' : `${briefPercent(pct)}%`}
                hint={
                  onTimeTotal > 0
                    ? `${briefNumber(onTimeCount)} de ${briefNumber(onTimeTotal)} pedidos`
                    : 'sin fechas de entrega'
                }
                tone={pct === null ? 'muted' : pct < 70 ? 'danger' : pct < 90 ? 'warning' : 'success'}
              />
              <BriefStat
                className="bg-surface-container-lowest"
                label="Facturas pend."
                value={briefNumber(summary.invoice.pending)}
                hint={summary.invoice.pending > 0 ? 'por entregar' : 'todas entregadas'}
                tone={summary.invoice.pending > 0 ? 'warning' : 'success'}
              />
            </dl>

            {/* Termómetro de cumplimiento: pedidos a tiempo vs. tarde. */}
            <div className="border-t border-outline-variant/30 px-space-md py-space-sm">
              <div className="flex flex-wrap items-baseline gap-x-space-sm gap-y-0.5">
                <span className="text-label-sm font-semibold uppercase tracking-[0.12em] text-outline">
                  Cumplimiento de entrega
                </span>
                {pct !== null && (
                  <span className={cx('text-label-sm font-semibold tabular-nums', onTimeClass(pct))}>
                    {briefPercent(pct)}% a tiempo
                  </span>
                )}
                <span className="ml-auto text-label-sm text-outline">por fecha planificada</span>
              </div>

              {onTimeTotal > 0 ? (
                <div
                  className="animate-strip-grow mt-space-xs flex h-2 w-full overflow-hidden rounded-pill bg-surface-container-high"
                  role="img"
                  aria-label={`Cumplimiento: ${onTimeText}`}
                >
                  {onTimeCount > 0 && (
                    <span
                      className="h-full rounded-l-pill bg-secondary-container"
                      style={{ width: `${(onTimeCount / onTimeTotal) * 100}%` }}
                      title={`${briefNumber(onTimeCount)} a tiempo`}
                    />
                  )}
                  {late > 0 && (
                    <span
                      className="h-full rounded-r-pill bg-critical"
                      style={{ width: `${(late / onTimeTotal) * 100}%` }}
                      title={`${briefNumber(late)} tarde`}
                    />
                  )}
                </div>
              ) : (
                <p className="mt-space-xs text-label-sm text-on-surface-variant">{onTimeText}.</p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-space-sm gap-y-1 text-label-sm">
                {onTimeTotal > 0 ? (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className="size-1.5 rounded-full bg-secondary-container" />
                      <span className="font-semibold tabular-nums text-secondary">{briefNumber(onTimeCount)}</span>
                      <span className="text-on-surface-variant">a tiempo</span>
                    </span>
                    {late > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="size-1.5 rounded-full bg-critical" />
                        <span className="font-semibold tabular-nums text-critical">{briefNumber(late)}</span>
                        <span className="text-on-surface-variant">tarde</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-outline">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-space-sm gap-y-1 border-t border-outline-variant/30 px-space-md py-space-sm">
          <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <CheckCheck aria-hidden className="size-3.5 text-outline" />
            Solo despachos cerrados · resumen por fecha de cierre
          </span>
          {reportButton}
        </div>
      </div>
    </Card>
  );
}

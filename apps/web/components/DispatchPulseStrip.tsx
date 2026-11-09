'use client';

// ============================================================
// Brief de carga — cabecera operativa de la bandeja de Despacho.
//
// Responde tres preguntas en un vistazo:
//   1. ¿Cuánto falta?        → renglones por cargar (cifra protagonista).
//   2. ¿Dónde está?          → desglose por despacho y pedidos distintos.
//   3. ¿Qué tan urgente es?  → termómetro por fecha de entrega.
//
// El permiso que la muestra es `despacho:view_summary` (por defecto solo
// ADMIN); la página decide si la monta. No depende del tab ni del filtro.
// ============================================================

import type { DispatchPulse } from '@nexo/contracts';
import { AlertTriangle, CheckCheck, ChevronDown, Layers, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { formatBusinessDate } from '../lib/dispatch-sheet';
import {
  BriefStat,
  BriefStamp,
  briefNumber as formatMetric,
  briefPlural as plural,
} from './DispatchBriefParts';
import { Card, cx } from './ui';

type UrgencyKey = keyof DispatchPulse['urgency'];

const URGENCY_ORDER: UrgencyKey[] = ['overdue', 'today', 'week', 'later', 'noDate'];

const URGENCY_TONE: Record<UrgencyKey, { dot: string; text: string }> = {
  overdue: { dot: 'bg-critical', text: 'text-critical' },
  today: { dot: 'bg-accent', text: 'text-on-accent-container' },
  week: { dot: 'bg-secondary-container', text: 'text-secondary' },
  later: { dot: 'bg-primary-fixed-dim', text: 'text-primary' },
  noDate: { dot: 'bg-outline-variant', text: 'text-outline' },
};

function urgencyLabel(key: UrgencyKey, value: number): string {
  switch (key) {
    case 'overdue':
      return plural(value, 'vencida', 'vencidas');
    case 'today':
      return 'para hoy';
    case 'week':
      return 'esta semana';
    case 'later':
      return 'después';
    case 'noDate':
      return 'sin fecha';
    default:
      return 'pendiente';
  }
}

function volumeLabel(pulse: DispatchPulse): string {
  const parts = [
    pulse.sacks > 0 ? `${formatMetric(pulse.sacks)} sacos` : null,
    pulse.bulkKg > 0 ? `${formatMetric(pulse.bulkKg)} kg granel` : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join(' + ');
  return `${formatMetric(pulse.otherKg)} kg`;
}

export function DispatchPulseStrip({
  pulse,
  loading,
  error,
  onRetry,
}: {
  pulse?: DispatchPulse;
  loading: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  if (loading && !pulse) {
    return (
      <Card className="animate-pulse overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_1.5fr]">
          <div className="bg-hero px-space-lg py-space-md">
            <div className="h-3 w-24 rounded-full bg-white/15" />
            <div className="mt-space-sm h-10 w-20 rounded-lg bg-white/15" />
            <div className="mt-space-sm h-3 w-40 rounded-full bg-white/10" />
          </div>
          <div className="grid grid-cols-3 divide-x divide-outline-variant/30">
            {[0, 1, 2].map((index) => (
              <div key={index} className="px-space-sm py-space-sm sm:px-space-md">
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

  if (!pulse) {
    return (
      <Card className="flex flex-wrap items-center gap-space-sm px-space-md py-space-sm">
        <AlertTriangle aria-hidden className="size-4 text-warning" />
        <span className="font-semibold text-on-surface">No se pudo leer la carga pendiente.</span>
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

  const readySheets = Math.max(0, pulse.openSheets - pulse.sheets);
  const openSheetsLabel = `${formatMetric(pulse.openSheets)} ${plural(pulse.openSheets, 'despacho abierto', 'despachos abiertos')}`;
  const sheetsWithPendingLabel = `${formatMetric(pulse.sheets)} de ${openSheetsLabel}`;

  if (pulse.lines === 0) {
    return (
      <Card className="animate-band-in overflow-hidden">
        <div className="flex flex-wrap items-center gap-space-md bg-hero px-space-lg py-space-md text-white">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container/15 text-secondary-container">
            <CheckCheck aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-headline-md leading-tight text-secondary-container">Todo cargado</p>
            <p className="text-label-md text-white/60">{openSheetsLabel} sin renglones pendientes.</p>
          </div>
          <BriefStamp mode="live" generatedAt={pulse.generatedAt} error={error} className="ml-auto text-white/55" />
        </div>
      </Card>
    );
  }

  const urgency = URGENCY_ORDER.map((key) => ({ key, value: pulse.urgency[key] })).filter((item) => item.value > 0);
  const urgencyTotal = urgency.reduce((sum, item) => sum + item.value, 0);
  const urgencyText = urgency
    .map((item) => `${formatMetric(item.value)} ${urgencyLabel(item.key, item.value)}`)
    .join(' · ');
  const customerHint = pulse.customerNames.length > 0 ? pulse.customerNames.join(' · ') : 'sin nombre';
  const volumeHint = `${formatMetric(pulse.totalKg)} kg en total`;

  return (
    <Card className="animate-band-in overflow-hidden">
      <div role="group" aria-label="Carga pendiente de la bandeja de despacho">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_1.5fr]">
        {/* Cifra protagonista: lo que falta, en el lenguaje del piso. */}
        <div className="relative isolate flex h-full flex-col justify-between gap-space-sm overflow-hidden bg-hero px-space-lg py-space-md text-white">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-secondary-container/15 blur-3xl"
          />
          <div className="relative flex flex-wrap items-center gap-x-space-sm gap-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/10 px-2.5 py-1 text-label-sm font-semibold uppercase tracking-[0.14em] text-white/75">
              <span aria-hidden className="animate-pulse-dot size-1.5 rounded-full bg-secondary-container" />
              Cola de carga
            </span>
            <BriefStamp mode="live" generatedAt={pulse.generatedAt} error={error} className="ml-auto text-white/55" />
          </div>
          <div className="relative">
            <div className="flex flex-wrap items-end gap-x-space-sm gap-y-1">
              <span className="font-display text-[2.75rem] leading-none tracking-tight tabular-nums text-secondary-container">
                {formatMetric(pulse.lines)}
              </span>
              <span className="pb-1 text-label-lg font-semibold text-white/75">renglones por cargar</span>
            </div>
            <p className="mt-space-2xs text-label-md text-white/60">en {sheetsWithPendingLabel}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          {/* Tres métricas de apoyo, cada una con su línea de significado. */}
          <dl className="grid flex-1 grid-cols-3 divide-x divide-outline-variant/30">
            <BriefStat
              label="Pedidos"
              value={formatMetric(pulse.orders)}
              hint="números de orden distintos"
              title="Pedidos distintos (nº de orden) con al menos un renglón por cargar. No es la cantidad de despachos."
            />
            <BriefStat label="Volumen" value={volumeLabel(pulse)} hint={volumeHint} />
            <BriefStat
              label="Clientes"
              value={formatMetric(pulse.customers)}
              hint={customerHint}
              title={pulse.customerNames.join(' · ') || 'Clientes con carga pendiente'}
            />
          </dl>

          {/* Termómetro: la urgencia se agrupa por pedido, no por renglón. */}
          <div className="border-t border-outline-variant/30 px-space-md py-space-sm">
            <div className="flex flex-wrap items-baseline gap-x-space-sm gap-y-0.5">
              <span className="text-label-sm font-semibold uppercase tracking-[0.12em] text-outline">Urgencia por pedido</span>
              {pulse.oldestDue && pulse.urgency.overdue > 0 && (
                <span className="text-label-sm text-on-surface-variant">
                  la más antigua venció el {formatBusinessDate(pulse.oldestDue)}
                </span>
              )}
              <span className="ml-auto text-label-sm text-outline">por fecha de entrega</span>
            </div>

            {urgencyTotal > 0 && (
              <div
                className="animate-strip-grow mt-space-xs flex h-2 w-full overflow-hidden rounded-pill bg-surface-container-high"
                role="img"
                aria-label={`Urgencia: ${urgencyText}`}
              >
                {urgency.map((item) => (
                  <span
                    key={item.key}
                    className={cx('h-full first:rounded-l-pill last:rounded-r-pill', URGENCY_TONE[item.key].dot)}
                    style={{ width: `${(item.value / urgencyTotal) * 100}%` }}
                    title={`${formatMetric(item.value)} ${urgencyLabel(item.key, item.value)}`}
                  />
                ))}
              </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-space-sm gap-y-1 text-label-sm">
              {urgency.length > 0 ? (
                urgency.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1">
                    <span aria-hidden className={cx('size-1.5 rounded-full', URGENCY_TONE[item.key].dot)} />
                    <span className={cx('font-semibold tabular-nums', URGENCY_TONE[item.key].text)}>
                      {formatMetric(item.value)}
                    </span>
                    <span className="text-on-surface-variant">{urgencyLabel(item.key, item.value)}</span>
                  </span>
                ))
              ) : (
                <span className="text-on-surface-variant">Sin fechas de entrega registradas.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desglose progresivo: de dónde sale cada total. */}
      <details className="group border-t border-outline-variant/30">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-space-sm gap-y-1 px-space-md py-space-sm transition-colors hover:bg-surface-container-low/60 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            {readySheets > 0 ? (
              <CheckCheck aria-hidden className="size-3.5 text-secondary" />
            ) : (
              <Layers aria-hidden className="size-3.5 text-outline" />
            )}
            {readySheets > 0
              ? `${formatMetric(readySheets)} ${plural(readySheets, 'despacho sin carga pendiente', 'despachos sin carga pendiente')}`
              : 'Todos los despachos abiertos tienen carga pendiente'}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-label-md font-semibold text-primary transition-colors group-hover:text-secondary">
            Ver desglose
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
          </span>
        </summary>

        <div className="border-t border-outline-variant/20 bg-surface-container-low/40">
          <ul className="divide-y divide-outline-variant/20">
            {pulse.bySheet.slice(0, 6).map((sheet) => (
              <li
                key={sheet.id || sheet.number}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-space-sm gap-y-1 px-space-md py-space-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold tabular-nums text-primary">{sheet.number || 'Despacho'}</p>
                  <p className="truncate text-label-sm text-on-surface-variant">
                    {formatMetric(sheet.orders)} {plural(sheet.orders, 'pedido', 'pedidos')} ·{' '}
                    {formatMetric(sheet.lines)} {plural(sheet.lines, 'renglón', 'renglones')}
                    {sheet.oldestDue ? ` · entrega ${formatBusinessDate(sheet.oldestDue)}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-label-md font-semibold tabular-nums text-on-surface">
                    {formatMetric(sheet.sacks)} sacos
                  </p>
                  <p className="text-label-sm tabular-nums text-outline">{formatMetric(sheet.kg)} kg</p>
                </div>
                {sheet.id && (
                  <Link
                    href={`/despacho/${sheet.id}`}
                    className="col-span-2 justify-self-end rounded-pill border border-outline-variant/50 px-space-sm py-1 font-semibold text-label-sm text-on-surface-variant transition-colors hover:border-primary/30 hover:bg-surface-container-lowest hover:text-primary sm:col-span-1"
                  >
                    Abrir
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {pulse.bySheet.length > 6 && (
            <p className="px-space-md pb-space-sm text-label-sm text-outline">
              y {formatMetric(pulse.bySheet.length - 6)} despacho(s) más con carga pendiente.
            </p>
          )}
          <p className="border-t border-outline-variant/20 px-space-md py-space-sm text-label-sm text-outline">
            Pedidos = números de orden distintos con algo por cargar. Renglones = líneas de carga
            pendientes (planificado − cargado).
          </p>
        </div>
        </details>
      </div>
    </Card>
  );
}

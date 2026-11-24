'use client';

// ============================================================
// Barras de antigüedad reutilizables de CxC.
//
// La leyenda y las tiras usan la misma paleta que el gráfico «Antigüedad de
// la cartera»: verde para por vencer, amarillo/ámbar para la mora temprana y
// rojo para la mora alta. La barra conserva el largo proporcional al saldo
// (para no perder quién debe más) y los chips muestran el % de cada tramo.
// ============================================================

import type { ReceivablesBucket, ReceivablesCurrency } from '@nexo/contracts';
import { cx } from '../ui';
import {
  BUCKET_COLORS,
  BUCKET_LABEL_COLORS,
  formatCompactMoney,
  formatPct,
  formatPctCompact,
  formatReceivablesMoney,
  type AgingSegment,
} from '../../lib/receivables';

export function AgingLegend({
  buckets,
  className,
  showPct = false,
  caption = 'Antigüedad',
  pctLabel = 'de la cartera',
}: {
  buckets: ReceivablesBucket[];
  className?: string;
  /** Muestra el % global del total junto a cada tramo. */
  showPct?: boolean;
  /** Texto que precede a los chips (la cobranza usa «Atraso»). */
  caption?: string;
  /** Contexto del % en el tooltip («de la cartera» / «de lo cobrado»). */
  pctLabel?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-space-sm gap-y-1', className)}>
      <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">
        {caption}
      </span>
      {buckets.map((bucket) => (
        <span
          key={bucket.key}
          className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant"
          title={`${bucket.label}: ${formatPct(bucket.pct)} ${pctLabel}`}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: BUCKET_COLORS[bucket.key] }}
          />
          <span>{bucket.short}</span>
          {showPct && bucket.pct > 0 && (
            <span className="tabular-nums text-outline">{formatPctCompact(bucket.pct)}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Tira apilada. `max` es el saldo mayor del grupo: el largo de la barra se
 * escala contra él y los tramos se reparten el 100 % de la deuda de la fila.
 */
export function AgingBar({
  segments,
  total,
  max,
  currency,
  height = 20,
  showInside = true,
  className,
  ariaLabel,
  emptyLabel = 'Sin cartera',
}: {
  segments: AgingSegment[];
  total: number;
  max: number;
  currency: ReceivablesCurrency;
  height?: number;
  showInside?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Texto cuando no hay tramos (la cobranza usa «Sin pagos en 12 meses»). */
  emptyLabel?: string;
}) {
  const safeTotal = total > 0 ? total : 0;
  const trackWidth = max > 0 && safeTotal > 0 ? Math.min(100, (safeTotal / max) * 100) : 0;
  const breakdown = segments
    .map(
      (segment) =>
        `${segment.label}: ${formatReceivablesMoney(segment.amount, currency)} (${formatPctCompact(
          segment.pct,
        )})`,
    )
    .join(' · ');

  if (segments.length === 0 || safeTotal <= 0) {
    return (
      <div
        className={cx(
          'flex w-full items-center rounded-md border border-dashed border-outline-variant/50 px-2 text-label-sm text-outline',
          className,
        )}
        style={{ height }}
        role="img"
        aria-label={emptyLabel}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={cx(
        'relative w-full overflow-hidden rounded-md bg-surface-container-high/70',
        className,
      )}
      style={{ height }}
      role="img"
      aria-label={
        ariaLabel ?? `Cartera ${formatReceivablesMoney(safeTotal, currency)}. ${breakdown}`
      }
      title={breakdown}
    >
      <div
        className="flex h-full overflow-hidden rounded-md transition-[width] duration-500 ease-out"
        style={{ width: `${trackWidth}%` }}
      >
        {segments.map((segment) => {
          const width = safeTotal > 0 ? (segment.amount / safeTotal) * 100 : 0;
          const trackShare = max > 0 ? (segment.amount / max) * 100 : 0;
          return (
            <span
              key={segment.key}
              className="relative flex h-full min-w-[2px] items-center justify-center overflow-hidden first:rounded-l-md last:rounded-r-md"
              style={{
                width: `${width}%`,
                backgroundColor: BUCKET_COLORS[segment.key],
                boxShadow: 'inset -1px 0 0 rgba(255,255,255,.35)',
              }}
              title={`${segment.label}: ${formatReceivablesMoney(
                segment.amount,
                currency,
              )} · ${formatPctCompact(segment.pct)}`}
            >
              {showInside && trackShare >= 8 && (
                <span
                  className="hidden text-[9px] font-bold leading-none tabular-nums sm:inline"
                  style={{ color: BUCKET_LABEL_COLORS[segment.key] }}
                >
                  {formatPctCompact(segment.pct)}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function AgingMixRow({
  title,
  subtitle,
  amount,
  segments,
  max,
  currency,
  onClick,
  ariaLabel,
  selected = false,
}: {
  title: string;
  subtitle?: string;
  amount: number;
  segments: AgingSegment[];
  max: number;
  currency: ReceivablesCurrency;
  onClick?: () => void;
  ariaLabel?: string;
  selected?: boolean;
}) {
  const breakdown = segments
    .map(
      (segment) =>
        `${segment.short} ${formatReceivablesMoney(segment.amount, currency)} (${formatPctCompact(
          segment.pct,
        )})`,
    )
    .join(' · ');
  const content = (
    <>
      <span className="flex items-baseline justify-between gap-space-sm">
        <span className="truncate text-label-md font-semibold text-on-surface">{title}</span>
        <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">
          {formatCompactMoney(amount, currency)}
        </span>
      </span>
      {subtitle && (
        <span className="block truncate text-label-sm text-on-surface-variant">{subtitle}</span>
      )}
      <AgingBar
        segments={segments}
        total={amount}
        max={max}
        currency={currency}
        className="mt-1"
        ariaLabel={breakdown}
      />
      {segments.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {segments.map((segment) => (
            <span
              key={segment.key}
              className="inline-flex items-center gap-1 text-[10px] leading-none text-on-surface-variant"
              title={`${segment.label}: ${formatReceivablesMoney(
                segment.amount,
                currency,
              )} · ${formatPctCompact(segment.pct)}`}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: BUCKET_COLORS[segment.key] }}
              />
              <span>{segment.short}</span>
              <span className="tabular-nums font-semibold text-on-surface">
                {formatPctCompact(segment.pct)}
              </span>
            </span>
          ))}
        </span>
      )}
    </>
  );

  const titleText = breakdown ? `${title} · ${breakdown}` : title;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected === false ? false : selected === true ? true : undefined}
        title={titleText}
        className={cx(
          'flex w-full flex-col gap-0.5 rounded-lg py-space-sm text-left transition-colors',
          selected ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low/70',
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-0.5 py-space-sm" title={titleText} aria-label={ariaLabel}>
      {content}
    </div>
  );
}

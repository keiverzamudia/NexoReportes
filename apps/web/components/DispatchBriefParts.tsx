'use client';

// ============================================================
// Piezas compartidas por los «briefs» de Despacho (carga e historial).
// Mantienen la misma jerarquía tipográfica y el mismo lenguaje visual.
// ============================================================

import { RefreshCw } from 'lucide-react';
import { formatNumber, relativeTime } from '../lib/dispatch-sheet';
import { cx } from './ui';

export type BriefTone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

const BRIEF_TONE: Record<BriefTone, string> = {
  default: 'text-primary',
  success: 'text-secondary',
  warning: 'text-warning',
  danger: 'text-critical',
  muted: 'text-outline',
};

export function briefNumber(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

export function briefPlural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? singular : pluralWord;
}

/** Porcentaje con un decimal como máximo y coma decimal (es-VE). */
export function briefPercent(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

export function BriefStat({
  label,
  value,
  hint,
  title,
  tone = 'default',
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  title?: string;
  tone?: BriefTone;
  className?: string;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col justify-center px-space-sm py-space-sm sm:px-space-md', className)}>
      <dt className="text-label-sm font-semibold uppercase tracking-[0.12em] text-outline">{label}</dt>
      <dd className="mt-0.5 min-w-0">
        <span
          className={cx('block truncate text-title-md font-black tabular-nums sm:text-headline-md', BRIEF_TONE[tone])}
          title={value}
        >
          {value}
        </span>
        {hint && (
          <span
            className="mt-0.5 block truncate text-label-sm font-medium text-on-surface-variant"
            title={title ?? hint}
          >
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

export function BriefStamp({
  generatedAt,
  error,
  mode = 'live',
  className,
}: {
  generatedAt: string;
  error?: Error | null;
  mode?: 'live' | 'updated';
  className?: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-label-sm tabular-nums', className)}>
      {error ? (
        <>
          <RefreshCw aria-hidden className="size-3.5" />
          sin actualizar
        </>
      ) : (
        <>
          <span
            aria-hidden
            className={cx(
              'size-1.5 rounded-full bg-secondary-container',
              mode === 'live' && 'animate-pulse-dot',
            )}
          />
          {mode === 'live' ? `en vivo · ${relativeTime(generatedAt)}` : `actualizado ${relativeTime(generatedAt)}`}
        </>
      )}
    </span>
  );
}

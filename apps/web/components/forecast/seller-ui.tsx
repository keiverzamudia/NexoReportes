'use client';

// ============================================================
// Piezas visuales compartidas por «Vendedoras vs Forecast».
//
// Mantienen el lenguaje del informe de ventas (hero navy, anillo de
// cumplimiento, barras contra meta) sin duplicar los componentes de
// `SalesReport`. La lógica de negocio vive en el API y en `lib/sellers-report`.
// ============================================================

import type { ForecastSellerRow } from '@nexo/contracts';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EChart } from '../EChart';
import { cx } from '../ui';
import { fmtKg, fmtPct } from '../../lib/sales-report';
import {
  fmtAttainmentPct,
  quotaGeometry,
  sellerInitials,
  type SellerShareSlice,
} from '../../lib/sellers-report';
import type { SalesTone } from '../../lib/sales-report';
import { salesTone } from '../../lib/sales-report';

export const TONE_HEX: Record<SalesTone, string> = {
  good: '#15803d',
  warn: '#b45309',
  bad: '#dc2626',
  none: '#737780',
};

export const TONE_TEXT: Record<SalesTone, string> = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-critical',
  none: 'text-outline',
};

export const TONE_PILL: Record<SalesTone, string> = {
  good: 'bg-success-container text-on-success-container',
  warn: 'bg-warning-container text-on-warning-container',
  bad: 'bg-critical-container text-on-critical-container',
  none: 'bg-surface-container-high text-on-surface-variant',
};

export const TONE_BADGE: Record<SalesTone, 'success' | 'warning' | 'danger' | 'muted'> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
  none: 'muted',
};

export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${fmtKg(value / 1_000_000, 1)} M`;
  if (abs >= 10_000) return `${fmtKg(value / 1_000, 1)} k`;
  return fmtKg(value, 0);
}

/** Animación numérica respetando `prefers-reduced-motion`. */
export function useCountUp(value: number | null): number {
  const [display, setDisplay] = useState(value ?? 0);

  useEffect(() => {
    if (value === null || !Number.isFinite(value)) {
      setDisplay(0);
      return;
    }
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const from = display;
    const start = performance.now();
    const duration = 850;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `display` se lee solo como punto de partida; no debe reiniciar el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display;
}

export function PctPill({ pct, emptyLabel = 'Sin meta' }: { pct: number | null; emptyLabel?: string }) {
  const tone = salesTone(pct);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2 py-0.5 text-label-sm font-bold tabular-nums',
        TONE_PILL[tone],
      )}
      title={pct === null ? undefined : fmtPct(pct)}
    >
      {pct === null ? emptyLabel : fmtAttainmentPct(pct)}
      {pct !== null && tone !== 'none' && (
        <span aria-hidden>{tone === 'bad' ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}</span>
      )}
    </span>
  );
}

export function AttainmentRing({
  pct,
  tone,
  label = 'de su cuota',
}: {
  pct: number | null;
  tone: SalesTone;
  label?: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setProgress(clamped);
      return;
    }
    const frame = requestAnimationFrame(() => setProgress(clamped));
    return () => cancelAnimationFrame(frame);
  }, [clamped]);

  return (
    <div
      className="relative grid size-[148px] shrink-0 place-items-center"
      role="img"
      aria-label={pct === null ? 'Sin meta' : `${fmtAttainmentPct(pct)} ${label}`}
    >
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={TONE_HEX[tone]}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress / 100)}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="tabular-nums text-[1.65rem] font-black leading-none" style={{ color: TONE_HEX[tone] }}>
          {pct === null ? '—' : fmtAttainmentPct(pct)}
        </span>
        <span className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</span>
      </div>
    </div>
  );
}

export function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-space-sm py-space-xs backdrop-blur-sm">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/55">{label}</p>
      <p className="tabular-nums text-title-md font-bold text-white">{value}</p>
      {hint && <p className="text-label-sm text-white/50">{hint}</p>}
    </div>
  );
}

export function MiniStat({
  label,
  value,
  hint,
  tone = 'none',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: SalesTone;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
      <p className={cx('tabular-nums text-title-md font-black', TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

const RANK_STYLE = [
  'ring-2 ring-secondary-container text-on-secondary-container bg-secondary-container/20',
  'ring-1 ring-outline-variant text-on-surface-variant bg-surface-container-high',
  'ring-1 ring-accent/40 text-on-accent-container bg-accent-container',
];

export function SellerAvatar({ name, rank }: { name: string; rank: number }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-9 shrink-0 place-items-center rounded-xl text-label-md font-black tracking-wide',
        RANK_STYLE[rank - 1] ?? 'bg-primary-container/10 text-primary-container',
      )}
    >
      {sellerInitials(name)}
    </span>
  );
}

/** Barra de cumplimiento contra la meta asignada (marcador fijo al 100 %). */
export function QuotaBar({
  targetKg,
  actualKg,
  projectedKg,
  showProjection = true,
  className,
}: {
  targetKg: number;
  actualKg: number;
  projectedKg: number | null;
  showProjection?: boolean;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const geometry = useMemo(
    () => quotaGeometry({ targetKg, actualKg, projectedKg }),
    [targetKg, actualKg, projectedKg],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={cx('relative', className)} aria-hidden>
      <div
        className={cx(
          'h-2.5 w-full rounded-pill',
          geometry.hasMeta ? 'bg-surface-container' : 'border border-dashed border-outline-variant/60',
        )}
      >
        {geometry.hasMeta && (
          <div className="relative h-full w-full overflow-hidden rounded-pill">
            {showProjection && (
              <div
                className="absolute inset-y-0 left-0 rounded-pill bg-secondary-container/45 transition-[width] duration-700 ease-out"
                style={{ width: mounted ? `${geometry.projectedWidthPct}%` : '0%' }}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 rounded-pill bg-primary-container transition-[width] duration-700 ease-out"
              style={{ width: mounted ? `${geometry.actualWidthPct}%` : '0%', transitionDelay: '80ms' }}
            />
          </div>
        )}
      </div>
      {geometry.hasMeta && (
        <span
          className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-pill bg-secondary shadow-[0_0_0_1px_white]"
          style={{ left: `calc(${geometry.markerPct}% - 1px)` }}
        />
      )}
    </div>
  );
}

/** Franja apilada del reparto de la venta del mes. */
export function ShareStrip({
  slices,
  onSelect,
}: {
  slices: SellerShareSlice[];
  onSelect?: (code: string) => void;
}) {
  if (slices.length === 0) return null;

  return (
    <div className="flex flex-col gap-space-xs">
      <div
        className="flex h-3 w-full overflow-hidden rounded-pill bg-white/10"
        role="img"
        aria-label="Reparto de la venta del mes por vendedora"
      >
        {slices.map((slice) => {
          const content = (
            <>
              <span className="sr-only">
                {slice.name}: {fmtPct(slice.pct)}
              </span>
            </>
          );
          const style = { width: `${slice.pct}%`, backgroundColor: slice.color };
          return slice.other || !onSelect ? (
            <span
              key={slice.code}
              title={`${slice.name}: ${fmtPct(slice.pct)} · ${fmtKg(slice.kg)} kg`}
              style={style}
              className="h-full first:rounded-l-pill last:rounded-r-pill"
            >
              {content}
            </span>
          ) : (
            <button
              key={slice.code}
              type="button"
              onClick={() => onSelect(slice.code)}
              title={`${slice.name}: ${fmtPct(slice.pct)} · ${fmtKg(slice.kg)} kg`}
              aria-label={`Ver el expediente de ${slice.name} (${fmtPct(slice.pct)} de la venta)`}
              className="h-full min-w-[3px] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 first:rounded-l-pill last:rounded-r-pill"
              style={style}
            >
              {content}
            </button>
          );
        })}
      </div>
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {slices.map((slice) => {
          const chip = (
            <>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
              <span className="max-w-[9rem] truncate">{slice.name}</span>
              <span className="tabular-nums font-bold text-white/85">{fmtPct(slice.pct)}</span>
            </>
          );
          return slice.other || !onSelect ? (
            <span
              key={slice.code}
              className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-white/10 px-2 py-0.5 text-[11px] text-white/70"
            >
              {chip}
            </span>
          ) : (
            <button
              key={slice.code}
              type="button"
              onClick={() => onSelect(slice.code)}
              className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-white/10 px-2 py-0.5 text-[11px] text-white/70 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {chip}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Gráficas
// ============================================================

interface DailyPoint {
  date: string;
  actualKg: number;
  cumulativeKg: number | null;
  projectedCumulativeKg: number | null;
  forecastCumulativeKg: number | null;
}

/** Acumulado del mes: real, proyección y ritmo de la cuota. */
export function cumulativeOption(input: {
  daily: DailyPoint[];
  forecastKg: number;
  asOf: string | null;
  today: string;
}): Record<string, unknown> {
  const points = input.daily.map((day) => ({
    label: String(Number(day.date.slice(8, 10))),
    date: day.date,
    actual: day.cumulativeKg,
    projected: day.projectedCumulativeKg,
    pace: day.forecastCumulativeKg,
  }));
  const labels = points.map((point) => point.label);
  const actual = points.map((point) => point.actual);
  const projected = points.map((point) => point.projected);
  const pace = points.map((point) => point.pace);
  const cutDay = input.asOf ? String(Number(input.asOf.slice(8, 10))) : null;
  const today = String(Number(input.today.slice(8, 10)));
  const labelStep = Math.max(1, Math.ceil(labels.length / 10));

  const markLine =
    cutDay === null
      ? undefined
      : {
          symbol: 'none',
          silent: true,
          lineStyle: { color: '#9aa3af', type: 'dashed', width: 1 },
          label: { formatter: 'corte', color: '#737780', fontSize: 10, position: 'insideEndTop', rotate: 0 },
          data: [
            { xAxis: cutDay },
            ...(today !== cutDay
              ? [
                  {
                    xAxis: today,
                    lineStyle: { color: '#d18700', type: 'dotted', width: 1 },
                    label: { formatter: 'hoy', color: '#d18700', fontSize: 10, position: 'insideEndBottom', rotate: 0 },
                  },
                ]
              : []),
          ],
        };

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 8, right: 16, top: 14, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -28px rgba(8,29,44,.6);',
      axisPointer: { type: 'line', lineStyle: { color: '#95C800', opacity: 0.5 } },
      formatter: (params: Array<{ seriesName?: string; value?: number | null; dataIndex?: number }>) => {
        const first = params[0];
        const point = first && first.dataIndex !== undefined ? points[first.dataIndex] : undefined;
        if (!point) return '';
        const lines = params
          .filter((item) => item.value !== null && item.value !== undefined)
          .map((item) => {
            const value = Number(item.value);
            const share = input.forecastKg > 0 ? ` · ${fmtPct((value / input.forecastKg) * 100, 1)}` : '';
            return `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;">
              <span style="color:rgba(255,255,255,.72);">${item.seriesName ?? ''}</span>
              <strong style="font-variant-numeric:tabular-nums;color:#fff;">${fmtKg(value)} kg${share}</strong>
            </div>`;
          })
          .join('');
        return `<div style="min-width:170px;"><div style="font-weight:700;margin-bottom:2px;">Día ${point.label}</div>${lines}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: { color: '#737780', fontSize: 10, interval: (index: number) => index % labelStep === 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eef6ff' } },
      axisLabel: { color: '#737780', fontSize: 10, formatter: (value: number) => compact(value) },
    },
    series: [
      {
        name: 'Real',
        type: 'line',
        smooth: 0.28,
        showSymbol: false,
        data: actual,
        lineStyle: { width: 3, color: '#003366' },
        itemStyle: { color: '#003366' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0,51,102,0.22)' },
              { offset: 1, color: 'rgba(0,51,102,0)' },
            ],
          },
        },
        markLine,
        z: 4,
      },
      {
        name: 'Proyección',
        type: 'line',
        smooth: 0.28,
        showSymbol: false,
        connectNulls: false,
        data: projected,
        lineStyle: { width: 2.5, color: '#95C800', type: 'dashed' },
        itemStyle: { color: '#95C800' },
        z: 3,
      },
      {
        name: 'Ritmo de cuota',
        type: 'line',
        showSymbol: false,
        connectNulls: false,
        data: pace,
        lineStyle: { width: 1.5, color: '#9aa3af', type: 'dotted' },
        itemStyle: { color: '#9aa3af' },
        z: 2,
      },
    ],
  };
}

/** Histórico mensual de la vendedora contra su cuota mensual. */
export function monthlyHistoryOption(seller: ForecastSellerRow): Record<string, unknown> {
  const labels = seller.history.map((entry) => `${entry.month}/${String(entry.year).slice(2)}`);
  const values = seller.history.map((entry) => entry.actualKg);
  const quota = seller.targetKg;

  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 8, right: 12, top: 18, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:12px;',
      formatter: (params: Array<{ dataIndex?: number; value?: number }>) => {
        const index = params[0]?.dataIndex;
        const entry = index !== undefined ? seller.history[index] : undefined;
        if (!entry) return '';
        return `<div style="font-weight:700;margin-bottom:2px;">${labels[index!]}</div>
          <div style="display:flex;justify-content:space-between;gap:18px;"><span style="color:rgba(255,255,255,.72);">Venta</span><strong>${fmtKg(entry.actualKg)} kg</strong></div>
          <div style="display:flex;justify-content:space-between;gap:18px;"><span style="color:rgba(255,255,255,.72);">Cuota actual</span><strong>${fmtKg(quota)} kg</strong></div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: { color: '#737780', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eef6ff' } },
      axisLabel: { color: '#737780', fontSize: 10, formatter: (value: number) => compact(value) },
    },
    series: [
      {
        name: 'Venta',
        type: 'bar',
        data: values,
        barMaxWidth: 34,
        itemStyle: { borderRadius: [6, 6, 0, 0], color: '#003366' },
        markLine: quota > 0
          ? {
              symbol: 'none',
              silent: true,
              lineStyle: { color: '#95C800', type: 'dashed', width: 2 },
              label: { formatter: 'cuota', color: '#4b6700', fontSize: 10, position: 'insideEndTop' },
              data: [{ yAxis: quota }],
            }
          : undefined,
      },
    ],
  };
}

export { EChart, salesTone };

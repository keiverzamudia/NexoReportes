'use client';

// ============================================================
// «Ventas vs Forecast» — informe ejecutivo del mes.
//
// · Arriba: proyección de cierre (run-rate sobre días hábiles) con anillo de
//   cumplimiento y KPIs.
// · En medio: acumulado real vs proyección vs ritmo del forecast (ECharts) y
//   desviación por producto (barras animadas, clic para enfocar).
// · Abajo: tabla ordenable con semáforo, sacos para artículos SAC y CSV.
//
// Las cifras las calcula el API (`/forecast/sales`); aquí solo se da formato.
// ============================================================

import type { ForecastSalesResponse, ForecastSalesRow } from '@nexo/contracts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Download,
  Gauge,
  Info,
  PackageSearch,
  RotateCw,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { ProductPicker } from '../ProductPicker';
import { SALES_COLUMN_HELP, SALES_HELP_RULES, SALES_HELP_TERMS, SALES_HELP_TITLE } from '../../content/help/forecast';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Kpi,
  Skeleton,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import {
  buildCumulativeSeries,
  buildNarrative,
  buildSalesCsv,
  dayLabel,
  filterSalesRows,
  fmtKg,
  fmtPct,
  fmtTonnes,
  monthLabel,
  salesCsvFileName,
  salesTone,
  topSalesRows,
  type SalesTone,
} from '../../lib/sales-report';
import { useHelpRow } from '../../lib/use-help-row';

const C = {
  navy: '#003366',
  lime: '#95C800',
  grid: '#eef6ff',
  outline: '#737780',
  ink: '#081d2c',
  amber: '#d18700',
  red: '#dc2626',
};

const STATUS_LABEL: Record<ForecastSalesResponse['status'], string> = {
  OPEN: 'Mes en curso',
  CLOSED: 'Mes cerrado',
  FUTURE: 'Mes futuro',
};

const TONE_HEX: Record<SalesTone, string> = {
  good: '#15803d',
  warn: '#b45309',
  bad: '#dc2626',
  none: '#737780',
};

const TONE_TEXT: Record<SalesTone, string> = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-critical',
  none: 'text-outline',
};

const TONE_PILL: Record<SalesTone, string> = {
  good: 'bg-success-container text-on-success-container',
  warn: 'bg-warning-container text-on-warning-container',
  bad: 'bg-critical-container text-on-critical-container',
  none: 'bg-surface-container-high text-on-surface-variant',
};

const TONE_BADGE: Record<SalesTone, 'success' | 'warning' | 'danger' | 'muted'> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
  none: 'muted',
};

const TONE_KPI: Record<SalesTone, 'success' | 'warning' | 'danger' | 'muted'> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
  none: 'muted',
};

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${fmtKg(value / 1_000_000, 1)} M`;
  if (abs >= 10_000) return `${fmtKg(value / 1_000, 1)} k`;
  return fmtKg(value, 0);
}

/** Animación numérica respetando `prefers-reduced-motion`. */
function useCountUp(value: number | null): number {
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
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return display;
}

function PctPill({ pct }: { pct: number | null }) {
  const tone = salesTone(pct);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2 py-0.5 text-label-sm font-bold tabular-nums',
        TONE_PILL[tone],
      )}
    >
      {pct === null ? 'Sin meta' : fmtPct(pct)}
      {pct !== null && tone !== 'none' && (
        <span aria-hidden>{tone === 'bad' ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}</span>
      )}
    </span>
  );
}

function AttainmentRing({ pct, tone }: { pct: number | null; tone: SalesTone }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const frame = requestAnimationFrame(() => setProgress(clamped));
    return () => cancelAnimationFrame(frame);
  }, [clamped]);

  return (
    <div className="relative grid size-[148px] shrink-0 place-items-center" role="img" aria-label={pct === null ? 'Sin meta' : `${fmtPct(pct)} del forecast`}>
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
          {pct === null ? '—' : fmtPct(pct)}
        </span>
        <span className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/55">del forecast</span>
      </div>
    </div>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-space-sm py-space-xs backdrop-blur-sm">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/55">{label}</p>
      <p className="tabular-nums text-title-md font-bold text-white">{value}</p>
      {hint && <p className="text-label-sm text-white/50">{hint}</p>}
    </div>
  );
}

function MiniStat({ label, value, hint, tone = 'none' }: { label: string; value: string; hint?: string; tone?: SalesTone }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
      <p className={cx('tabular-nums text-title-md font-black', TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export function SalesReport({
  report,
  isLoading,
  error,
  unit,
  onRetry,
}: {
  report?: ForecastSalesResponse;
  isLoading: boolean;
  error?: Error | null;
  unit: 'ALL' | 'SAC' | 'KG';
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithForecast, setOnlyWithForecast] = useState(false);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [helpRow, setHelpRow] = useHelpRow();

  const filtered = useMemo(
    () =>
      report
        ? filterSalesRows(report.rows, { unit, search, onlyWithSales, onlyWithForecast })
        : [],
    [report, unit, search, onlyWithSales, onlyWithForecast],
  );

  const chartOption = useMemo(() => (report ? cumulativeOption(report) : {}), [report]);
  const focusRow = useMemo(
    () => (report && focusCode ? report.rows.find((row) => row.productCode === focusCode) ?? null : null),
    [report, focusCode],
  );
  const focusOption = useMemo(() => (report && focusRow ? historyOption(report, focusRow) : {}), [report, focusRow]);

  const pickerOptions = useMemo(
    () =>
      (report?.rows ?? []).map((row) => ({
        value: row.productCode,
        description: row.description,
        uom: row.uom,
      })),
    [report],
  );

  // Los hooks van SIEMPRE antes de los returns condicionales.
  const projectedTonnes = useCountUp(
    report && report.totals.projectedKg !== null ? report.totals.projectedKg / 1000 : null,
  );
  const narrative = useMemo(() => (report ? buildNarrative(report) : ''), [report]);

  if (isLoading && !report) return <SalesSkeleton />;

  if (error && !report) {
    return (
      <Card className="flex flex-col items-start gap-space-sm p-space-lg">
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" />
          No se pudo cargar el informe de ventas: {error.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-space-2xs rounded-lg bg-primary-container px-space-md text-label-md font-semibold text-on-primary transition-transform hover:-translate-y-0.5"
        >
          <RotateCw aria-hidden className="size-4" /> Reintentar
        </button>
      </Card>
    );
  }

  if (!report) return null;

  if (!report.salesAvailable) {
    return (
      <Card className="flex flex-col items-start gap-space-md border-warning-container bg-warning-container/40 p-space-lg">
        <div className="flex items-start gap-space-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="text-title-md font-bold text-on-warning-container">No se pudieron leer los despachos de Profit</p>
            <p className="max-w-2xl text-body-md text-on-warning-container/80">
              La consulta a <code>not_ent/reng_nde</code> falló. No se muestran cifras parciales ni ceros: el informe
              se habilita cuando Profit responda.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-space-2xs rounded-lg bg-primary-container px-space-md text-label-md font-semibold text-on-primary transition-transform hover:-translate-y-0.5"
        >
          <RotateCw aria-hidden className="size-4" /> Reintentar
        </button>
      </Card>
    );
  }

  const isFuture = report.status === 'FUTURE';
  const isOpen = report.status === 'OPEN';
  const totals = report.totals;
  const projected = totals.projectedKg;
  const attainment = totals.attainmentPct;
  const projectedAttainment = totals.projectedAttainmentPct;
  const tone = salesTone(projectedAttainment ?? attainment);
  const toneNow = salesTone(attainment);
  // La brecha se mide sobre la venta real acumulada, no sobre la proyección de cierre.
  const gapKg = totals.forecastKg > 0 ? totals.actualKg - totals.forecastKg : null;
  const basisLabel = report.basis === 'WORKING' ? 'día hábil (lun–sáb)' : 'día calendario';

  const download = () => {
    const blob = new Blob([buildSalesCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = salesCsvFileName(report);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const columns: Column<ForecastSalesRow>[] = [
    {
      key: 'codigo',
      header: 'Código',
      help: SALES_COLUMN_HELP.codigo,
      kind: 'id',
      sortValue: (row) => row.productCode,
      render: (row) => <span className="font-bold tabular-nums text-primary">{row.productCode}</span>,
    },
    {
      key: 'descripcion',
      header: 'Descripción',
      help: SALES_COLUMN_HELP.descripcion,
      title: (row) => row.description,
      render: (row) => (
        <span className="block max-w-[15rem] truncate" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      key: 'semaforo',
      header: 'Semáforo',
      help: SALES_COLUMN_HELP.semaforo,
      align: 'center',
      kind: 'status',
      sortValue: (row) => row.projectedAttainmentPct ?? -1,
      render: (row) => <Semaphore row={row} />,
    },
    {
      key: 'uom',
      header: 'UOM',
      help: SALES_COLUMN_HELP.uom,
      align: 'center',
      sortValue: (row) => row.uom,
      render: (row) => <Badge tone="muted">{row.uom}</Badge>,
    },
    {
      key: 'forecast',
      header: 'Forecast kg',
      help: SALES_COLUMN_HELP.forecast,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.forecastKg,
      render: (row) =>
        row.forecastKg > 0 ? (
          <span className="font-semibold tabular-nums text-on-surface">{fmtKg(row.forecastKg)}</span>
        ) : (
          <span className="text-outline">—</span>
        ),
    },
    {
      key: 'ventaKg',
      header: 'Venta kg',
      help: SALES_COLUMN_HELP.ventaKg,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.actualKg,
      render: (row) => (
        <span className={cx('tabular-nums font-bold', row.actualKg > 0 ? 'text-primary' : 'text-outline')}>
          {fmtKg(row.actualKg)}
        </span>
      ),
    },
    {
      key: 'sacos',
      header: 'Sacos',
      help: SALES_COLUMN_HELP.sacos,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.actualSacks ?? -1,
      render: (row) =>
        row.actualSacks === null ? (
          <span className="text-outline">—</span>
        ) : (
          <span className="tabular-nums text-on-surface-variant">{fmtKg(row.actualSacks)}</span>
        ),
    },
    {
      key: 'avance',
      header: 'Avance',
      help: SALES_COLUMN_HELP.avance,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.attainmentPct ?? -1,
      render: (row) => <PctPill pct={row.attainmentPct} />,
    },
    {
      key: 'promedio',
      header: 'Promedio/día',
      help: SALES_COLUMN_HELP.promedio,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.dailyAvgKg,
      render: (row) => <span className="tabular-nums">{fmtKg(row.dailyAvgKg)}</span>,
    },
    {
      key: 'proyeccion',
      header: 'Proyección kg',
      help: SALES_COLUMN_HELP.proyeccion,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.projectedKg ?? -1,
      render: (row) => (
        <span className={cx('tabular-nums font-bold', row.projectedKg === null ? 'text-outline' : 'text-on-surface')}>
          {fmtKg(row.projectedKg)}
        </span>
      ),
    },
    {
      key: 'proyectadoPct',
      header: '% vs forecast',
      help: SALES_COLUMN_HELP.proyectadoPct,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.projectedAttainmentPct ?? -1,
      render: (row) => <PctPill pct={row.projectedAttainmentPct} />,
    },
    {
      key: 'ritmo',
      header: 'Ritmo nec.',
      help: SALES_COLUMN_HELP.ritmo,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.requiredDailyKg ?? -1,
      render: (row) =>
        row.requiredDailyKg === null ? (
          <span className="text-outline">—</span>
        ) : (
          <span className="tabular-nums text-warning">{fmtKg(row.requiredDailyKg)}</span>
        ),
    },
    {
      key: 'historico',
      header: 'Histórico kg',
      help: SALES_COLUMN_HELP.historico,
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.historicalAvgKg ?? -1,
      render: (row) => <span className="tabular-nums">{fmtKg(row.historicalAvgKg)}</span>,
    },
    {
      key: 'vsHistorico',
      header: '% vs histórico',
      help: SALES_COLUMN_HELP.vsHistorico,
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.vsHistoricalPct ?? -1,
      render: (row) => (
        <span className={cx('tabular-nums', (row.vsHistoricalPct ?? 0) >= 0 ? 'text-success' : 'text-critical')}>
          {fmtPct(row.vsHistoricalPct)}
        </span>
      ),
    },
    {
      key: 'ultimaFactura',
      header: 'Última entrega',
      help: SALES_COLUMN_HELP.ultimaFactura,
      align: 'right',
      kind: 'detail',
      render: (row) => <span className="whitespace-nowrap text-label-sm text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  const footer = (
    <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
      <td colSpan={3} className="px-space-sm py-space-xs">
        <span className="flex flex-wrap items-center gap-space-sm uppercase text-label-sm text-outline">
          Totales {filtered.length !== report.rows.length ? `(${filtered.length} filtrados)` : 'globales'}
          <Badge tone={TONE_BADGE[tone]} dot>
            {tone === 'good' ? 'Cumplido' : tone === 'warn' ? 'En riesgo' : tone === 'bad' ? 'Crítico' : 'Sin meta'}
          </Badge>
        </span>
      </td>
      <td /> {/* UOM */}
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtKg(totals.forecastKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtKg(totals.actualKg)}</td>
      {/* No se suman sacos con kg: la celda queda vacía a propósito. */}
      <td className="px-space-sm py-space-xs text-right text-outline">—</td>
      <td className="px-space-sm py-space-xs text-right">{fmtPct(totals.attainmentPct)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtKg(totals.dailyAvgKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtKg(totals.projectedKg)}</td>
      <td className="px-space-sm py-space-xs text-right">{fmtPct(totals.projectedAttainmentPct)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums text-warning">{fmtKg(totals.requiredDailyKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtKg(totals.historicalAvgKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtPct(totals.vsHistoricalPct)}</td>
      <td className="px-space-sm py-space-xs text-right text-label-sm text-on-surface-variant">
        {totals.lastInvoiceDate ? fmtDate(totals.lastInvoiceDate) : '—'}
      </td>
    </tr>
  );

  const mobileSummary = (
    <div className="grid grid-cols-2 gap-space-sm border-t border-surface-container px-space-lg py-space-md text-body-md">
      <span className="text-outline">Venta kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(totals.actualKg)}</span>
      <span className="text-outline">Forecast kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(totals.forecastKg)}</span>
      <span className="text-outline">Proyección kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(totals.projectedKg)}</span>
      <span className="text-outline">Cumplimiento</span>
      <span className="text-right font-bold tabular-nums">{fmtPct(totals.projectedAttainmentPct)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-space-lg">
      {!report.forecastAvailable && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-warning-container/60 px-space-md py-space-sm text-body-md text-on-warning-container">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          No se pudo leer el forecast de Profit (<code>xart_fore</code>): la venta real se muestra, pero los
          porcentajes de cumplimiento quedan sin meta.
        </p>
      )}

      {isFuture && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-primary-fixed/40 px-space-md py-space-sm text-body-md text-primary">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {monthLabel(report.year, report.month)} todavía no tiene ventas. Se muestra la meta como referencia y la
          proyección se habilitará con la primera entrega del mes.
        </p>
      )}

      {report.status !== 'OPEN' && report.forecastSource === 'NONE' && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-md text-on-surface-variant">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          No hay meta guardada para {monthLabel(report.year, report.month)}. Se muestra la venta real y la comparación
          contra el promedio histórico; el snapshot de la meta se captura mientras el mes está en curso.
        </p>
      )}

      {report.status === 'OPEN' && report.forecastSource === 'NONE' && report.forecastAvailable && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-md text-on-surface-variant">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          xart_fore no tiene metas para este mes: la venta real se muestra sin porcentajes de cumplimiento.
        </p>
      )}

      {/* ---------- Hero: proyección de cierre ---------- */}
      <section className="relative isolate overflow-hidden rounded-card bg-hero p-space-lg text-white shadow-hero animate-rise">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-secondary-container/20 blur-3xl animate-float" />
        <span aria-hidden className="pointer-events-none absolute -bottom-28 -left-16 size-60 rounded-full bg-accent/15 blur-3xl" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255 / 0.9) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.9) 1px, transparent 1px)',
            backgroundSize: '38px 38px',
          }}
        />

        <div className="relative grid items-center gap-space-lg xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-space-md">
            <div className="flex flex-wrap items-center gap-space-sm">
              <span className="inline-flex items-center gap-2 rounded-pill bg-white/10 px-space-sm py-1 text-label-sm font-bold uppercase tracking-[0.14em] text-white/85">
                {isOpen && <span aria-hidden className="size-1.5 rounded-full bg-secondary-container animate-pulse-dot" />}
                {STATUS_LABEL[report.status]}
                {report.forecastSource === 'SNAPSHOT' && (
                  <span className="font-semibold normal-case tracking-normal text-white/60">· meta histórica</span>
                )}
              </span>
              <span className="text-label-md text-white/65">
                Corte {report.asOf ? dayLabel(report.asOf) : 'sin ventas'} · {report.days.workingElapsed}/{report.days.workingInMonth} días hábiles
              </span>
              <span className="text-label-md text-white/45">·</span>
              <span className="text-label-md text-white/65">
                Histórico: {report.history.length} meses cerrados
              </span>
            </div>

            <div>
              <p className="text-label-sm font-semibold uppercase tracking-[0.16em] text-white/55">
                {isFuture ? 'Meta del mes' : isOpen ? 'Proyección de cierre' : 'Venta del mes'}
              </p>
              <div className="mt-space-2xs flex flex-wrap items-end gap-space-sm">
                <span className="font-display tabular-nums text-[3.4rem] font-black leading-none tracking-tight text-secondary-container">
                  {projected === null ? '—' : fmtKg(projectedTonnes, 1)}
                </span>
                <span className="pb-2 text-title-md font-semibold text-white/55">t</span>
                <span className="mb-1.5 rounded-pill bg-white/10 px-space-sm py-1 text-label-md font-semibold text-white/75">
                  {projected === null ? 'sin proyección' : `${fmtKg(projected)} kg`}
                </span>
              </div>
              <p className="mt-space-xs max-w-xl text-body-md text-white/60">{narrative}</p>
            </div>

            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
              <HeroStat label="Venta acumulada" value={`${fmtKg(totals.actualKg)} kg`} hint={`${fmtTonnes(totals.actualKg)} t`} />
              <HeroStat label="Forecast" value={totals.forecastKg > 0 ? `${fmtKg(totals.forecastKg)} kg` : 'Sin meta'} hint={report.forecastSource === 'SNAPSHOT' ? `${fmtTonnes(totals.forecastKg)} t · guardada` : `${fmtTonnes(totals.forecastKg)} t`} />
              <HeroStat
                label="Brecha"
                value={gapKg === null ? '—' : `${gapKg > 0 ? '+' : ''}${fmtKg(gapKg)} kg`}
                hint={gapKg === null ? 'depende de la meta' : gapKg >= 0 ? 'por encima del forecast' : 'por debajo del forecast'}
              />
              <HeroStat
                label={isOpen ? 'Ritmo necesario' : 'Entregas'}
                value={isOpen ? (totals.requiredDailyKg === null ? '—' : `${fmtKg(totals.requiredDailyKg)} kg/día`) : fmtKg(totals.invoiceCount, 0)}
                hint={isOpen ? `${report.days.workingRemaining} días hábiles restantes` : `última ${totals.lastInvoiceDate ? dayLabel(totals.lastInvoiceDate) : '—'}`}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-space-sm justify-self-center rounded-2xl border border-white/10 bg-white/5 p-space-md">
            <AttainmentRing pct={isFuture ? null : projectedAttainment} tone={tone} />
            <div className="flex flex-col items-center gap-space-2xs text-center">
              <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-white/50">Cumplimiento actual</span>
              <span className={cx('tabular-nums text-title-md font-bold', toneNow === 'good' ? 'text-secondary-container' : 'text-white/85')}>
                {fmtPct(attainment)}
              </span>
              <span className="text-label-sm text-white/45">Meta {fmtKg(totals.forecastKg)} kg</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- KPIs ---------- */}
      <div className="stagger grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-6">
        <Kpi
          label="Venta acumulada"
          value={fmtKg(totals.actualKg)}
          suffix="kg"
          hint={`${fmtTonnes(totals.actualKg)} t · ${report.days.elapsed} días corridos`}
          icon={PackageSearch}
        />
        <Kpi
          label="Promedio diario"
          value={fmtKg(totals.dailyAvgKg)}
          suffix="kg"
          hint={`por ${basisLabel}`}
          icon={Gauge}
        />
        <Kpi
          label={isFuture ? 'Meta del mes' : isOpen ? 'Proyección de cierre' : 'Venta del mes'}
          value={projected === null ? '—' : fmtKg(projected / 1000, 1)}
          suffix={projected === null ? undefined : 't'}
          hint={projected === null ? 'sin ventas todavía' : `${fmtKg(projected)} kg`}
          icon={TrendingUp}
          tone="primary"
        />
        <Kpi
          label="Cumplimiento actual"
          value={fmtPct(attainment)}
          hint={
            totals.forecastKg > 0
              ? `Forecast ${fmtKg(totals.forecastKg)} kg${report.forecastSource === 'SNAPSHOT' ? ' · meta histórica' : ''}`
              : 'sin meta registrada'
          }
          icon={Target}
          tone={TONE_KPI[toneNow]}
        />
        <Kpi
          label="Cumplimiento proyectado"
          value={fmtPct(projectedAttainment)}
          hint={totals.vsHistoricalPct === null ? 'sin comparación histórica' : `${fmtPct(totals.vsHistoricalPct)} vs promedio histórico`}
          icon={Sparkles}
          tone={TONE_KPI[tone]}
        />
        <Kpi
          label={isOpen ? 'Ritmo necesario' : 'Días restantes'}
          value={isOpen ? fmtKg(totals.requiredDailyKg) : fmtKg(report.days.workingRemaining, 0)}
          suffix={isOpen ? 'kg/día' : 'días'}
          hint={isOpen ? `${report.days.workingRemaining} hábiles restantes` : 'mes sin días pendientes'}
          icon={CalendarClock}
          tone={isOpen && totals.requiredDailyKg !== null && totals.requiredDailyKg > 0 ? 'warning' : 'muted'}
        />
      </div>

      {/* ---------- Gráficas ---------- */}
      <div className="grid gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden animate-rise">
          <header className="flex flex-wrap items-end justify-between gap-space-sm px-space-md pt-space-md">
            <div>
              <h2 className="text-title-md font-bold text-on-surface">Acumulado del mes</h2>
              <p className="text-label-md text-on-surface-variant">
                {isOpen
                  ? 'Real hasta el corte · proyección punteada · ritmo uniforme del forecast'
                  : 'Venta real acumulada · ritmo uniforme del forecast'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: C.navy }} /> Real
              </span>
              {isOpen && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: C.lime }} /> Proyección
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: C.outline }} /> Ritmo forecast
              </span>
            </div>
          </header>
          <div className="px-space-sm pb-space-sm">
            {report.daily.length > 0 ? (
              <EChart option={chartOption} height={300} ariaLabel="Acumulado del mes: venta real, proyección y ritmo del forecast" />
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="Sin serie diaria"
                description="No hay entregas en el rango consultado para dibujar el acumulado."
              />
            )}
          </div>
        </Card>

        <Card className="overflow-hidden animate-rise">
          <header className="flex items-end justify-between gap-space-sm px-space-md pt-space-md">
            <div>
              <h2 className="text-title-md font-bold text-on-surface">Desviación por producto</h2>
              <p className="text-label-md text-on-surface-variant">Top 10 por meta · clic para enfocar</p>
            </div>
            <Badge tone="primary">{fmtKg(filtered.length, 0)} art.</Badge>
          </header>
          <div className="px-space-md pb-space-md pt-space-sm">
            <DeviationBars
              rows={filtered}
              focus={focusCode}
              showProjection={isOpen}
              onFocus={(code) => setFocusCode((current) => (current === code ? null : code))}
            />
          </div>
        </Card>
      </div>

      {focusRow && (
        <Card className="overflow-hidden animate-rise">
          <div className="flex flex-wrap items-start justify-between gap-space-md px-space-md pt-space-md">
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Producto enfocado</p>
              <h2 className="flex flex-wrap items-baseline gap-space-sm text-title-md font-bold text-on-surface">
                <span className="tabular-nums text-primary">{focusRow.productCode}</span>
                <span className="min-w-0 truncate text-body-md font-normal text-on-surface-variant">{focusRow.description}</span>
              </h2>
              <p className="text-label-md text-on-surface-variant">
                {focusRow.uom}
                {focusRow.kgPerUom !== null ? ` · ${fmtKg(focusRow.kgPerUom, 2)} kg/unidad` : ' · granel'}
                {focusRow.lastInvoiceDate ? ` · última entrega ${fmtDate(focusRow.lastInvoiceDate)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFocusCode(null)}
              className="grid size-9 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-label="Cerrar producto enfocado"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <div className="grid gap-space-md p-space-md xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <EChart option={focusOption} height={210} ariaLabel={`Histórico de ventas de ${focusRow.productCode}`} />
            <div className="grid grid-cols-2 gap-space-sm">
              <MiniStat label="Venta del mes" value={`${fmtKg(focusRow.actualKg)} kg`} hint={`${fmtKg(focusRow.actualUnits)} unid. · ${fmtKg(focusRow.actualSacks)} sacos`} />
              <MiniStat label={isOpen ? 'Proyección' : 'Cierre real'} value={focusRow.projectedKg === null ? '—' : `${fmtKg(focusRow.projectedKg)} kg`} hint={focusRow.projectedAttainmentPct === null ? 'sin meta' : `${fmtPct(focusRow.projectedAttainmentPct)} del forecast`} tone={salesTone(focusRow.projectedAttainmentPct)} />
              <MiniStat label="Promedio/día" value={`${fmtKg(focusRow.dailyAvgKg)} kg`} hint={`por ${basisLabel}`} />
              <MiniStat label={isOpen ? 'Ritmo necesario' : 'Meta del mes'} value={isOpen ? (focusRow.requiredDailyKg === null ? '—' : `${fmtKg(focusRow.requiredDailyKg)} kg/día`) : (focusRow.forecastKg > 0 ? `${fmtKg(focusRow.forecastKg)} kg` : '—')} hint={isOpen ? (focusRow.forecastKg > 0 ? `meta ${fmtKg(focusRow.forecastKg)} kg` : 'sin meta') : (focusRow.forecastKg > 0 ? 'meta histórica guardada' : 'sin meta guardada')} tone="warn" />
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Tabla ---------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container px-space-md py-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            <TextInput
              icon={PackageSearch}
              value={search}
              onChange={setSearch}
              placeholder="Buscar código o descripción…"
              ariaLabel="Buscar producto en el informe"
              className="w-full sm:w-64"
            />
            <label className="flex items-center gap-space-xs text-body-md text-on-surface-variant">
              <input
                type="checkbox"
                checked={onlyWithSales}
                onChange={(event) => setOnlyWithSales(event.target.checked)}
                className="size-4 accent-[var(--color-primary-container)]"
              />
              Solo con venta
            </label>
            <label className="flex items-center gap-space-xs text-body-md text-on-surface-variant">
              <input
                type="checkbox"
                checked={onlyWithForecast}
                onChange={(event) => setOnlyWithForecast(event.target.checked)}
                className="size-4 accent-[var(--color-primary-container)]"
              />
              Solo con forecast
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="w-full sm:w-64">
              <ProductPicker
                value={focusCode}
                onChange={setFocusCode}
                options={pickerOptions}
                allLabel="Todos los productos"
              />
            </div>
            <button
              type="button"
              onClick={() => setHelpRow(!helpRow)}
              aria-pressed={helpRow}
              title={helpRow ? 'Ocultar la explicación bajo cada columna' : 'Mostrar qué significa cada columna'}
              className={cx(
                'inline-flex h-10 items-center gap-space-2xs rounded-xl border px-space-md text-label-md font-semibold transition-colors',
                helpRow
                  ? 'border-primary-container/60 bg-primary-container/10 text-primary'
                  : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/40 hover:text-primary',
              )}
            >
              <BookOpen aria-hidden className="size-4" /> Explicaciones
            </button>
            <ModuleHelp
              title={SALES_HELP_TITLE}
              narrative={narrative}
              rules={SALES_HELP_RULES}
              terms={SALES_HELP_TERMS}
            />
            <button
              type="button"
              onClick={download}
              className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
            >
              <Download aria-hidden className="size-4" /> CSV
            </button>
          </div>
        </div>

        <DataTable<ForecastSalesRow>
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.productCode}
          empty={
            <EmptyState
              icon={PackageSearch}
              title="Sin ventas registradas"
              description={
                search || onlyWithSales || onlyWithForecast
                  ? 'Ningún artículo coincide con los filtros. Prueba a limpiar la búsqueda.'
                  : 'Profit no reporta entregas ABA para el rango consultado.'
              }
              action={
                search || onlyWithSales || onlyWithForecast ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setOnlyWithSales(false);
                      setOnlyWithForecast(false);
                    }}
                    className="text-label-md font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Limpiar filtros
                  </button>
                ) : undefined
              }
            />
          }
          footer={footer}
          mobileSummary={mobileSummary}
          showHelpRow={helpRow}
        />
      </Card>

      <p className="flex flex-wrap items-center gap-space-sm px-space-2xs text-label-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-success" /> ≥ 100 %
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-warning" /> 85–99 %
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-critical" /> &lt; 85 %
        </span>
        <span className="text-outline">·</span>
        Corte a ayer; el domingo no entra al denominador. Venta = nota de entrega no anulada, línea ABA (sin
        devoluciones). Los sacos no se suman con kg en los totales.
      </p>
    </div>
  );
}

function Semaphore({ row }: { row: ForecastSalesRow }) {
  if (row.forecastKg <= 0 && row.actualKg > 0) {
    return <Badge tone="muted">Sin meta</Badge>;
  }
  if (row.forecastKg > 0 && row.actualKg <= 0) {
    return <Badge tone="warning">Sin venta</Badge>;
  }
  const pct = row.projectedAttainmentPct ?? row.attainmentPct;
  const tone = salesTone(pct);
  const label = tone === 'good' ? 'Cumplido' : tone === 'warn' ? 'En riesgo' : tone === 'bad' ? 'Crítico' : 'Sin meta';
  return (
    <Badge tone={TONE_BADGE[tone]} dot>
      {label}
    </Badge>
  );
}

function DeviationBars({
  rows,
  focus,
  showProjection,
  onFocus,
}: {
  rows: ForecastSalesRow[];
  focus: string | null;
  showProjection: boolean;
  onFocus: (code: string) => void;
}) {
  const top = useMemo(() => topSalesRows(rows, 10), [rows]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const max = Math.max(1, ...top.flatMap((row) => [row.forecastKg, row.projectedKg ?? 0, row.actualKg]));

  if (top.length === 0) {
    return <p className="py-space-lg text-center text-body-md text-on-surface-variant">Sin artículos para graficar.</p>;
  }

  return (
    <ul className="flex flex-col gap-space-2xs">
      {top.map((row) => {
        const pct = row.projectedAttainmentPct ?? row.attainmentPct;
        const tone = salesTone(pct);
        const widthProjected = Math.max(0, Math.min(100, ((row.projectedKg ?? row.actualKg) / max) * 100));
        const widthActual = Math.max(0, Math.min(100, (row.actualKg / max) * 100));
        const marker = Math.max(0, Math.min(100, (row.forecastKg / max) * 100));
        return (
          <li key={row.productCode}>
            <button
              type="button"
              onClick={() => onFocus(row.productCode)}
              aria-pressed={focus === row.productCode}
              className={cx(
                'group w-full rounded-xl px-space-xs py-2 text-left transition-all duration-200 hover:bg-surface-container-low',
                focus === row.productCode && 'bg-surface-container-low ring-1 ring-primary-container/25',
              )}
            >
              <div className="flex items-center justify-between gap-space-sm">
                <span className="flex min-w-0 items-baseline gap-space-xs">
                  <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">{row.productCode}</span>
                  <span className="truncate text-label-sm text-on-surface-variant">{row.description}</span>
                </span>
                <span className={cx('shrink-0 tabular-nums text-label-md font-bold', TONE_TEXT[tone])}>{fmtPct(pct)}</span>
              </div>
              <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-surface-container">
                {showProjection && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-pill bg-secondary-container/45 transition-[width] duration-700 ease-out"
                    style={{ width: mounted ? `${widthProjected}%` : '0%' }}
                  />
                )}
                <div
                  className="absolute inset-y-0 left-0 rounded-pill bg-primary-container transition-[width] duration-700 ease-out"
                  style={{ width: mounted ? `${widthActual}%` : '0%', transitionDelay: '80ms' }}
                />
                {row.forecastKg > 0 && (
                  <span
                    aria-hidden
                    className="absolute -inset-y-0.5 w-[2px] rounded-pill bg-secondary"
                    style={{ left: `calc(${marker}% - 1px)` }}
                  />
                )}
              </div>
            </button>
          </li>
        );
      })}
      <li className="mt-space-xs flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Real
        </span>
        {showProjection && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-secondary-container/60" /> Proyección
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-2 w-0.5 rounded-pill bg-secondary" /> Meta
        </span>
      </li>
    </ul>
  );
}

function cumulativeOption(report: ForecastSalesResponse): Record<string, unknown> {
  const points = buildCumulativeSeries(report);
  const forecastKg = report.totals.forecastKg;
  const labels = points.map((point) => point.label);
  const actual = points.map((point) => point.actual);
  const projected = points.map((point) => point.projected);
  const pace = points.map((point) => point.pace);
  const cutDay = report.asOf ? String(Number(report.asOf.slice(8, 10))) : null;
  const today = String(Number(report.days.today.slice(8, 10)));
  const interval = Math.max(0, Math.ceil(labels.length / 10) - 1);

  const markLine =
    cutDay === null
      ? undefined
      : {
          symbol: 'none',
          silent: true,
          lineStyle: { color: '#9aa3af', type: 'dashed', width: 1 },
          label: { formatter: 'corte', color: C.outline, fontSize: 10, position: 'insideEndTop', rotate: 0 },
          data: [
            { xAxis: cutDay },
            ...(today !== cutDay
              ? [
                  {
                    xAxis: today,
                    lineStyle: { color: C.amber, type: 'dotted', width: 1 },
                    label: { formatter: 'hoy', color: C.amber, fontSize: 10, position: 'insideEndBottom', rotate: 0 },
                  },
                ]
              : []),
          ],
        };

  return {
    animationDuration: 900,
    animationEasing: 'cubicOut',
    grid: { left: 8, right: 16, top: 14, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [10, 12],
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -28px rgba(8,29,44,.6);',
      axisPointer: { type: 'line', lineStyle: { color: C.lime, opacity: 0.5 } },
      formatter: (params: Array<{ seriesName?: string; value?: number | null; dataIndex?: number }>) => {
        const first = params[0];
        const point = first && first.dataIndex !== undefined ? points[first.dataIndex] : undefined;
        if (!point) return '';
        const lines = params
          .filter((item) => item.value !== null && item.value !== undefined)
          .map((item) => {
            const value = Number(item.value);
            const share = forecastKg > 0 ? ` · ${fmtPct((value / forecastKg) * 100, 1)}` : '';
            return `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;">
              <span style="color:rgba(255,255,255,.72);">${item.seriesName ?? ''}</span>
              <strong style="font-variant-numeric:tabular-nums;color:#fff;">${fmtKg(value)} kg${share}</strong>
            </div>`;
          })
          .join('');
        return `<div style="min-width:190px;"><div style="font-weight:700;margin-bottom:2px;">${dayLabel(point.date)}</div>${lines}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: { color: C.outline, fontSize: 10, interval },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { color: C.outline, fontSize: 10, formatter: (value: number) => compact(value) },
    },
    series: [
      {
        name: 'Real',
        type: 'line',
        smooth: 0.28,
        showSymbol: false,
        data: actual,
        lineStyle: { width: 3, color: C.navy },
        itemStyle: { color: C.navy },
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
        lineStyle: { width: 2.5, color: C.lime, type: 'dashed' },
        itemStyle: { color: C.lime },
        z: 3,
      },
      {
        name: 'Ritmo forecast',
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

function historyOption(report: ForecastSalesResponse, row: ForecastSalesRow): Record<string, unknown> {
  const categories = [
    ...row.history.map((entry) => monthLabel(entry.year, entry.month, true)),
    monthLabel(report.year, report.month, true),
  ];
  const values = [...row.history.map((entry) => entry.actualKg), row.actualKg];
  // Meta de cada mes: snapshot histórico y, en el mes del informe, su meta.
  const targets = [...row.history.map((entry) => entry.forecastKg), row.forecastKg > 0 ? row.forecastKg : null];
  const hasHistoryTarget = row.history.some((entry) => entry.forecastKg !== null);
  const numericTargets = targets.filter((value): value is number => value !== null);
  // Incluye la meta en la escala para que la línea de referencia no se corte.
  const axisMax = Math.max(...values, ...numericTargets, 1) * 1.08;

  return {
    animationDuration: 700,
    grid: { left: 6, right: 12, top: 26, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params: Array<{ seriesName?: string; value?: number | null; dataIndex?: number }>) => {
        const index = params[0]?.dataIndex ?? 0;
        const label =
          index === values.length - 1 ? `${monthLabel(report.year, report.month)} (en curso)` : categories[index];
        const lines = params
          .filter((item) => item.value !== null && item.value !== undefined)
          .map(
            (item) =>
              `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;">
                <span style="color:rgba(255,255,255,.72);">${item.seriesName ?? ''}</span>
                <strong style="font-variant-numeric:tabular-nums;color:#fff;">${fmtKg(Number(item.value))} kg</strong>
              </div>`,
          )
          .join('');
        return `<div style="min-width:160px;"><strong>${label}</strong>${lines}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: { color: C.outline, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      max: axisMax,
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { color: C.outline, fontSize: 10, formatter: (value: number) => compact(value) },
    },
    series: [
      {
        name: 'Venta real',
        type: 'bar',
        barMaxWidth: 38,
        data: values.map((value, index) => ({
          value,
          itemStyle: {
            color: index === values.length - 1 ? C.lime : C.navy,
            borderRadius: [6, 6, 0, 0],
          },
        })),
        // Sin meta histórica, una línea horizontal marca la meta vigente.
        markLine:
          !hasHistoryTarget && row.forecastKg > 0
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: C.lime, type: 'dashed', width: 1.5 },
                label: { formatter: `Meta ${compact(row.forecastKg)}`, color: '#4b6700', fontSize: 10, position: 'insideEndTop' },
                data: [{ yAxis: row.forecastKg }],
              }
            : undefined,
      },
      ...(hasHistoryTarget
        ? [
            {
              name: 'Meta',
              type: 'line',
              data: targets,
              connectNulls: false,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: { color: C.lime, type: 'dashed', width: 1.8 },
              itemStyle: { color: C.lime },
              z: 3,
            },
          ]
        : []),
    ],
  };
}

function SalesSkeleton() {
  return (
    <div className="flex flex-col gap-space-lg" aria-busy="true" aria-live="polite">
      <p className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
        <RotateCw aria-hidden className="size-4 animate-spin" /> Calculando ventas del mes contra el forecast…
      </p>
      <div className="shimmer h-52 rounded-card bg-surface-container-low" />
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <div className="grid gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

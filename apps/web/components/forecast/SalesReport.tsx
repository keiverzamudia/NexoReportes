'use client';

// ============================================================
// «Ventas vs Forecast» — informe ejecutivo del mes.
//
// · Arriba: proyección de cierre (run-rate sobre días hábiles) con anillo de
//   cumplimiento y KPIs.
// · En medio: acumulado real vs proyección vs ritmo del forecast (ECharts),
//   la tira de ventas por día con scroll horizontal y desviación por producto
//   (barras animadas, clic para enfocar).
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
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  ListFilter,
  PackageSearch,
  RotateCw,
  X,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { ProductPicker } from '../ProductPicker';
import { SALES_COLUMN_HELP, SALES_HELP_RULES, SALES_HELP_TERMS, SALES_HELP_TITLE } from '../../content/help/forecast';
import { apiFetch } from '../../lib/api';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Skeleton,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import {
  META_MARKER_PCT,
  buildCumulativeSeries,
  buildDayBars,
  buildNarrative,
  buildSalesCsv,
  dailySalesScale,
  dayLabel,
  filterSalesRows,
  fmtKg,
  fmtPct,
  fmtTonnes,
  monthLabel,
  productsForDay,
  salesCsvFileName,
  salesDaysWithSales,
  salesDeviationGeometry,
  salesTone,
  type DailySalesScale,
  type SalesDayBar,
  type SalesTone,
} from '../../lib/sales-report';
import { useHelpRow } from '../../lib/use-help-row';

const C = {
  navy: '#003366',
  navyLight: '#1d5a96',
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

/** Artículos visibles antes de pedir «ver todos» en la lista de desviación. */
const DEVIATION_PREVIEW = 20;

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
  canEdit = false,
  onRetry,
}: {
  report?: ForecastSalesResponse;
  isLoading: boolean;
  error?: Error | null;
  unit: 'ALL' | 'SAC' | 'KG';
  /** Permite aceptar un cambio de meta detectado en Profit. */
  canEdit?: boolean;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithForecast, setOnlyWithForecast] = useState(false);
  const [onlyWithData, setOnlyWithData] = useState(false);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [helpRow, setHelpRow] = useHelpRow();
  // Listas largas: el informe no debe pintar cientos de filas de golpe.
  const [deviationExpanded, setDeviationExpanded] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // El input responde al instante; la lista se filtra cuando hay hueco.
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(
    () =>
      report
        ? filterSalesRows(report.rows, {
            unit,
            search: deferredSearch,
            onlyWithSales,
            onlyWithForecast,
            onlyWithData,
          })
        : [],
    [report, unit, deferredSearch, onlyWithSales, onlyWithForecast, onlyWithData],
  );

  const deviationPreview = useMemo(
    () => (deviationExpanded ? filtered : filtered.slice(0, DEVIATION_PREVIEW)),
    [filtered, deviationExpanded],
  );

  const openProduct = useCallback((code: string) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusCode((current) => (current === code ? null : code));
  }, []);
  const closeProduct = useCallback(() => setFocusCode(null), []);

  const chartOption = useMemo(() => (report ? cumulativeOption(report, pinnedDay) : {}), [report, pinnedDay]);
  const daysWithSales = useMemo(() => (report ? salesDaysWithSales(report) : []), [report]);
  // Una ranura por día del mes: la tira muestra también los días futuros.
  const dayBars = useMemo(() => (report ? buildDayBars(report) : []), [report]);
  const dayScale = useMemo<DailySalesScale>(
    () => (report ? dailySalesScale(report, dayBars) : { maxKg: 1, goalKg: null }),
    [report, dayBars],
  );
  const activeDay = hoverDay ?? pinnedDay;
  const activeBar = useMemo(
    () => (activeDay ? dayBars.find((bar) => bar.date === activeDay) ?? null : null),
    [activeDay, dayBars],
  );
  const pinnedBar = useMemo(
    () => (pinnedDay ? dayBars.find((bar) => bar.date === pinnedDay) ?? null : null),
    [pinnedDay, dayBars],
  );
  // El desglose se ancla al clic, no al hover: la tabla debe quedarse quieta
  // mientras el puntero viaja de la barra a la tabla.
  const pinnedDayProducts = useMemo(
    () => (report && pinnedDay ? productsForDay(report, pinnedDay) : []),
    [report, pinnedDay],
  );
  // Arranque del scroll: hoy si está en el mes, si no el último día con venta.
  const initialBarDate = useMemo(() => {
    if (!report) return null;
    if (dayBars.some((bar) => bar.date === report.days.today)) return report.days.today;
    const lastSale = [...dayBars].reverse().find((bar) => bar.kg > 0);
    return lastSale?.date ?? dayBars[0]?.date ?? null;
  }, [dayBars, report]);
  const togglePinnedDay = useCallback((date: string) => {
    setPinnedDay((current) => (current === date ? null : date));
  }, []);

  // La gráfica informa el índice del eje X; el panel lo traduce a fecha.
  const handleIndexHover = useCallback(
    (index: number | null) => {
      setHoverDay(index === null ? null : report?.daily[index]?.date ?? null);
    },
    [report],
  );
  const handleIndexClick = useCallback(
    (index: number) => {
      const date = report?.daily[index]?.date;
      if (!date) return;
      setPinnedDay((current) => (current === date ? null : date));
    },
    [report],
  );

  // Al cambiar de mes se limpia la selección (las fechas ya no aplican).
  useEffect(() => {
    setPinnedDay(null);
    setHoverDay(null);
  }, [report?.year, report?.month]);

  // El detalle del producto es un diálogo: Esc cierra, el fondo no scrollea
  // y el foco entra al panel para que el clic tenga respuesta inmediata.
  useEffect(() => {
    if (!focusCode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusCode(null);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => detailRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, [focusCode]);
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

  const hasDeviationFilters =
    Boolean(search.trim()) || onlyWithSales || onlyWithForecast || onlyWithData;
  const clearDeviationFilters = useCallback(() => {
    setSearch('');
    setOnlyWithSales(false);
    setOnlyWithForecast(false);
    setOnlyWithData(false);
  }, []);

  // Aceptar un cambio de Profit sobre la meta capturada (solo mes en curso).
  const acceptDrift = useMutation<void, Error, string>({
    mutationFn: (code) =>
      apiFetch(
        `/forecast/targets/${encodeURIComponent(code)}/accept?year=${report?.year}&month=${report?.month}`,
        { method: 'POST' },
      ),
    onSuccess: () => onRetry(),
  });

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

  // Las columnas se definen por render, pero solo dependen de helpers del módulo.
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
      render: (row) => (
        <span
          className="inline-flex items-center justify-end gap-1"
          title={
            row.forecastDriftAt
              ? `Profit cambió la meta después de la captura${row.forecastCapturedKg !== null ? ` (capturada: ${fmtKg(row.forecastCapturedKg)} kg)` : ''}`
              : undefined
          }
        >
          {row.forecastKg > 0 ? (
            <span className="font-semibold tabular-nums text-on-surface">{fmtKg(row.forecastKg)}</span>
          ) : (
            <span className="text-outline">—</span>
          )}
          {row.forecastDriftAt && <AlertTriangle aria-label="Meta cambiada en Profit" className="size-3 shrink-0 text-warning" />}
        </span>
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
          No se pudo leer el forecast de Profit (<code>forecast</code>):{' '}
          {report.forecastSource === 'CAPTURED'
            ? 'se usa la meta capturada localmente y la venta real se muestra igual.'
            : 'la venta real se muestra, pero los porcentajes de cumplimiento quedan sin meta.'}
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
          No hay meta en Profit ni snapshot guardado para {monthLabel(report.year, report.month)}. Se muestra la venta real y
          la comparación contra el promedio histórico; el snapshot de la meta se captura mientras el mes está en curso.
        </p>
      )}

      {report.status === 'OPEN' && report.forecastSource === 'NONE' && report.forecastAvailable && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-md text-on-surface-variant">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          forecast no tiene metas para este mes: la venta real se muestra sin porcentajes de cumplimiento.
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
                {report.forecastSource === 'CAPTURED' && (
                  <span className="font-semibold normal-case tracking-normal text-white/60">· meta capturada</span>
                )}
              </span>
              <span className="text-label-md text-white/65">
                Corte {report.asOf ? dayLabel(report.asOf) : 'sin ventas'} · {report.days.workingElapsed}/{report.days.workingInMonth} días hábiles
              </span>
              <span className="text-label-md text-white/45">·</span>
              <span className="text-label-md text-white/65">
                Histórico: {report.history.length} meses cerrados
              </span>
              <span className="text-label-md text-white/45">·</span>
              <span className="text-label-md text-white/65">
                Promedio {fmtKg(totals.dailyAvgKg)} kg/día
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
              <HeroStat
                label="Forecast"
                value={totals.forecastKg > 0 ? `${fmtKg(totals.forecastKg)} kg` : 'Sin meta'}
                hint={
                  report.forecastSource === 'SNAPSHOT' || report.forecastSource === 'CAPTURED'
                    ? `${fmtTonnes(totals.forecastKg)} t · guardada`
                    : `${fmtTonnes(totals.forecastKg)} t`
                }
              />
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
              <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-white/50">
                Cumplimiento proyectado
              </span>
              <span className={cx('tabular-nums text-title-md font-bold', tone === 'good' ? 'text-secondary-container' : 'text-white/85')}>
                {fmtPct(projectedAttainment)}
              </span>
              <span className="text-label-sm text-white/45">Meta {fmtKg(totals.forecastKg)} kg</span>
              <span className="mt-1 flex items-center gap-1 text-label-sm text-white/55">
                Actual
                <strong className="tabular-nums text-white/85">{fmtPct(attainment)}</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Gráficas ---------- */}
      <div className="grid items-start gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden animate-rise">
          <header className="flex flex-wrap items-end justify-between gap-space-sm px-space-md pt-space-md">
            <div>
              <h2 className="text-title-md font-bold text-on-surface">Acumulado del mes</h2>
              <p className="text-label-md text-on-surface-variant">
                {isOpen
                  ? 'Real hasta el corte · proyección punteada · ritmo uniforme del forecast'
                  : 'Venta real acumulada · ritmo uniforme del forecast'}
                {report.daily.length > 0 && totals.actualKg > 0
                  ? ' · pasa el mouse o haz clic en un día: la barra de abajo se sincroniza'
                  : ''}
              </p>
            </div>
            {totals.actualKg > 0 && (
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
            )}
          </header>
          <div className="px-space-sm pb-space-sm">
            {report.daily.length > 0 && totals.actualKg > 0 ? (
              <>
                <EChart
                  option={chartOption}
                  height={280}
                  ariaLabel="Acumulado del mes: venta real, proyección y ritmo del forecast"
                  onIndexHover={handleIndexHover}
                  onIndexClick={handleIndexClick}
                />

                {/* Tira de barras sincronizada con el acumulado: un día por columna. */}
                <DailySalesBars
                  bars={dayBars}
                  scale={dayScale}
                  activeDate={activeDay}
                  pinnedDate={pinnedDay}
                  initialDate={initialBarDate}
                  fallbackSummary={`${daysWithSales.length} días con venta · ${fmtKg(totals.actualKg)} kg · ${fmtKg(totals.invoiceCount)} notas`}
                  onHover={setHoverDay}
                  onPin={togglePinnedDay}
                />

                {/* Desglose del día fijado con clic (el hover solo previsualiza). */}
                <section
                  aria-label="Desglose por producto del día"
                  className="mt-space-sm border-t border-surface-container pt-space-sm"
                >
                  <header className="mb-space-xs flex flex-wrap items-center justify-between gap-space-sm px-space-xs">
                    <div className="min-w-0">
                      <h3 className="text-label-sm font-bold uppercase tracking-[0.14em] text-outline">
                        Desglose por producto
                      </h3>
                      <p className="text-label-md text-on-surface-variant">
                        {pinnedBar
                          ? `${dayLabel(pinnedBar.date)}${pinnedBar.partial ? ' · en curso' : ''} · ${fmtKg(pinnedBar.kg)} kg · ${fmtKg(pinnedBar.invoices)} notas`
                          : 'Haz clic en un día del acumulado o en una barra para fijar su desglose.'}
                      </p>
                    </div>
                  </header>

                  {pinnedBar && (
                    <div className="max-h-[200px] overflow-y-auto pr-1">
                      {pinnedDayProducts.length > 0 ? (
                        <table className="w-full border-collapse text-label-md">
                          <caption className="sr-only">
                            Productos despachados el {dayLabel(pinnedBar.date)}
                          </caption>
                          <thead>
                            <tr className="text-label-sm uppercase tracking-[0.1em] text-outline">
                              <th scope="col" className="py-1 text-left font-semibold">
                                Producto
                              </th>
                              <th scope="col" className="py-1 text-right font-semibold">
                                Kg
                              </th>
                              <th scope="col" className="py-1 text-right font-semibold">
                                Sacos
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {pinnedDayProducts.map((line) => (
                              <tr key={line.productCode} className="border-t border-surface-container/70">
                                <td className="py-1 pr-2">
                                  <span className="block truncate text-on-surface">{line.description}</span>
                                  <span className="text-label-sm text-outline">
                                    {line.productCode}
                                    {line.uom ? ` · ${line.uom}` : ''}
                                  </span>
                                </td>
                                <td className="py-1 text-right tabular-nums text-on-surface">{fmtKg(line.kg)}</td>
                                <td className="py-1 text-right tabular-nums text-on-surface-variant">
                                  {line.sacks === null ? '—' : fmtKg(line.sacks, 1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="px-space-xs py-3 text-label-md text-outline">
                          Este día no tiene desglose por producto (sin despachos).
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="Aún no hay ventas en el mes"
                description={
                  report.daily.length === 0
                    ? 'No hay entregas en el rango consultado para dibujar el acumulado.'
                    : 'Cuando Profit registre la primera nota de entrega verás aquí la venta real contra la meta.'
                }
              />
            )}
          </div>
        </Card>

        <Card className="overflow-hidden animate-rise">
          <header className="px-space-md pt-space-md">
            <div className="flex items-start justify-between gap-space-sm">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                  <ListFilter aria-hidden className="size-4 shrink-0 text-primary" />
                  Desviación por producto
                </h2>
                <p className="text-label-md text-on-surface-variant">
                  {hasDeviationFilters
                    ? `${fmtKg(filtered.length, 0)} de ${fmtKg(report.rows.length, 0)} artículos · cada barra se mide contra su meta`
                    : `${fmtKg(report.rows.length, 0)} artículos · cada barra se mide contra su meta`}
                  <span className="block text-outline">Haz clic en un artículo para abrir su detalle.</span>
                </p>
              </div>
              <Badge tone="primary">{fmtKg(filtered.length, 0)} art.</Badge>
            </div>

            <div
              className="mt-space-sm flex flex-wrap items-center gap-space-2xs"
              role="group"
              aria-label="Filtros de la desviación por producto"
            >
              <TextInput
                icon={PackageSearch}
                value={search}
                onChange={setSearch}
                placeholder="Buscar código o descripción…"
                ariaLabel="Buscar producto en la desviación"
                className="min-w-[12rem] flex-1"
              />
              <FilterChip active={onlyWithData} onClick={() => setOnlyWithData((value) => !value)} label="Con datos" />
              <FilterChip
                active={onlyWithForecast}
                onClick={() => setOnlyWithForecast((value) => !value)}
                label="Con forecast"
              />
              <FilterChip active={onlyWithSales} onClick={() => setOnlyWithSales((value) => !value)} label="Con venta" />
              {hasDeviationFilters && (
                <button
                  type="button"
                  onClick={clearDeviationFilters}
                  className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl px-space-xs text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70"
                >
                  <X aria-hidden className="size-3.5" /> Limpiar
                </button>
              )}
            </div>
          </header>
          <div className="px-space-md pb-space-md pt-space-sm">
            <DeviationBars
              rows={deviationPreview}
              focus={focusCode}
              showProjection={isOpen}
              onFocus={openProduct}
            />
            {filtered.length > DEVIATION_PREVIEW && (
              <button
                type="button"
                onClick={() => setDeviationExpanded((value) => !value)}
                aria-expanded={deviationExpanded}
                className="mt-space-xs inline-flex h-9 w-full items-center justify-center gap-1 rounded-xl border border-outline-variant/40 text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
              >
                <ChevronDown
                  aria-hidden
                  className={cx('size-4 transition-transform', deviationExpanded && 'rotate-180')}
                />
                {deviationExpanded
                  ? 'Ver solo los principales'
                  : `Ver los ${fmtKg(filtered.length, 0)} artículos`}
              </button>
            )}
          </div>
        </Card>
      </div>

      {focusRow && (
        <>
          <div
            aria-hidden
            className="animate-fade fixed inset-0 z-40 bg-[#081d2c]/45 backdrop-blur-[2px]"
            onClick={closeProduct}
          />
          <aside
            ref={detailRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-product-title"
            tabIndex={-1}
            className="animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto overscroll-contain bg-surface-container-lowest shadow-2xl outline-none"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-space-md border-b border-surface-container bg-surface-container-lowest/95 px-space-md py-space-sm backdrop-blur">
              <div className="min-w-0">
                <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Detalle del producto</p>
                <h2
                  id="focus-product-title"
                  className="flex flex-wrap items-baseline gap-space-sm text-title-md font-bold text-on-surface"
                >
                  <span className="tabular-nums text-primary">{focusRow.productCode}</span>
                  <span className="min-w-0 truncate text-body-md font-normal text-on-surface-variant">
                    {focusRow.description}
                  </span>
                </h2>
                <p className="text-label-md text-on-surface-variant">
                  {focusRow.uom}
                  {focusRow.kgPerUom !== null ? ` · ${fmtKg(focusRow.kgPerUom, 2)} kg/unidad` : ' · granel'}
                  {focusRow.lastInvoiceDate ? ` · última entrega ${fmtDate(focusRow.lastInvoiceDate)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeProduct}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
                aria-label="Cerrar detalle del producto"
              >
                <X aria-hidden className="size-4" />
              </button>
            </header>

            <div className="flex flex-col gap-space-md p-space-md">
              {focusRow.forecastDriftAt && (
                <div className="flex flex-wrap items-center gap-space-sm rounded-xl bg-warning-container/60 px-space-md py-space-xs text-label-md text-on-warning-container">
                  <AlertTriangle aria-hidden className="size-4 shrink-0" />
                  <span>
                    Profit cambió la meta: ahora{' '}
                    <strong className="tabular-nums">{fmtKg(focusRow.forecastLiveKg ?? 0)} kg</strong>.
                    {focusRow.forecastCapturedKg !== null && (
                      <>
                        {' '}La captura histórica sigue en{' '}
                        <strong className="tabular-nums">{fmtKg(focusRow.forecastCapturedKg)} kg</strong>.
                      </>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => acceptDrift.mutate(focusRow.productCode)}
                      disabled={acceptDrift.isPending}
                      className="inline-flex h-7 items-center rounded-pill border border-warning/50 bg-white/60 px-space-sm text-label-sm font-bold text-on-warning-container transition-colors hover:bg-white disabled:opacity-60"
                    >
                      {acceptDrift.isPending ? 'Aceptando…' : 'Aceptar cambio'}
                    </button>
                  )}
                </div>
              )}
              {acceptDrift.error && (
                <p role="alert" className="text-label-md text-critical">
                  {acceptDrift.error.message}
                </p>
              )}

              <div>
                <div className="mb-space-2xs flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Venta real
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-full bg-[#1d5a96]" /> Mes en curso
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="h-2 w-0.5 rounded-pill bg-secondary" /> Meta capturada por mes
                  </span>
                </div>
                <EChart option={focusOption} height={230} ariaLabel={`Histórico de ventas de ${focusRow.productCode}`} />
              </div>

              <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                <MiniStat
                  label="Venta del mes"
                  value={`${fmtKg(focusRow.actualKg)} kg`}
                  hint={`${fmtKg(focusRow.actualUnits)} unid. · ${fmtKg(focusRow.actualSacks)} sacos`}
                />
                <MiniStat
                  label={isOpen ? 'Proyección' : 'Cierre real'}
                  value={focusRow.projectedKg === null ? '—' : `${fmtKg(focusRow.projectedKg)} kg`}
                  hint={
                    focusRow.projectedAttainmentPct === null
                      ? 'sin meta'
                      : `${fmtPct(focusRow.projectedAttainmentPct)} del forecast${
                          isOpen && report.days.workingElapsed === 0 ? ' · aún sin días hábiles' : ''
                        }`
                  }
                  tone={salesTone(focusRow.projectedAttainmentPct)}
                />
                <MiniStat label="Promedio/día" value={`${fmtKg(focusRow.dailyAvgKg)} kg`} hint={`por ${basisLabel}`} />
                <MiniStat
                  label={isOpen ? 'Ritmo necesario' : 'Meta del mes'}
                  value={
                    isOpen
                      ? focusRow.requiredDailyKg === null
                        ? '—'
                        : `${fmtKg(focusRow.requiredDailyKg)} kg/día`
                      : focusRow.forecastKg > 0
                        ? `${fmtKg(focusRow.forecastKg)} kg`
                        : '—'
                  }
                  hint={
                    isOpen
                      ? focusRow.forecastKg > 0
                        ? `meta ${fmtKg(focusRow.forecastKg)} kg${
                            focusRow.forecastCapturedAt
                              ? ` · capturada ${fmtDate(focusRow.forecastCapturedAt.slice(0, 10))}`
                              : ''
                          }`
                        : 'sin meta'
                      : focusRow.forecastKg > 0
                        ? `meta histórica guardada${
                            focusRow.forecastCapturedAt
                              ? ` · ${fmtDate(focusRow.forecastCapturedAt.slice(0, 10))}`
                              : ''
                          }`
                        : 'sin meta guardada'
                  }
                  tone="warn"
                />
              </div>
            </div>
          </aside>
        </>
      )}

      {/* ---------- Tabla ---------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container px-space-md py-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm text-label-md text-on-surface-variant">
            <span>
              {hasDeviationFilters ? (
                <>
                  <strong className="tabular-nums text-on-surface">{fmtKg(filtered.length, 0)}</strong> de{' '}
                  <strong className="tabular-nums text-on-surface">{fmtKg(report.rows.length, 0)}</strong> artículos
                </>
              ) : (
                <>
                  <strong className="tabular-nums text-on-surface">{fmtKg(report.rows.length, 0)}</strong> artículos
                </>
              )}
            </span>
            {hasDeviationFilters && (
              <button
                type="button"
                onClick={clearDeviationFilters}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-space-xs font-semibold text-primary transition-colors hover:bg-primary-container/10"
              >
                <X aria-hidden className="size-3.5" /> Limpiar filtros
              </button>
            )}
            <span className="hidden text-outline md:inline">Los filtros se aplican desde «Desviación por producto».</span>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="w-full sm:w-64">
              <ProductPicker
                value={focusCode}
                onChange={(code) => (code ? openProduct(code) : closeProduct())}
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
                search || onlyWithSales || onlyWithForecast || onlyWithData
                  ? 'Ningún artículo coincide con los filtros. Prueba a limpiar la búsqueda.'
                  : 'Profit no reporta entregas ABA para el rango consultado.'
              }
              action={
                search || onlyWithSales || onlyWithForecast || onlyWithData ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setOnlyWithSales(false);
                      setOnlyWithForecast(false);
                      setOnlyWithData(false);
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

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-space-sm text-label-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70',
        active
          ? 'border-primary-container/60 bg-primary-container/10 text-primary'
          : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/40 hover:text-primary',
      )}
    >
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full', active ? 'bg-primary-container' : 'bg-outline/40')}
      />
      {label}
    </button>
  );
}

function Semaphore({ row }: { row: ForecastSalesRow }) {
  if (row.forecastKg <= 0 && row.actualKg <= 0) {
    return (row.forecastCapturedKg ?? 0) > 0 ? (
      <Badge tone="warning">Meta sin leer</Badge>
    ) : (
      <Badge tone="muted">Sin datos</Badge>
    );
  }
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

/** Ancho de cada día en la tira: fija el scroll horizontal del mes. */
const DAY_SLOT_PX = 38;
/** Alto de la pista de barras y de la fila de días. */
const BAR_AREA_PX = 148;
const DAY_LABEL_PX = 22;

/**
 * Tira de ventas por día: una columna por día del mes dentro de una caja con
 * scroll horizontal. Comparte `activeDate`/`pinnedDate` con la gráfica de
 * acumulado, así el clic arriba marca la barra y el clic en la barra fija el
 * día en la línea.
 */
const DailySalesBars = memo(function DailySalesBars({
  bars,
  scale,
  activeDate,
  pinnedDate,
  initialDate,
  fallbackSummary,
  onHover,
  onPin,
}: {
  bars: SalesDayBar[];
  scale: DailySalesScale;
  activeDate: string | null;
  pinnedDate: string | null;
  initialDate: string | null;
  fallbackSummary: string;
  onHover: (date: string | null) => void;
  onPin: (date: string) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const anchors = useRef(new Map<string, HTMLButtonElement>());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Centra un día sin mover la página: solo se toca el scroll de la tira.
  const centerOn = useCallback((date: string | null, smooth: boolean) => {
    const box = scroller.current;
    const node = date ? anchors.current.get(date) : null;
    if (!box || !node) return;
    const left = node.offsetLeft + node.offsetWidth / 2 - box.clientWidth / 2;
    const maxLeft = Math.max(0, box.scrollWidth - box.clientWidth);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({
      left: Math.max(0, Math.min(left, maxLeft)),
      behavior: smooth && !reduceMotion ? 'smooth' : 'auto',
    });
  }, []);

  // Al abrir el mes, el tramo con actividad queda a la vista.
  useEffect(() => {
    const frame = requestAnimationFrame(() => centerOn(initialDate, false));
    return () => cancelAnimationFrame(frame);
  }, [centerOn, initialDate]);

  // Un clic (en la línea o en una barra) centra el día elegido.
  useEffect(() => {
    if (!pinnedDate) return;
    const frame = requestAnimationFrame(() => centerOn(pinnedDate, true));
    return () => cancelAnimationFrame(frame);
  }, [centerOn, pinnedDate]);

  const shift = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * DAY_SLOT_PX * 7, behavior: 'smooth' });
  };

  if (bars.length === 0) return null;

  const goalPct =
    scale.goalKg !== null && scale.maxKg > 0 ? Math.min(100, (scale.goalKg / scale.maxKg) * 100) : null;
  const activeBar = activeDate ? bars.find((bar) => bar.date === activeDate) ?? null : null;
  const summary = activeBar
    ? `${dayLabel(activeBar.date)}${activeBar.partial ? ' · en curso' : ''} · ${fmtKg(activeBar.kg)} kg · ${fmtKg(activeBar.invoices)} notas`
    : fallbackSummary;

  return (
    <section aria-label="Ventas por día" className="mt-space-sm border-t border-surface-container pt-space-sm">
      <header className="mb-space-xs flex flex-wrap items-center justify-between gap-space-sm px-space-xs">
        <div className="min-w-0">
          <h3 className="text-label-sm font-bold uppercase tracking-[0.14em] text-outline">Ventas por día</h3>
          <p className="text-label-md text-on-surface-variant">{summary}</p>
        </div>
        <div className="flex items-center gap-space-2xs">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Ver días anteriores"
            className="grid size-7 place-items-center rounded-pill border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Ver días siguientes"
            className="grid size-7 place-items-center rounded-pill border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
          {pinnedDate && (
            <button
              type="button"
              onClick={() => {
                onHover(null);
                onPin(pinnedDate);
              }}
              className="inline-flex h-7 items-center gap-1 rounded-pill border border-outline-variant/40 px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <X aria-hidden className="size-3.5" /> Ver todo el mes
            </button>
          )}
        </div>
      </header>

      <div className="flex items-start gap-1.5 px-space-xs">
        {/* Eje de kg/día fuera del scroll: no se va con las barras. */}
        <div
          aria-hidden
          className="relative w-9 shrink-0 text-right text-[10px] tabular-nums text-outline"
          style={{ height: BAR_AREA_PX }}
        >
          <span className="absolute right-0 top-0 -translate-y-1/2 leading-none">{compact(scale.maxKg)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 leading-none">{compact(scale.maxKg / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2 leading-none">0</span>
        </div>

        <div
          ref={scroller}
          role="group"
          aria-label="Días del mes"
          tabIndex={0}
          className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-lg pb-1 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/60"
        >
          <div className="relative" style={{ width: bars.length * DAY_SLOT_PX }}>
            {/* Guías horizontales y meta diaria. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: BAR_AREA_PX }}>
              <span className="absolute inset-x-0 top-0 border-t border-dashed border-surface-container" />
              <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-surface-container" />
              <span className="absolute inset-x-0 bottom-0 border-t border-outline-variant/50" />
              {goalPct !== null && (
                <span
                  className="absolute inset-x-0 border-t-2 border-dashed border-secondary"
                  style={{ bottom: `${goalPct}%` }}
                />
              )}
            </div>

            <ul className="relative flex items-end" style={{ height: BAR_AREA_PX + DAY_LABEL_PX }}>
              {bars.map((bar) => {
                const isActive = activeDate === bar.date;
                const isPinned = pinnedDate === bar.date;
                const height = bar.kg > 0 ? Math.max(3, (bar.kg / scale.maxKg) * BAR_AREA_PX) : 2;

                return (
                  <li
                    key={bar.date}
                    className="shrink-0"
                    style={{ width: DAY_SLOT_PX, height: BAR_AREA_PX + DAY_LABEL_PX }}
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) anchors.current.set(bar.date, node);
                        else anchors.current.delete(bar.date);
                      }}
                      aria-pressed={isPinned}
                      aria-label={`Día ${bar.dayNumber}: ${fmtKg(bar.kg)} kg, ${fmtKg(bar.invoices)} notas${
                        bar.partial ? ', día en curso' : bar.future ? ', día futuro' : ''
                      }`}
                      onClick={() => onPin(bar.date)}
                      onMouseEnter={() => onHover(bar.date)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(bar.date)}
                      onBlur={() => onHover(null)}
                      className={cx(
                        'group flex h-full w-full flex-col items-center justify-end rounded-md px-[3px] pb-0 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70',
                        isActive ? 'bg-surface-container-low' : 'hover:bg-surface-container-low/60',
                      )}
                    >
                      <span className="flex w-full items-end justify-center" style={{ height: BAR_AREA_PX }}>
                        <span
                          aria-hidden
                          className={cx(
                            'relative w-full max-w-[22px] rounded-t-[4px] transition-[height] duration-500 ease-out',
                            bar.future
                              ? 'bg-surface-container-high/60'
                              : bar.kg <= 0
                                ? 'bg-surface-container-high'
                                : bar.partial
                                  ? 'bg-primary-container/45'
                                  : 'bg-primary-container',
                            isPinned && 'ring-2 ring-secondary ring-offset-1',
                            isActive && !isPinned && 'ring-1 ring-primary/30',
                          )}
                          style={{ height: mounted ? height : 0 }}
                        >
                          {bar.partial && bar.kg > 0 && (
                            <span className="absolute inset-x-0 top-0 h-1 rounded-t-[4px] bg-secondary" />
                          )}
                        </span>
                      </span>
                      <span
                        className={cx(
                          'flex h-[22px] min-w-[20px] items-center justify-center rounded-pill px-1 text-[10px] tabular-nums',
                          isPinned
                            ? 'bg-primary-container font-bold text-white'
                            : bar.isToday
                              ? 'font-bold text-primary'
                              : bar.future
                                ? 'text-outline/55'
                                : 'text-outline',
                        )}
                      >
                        {bar.dayNumber}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-space-xs flex flex-wrap items-center gap-space-sm px-space-xs text-label-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Real
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-secondary" /> En curso
        </span>
        {scale.goalKg !== null && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="w-4 border-t-2 border-dashed border-secondary" /> Meta/día{' '}
            {fmtKg(scale.goalKg)} kg
          </span>
        )}
        <span className="text-outline">Clic en una barra para fijar el día.</span>
      </div>
    </section>
  );
});

/** Eje de referencia: 0 % a la izquierda y el 100 % de la meta en el marcador. */
function DeviationScale({ markerPct }: { markerPct: number }) {
  return (
    <div className="px-space-xs">
      <div className="relative h-4 text-label-sm text-outline">
        <span className="absolute left-0 top-0 leading-none">0 %</span>
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-semibold leading-none text-secondary"
          style={{ left: `${markerPct}%` }}
        >
          meta 100 %
        </span>
      </div>
      <div className="relative h-3">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-surface-container-high" />
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-pill bg-secondary"
          style={{ left: `calc(${markerPct}% - 1px)` }}
        />
      </div>
    </div>
  );
}

const DeviationBars = memo(function DeviationBars({
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (rows.length === 0) {
    return <p className="py-space-lg text-center text-body-md text-on-surface-variant">Sin artículos para graficar.</p>;
  }

  return (
    <div className="flex flex-col gap-space-2xs">
      <div className="max-h-[520px] overflow-y-auto pr-1">
        <div className="sticky top-0 z-10 border-b border-surface-container bg-surface-container-lowest pb-space-2xs">
          <DeviationScale markerPct={META_MARKER_PCT} />
        </div>
        <ul className="flex flex-col gap-space-2xs">
          {rows.map((row) => {
            const pct = row.projectedAttainmentPct ?? row.attainmentPct;
            const tone = salesTone(pct);
            const geo = salesDeviationGeometry(row);
            // El % mostrado es la proyección: si cruza el marcador, se dice cuánto.
            const overPct = pct !== null && Number.isFinite(pct) && pct > 100 ? pct - 100 : null;
            return (
              <li key={row.productCode}>
                <button
                  type="button"
                  onClick={() => onFocus(row.productCode)}
                  aria-pressed={focus === row.productCode}
                  aria-haspopup="dialog"
                  title={`Ver detalle de ${row.productCode}`}
                  className={cx(
                    'group w-full rounded-xl px-space-xs py-2 text-left transition-all duration-200 hover:bg-surface-container-low',
                    focus === row.productCode && 'bg-surface-container-low ring-1 ring-primary-container/25',
                  )}
                >
                  <div className="flex items-start justify-between gap-space-sm">
                    <span className="flex min-w-0 items-baseline gap-space-xs">
                      <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">{row.productCode}</span>
                      <span className="truncate text-label-sm text-on-surface-variant">{row.description}</span>
                      {row.forecastDriftAt && (
                        <AlertTriangle
                          aria-label="Profit cambió la meta después de la captura"
                          className="size-3 shrink-0 text-warning"
                        />
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end leading-tight">
                      <span className={cx('tabular-nums text-label-md font-bold', TONE_TEXT[tone])}>
                        {geo.hasMeta ? fmtPct(pct) : 'Sin meta'}
                      </span>
                      {overPct !== null && (
                        <span className="whitespace-nowrap text-label-sm font-semibold text-success">
                          +{fmtPct(overPct)} sobre meta
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="relative mt-1.5">
                    <div
                      className={cx(
                        'h-2.5 w-full rounded-pill',
                        geo.hasMeta ? 'bg-surface-container' : 'border border-dashed border-outline-variant/60',
                      )}
                    >
                      {geo.hasMeta && (
                        <div className="relative h-full w-full overflow-hidden rounded-pill">
                          {showProjection && (
                            <div
                              className="absolute inset-y-0 left-0 rounded-pill bg-secondary-container/45 transition-[width] duration-700 ease-out"
                              style={{ width: mounted ? `${geo.projectedWidthPct}%` : '0%' }}
                            />
                          )}
                          <div
                            className="absolute inset-y-0 left-0 rounded-pill bg-primary-container transition-[width] duration-700 ease-out"
                            style={{ width: mounted ? `${geo.actualWidthPct}%` : '0%', transitionDelay: '80ms' }}
                          />
                        </div>
                      )}
                    </div>
                    {geo.hasMeta && (
                      <span
                        aria-hidden
                        className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-pill bg-secondary shadow-[0_0_0_1px_white]"
                        style={{ left: `calc(${geo.markerPct}% - 1px)` }}
                      />
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-space-xs flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Real
        </span>
        {showProjection && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-secondary-container/60" /> Proyección
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-3 w-[2px] rounded-pill bg-secondary" /> Marcador verde = 100 % de la meta
        </span>
        <span className="inline-flex items-center gap-1">
          <AlertTriangle aria-hidden className="size-3 text-warning" /> Meta cambiada en Profit
        </span>
      </div>
    </div>
  );
});

function cumulativeOption(report: ForecastSalesResponse, pinnedDate: string | null = null): Record<string, unknown> {
  const points = buildCumulativeSeries(report);
  const forecastKg = report.totals.forecastKg;
  const labels = points.map((point) => point.label);
  const actual = points.map((point) => point.actual);
  const projected = points.map((point) => point.projected);
  const pace = points.map((point) => point.pace);
  const cutDay = report.asOf ? String(Number(report.asOf.slice(8, 10))) : null;
  const today = String(Number(report.days.today.slice(8, 10)));
  const labelStep = Math.max(1, Math.ceil(labels.length / 10));
  // Día fijado con clic: banda vertical + etiqueta del eje resaltada.
  const pinnedIndex = pinnedDate ? points.findIndex((point) => point.date === pinnedDate) : -1;
  const pinnedLabel = pinnedIndex >= 0 ? labels[pinnedIndex] : null;

  const highlightLine = pinnedLabel
    ? {
        symbol: 'none',
        silent: true,
        animation: false,
        lineStyle: { color: 'rgba(149, 200, 0, 0.22)', type: 'solid', width: 26 },
        label: { show: false },
        z: 0,
        data: [{ xAxis: pinnedLabel }],
      }
    : undefined;

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
        return `<div style="min-width:170px;"><div style="font-weight:700;margin-bottom:2px;">${dayLabel(point.date)}</div>${lines}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: {
        color: C.outline,
        fontSize: 10,
        // Etiquetas cada `labelStep` días, pero el día fijado siempre se ve.
        interval: (index: number, value: string) =>
          (pinnedLabel !== null && value === pinnedLabel) || index % labelStep === 0,
        formatter: (value: string) => (pinnedLabel !== null && value === pinnedLabel ? `{sel|${value}}` : value),
        rich: {
          sel: {
            color: C.navy,
            fontWeight: 'bold',
            fontSize: 10,
            backgroundColor: 'rgba(149,200,0,0.32)',
            borderRadius: 3,
            padding: [2, 3],
          },
        },
      },
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
        markLine: highlightLine,
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
    animationDuration: 450,
    grid: { left: 6, right: 12, top: 26, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -28px rgba(8,29,44,.6);',
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
            color: index === values.length - 1 ? C.navyLight : C.navy,
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
      <div className="grid gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

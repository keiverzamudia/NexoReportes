'use client';

// ============================================================
// «Ventas vs Forecast» — informe ejecutivo del mes.
//
// · Arriba: proyección de cierre (run-rate sobre días hábiles) con anillo de
//   cumplimiento y KPIs.
// · En medio: acumulado real vs proyección vs ritmo del forecast (ECharts),
//   la tira de ventas por día a todo el ancho y desviación por producto
//   (barras animadas, clic para enfocar).
// · Abajo: tabla ordenable con semáforo, sacos para artículos SAC y CSV.
//
// Las cifras las calcula el API (`/forecast/sales`); aquí solo se da formato.
// ============================================================

import type {
  ForecastCustomerSalesResponse,
  ForecastCustomerSalesRow,
  ForecastResponse,
  ForecastSalesResponse,
  ForecastSalesRow,
} from '@nexo/contracts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  ListFilter,
  PackageSearch,
  RotateCw,
  Users,
  X,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { CustomerPicker } from '../CustomerPicker';
import { ProductPicker } from '../ProductPicker';
import { DaySalesModal } from './DaySalesModal';
import {
  CUSTOMER_SALES_COLUMN_HELP,
  CUSTOMER_SALES_HELP_TERMS,
  SALES_COLUMN_HELP,
  SALES_CUSTOMER_HELP_RULES,
  SALES_CUSTOMER_HELP_TITLE,
  SALES_HELP_RULES,
  SALES_HELP_TERMS,
  SALES_HELP_TITLE,
} from '../../content/help/forecast';
import { apiFetch } from '../../lib/api';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Segmented,
  Skeleton,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import {
  META_MARKER_PCT,
  buildCumulativeSeries,
  buildCustomerSalesCsv,
  buildDayBars,
  buildNarrative,
  buildSalesCsv,
  customerSalesCsvFileName,
  dailySalesScale,
  dayLabel,
  dayPendingSharePct,
  filterCustomerSalesRows,
  filterSalesRows,
  fmtKg,
  fmtPct,
  fmtSignedPct,
  fmtTonnes,
  monthLabel,
  monthOverMonthPct,
  pendingCoveragePct,
  salesCsvFileName,
  salesDaysWithSales,
  salesDeviationGeometry,
  salesGap,
  salesTone,
  weeklyForecast,
  type DailySalesScale,
  type SalesDayBar,
  type SalesGapScope,
  type SalesTone,
} from '../../lib/sales-report';
import { useHelpRow } from '../../lib/use-help-row';
import { HERO_TONE } from './seller-ui';

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

/** Colores de la barra de avance sobre el fondo oscuro del hero. */
const GAP_BAR_COLOR = HERO_TONE;

/**
 * Tarjeta «Brecha»: alterna entre la brecha del mes (venta acumulada vs
 * forecast) y la del día en curso (ritmo necesario vs venta de hoy), y
 * acompaña la cifra con su barra de avance.
 */
function GapStat({ report }: { report: ForecastSalesResponse }) {
  const [scope, setScope] = useState<SalesGapScope>('month');
  const gap = useMemo(() => salesGap(report), [report]);
  const canPickDay = report.status === 'OPEN' && gap.dayGoalKg !== null;
  const isDay = canPickDay && scope === 'day';

  const value = isDay ? gap.dayGapKg : gap.monthGapKg;
  const pct = isDay ? gap.dayPct : gap.monthPct;
  const tone = salesTone(pct);
  const filled = pct === null ? 0 : Math.max(0, Math.min(100, pct));

  const display =
    value === null
      ? '—'
      : isDay
        ? value > 0
          ? `faltan ${fmtKg(value)} kg`
          : value === 0
            ? '0 kg'
            : `+${fmtKg(Math.abs(value))} kg`
        : `${value > 0 ? '+' : ''}${fmtKg(value)} kg`;

  const hint = isDay
    ? value !== null && value <= 0
      ? 'objetivo del día cumplido'
      : `objetivo ${fmtKg(gap.dayGoalKg)} kg/día · hoy ${fmtKg(gap.todayKg)} kg`
    : value === null
      ? 'depende de la meta'
      : value >= 0
        ? 'por encima del forecast'
        : 'por debajo del forecast';

  return (
    <div className="rounded-xl bg-white/10 px-space-sm py-space-xs backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-space-2xs gap-y-1">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/55">Brecha</p>
        {canPickDay && (
          <div role="group" aria-label="Escala de la brecha" className="flex shrink-0 rounded-pill bg-white/10 p-0.5">
            {(
              [
                { value: 'month', label: 'Mes' },
                { value: 'day', label: 'Día' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
                className={`rounded-pill px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide transition-colors ${
                  scope === option.value ? 'bg-white/25 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="tabular-nums text-title-md font-bold text-white">{display}</p>
      <p className="text-label-sm text-white/50">{hint}</p>
      <div
        role="progressbar"
        aria-label={isDay ? 'Avance del objetivo del día' : 'Avance de la meta del mes'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(filled)}
        aria-valuetext={fmtPct(pct)}
        className="mt-1 h-1.5 overflow-hidden rounded-pill bg-white/15"
      >
        <span
          aria-hidden
          className="block h-full rounded-pill transition-[width] duration-700 ease-out"
          style={{ width: `${filled}%`, background: GAP_BAR_COLOR[tone] }}
        />
      </div>
      <p className="mt-1 text-[0.6rem] text-white/45">
        {isDay ? 'del objetivo del día' : 'de la meta del mes'} · {fmtPct(pct)}
      </p>
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
  mode = 'product',
  onModeChange,
  customerReport,
  customerLoading = false,
  customerError = null,
  onCustomerRetry,
  forecast,
  forecastLoading = false,
}: {
  report?: ForecastSalesResponse;
  isLoading: boolean;
  error?: Error | null;
  unit: 'ALL' | 'SAC' | 'KG';
  /** Permite aceptar un cambio de meta detectado en Profit. */
  canEdit?: boolean;
  onRetry: () => void;
  /** Producto (informe actual) o cliente (reparto de la meta). */
  mode?: 'product' | 'customer';
  onModeChange?: (mode: 'product' | 'customer') => void;
  customerReport?: ForecastCustomerSalesResponse;
  customerLoading?: boolean;
  customerError?: Error | null;
  onCustomerRetry?: () => void;
  /** Forecast del Asignador (mensual + semanas) del mes del informe. */
  forecast?: ForecastResponse;
  forecastLoading?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithForecast, setOnlyWithForecast] = useState(false);
  const [onlyWithData, setOnlyWithData] = useState(false);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  // Día abierto en el modal de desglose (independiente del pin de la tira).
  const [detailDay, setDetailDay] = useState<string | null>(null);
  const [helpRow, setHelpRow] = useHelpRow();
  // Listas largas: el informe no debe pintar cientos de filas de golpe.
  const [deviationExpanded, setDeviationExpanded] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const customerTableRef = useRef<HTMLDivElement | null>(null);

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

  const filteredCustomers = useMemo(
    () =>
      customerReport
        ? filterCustomerSalesRows(customerReport.customers, {
            search: deferredSearch,
            onlyWithSales,
          })
        : [],
    [customerReport, deferredSearch, onlyWithSales],
  );

  const customerDeviationPreview = useMemo(
    () => (deviationExpanded ? filteredCustomers : filteredCustomers.slice(0, DEVIATION_PREVIEW)),
    [filteredCustomers, deviationExpanded],
  );

  const customerPickerOptions = useMemo(
    () =>
      (customerReport?.customers ?? []).map((customer) => ({
        value: customer.customerCode,
        description: customer.customerName,
        customerType: customer.customerType,
      })),
    [customerReport],
  );

  const openCustomer = useCallback((code: string) => {
    setExpandedCustomer((current) => (current === code ? null : code));
    requestAnimationFrame(() => {
      customerTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

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
  const pendingPct = useMemo(() => (report ? pendingCoveragePct(report) : null), [report]);
  const activeDay = hoverDay ?? pinnedDay;
  const activeBar = useMemo(
    () => (activeDay ? dayBars.find((bar) => bar.date === activeDay) ?? null : null),
    [activeDay, dayBars],
  );
  // Día del modal: sale de `dayBars` para tener kg/notas y el estado del día.
  const detailBar = useMemo(
    () => (detailDay ? dayBars.find((bar) => bar.date === detailDay) ?? null : null),
    [dayBars, detailDay],
  );
  // El clic fija el día y abre el modal si hay venta o pedidos pendientes.
  const openDay = useCallback(
    (date: string) => {
      setPinnedDay(date);
      const bar = dayBars.find((entry) => entry.date === date);
      if (!bar || (bar.kg <= 0 && bar.pendingKg <= 0)) return;
      setDetailDay(date);
    },
    [dayBars],
  );
  const clearPinnedDay = useCallback(() => {
    setPinnedDay(null);
    setHoverDay(null);
    setDetailDay(null);
  }, []);
  const closeDayDetail = useCallback(() => setDetailDay(null), []);

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
      openDay(date);
    },
    [openDay, report],
  );

  // Al cambiar de mes se limpia la selección (las fechas ya no aplican).
  useEffect(() => {
    setPinnedDay(null);
    setHoverDay(null);
    setDetailDay(null);
    setExpandedCustomer(null);
  }, [report?.year, report?.month]);

  // Al cambiar de producto a cliente (o al revés) no se arrastra el foco de la
  // vista anterior.
  useEffect(() => {
    setFocusCode(null);
    setExpandedCustomer(null);
  }, [mode]);

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

  // Forecast del Asignador para el producto enfocado: mes + reparto semanal.
  const focusForecast = useMemo(() => {
    if (!focusRow) return null;
    const row = forecast?.rows.find((entry) => entry.productCode === focusRow.productCode) ?? null;
    const monthlyKg = row?.monthlyQty ?? 0;
    return {
      monthlyKg,
      weekly: weeklyForecast({
        monthKg: monthlyKg,
        weeks: row?.weeks ?? [],
        weekRanges: forecast?.weekRanges ?? [],
        today: report?.days.today ?? null,
        kgPerUom: focusRow.uom === 'SAC' ? focusRow.kgPerUom : null,
      }),
    };
  }, [focusRow, forecast, report?.days.today]);

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
  const customerHasFilters = Boolean(search.trim()) || onlyWithSales;
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
  const basisLabel = report.basis === 'WORKING' ? 'día hábil (lun–sáb)' : 'día calendario';

  // De dónde sale la meta del mes que se muestra en la ficha del producto.
  const focusForecastOrigin = !focusRow
    ? ''
    : !isOpen
      ? 'meta histórica'
      : focusRow.forecastLiveKg !== null
        ? 'Profit en vivo'
        : focusRow.forecastCapturedAt
          ? 'captura local'
          : 'meta guardada';

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

  const downloadCustomers = () => {
    if (!customerReport) return;
    const blob = new Blob([buildCustomerSalesCsv(customerReport)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = customerSalesCsvFileName(customerReport);
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

  const customerColumns: Column<ForecastCustomerSalesRow>[] = [
    {
      key: 'codigo',
      header: 'Código',
      help: CUSTOMER_SALES_COLUMN_HELP.codigo,
      kind: 'id',
      sortValue: (row) => row.customerCode,
      render: (row) => <span className="font-bold tabular-nums text-primary">{row.customerCode}</span>,
    },
    {
      key: 'cliente',
      header: 'Cliente',
      help: CUSTOMER_SALES_COLUMN_HELP.cliente,
      title: (row) => row.customerName,
      render: (row) => (
        <span className="block max-w-[16rem] truncate font-semibold text-on-surface" title={row.customerName}>
          {row.customerName}
        </span>
      ),
    },
    {
      key: 'tipo',
      header: 'Tipo / Vendedor',
      help: CUSTOMER_SALES_COLUMN_HELP.tipo,
      kind: 'field',
      render: (row) => (
        <span className="flex max-w-[13rem] flex-col">
          <span className="truncate text-label-sm font-semibold text-on-surface-variant">{row.customerType ?? 'Sin tipo'}</span>
          <span className="truncate text-label-sm text-outline">{row.vendor ?? 'Sin vendedor'}</span>
        </span>
      ),
    },
    {
      key: 'venta',
      header: 'Venta kg',
      help: CUSTOMER_SALES_COLUMN_HELP.venta,
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
      key: 'participacion',
      header: 'Participación %',
      help: CUSTOMER_SALES_COLUMN_HELP.participacion,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.sharePct,
      render: (row) => (
        <span className={cx('tabular-nums font-bold', row.sharePct > 0 ? 'text-secondary' : 'text-outline')}>
          {fmtPct(row.sharePct)}
        </span>
      ),
    },
    {
      key: 'productos',
      header: 'Productos',
      help: CUSTOMER_SALES_COLUMN_HELP.productos,
      align: 'center',
      kind: 'metric',
      sortValue: (row) => row.productCount,
      render: (row) => <Badge tone="muted">{fmtKg(row.productCount, 0)}</Badge>,
    },
    {
      key: 'ultimaFactura',
      header: 'Última entrega',
      help: CUSTOMER_SALES_COLUMN_HELP.ultimaFactura,
      align: 'right',
      kind: 'detail',
      render: (row) => (
        <span className="whitespace-nowrap text-label-sm text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>
      ),
    },
    {
      key: 'acciones',
      header: '',
      align: 'right',
      kind: 'action',
      render: (row) => (
        <button
          type="button"
          onClick={() => setExpandedCustomer((current) => (current === row.customerCode ? null : row.customerCode))}
          aria-expanded={expandedCustomer === row.customerCode}
          aria-label={`${expandedCustomer === row.customerCode ? 'Ocultar' : 'Ver'} productos de ${row.customerName}`}
          title={expandedCustomer === row.customerCode ? 'Ocultar productos' : 'Ver productos'}
          className="grid size-8 place-items-center rounded-lg text-outline transition-colors hover:bg-surface-container hover:text-primary"
        >
          <ChevronRight
            aria-hidden
            className={cx('size-4 transition-transform', expandedCustomer === row.customerCode && 'rotate-90')}
          />
        </button>
      ),
    },
  ];

  const customerTotals = customerReport?.totals;
  const filteredActiveCustomers = filteredCustomers.filter((customer) => customer.actualKg > 0).length;
  const customerProductCount = filteredCustomers.reduce((acc, customer) => acc + customer.productCount, 0);
  const filteredShare = filteredCustomers.reduce((acc, customer) => acc + customer.sharePct, 0);
  const customerFooter = (
    <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
      <td colSpan={3} className="px-space-sm py-space-xs">
        <span className="flex flex-wrap items-center gap-space-sm uppercase text-label-sm text-outline">
          Totales {filteredCustomers.length !== (customerReport?.customers.length ?? 0) ? `(${filteredCustomers.length} filtrados)` : 'globales'}
          <Badge tone="primary" dot>
            {fmtKg(filteredActiveCustomers, 0)} con venta
          </Badge>
        </span>
      </td>
      <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtKg(customerTotals?.actualKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtPct(filteredShare)}</td>
      <td className="px-space-sm py-space-xs text-center">{fmtKg(customerProductCount, 0)}</td>
      <td className="px-space-sm py-space-xs text-right text-label-sm text-on-surface-variant">
        {customerTotals?.lastInvoiceDate ? fmtDate(customerTotals.lastInvoiceDate) : '—'}
      </td>
      <td />
    </tr>
  );

  const customerMobileSummary = (
    <div className="grid grid-cols-2 gap-space-sm border-t border-surface-container px-space-lg py-space-md text-body-md">
      <span className="text-outline">Venta kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(customerTotals?.actualKg)}</span>
      <span className="text-outline">Participación visible</span>
      <span className="text-right font-bold tabular-nums">{fmtPct(filteredShare)}</span>
      <span className="text-outline">Clientes con venta</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(filteredActiveCustomers, 0)}</span>
      <span className="text-outline">Productos</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(customerProductCount, 0)}</span>
    </div>
  );

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

      {mode === 'customer' && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-primary-fixed/30 px-space-md py-space-sm text-body-md text-primary">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          El acumulado y los KPIs superiores son de la empresa. La desviación y la tabla de abajo son por cliente, con la
          meta de cada producto repartida según su histórico de compra.
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
                <span
                  className="font-display tabular-nums text-[3.4rem] font-black leading-none tracking-tight"
                  style={{ color: tone === 'none' ? 'rgb(255 255 255 / 0.75)' : HERO_TONE[tone] }}
                >
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
              <GapStat report={report} />
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
                {report.daily.length > 0 && (totals.actualKg > 0 || totals.pendingKg > 0)
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
            {report.daily.length > 0 && (totals.actualKg > 0 || totals.pendingKg > 0) ? (
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
                  pendingSharePct={pendingPct}
                  fallbackSummary={`${daysWithSales.length} días con venta · ${fmtKg(totals.actualKg)} kg · ${fmtKg(
                    totals.invoiceCount,
                  )} notas${totals.pendingKg > 0 ? ` · ${fmtKg(totals.pendingKg)} kg en pedidos pendientes` : ''}`}
                  onHover={setHoverDay}
                  onPin={openDay}
                  onClear={clearPinnedDay}
                />
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
                <div className="flex flex-wrap items-center gap-space-sm">
                  <h2 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                    <ListFilter aria-hidden className="size-4 shrink-0 text-primary" />
                    {mode === 'customer' ? 'Participación por cliente' : 'Desviación por producto'}
                  </h2>
                  <Segmented
                    ariaLabel="Ver el informe por"
                    value={mode}
                    onChange={(value) => onModeChange?.(value)}
                    options={[
                      { value: 'product', label: 'Por producto' },
                      { value: 'customer', label: 'Por cliente' },
                    ]}
                  />
                </div>
                <p className="text-label-md text-on-surface-variant">
                  {mode === 'customer' ? (
                    <>
                      {customerHasFilters
                        ? `${fmtKg(filteredCustomers.length, 0)} de ${fmtKg(customerReport?.customers.length ?? 0, 0)} clientes · % de la venta ABA del mes a la fecha`
                        : `${fmtKg(customerReport?.customers.length ?? 0, 0)} clientes · % de la venta ABA del mes a la fecha`}
                      <span className="block text-outline">Haz clic en un cliente para resaltarlo y expandir sus productos.</span>
                    </>
                  ) : (
                    <>
                      {hasDeviationFilters
                        ? `${fmtKg(filtered.length, 0)} de ${fmtKg(report.rows.length, 0)} artículos · cada barra se mide contra su meta`
                        : `${fmtKg(report.rows.length, 0)} artículos · cada barra se mide contra su meta`}
                      <span className="block text-outline">Haz clic en un artículo para abrir su detalle.</span>
                    </>
                  )}
                </p>
              </div>
              <Badge tone="primary">
                {mode === 'customer'
                  ? `${fmtKg(filteredActiveCustomers, 0)} con venta`
                  : `${fmtKg(filtered.length, 0)} art.`}
              </Badge>
            </div>

            <div
              className="mt-space-sm flex flex-wrap items-center gap-space-2xs"
              role="group"
              aria-label={mode === 'customer' ? 'Filtros de participación por cliente' : 'Filtros de la desviación por producto'}
            >
              <TextInput
                icon={PackageSearch}
                value={search}
                onChange={setSearch}
                placeholder={mode === 'customer' ? 'Buscar código o cliente…' : 'Buscar código o descripción…'}
                ariaLabel={mode === 'customer' ? 'Buscar cliente' : 'Buscar producto en la desviación'}
                className="min-w-[12rem] flex-1"
              />
              {mode === 'customer' ? (
                <FilterChip active={onlyWithSales} onClick={() => setOnlyWithSales((value) => !value)} label="Con venta" />
              ) : (
                <>
                  <FilterChip active={onlyWithData} onClick={() => setOnlyWithData((value) => !value)} label="Con datos" />
                  <FilterChip
                    active={onlyWithForecast}
                    onClick={() => setOnlyWithForecast((value) => !value)}
                    label="Con forecast"
                  />
                  <FilterChip active={onlyWithSales} onClick={() => setOnlyWithSales((value) => !value)} label="Con venta" />
                </>
              )}
              {(mode === 'customer' ? customerHasFilters : hasDeviationFilters) && (
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
            {mode === 'customer' ? (
              <>
                {customerLoading && !customerReport && <CustomerDeviationSkeleton />}
                {customerError && !customerReport && (
                  <div className="flex flex-col items-start gap-space-sm rounded-xl bg-critical-container/50 p-space-sm">
                    <p role="alert" className="flex items-center gap-space-sm text-body-md text-on-critical-container">
                      <AlertTriangle aria-hidden className="size-4" />
                      No se pudo cargar la participación por cliente: {customerError.message}
                    </p>
                    <button
                      type="button"
                      onClick={onCustomerRetry}
                      className="inline-flex h-8 items-center gap-space-2xs rounded-lg bg-primary-container px-space-sm text-label-sm font-semibold text-on-primary"
                    >
                      <RotateCw aria-hidden className="size-3.5" /> Reintentar
                    </button>
                  </div>
                )}
                {customerReport && !customerReport.salesAvailable && (
                  <div className="flex flex-col items-start gap-space-sm rounded-xl bg-warning-container/50 p-space-sm">
                    <p role="status" className="flex items-start gap-space-sm text-body-md text-on-warning-container">
                      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                      No se pudieron leer los despachos por cliente. No se muestran cifras parciales.
                    </p>
                    <button
                      type="button"
                      onClick={onCustomerRetry}
                      className="inline-flex h-8 items-center gap-space-2xs rounded-lg bg-primary-container px-space-sm text-label-sm font-semibold text-on-primary"
                    >
                      <RotateCw aria-hidden className="size-3.5" /> Reintentar
                    </button>
                  </div>
                )}
                {customerReport?.salesAvailable && (
                  <>
                    <CustomerShareBars
                      rows={customerDeviationPreview}
                      focus={expandedCustomer}
                      onFocus={openCustomer}
                    />
                    {customerReport.truncated && (
                      <p role="status" className="mt-space-xs rounded-lg bg-warning-container/50 px-space-sm py-space-2xs text-label-sm text-on-warning-container">
                        La consulta alcanzó el límite de filas: el detalle puede estar incompleto.
                      </p>
                    )}
                    {filteredCustomers.length > DEVIATION_PREVIEW && (
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
                          : `Ver los ${fmtKg(filteredCustomers.length, 0)} clientes`}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Card>
      </div>

      {detailDay && detailBar && (
        <DaySalesModal
          key={detailDay}
          date={detailDay}
          bar={detailBar}
          report={report}
          goalKg={dayScale.goalKg}
          onClose={closeDayDetail}
        />
      )}

      {mode === 'product' && focusRow && (
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
                    <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-[#95C800]" /> Meta de cada mes
                  </span>
                  {focusRow.history.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className="h-0.5 w-3 rounded-pill bg-[#dc2626]" /> Crecimiento % vs mes anterior
                    </span>
                  )}
                </div>
                <EChart option={focusOption} height={250} ariaLabel={`Histórico de ventas de ${focusRow.productCode}`} />
                <p className="mt-space-2xs text-label-sm text-outline">
                  El guion verde es la meta de ese mes y el tramo verde de la barra, lo que la superó; la línea roja es la
                  variación % contra el mes anterior.
                </p>
              </div>

              {/* Forecast del mes y su reparto semanal (Asignador). */}
              <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
                <header className="flex flex-wrap items-start justify-between gap-space-sm">
                  <div className="min-w-0">
                    <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">Forecast del mes</p>
                    <p className="tabular-nums text-headline-md font-black text-primary">
                      {focusRow.forecastKg > 0 ? `${fmtKg(focusRow.forecastKg)} kg` : '—'}
                    </p>
                    <p className="text-label-sm text-on-surface-variant">
                      {focusRow.forecastKg > 0
                        ? `${focusForecastOrigin}${
                            focusRow.forecastCapturedAt
                              ? ` · capturada ${fmtDate(focusRow.forecastCapturedAt.slice(0, 10))}`
                              : ''
                          }`
                        : 'sin meta para el mes'}
                    </p>
                  </div>
                  {focusForecast?.weekly.hasSplit &&
                    Math.abs(focusForecast.weekly.totalKg - focusRow.forecastKg) > 1 && (
                      <Badge tone="muted">Desglose {fmtKg(focusForecast.weekly.totalKg)} kg</Badge>
                    )}
                </header>

                <div className="my-space-sm h-px bg-surface-container" />

                <div className="flex flex-wrap items-baseline justify-between gap-space-2xs">
                  <h3 className="text-label-md font-bold text-on-surface">Forecast semanal</h3>
                  <p className="text-label-sm text-outline">Semanas del Asignador · por defecto mes ÷ 4</p>
                </div>

                {focusForecast?.weekly.hasSplit ? (
                  <>
                    <div className="mt-space-2xs grid grid-cols-2 gap-space-2xs sm:grid-cols-4">
                      {focusForecast.weekly.tiles.map((tile) => (
                        <div
                          key={tile.weekIndex}
                          className={cx(
                            'rounded-xl border p-space-2xs',
                            tile.isCurrent
                              ? 'border-secondary-container bg-secondary-container/10'
                              : 'border-outline-variant/30 bg-surface',
                          )}
                        >
                          <p className="flex items-baseline justify-between gap-1 text-label-sm font-semibold uppercase text-outline">
                            <span>S{tile.weekIndex}</span>
                            {tile.isCurrent && <span className="normal-case text-secondary">en curso</span>}
                          </p>
                          <p className="tabular-nums text-title-md font-black text-on-surface">{fmtKg(tile.kg)} kg</p>
                          <p className="text-label-sm text-on-surface-variant">{tile.rangeLabel}</p>
                          <p className="text-label-sm text-outline">
                            {tile.pctOfMonth === null ? '—' : `${fmtPct(tile.pctOfMonth)} del mes`}
                            {tile.sacks !== null ? ` · ${fmtKg(tile.sacks)} sacos` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-space-2xs text-label-sm text-outline">
                      Se ajustan en la pestaña Asignador; el forecast mensual lo administra Profit.
                    </p>
                  </>
                ) : (
                  <p className="mt-space-2xs text-label-sm text-on-surface-variant">
                    {forecastLoading
                      ? 'Cargando desglose semanal…'
                      : `Profit no trae desglose semanal para ${monthLabel(report.year, report.month)}.`}
                  </p>
                )}
              </section>

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
                  label={isOpen ? 'Ritmo necesario' : 'Brecha'}
                  value={
                    isOpen
                      ? focusRow.requiredDailyKg === null
                        ? '—'
                        : `${fmtKg(focusRow.requiredDailyKg)} kg/día`
                      : focusRow.gapKg === null
                        ? '—'
                        : `${focusRow.gapKg > 0 ? '+' : ''}${fmtKg(focusRow.gapKg)} kg`
                  }
                  hint={
                    isOpen
                      ? focusRow.requiredDailyKg === null
                        ? 'sin meta'
                        : 'para cerrar el forecast del mes'
                      : focusRow.gapKg === null
                        ? report.status === 'FUTURE'
                          ? 'aún sin venta en el mes'
                          : 'sin meta'
                        : 'cierre real menos meta'
                  }
                  tone={isOpen ? 'warn' : focusRow.gapKg === null ? 'none' : focusRow.gapKg < 0 ? 'bad' : 'good'}
                />
              </div>
            </div>
          </aside>
        </>
      )}

      {/* ---------- Tabla ---------- */}
      <Card className="overflow-hidden">
        <div
          ref={customerTableRef}
          className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container px-space-md py-space-sm"
        >
          <div className="flex flex-wrap items-center gap-space-sm text-label-md text-on-surface-variant">
            <span>
              {mode === 'customer' ? (
                customerHasFilters ? (
                  <>
                    <strong className="tabular-nums text-on-surface">{fmtKg(filteredCustomers.length, 0)}</strong> de{' '}
                    <strong className="tabular-nums text-on-surface">{fmtKg(customerReport?.customers.length ?? 0, 0)}</strong> clientes
                  </>
                ) : (
                  <>
                    <strong className="tabular-nums text-on-surface">{fmtKg(customerReport?.customers.length ?? 0, 0)}</strong> clientes
                  </>
                )
              ) : hasDeviationFilters ? (
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
            {(mode === 'customer' ? customerHasFilters : hasDeviationFilters) && (
              <button
                type="button"
                onClick={clearDeviationFilters}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-space-xs font-semibold text-primary transition-colors hover:bg-primary-container/10"
              >
                <X aria-hidden className="size-3.5" /> Limpiar filtros
              </button>
            )}
            <span className="hidden text-outline md:inline">
              Los filtros se aplican desde «{mode === 'customer' ? 'Participación por cliente' : 'Desviación por producto'}».
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="w-full sm:w-64">
              {mode === 'customer' ? (
                <CustomerPicker
                  value={expandedCustomer}
                  onChange={(code) => (code ? openCustomer(code) : setExpandedCustomer(null))}
                  options={customerPickerOptions}
                  allLabel={`Todos los clientes (${customerReport?.customers.length ?? 0})`}
                />
              ) : (
                <ProductPicker
                  value={focusCode}
                  onChange={(code) => (code ? openProduct(code) : closeProduct())}
                  options={pickerOptions}
                  allLabel="Todos los productos"
                />
              )}
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
              title={mode === 'customer' ? SALES_CUSTOMER_HELP_TITLE : SALES_HELP_TITLE}
              narrative={
                mode === 'customer'
                  ? customerReport
                    ? `${fmtKg(customerReport.totals.actualKg)} kg vendidos en el mes a la fecha entre ${fmtKg(customerReport.totals.activeCustomerCount, 0)} clientes con venta. La participación se mide contra el total ABA.`
                    : 'Cargando participación por cliente…'
                  : narrative
              }
              rules={mode === 'customer' ? SALES_CUSTOMER_HELP_RULES : SALES_HELP_RULES}
              terms={mode === 'customer' ? CUSTOMER_SALES_HELP_TERMS : SALES_HELP_TERMS}
            />
            <button
              type="button"
              onClick={mode === 'customer' ? downloadCustomers : download}
              disabled={mode === 'customer' && !customerReport}
              className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download aria-hidden className="size-4" /> CSV
            </button>
          </div>
        </div>

        {mode === 'customer' ? (
          <DataTable<ForecastCustomerSalesRow>
            columns={customerColumns}
            rows={filteredCustomers}
            rowKey={(row) => row.customerCode}
            expandedKey={expandedCustomer}
            renderExpanded={(row) => <CustomerProductsTable row={row} />}
            empty={
              <EmptyState
                icon={Users}
                title={customerError ? 'No se pudo cargar la participación por cliente' : 'Sin clientes registrados'}
                description={
                  customerLoading
                    ? 'Consultando ventas por cliente en Profit…'
                    : customerError
                      ? customerError.message
                      : customerHasFilters
                        ? 'Ningún cliente coincide con los filtros. Prueba a limpiar la búsqueda.'
                        : 'Profit no reporta entregas ABA por cliente para el rango consultado.'
                }
                action={
                  customerError ? (
                    <button
                      type="button"
                      onClick={onCustomerRetry}
                      className="text-label-md font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Reintentar
                    </button>
                  ) : customerHasFilters ? (
                    <button
                      type="button"
                      onClick={clearDeviationFilters}
                      className="text-label-md font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Limpiar filtros
                    </button>
                  ) : undefined
                }
              />
            }
            footer={customerFooter}
            mobileSummary={customerMobileSummary}
            showHelpRow={helpRow}
          />
        ) : (
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
                      onClick={clearDeviationFilters}
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
        )}
      </Card>

      <p className="flex flex-wrap items-center gap-space-sm px-space-2xs text-label-sm text-on-surface-variant">
        {mode === 'customer' ? (
          <>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Venta real
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-secondary" /> Participación sobre la venta ABA
            </span>
            <span className="text-outline">·</span>
            El 100 % es la venta ABA del mes hasta el corte. La barra se compara con el cliente de mayor participación;
            la etiqueta muestra el porcentaje real. Los sacos no se suman con kg.
          </>
        ) : (
          <>
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
          </>
        )}
      </p>
    </div>
  );
}

function CustomerProductsTable({ row }: { row: ForecastCustomerSalesRow }) {
  if (row.products.length === 0) {
    return <p className="px-space-xs py-2 text-label-md text-outline">El cliente no tiene venta de productos en el mes a la fecha.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-label-md">
        <caption className="sr-only">Productos de {row.customerName}</caption>
        <thead>
          <tr className="text-label-sm uppercase tracking-[0.1em] text-outline">
            <th scope="col" className="py-1 text-left font-semibold">Producto</th>
            <th scope="col" className="py-1 text-center font-semibold">UOM</th>
            <th scope="col" className="py-1 text-right font-semibold">Venta kg</th>
            <th scope="col" className="py-1 text-right font-semibold">Unidades</th>
            <th scope="col" className="py-1 text-right font-semibold">Sacos</th>
            <th scope="col" className="py-1 text-right font-semibold">% del cliente</th>
            <th scope="col" className="py-1 text-right font-semibold">% del producto</th>
          </tr>
        </thead>
        <tbody>
          {row.products.map((product) => (
            <tr key={product.productCode} className="border-t border-surface-container/70">
              <td className="py-1 pr-2">
                <span className="block truncate text-on-surface">{product.description}</span>
                <span className="text-label-sm text-outline">{product.productCode}</span>
              </td>
              <td className="py-1 text-center text-on-surface-variant">{product.uom}</td>
              <td className="py-1 text-right tabular-nums font-semibold text-primary">{fmtKg(product.kg)}</td>
              <td className="py-1 text-right tabular-nums text-on-surface-variant">{fmtKg(product.units)}</td>
              <td className="py-1 text-right tabular-nums text-on-surface-variant">
                {product.sacks === null ? '—' : fmtKg(product.sacks, 1)}
              </td>
              <td className="py-1 text-right tabular-nums">{fmtPct(product.shareOfCustomerPct)}</td>
              <td className="py-1 text-right tabular-nums text-secondary">{fmtPct(product.shareOfProductPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerDeviationSkeleton() {
  return (
    <div className="flex flex-col gap-space-2xs" aria-label="Cargando participación por cliente">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-1.5 py-2">
          <div className="flex items-center justify-between gap-space-sm">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-2.5 w-full" />
        </div>
      ))}
    </div>
  );
}

const CustomerShareBars = memo(function CustomerShareBars({
  rows,
  focus,
  onFocus,
}: {
  rows: ForecastCustomerSalesRow[];
  focus: string | null;
  onFocus: (code: string) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (rows.length === 0) {
    return <p className="py-space-lg text-center text-body-md text-on-surface-variant">Sin clientes para graficar.</p>;
  }

  const maxShare = Math.max(1, ...rows.map((row) => row.sharePct));

  return (
    <div className="flex flex-col gap-space-2xs">
      <div className="max-h-[520px] overflow-y-auto pr-1">
        <div className="sticky top-0 z-10 border-b border-surface-container bg-surface-container-lowest pb-space-2xs text-label-sm text-outline">
          <div className="flex items-center justify-between gap-space-sm px-space-xs py-1">
            <span>Barra relativa al cliente líder</span>
            <span className="font-semibold text-secondary">100 % = venta ABA del mes</span>
          </div>
        </div>
        <ul className="flex flex-col gap-space-2xs">
          {rows.map((row) => (
            <li key={row.customerCode}>
              <button
                type="button"
                onClick={() => onFocus(row.customerCode)}
                aria-pressed={focus === row.customerCode}
                title={`Ver productos de ${row.customerName}`}
                className={cx(
                  'group w-full rounded-xl px-space-xs py-2 text-left transition-all duration-200 hover:bg-surface-container-low',
                  focus === row.customerCode && 'bg-surface-container-low ring-1 ring-primary-container/25',
                )}
              >
                <div className="flex items-start justify-between gap-space-sm">
                  <span className="flex min-w-0 items-baseline gap-space-xs">
                    <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">{row.customerCode}</span>
                    <span className="truncate text-label-sm text-on-surface-variant">{row.customerName}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end leading-tight">
                    <span className="tabular-nums text-label-md font-bold text-secondary">{fmtPct(row.sharePct)}</span>
                    <span className="text-label-sm text-outline">{fmtKg(row.actualKg)} kg</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full rounded-pill bg-surface-container">
                  <div
                    className="h-full rounded-pill bg-secondary transition-[width] duration-700 ease-out"
                    style={{ width: mounted ? `${(row.sharePct / maxShare) * 100}%` : '0%' }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-space-xs flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-secondary" /> Participación sobre la venta ABA
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Código del cliente
        </span>
        <span className="text-outline">La etiqueta muestra el % real del total; la barra se compara con el líder.</span>
      </div>
    </div>
  );
});

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

/** Alto de la pista de barras y de la fila de días. */
const BAR_AREA_PX = 148;
const DAY_LABEL_PX = 22;

/**
 * Tira de ventas por día: una columna por día del mes. El ancho es fluido —
 * los días se reparten el espacio disponible del panel, igual que el eje X de
 * la gráfica de acumulado, así el mes completo entra sin scroll. Cada barra se
 * apila: abajo la venta real de Profit y arriba el pronóstico de los pedidos
 * pendientes en su fecha de entrega efectiva. Comparte `activeDate`/`pinnedDate`
 * con la gráfica, así el clic arriba marca la barra y el clic en la barra fija
 * el día en la línea.
 */
const DailySalesBars = memo(function DailySalesBars({
  bars,
  scale,
  activeDate,
  pinnedDate,
  pendingSharePct,
  fallbackSummary,
  onHover,
  onPin,
  onClear,
}: {
  bars: SalesDayBar[];
  scale: DailySalesScale;
  activeDate: string | null;
  pinnedDate: string | null;
  /** % del forecast del mes ya comprometido en pedidos pendientes. */
  pendingSharePct: number | null;
  fallbackSummary: string;
  onHover: (date: string | null) => void;
  onPin: (date: string) => void;
  /** Quita el día fijado y cierra el modal de desglose. */
  onClear: () => void;
}) {
  const plot = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Ancho real del área de barras: define cuánto ocupa cada día.
  useEffect(() => {
    const node = plot.current;
    if (!node) return;
    const measure = () => setPlotWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (bars.length === 0) return null;

  // Días a mostrar con número: si la ranura se estrecha, se rotula 1 de cada N.
  const slot = plotWidth > 0 ? plotWidth / bars.length : 0;
  const labelEvery = slot >= 24 || slot === 0 ? 1 : slot >= 16 ? 2 : slot >= 11 ? 3 : 0;

  const goalPct =
    scale.goalKg !== null && scale.maxKg > 0 ? Math.min(100, (scale.goalKg / scale.maxKg) * 100) : null;
  const activeBar = activeDate ? bars.find((bar) => bar.date === activeDate) ?? null : null;
  const pendingTotal = bars.reduce((acc, bar) => acc + bar.pendingKg, 0);
  const summary = activeBar
    ? `${dayLabel(activeBar.date)}${activeBar.partial ? ' · en curso' : ''} · ${fmtKg(activeBar.kg)} kg · ${fmtKg(
        activeBar.invoices,
      )} notas${
        activeBar.pendingKg > 0
          ? ` · ${fmtKg(activeBar.pendingKg)} kg en ${fmtKg(activeBar.pendingOrders)} pedidos (${fmtPct(
              dayPendingSharePct(activeBar),
            )} del día)`
          : ''
      }`
    : fallbackSummary;

  return (
    <section aria-label="Ventas por día" className="mt-space-sm border-t border-surface-container pt-space-sm">
      <header className="mb-space-xs flex flex-wrap items-center justify-between gap-space-sm px-space-xs">
        <div className="min-w-0">
          <h3 className="text-label-sm font-bold uppercase tracking-[0.14em] text-outline">Ventas por día</h3>
          <p className="text-label-md text-on-surface-variant">{summary}</p>
          <p className="text-label-sm text-outline">Clic en una barra para abrir el desglose por producto y cliente.</p>
        </div>
        {pinnedDate && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-7 items-center gap-1 rounded-pill border border-outline-variant/40 px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-3.5" /> Ver todo el mes
          </button>
        )}
      </header>

      <div className="flex items-start gap-1.5 pl-space-xs pr-4">
        {/* Eje de kg/día: mismo margen izquierdo que el eje Y de la gráfica. */}
        <div
          aria-hidden
          className="relative w-9 shrink-0 text-right text-[10px] tabular-nums text-outline"
          style={{ height: BAR_AREA_PX }}
        >
          <span className="absolute right-0 top-0 -translate-y-1/2 leading-none">{compact(scale.maxKg)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 leading-none">{compact(scale.maxKg / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2 leading-none">0</span>
        </div>

        <div ref={plot} role="group" aria-label="Días del mes" className="min-w-0 flex-1">
          <div className="relative w-full">
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

            <ul className="relative flex w-full items-end" style={{ height: BAR_AREA_PX + DAY_LABEL_PX }}>
              {bars.map((bar, index) => {
                const isActive = activeDate === bar.date;
                const isPinned = pinnedDate === bar.date;
                // Barra apilada: venta real abajo y pronóstico de pedidos arriba.
                const realHeight =
                  bar.kg > 0
                    ? Math.max(3, (bar.kg / scale.maxKg) * BAR_AREA_PX)
                    : bar.pendingKg > 0
                      ? 0
                      : 2;
                const pendingHeight =
                  bar.pendingKg > 0 ? Math.max(3, (bar.pendingKg / scale.maxKg) * BAR_AREA_PX) : 0;
                // Evita números pegados cuando el mes se reparte en poco ancho.
                const showLabel =
                  labelEvery === 0
                    ? isPinned || bar.isToday
                    : isPinned || bar.isToday || index % labelEvery === 0;

                return (
                  <li key={bar.date} className="min-w-0 flex-1" style={{ height: BAR_AREA_PX + DAY_LABEL_PX }}>
                    <button
                      type="button"
                      aria-pressed={isPinned}
                      aria-label={`Día ${bar.dayNumber}: ${fmtKg(bar.kg)} kg, ${fmtKg(bar.invoices)} notas${
                        bar.pendingKg > 0
                          ? `, ${fmtKg(bar.pendingKg)} kg en ${fmtKg(bar.pendingOrders)} pedidos pendientes`
                          : ''
                      }${bar.partial ? ', día en curso' : bar.future ? ', día futuro' : ''}`}
                      onClick={() => onPin(bar.date)}
                      onMouseEnter={() => onHover(bar.date)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(bar.date)}
                      onBlur={() => onHover(null)}
                      className={cx(
                        'group flex h-full w-full flex-col items-center justify-end rounded-md px-px pb-0 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70',
                        isActive ? 'bg-surface-container-low' : 'hover:bg-surface-container-low/60',
                      )}
                    >
                      <span className="flex w-full items-end justify-center" style={{ height: BAR_AREA_PX }}>
                        <span
                          aria-hidden
                          className={cx(
                            'relative flex w-full max-w-[18px] flex-col justify-end overflow-hidden rounded-t-[4px] transition-[height] duration-500 ease-out',
                            isPinned && 'ring-2 ring-secondary ring-offset-1',
                            isActive && !isPinned && 'ring-1 ring-primary/30',
                          )}
                          style={{ height: mounted ? realHeight + pendingHeight : 0 }}
                        >
                          {bar.pendingKg > 0 && (
                            <span
                              className="w-full border-t border-dashed border-white/70"
                              style={{ height: mounted ? pendingHeight : 0, background: C.amber }}
                            />
                          )}
                          {realHeight > 0 && (
                            <span
                              className={cx(
                                'relative w-full',
                                bar.future
                                  ? 'bg-surface-container-high/60'
                                  : bar.kg <= 0
                                    ? 'bg-surface-container-high'
                                    : bar.partial
                                      ? 'bg-primary-container/45'
                                      : 'bg-primary-container',
                              )}
                              style={{ height: realHeight }}
                            >
                              {bar.partial && bar.kg > 0 && (
                                <span className="absolute inset-x-0 top-0 h-1 bg-secondary" />
                              )}
                            </span>
                          )}
                        </span>
                      </span>
                      <span
                        className={cx(
                          'flex h-[22px] w-full items-center justify-center whitespace-nowrap rounded-pill text-[10px] tabular-nums',
                          isPinned
                            ? 'bg-primary-container font-bold text-white'
                            : bar.isToday
                              ? 'font-bold text-primary'
                              : bar.future
                                ? 'text-outline/55'
                                : 'text-outline',
                        )}
                      >
                        {showLabel ? bar.dayNumber : ''}
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
        {pendingTotal > 0 && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full" style={{ background: C.amber }} />
            Pedidos por entregar {fmtKg(pendingTotal)} kg
            {pendingSharePct !== null ? ` · ${fmtPct(pendingSharePct)} del forecast` : ''}
          </span>
        )}
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
function DeviationScale({ markerPct, metaLabel = 'meta 100 %' }: { markerPct: number; metaLabel?: string }) {
  return (
    <div className="px-space-xs">
      <div className="relative h-4 text-label-sm text-outline">
        <span className="absolute left-0 top-0 leading-none">0 %</span>
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-semibold leading-none text-secondary"
          style={{ left: `${markerPct}%` }}
        >
          {metaLabel}
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

interface CustomSeriesApi {
  value: (dimension: number) => number;
  coord: (point: number[]) => [number, number];
  size: (range: [number, number]) => [number, number];
}

function historyOption(report: ForecastSalesResponse, row: ForecastSalesRow): Record<string, unknown> {
  const categories = [
    ...row.history.map((entry) => monthLabel(entry.year, entry.month, true)),
    monthLabel(report.year, report.month, true),
  ];
  const values = [...row.history.map((entry) => entry.actualKg), row.actualKg];
  // Meta de cada mes: snapshot histórico y, en el mes del informe, su meta.
  const targets = [...row.history.map((entry) => entry.forecastKg), row.forecastKg > 0 ? row.forecastKg : null];
  const lastIndex = values.length - 1;
  // Variación % contra el mes anterior. El mes en curso entra con su venta
  // parcial: mientras se vende, el punto sube/baja como un mes más.
  const growth = monthOverMonthPct(values);
  const numericGrowth = growth.filter((value): value is number => value !== null);
  const hasGrowth = numericGrowth.length > 0;
  const growthSpan = numericGrowth.length > 0 ? Math.max(...numericGrowth) - Math.min(...numericGrowth) : 0;
  const growthPad = Math.max(6, growthSpan * 0.18);
  const growthMin = hasGrowth ? Math.min(0, ...numericGrowth) - growthPad : 0;
  const growthMax = hasGrowth ? Math.max(0, ...numericGrowth) + growthPad : 0;
  const numericTargets = targets.filter((value): value is number => value !== null);
  // Incluye la meta en la escala para que los guiones no se corten.
  const axisMax = Math.max(...values, ...numericTargets, 1) * 1.08;
  // Meses con meta: cada barra lleva su propio guion, sin unirlos entre meses.
  const metaMarks = targets.flatMap((target, index) =>
    target !== null && target > 0 ? [[index, target, values[index]]] : [],
  );

  const tipRow = (name: string, value: string, color = '#fff') =>
    `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;">
      <span style="color:rgba(255,255,255,.72);">${name}</span>
      <strong style="font-variant-numeric:tabular-nums;color:${color};">${value}</strong>
    </div>`;

  return {
    animationDuration: 450,
    grid: { left: 6, right: 8, top: 26, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(8, 29, 44, 0.94)',
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -28px rgba(8,29,44,.6);',
      formatter: (params: Array<{ dataIndex?: number }>) => {
        const index = params[0]?.dataIndex ?? 0;
        const label =
          index === lastIndex ? `${monthLabel(report.year, report.month)} (en curso)` : categories[index];
        const meta = targets[index] ?? null;
        const actual = values[index] ?? 0;
        const delta = meta !== null && meta > 0 ? actual - meta : null;
        const growthPct = growth[index] ?? null;
        const lines = [tipRow('Venta real', `${fmtKg(actual)} kg`)];
        if (delta !== null && meta !== null) {
          lines.push(tipRow('Meta del mes', `${fmtKg(meta)} kg`, '#d9f99d'));
          if (delta > 0) {
            lines.push(
              tipRow('Sobrepasó', `+${fmtKg(delta)} kg (${fmtSignedPct((delta / meta) * 100)})`, '#d9f99d'),
            );
          } else if (delta < 0) {
            lines.push(
              tipRow('Faltó', `-${fmtKg(Math.abs(delta))} kg (${fmtSignedPct((delta / meta) * 100)})`, '#fca5a5'),
            );
          } else {
            lines.push(tipRow('Meta', 'cumplida exacta', '#d9f99d'));
          }
        } else {
          lines.push(tipRow('Meta del mes', 'sin meta', 'rgba(255,255,255,.6)'));
        }
        if (growthPct !== null && index > 0) {
          lines.push(tipRow('Crecimiento', `${fmtSignedPct(growthPct)} vs ${categories[index - 1]}`, '#fca5a5'));
        }
        return `<div style="min-width:190px;"><strong>${label}</strong>${lines.join('')}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: '#d6ebff' } },
      axisTick: { show: false },
      axisLabel: { color: C.outline, fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value',
        max: axisMax,
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.outline, fontSize: 10, formatter: (value: number) => compact(value) },
      },
      ...(hasGrowth
        ? [
            {
              type: 'value',
              position: 'right',
              min: growthMin,
              max: growthMax,
              splitLine: { show: false },
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: {
                color: '#b91c1c',
                fontSize: 9,
                formatter: (value: number) => `${Math.round(value)} %`,
              },
            },
          ]
        : []),
    ],
    series: [
      {
        name: 'Venta real',
        type: 'bar',
        barMaxWidth: 38,
        data: values.map((value, index) => ({
          value,
          itemStyle: {
            color: index === lastIndex ? C.navyLight : C.navy,
            borderRadius: [6, 6, 0, 0],
          },
        })),
      },
      {
        // Guion de meta por barra: si la barra la supera, el tramo de exceso
        // se tiñe de verde sobre la barra en vez de alargar la línea.
        name: 'Meta',
        type: 'custom',
        silent: true,
        tooltip: { show: false },
        data: metaMarks,
        z: 4,
        renderItem: (_params: unknown, api: CustomSeriesApi) => {
          const index = api.value(0);
          const meta = api.value(1);
          const actual = api.value(2);
          if (!Number.isFinite(meta)) return null;
          const [cx, cy] = api.coord([index, meta]);
          const band = api.size([1, 0])[0] ?? 0;
          // Misma geometría que la barra de ECharts: 69 % de la banda, tope
          // `barMaxWidth` (38 px). Si cambia cualquiera de los dos, cambia aquí.
          const barWidth = Math.min(band * 0.69, 38);
          const half = Math.max(barWidth, 10) / 2 + 3;
          const children: Array<Record<string, unknown>> = [];
          if (Number.isFinite(actual) && actual > meta) {
            const [topY] = api.coord([index, actual]);
            children.push({
              type: 'rect',
              shape: {
                x: cx - barWidth / 2,
                y: topY,
                width: barWidth,
                height: Math.max(0, cy - topY),
                r: 6,
              },
              style: { fill: 'rgba(149, 200, 0, 0.22)', stroke: 'rgba(149, 200, 0, 0.55)', lineWidth: 1 },
            });
          }
          children.push({
            type: 'line',
            shape: { x1: cx - half, y1: cy, x2: cx + half, y2: cy },
            style: { stroke: C.lime, lineWidth: 2, lineCap: 'round', lineDash: [5, 4] },
          });
          return { type: 'group', children };
        },
      },
      ...(hasGrowth
        ? [
            {
              name: 'Crecimiento',
              type: 'line',
              yAxisIndex: 1,
              data: growth,
              smooth: 0.25,
              symbol: 'circle',
              symbolSize: 5,
              connectNulls: false,
              lineStyle: { width: 2, color: C.red },
              itemStyle: { color: C.red, borderColor: '#fff', borderWidth: 1 },
              z: 5,
              // Referencia 0 %: separa el crecimiento del descenso.
              markLine: {
                symbol: 'none',
                silent: true,
                lineStyle: { color: 'rgba(220, 38, 38, 0.32)', type: 'dashed', width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
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

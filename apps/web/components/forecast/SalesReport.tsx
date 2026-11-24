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
  Target,
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
  buildCommittedNarrative,
  buildCumulativeSeries,
  buildCustomerSalesCsv,
  buildDayBars,
  buildNarrative,
  buildSalesCsv,
  committedSnapshot,
  customerSalesCsvFileName,
  customerTargetGeometry,
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

/**
 * Píldora de porcentaje. El tono se puede imponer (`tone`): «Avance» muestra lo
 * acumulado pero se colorea con el ritmo (cierre proyectado), no con el número.
 */
function PctPill({ pct, tone: forcedTone }: { pct: number | null; tone?: SalesTone }) {
  const tone = forcedTone ?? salesTone(pct);
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
 * forecast, con signo) y el corte de hoy (lo que faltaría para el forecast si
 * el mes terminara con la venta registrada), y acompaña la cifra con su barra
 * de avance.
 *
 * Con «Sumar pedidos» activo la base es venta + cartera: solo tiene sentido la
 * lectura del mes, así que se oculta el selector Mes/Día.
 */
function GapStat({ report, withPending }: { report: ForecastSalesResponse; withPending: boolean }) {
  const [scope, setScope] = useState<SalesGapScope>('month');
  const gap = useMemo(() => salesGap(report, { includePending: withPending }), [report, withPending]);
  const canPickDay = !withPending && report.status === 'OPEN' && gap.cutGapKg !== null;
  const isDay = canPickDay && scope === 'day';

  const value = isDay ? gap.cutGapKg : gap.monthGapKg;
  const pct = isDay ? gap.cutPct : gap.monthPct;
  const tone = salesTone(pct);
  const filled = pct === null ? 0 : Math.max(0, Math.min(100, pct));

  const display =
    value === null
      ? '—'
      : isDay
        ? value > 0
          ? `faltan ${fmtKg(value)} kg`
          : 'meta cubierta'
        : `${value > 0 ? '+' : ''}${fmtKg(value)} kg`;

  const hint = isDay
    ? value === null
      ? 'depende de la meta'
      : `si el mes terminara hoy · ${fmtKg(report.totals.actualKg)} de ${fmtKg(report.totals.forecastKg)} kg`
    : withPending
      ? value === null
        ? 'depende de la meta'
        : `real + pedidos contra el forecast`
      : value === null
        ? 'depende de la meta'
        : value > 0
          ? 'por encima del forecast'
          : value < 0
            ? 'por debajo del forecast'
            : 'meta cubierta';

  return (
    <div className="rounded-xl bg-white/10 px-space-sm py-space-xs backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-space-2xs gap-y-1">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/55">
          Brecha
          {withPending && <span className="font-semibold normal-case tracking-normal text-white/45"> · con pedidos</span>}
        </p>
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
        aria-label={
          isDay
            ? 'Avance del forecast al corte'
            : withPending
              ? 'Avance de la meta con pedidos'
              : 'Avance de la meta del mes'
        }
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
        {isDay ? 'del forecast al corte' : withPending ? 'de la meta con pedidos' : 'de la meta del mes'} · {fmtPct(pct)}
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
  // Clientes: por defecto solo los que tienen meta histórica o venta del mes,
  // para no abrir con 1.100 filas vacías del catálogo.
  const [onlyWithTarget, setOnlyWithTarget] = useState(true);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  // Cliente abierto en el panel lateral (mismo patrón que el detalle de producto).
  const [focusCustomer, setFocusCustomer] = useState<string | null>(null);
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  // «Sumar pedidos»: añade la cartera pendiente al acumulado y a los KPIs del
  // hero. Apagado por defecto; no toca la tabla ni el CSV (venta real).
  const [withPending, setWithPending] = useState(false);
  // Día abierto en el modal de desglose (independiente del pin de la tira).
  const [detailDay, setDetailDay] = useState<string | null>(null);
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

  const filteredCustomers = useMemo(
    () =>
      customerReport
        ? filterCustomerSalesRows(customerReport.customers, {
            search: deferredSearch,
            onlyWithSales,
            onlyWithTarget,
          })
        : [],
    [customerReport, deferredSearch, onlyWithSales, onlyWithTarget],
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
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusCustomer((current) => (current === code ? null : code));
  }, []);
  const closeCustomer = useCallback(() => setFocusCustomer(null), []);

  const openProduct = useCallback((code: string) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusCode((current) => (current === code ? null : code));
  }, []);
  const closeProduct = useCallback(() => setFocusCode(null), []);

  // Cierre comprometido: venta + cartera. Null si no hay pedidos pendientes o
  // el mes no está en curso; el interruptor solo se ofrece cuando hay datos.
  const committedAvailable = useMemo(() => (report ? committedSnapshot(report) : null), [report]);
  const committed = withPending ? committedAvailable : null;

  const chartOption = useMemo(
    () => (report ? cumulativeOption(report, pinnedDay, Boolean(committed)) : {}),
    [report, pinnedDay, committed],
  );
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

  // Si la cartera desaparece (se facturó o cambió el mes), el escenario deja de
  // existir: se apaga para que el hero no quede en un estado sin datos.
  useEffect(() => {
    if (!committedAvailable) setWithPending(false);
  }, [committedAvailable]);

  // Al cambiar de mes se limpia la selección (las fechas ya no aplican).
  useEffect(() => {
    setPinnedDay(null);
    setHoverDay(null);
    setDetailDay(null);
    setFocusCustomer(null);
    setWithPending(false);
  }, [report?.year, report?.month]);

  // Al cambiar de producto a cliente (o al revés) no se arrastra el foco de la
  // vista anterior.
  useEffect(() => {
    setFocusCode(null);
    setFocusCustomer(null);
  }, [mode]);

  // Los detalles (producto y cliente) son diálogos: Esc cierra, el fondo no
  // scrollea y el foco entra al panel para que el clic tenga respuesta inmediata.
  const detailOpen = Boolean(focusCode || focusCustomer);
  const closeDetail = useCallback(() => {
    setFocusCode(null);
    setFocusCustomer(null);
  }, []);
  useEffect(() => {
    if (!detailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
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
  }, [detailOpen, closeDetail]);
  const focusRow = useMemo(
    () => (report && focusCode ? report.rows.find((row) => row.productCode === focusCode) ?? null : null),
    [report, focusCode],
  );
  const focusCustomerRow = useMemo(
    () =>
      customerReport && focusCustomer
        ? customerReport.customers.find((row) => row.customerCode === focusCustomer) ?? null
        : null,
    [customerReport, focusCustomer],
  );
  const focusOption = useMemo(() => (report && focusRow ? historyOption(report, focusRow) : {}), [report, focusRow]);
  const focusCustomerOption = useMemo(
    () => (customerReport && focusCustomerRow ? customerHistoryOption(customerReport, focusCustomerRow) : {}),
    [customerReport, focusCustomerRow],
  );
  // Historial del cliente en el orden de la ventana (meses con cero incluidos).
  const focusCustomerHistory = useMemo(() => {
    if (!customerReport || !focusCustomerRow) return [];
    return customerReport.historyMonths.map((month, index) => ({
      year: month.year,
      month: month.month,
      kg:
        focusCustomerRow.history.find((entry) => entry.year === month.year && entry.month === month.month)?.kg ??
        focusCustomerRow.history[index]?.kg ??
        0,
    }));
  }, [customerReport, focusCustomerRow]);
  const focusCustomerWindowLabel = useMemo(() => {
    const first = focusCustomerHistory[0];
    const last = focusCustomerHistory[focusCustomerHistory.length - 1];
    return first && last
      ? `${monthLabel(first.year, first.month, true)} – ${monthLabel(last.year, last.month, true)}`
      : null;
  }, [focusCustomerHistory]);

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
  const heroKg = committed ? committed.kg : report?.totals.projectedKg ?? null;
  const heroTonnes = useCountUp(heroKg !== null ? heroKg / 1000 : null);
  const narrative = useMemo(
    () => (report ? (committed ? buildCommittedNarrative(report, committed) : buildNarrative(report)) : ''),
    [report, committed],
  );

  const hasDeviationFilters =
    Boolean(search.trim()) || onlyWithSales || onlyWithForecast || onlyWithData;
  const customerHasFilters = Boolean(search.trim()) || onlyWithSales || onlyWithTarget;
  const clearDeviationFilters = useCallback(() => {
    setSearch('');
    setOnlyWithSales(false);
    setOnlyWithForecast(false);
    setOnlyWithData(false);
    setOnlyWithTarget(false);
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
  // El hero sigue la venta real; con «Sumar pedidos» pasa al cierre
  // comprometido (real + cartera) y lo dice en las etiquetas.
  const heroPct = committed ? committed.pctOfForecast : projectedAttainment;
  const heroValue = committed ? committed.kg : projected;
  const heroTone = salesTone(heroPct ?? attainment);
  const heroLabel = committed
    ? 'Cierre comprometido'
    : isFuture
      ? 'Meta del mes'
      : isOpen
        ? 'Proyección de cierre'
        : 'Venta del mes';
  const tone = salesTone(projectedAttainment ?? attainment);
  const basisLabel = report.basis === 'WORKING' ? 'día hábil (lun–sáb)' : 'día calendario';
  const remainingDays = report.basis === 'WORKING' ? report.days.workingRemaining : report.days.remaining;
  const remainingLabel = report.basis === 'WORKING' ? 'días hábiles' : 'días';

  // Parte del mes ya transcurrida: la vara del ritmo con la que se pinta el
  // «Avance» (en mes cerrado es 100 % y el color vuelve a leerse como cumplimiento).
  const elapsedDays = report.basis === 'WORKING' ? report.days.workingElapsed : report.days.elapsed;
  const monthDays = report.basis === 'WORKING' ? report.days.workingInMonth : report.days.inMonth;
  const elapsedSharePct = monthDays > 0 ? Math.min(100, (elapsedDays / monthDays) * 100) : 0;

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
      render: (row) => {
        // El número es lo vendido; el color, el ritmo (cierre al paso actual).
        const tonePct = row.projectedAttainmentPct ?? row.attainmentPct;
        const title =
          row.attainmentPct === null || elapsedDays <= 0
            ? undefined
            : `Avance ${fmtPct(row.attainmentPct)} con ${fmtPct(elapsedSharePct)} del mes transcurrido${
                row.projectedAttainmentPct === null
                  ? ''
                  : ` · cierre proyectado ${fmtPct(row.projectedAttainmentPct)} del forecast`
              }`;
        return (
          <span title={title}>
            <PctPill pct={row.attainmentPct} tone={salesTone(tonePct)} />
          </span>
        );
      },
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
      key: 'meta',
      header: 'Meta prom.',
      help: CUSTOMER_SALES_COLUMN_HELP.meta,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.targetKg,
      render: (row) =>
        row.targetKg > 0 ? (
          <span
            className="font-semibold tabular-nums text-on-surface"
            title={`Promedio de ${fmtKg(row.targetMonths, 0)} ${
              row.targetMonths === 1 ? 'mes con compra' : 'meses con compra'
            } en los últimos 3 meses cerrados`}
          >
            {fmtKg(row.targetKg)}
          </span>
        ) : (
          <span className="text-outline">—</span>
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
      key: 'proyeccion',
      header: 'Proyección kg',
      help: CUSTOMER_SALES_COLUMN_HELP.proyeccion,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.projectedKg ?? -1,
      render: (row) => (
        <span className={cx('tabular-nums font-semibold', row.projectedKg === null ? 'text-outline' : 'text-on-surface')}>
          {fmtKg(row.projectedKg)}
        </span>
      ),
    },
    {
      key: 'vsMeta',
      header: '% vs meta',
      help: CUSTOMER_SALES_COLUMN_HELP.vsMeta,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.projectedAttainmentPct ?? -1,
      render: (row) => <PctPill pct={row.projectedAttainmentPct ?? row.attainmentPct} />,
    },
    {
      key: 'ritmo',
      header: 'Ritmo nec.',
      help: CUSTOMER_SALES_COLUMN_HELP.ritmo,
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
      key: 'participacion',
      header: 'Participación %',
      help: CUSTOMER_SALES_COLUMN_HELP.participacion,
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.sharePct,
      render: (row) => (
        <span className={cx('tabular-nums font-semibold', row.sharePct > 0 ? 'text-secondary' : 'text-outline')}>
          {fmtPct(row.sharePct)}
        </span>
      ),
    },
    {
      key: 'productos',
      header: 'Productos',
      help: CUSTOMER_SALES_COLUMN_HELP.productos,
      align: 'center',
      kind: 'detail',
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
          onClick={() => openCustomer(row.customerCode)}
          aria-label={`Ver el detalle de ${row.customerName}`}
          title="Ver detalle del cliente"
          className="grid size-8 place-items-center rounded-lg text-outline transition-colors hover:bg-surface-container hover:text-primary"
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      ),
    },
  ];

  const customerTotals = customerReport?.totals;
  const filteredActiveCustomers = filteredCustomers.filter((customer) => customer.actualKg > 0).length;
  const filteredTargetCustomers = filteredCustomers.filter((customer) => customer.targetKg > 0).length;
  const customerProductCount = filteredCustomers.reduce((acc, customer) => acc + customer.productCount, 0);
  const filteredShare = filteredCustomers.reduce((acc, customer) => acc + customer.sharePct, 0);
  const customerFooter = (
    <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
      <td colSpan={3} className="px-space-sm py-space-xs">
        <span className="flex flex-wrap items-center gap-space-sm uppercase text-label-sm text-outline">
          Totales {filteredCustomers.length !== (customerReport?.customers.length ?? 0) ? `(${filteredCustomers.length} filtrados)` : 'globales'}
          <Badge tone="primary" dot>
            {fmtKg(filteredTargetCustomers, 0)} con meta
          </Badge>
          <Badge tone="muted">{fmtKg(filteredActiveCustomers, 0)} con venta</Badge>
        </span>
      </td>
      <td className="px-space-sm py-space-xs text-right tabular-nums text-on-surface">{fmtKg(customerTotals?.targetKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtKg(customerTotals?.actualKg)}</td>
      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtKg(customerTotals?.projectedKg)}</td>
      <td className="px-space-sm py-space-xs text-right">{fmtPct(customerTotals?.projectedAttainmentPct)}</td>
      <td className="px-space-sm py-space-xs text-right text-outline">—</td>
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
      <span className="text-outline">Meta prom. (Σ clientes)</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(customerTotals?.targetKg)}</span>
      <span className="text-outline">Venta kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(customerTotals?.actualKg)}</span>
      <span className="text-outline">Proyección kg</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(customerTotals?.projectedKg)}</span>
      <span className="text-outline">% vs meta</span>
      <span className="text-right font-bold tabular-nums">{fmtPct(customerTotals?.projectedAttainmentPct)}</span>
      <span className="text-outline">Clientes con meta</span>
      <span className="text-right font-bold tabular-nums">{fmtKg(filteredTargetCustomers, 0)}</span>
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
          Cada cliente se mide contra <strong>su propia meta histórica</strong>: el promedio de los kg de los meses con
          compra de los últimos 3 meses cerrados. La barra azul es la venta del mes y la verde, su proyección de cierre.
          Los KPIs superiores siguen siendo de la empresa: esta meta es un <strong>benchmark de cartera</strong> y no
          reemplaza el forecast oficial de Profit.
        </p>
      )}

      {mode === 'customer' && customerReport && !customerReport.historyAvailable && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-warning-container/60 px-space-md py-space-sm text-body-md text-on-warning-container">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          No se pudo leer el histórico de los últimos 3 meses: la venta del mes se muestra igual, pero los clientes
          quedan <strong>sin meta</strong> y no se calcula el % de cumplimiento.
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
                {committed && (
                  <span className="font-semibold normal-case tracking-normal text-amber-200/90">· con pedidos</span>
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
                {heroLabel}
              </p>
              <div className="mt-space-2xs flex flex-wrap items-end gap-space-sm">
                <span
                  className="font-display tabular-nums text-[3.4rem] font-black leading-none tracking-tight"
                  style={{ color: heroTone === 'none' ? 'rgb(255 255 255 / 0.75)' : HERO_TONE[heroTone] }}
                >
                  {heroValue === null ? '—' : fmtKg(heroTonnes, 1)}
                </span>
                <span className="pb-2 text-title-md font-semibold text-white/55">t</span>
                <span className="mb-1.5 rounded-pill bg-white/10 px-space-sm py-1 text-label-md font-semibold text-white/75">
                  {heroValue === null ? 'sin proyección' : `${fmtKg(heroValue)} kg`}
                </span>
              </div>
              <p className="mt-space-xs max-w-xl text-body-md text-white/60">{narrative}</p>
            </div>

            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
              <HeroStat
                label={committed ? 'Venta + pedidos' : 'Venta acumulada'}
                value={`${fmtKg(committed ? committed.kg : totals.actualKg)} kg`}
                hint={
                  committed
                    ? `${fmtKg(totals.actualKg)} vendidos + ${fmtKg(totals.pendingKg)} pedidos`
                    : `${fmtTonnes(totals.actualKg)} t`
                }
              />
              <HeroStat
                label="Forecast"
                value={totals.forecastKg > 0 ? `${fmtKg(totals.forecastKg)} kg` : 'Sin meta'}
                hint={
                  report.forecastSource === 'SNAPSHOT' || report.forecastSource === 'CAPTURED'
                    ? `${fmtTonnes(totals.forecastKg)} t · guardada`
                    : `${fmtTonnes(totals.forecastKg)} t`
                }
              />
              <GapStat report={report} withPending={Boolean(committed)} />
              <HeroStat
                label={isOpen ? 'Ritmo necesario' : 'Entregas'}
                value={
                  isOpen
                    ? committed
                      ? committed.gapKg !== null && committed.gapKg <= 0
                        ? 'Meta cubierta'
                        : committed.requiredDailyKg === null
                          ? '—'
                          : `${fmtKg(committed.requiredDailyKg)} kg/día`
                      : totals.requiredDailyKg === null
                        ? '—'
                        : `${fmtKg(totals.requiredDailyKg)} kg/día`
                    : fmtKg(totals.invoiceCount, 0)
                }
                hint={
                  isOpen
                    ? committed
                      ? `${remainingDays} ${remainingLabel} · sobre la cartera`
                      : `${remainingDays} ${remainingLabel} restantes`
                    : `última ${totals.lastInvoiceDate ? dayLabel(totals.lastInvoiceDate) : '—'}`
                }
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-space-sm justify-self-center rounded-2xl border border-white/10 bg-white/5 p-space-md">
            <AttainmentRing pct={isFuture ? null : heroPct} tone={heroTone} />
            <div className="flex flex-col items-center gap-space-2xs text-center">
              <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-white/50">
                {committed ? 'Cumplimiento comprometido' : 'Cumplimiento proyectado'}
              </span>
              <span className={cx('tabular-nums text-title-md font-bold', heroTone === 'good' ? 'text-secondary-container' : 'text-white/85')}>
                {fmtPct(heroPct)}
              </span>
              <span className="text-label-sm text-white/45">Meta {fmtKg(totals.forecastKg)} kg</span>
              <span className="mt-1 flex items-center gap-1 text-label-sm text-white/55">
                Actual
                <strong className="tabular-nums text-white/85">{fmtPct(attainment)}</strong>
              </span>
              {committed && (
                <span className="flex items-center gap-1 text-label-sm text-white/55">
                  Ritmo forecast
                  <strong className="tabular-nums text-white/85">{fmtPct(projectedAttainment)}</strong>
                </span>
              )}
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
                {withPending ? ' · línea ámbar = real + pedidos' : ''}
                {report.daily.length > 0 && (totals.actualKg > 0 || totals.pendingKg > 0)
                  ? ' · pasa el mouse o haz clic en un día: la barra de abajo se sincroniza'
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              {committedAvailable && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={withPending}
                  onClick={() => setWithPending((value) => !value)}
                  title="Suma la cartera pendiente del mes al acumulado y a los KPIs: si facturas todos los pedidos, ¿a cuánto llegarías?"
                  className={cx(
                    'inline-flex h-8 items-center gap-2 rounded-pill border px-space-sm text-label-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70',
                    withPending
                      ? 'border-warning/50 bg-warning-container/70 text-on-warning-container'
                      : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/40 hover:text-primary',
                  )}
                >
                  <span
                    aria-hidden
                    className={cx(
                      'relative inline-block h-3.5 w-6 shrink-0 rounded-pill transition-colors',
                      withPending ? 'bg-warning' : 'bg-outline/30',
                    )}
                  >
                    <span
                      className={cx(
                        'absolute top-0.5 size-2.5 rounded-full bg-white shadow-sm transition-[left]',
                        withPending ? 'left-3' : 'left-0.5',
                      )}
                    />
                  </span>
                  Sumar pedidos
                  <span
                    className={cx(
                      'hidden rounded-pill px-1.5 py-0.5 text-[0.65rem] font-bold tabular-nums sm:inline',
                      withPending
                        ? 'bg-white/60 text-on-warning-container'
                        : 'bg-surface-container text-on-surface-variant',
                    )}
                  >
                    {fmtKg(totals.pendingKg)} kg
                  </span>
                </button>
              )}
              {totals.actualKg > 0 && (
                <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: C.navy }} /> Real
                  </span>
                  {withPending && committed && (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: C.amber }} /> Real + pedidos
                    </span>
                  )}
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
            </div>
          </header>
          <div className="px-space-sm pb-space-sm">
            {report.daily.length > 0 && (totals.actualKg > 0 || totals.pendingKg > 0) ? (
              <>
                <EChart
                  option={chartOption}
                  height={280}
                  ariaLabel={
                    withPending
                      ? 'Acumulado del mes: venta real, real más pedidos, proyección y ritmo del forecast'
                      : 'Acumulado del mes: venta real, proyección y ritmo del forecast'
                  }
                  onIndexHover={handleIndexHover}
                  onIndexClick={handleIndexClick}
                />

                {committed && (
                  <p className="mx-space-xs mt-space-xs flex flex-wrap items-center gap-x-space-xs gap-y-1 rounded-lg border border-warning/25 bg-warning-container/35 px-space-sm py-space-2xs text-label-md text-on-warning-container">
                    <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: C.amber }} />
                    <span>
                      Si facturas los <strong className="tabular-nums">{fmtKg(totals.pendingKg)} kg</strong> de pedidos pendientes
                      llegarías a <strong className="tabular-nums">{fmtKg(committed.kg)} kg</strong> (
                      {fmtPct(committed.pctOfForecast)} del forecast)
                      {committed.gapKg !== null && committed.gapKg < 0
                        ? `; faltarían ${fmtKg(Math.abs(committed.gapKg))} kg.`
                        : committed.gapKg !== null && committed.gapKg > 0
                          ? `; irías ${fmtKg(committed.gapKg)} kg por encima.`
                          : '; la meta quedaría cubierta.'}
                    </span>
                    <span className="text-on-warning-container/70">La proyección de ritmo no incluye la cartera.</span>
                  </p>
                )}

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
                    {mode === 'customer' ? 'Meta histórica por cliente' : 'Desviación por producto'}
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
                        ? `${fmtKg(filteredCustomers.length, 0)} de ${fmtKg(customerReport?.customers.length ?? 0, 0)} clientes · meta = promedio de los meses con compra de los 3 meses cerrados`
                        : `${fmtKg(customerReport?.customers.length ?? 0, 0)} clientes · meta = promedio de los meses con compra de los 3 meses cerrados`}
                      <span className="block text-outline">
                        Ordenados por mayor promedio histórico. Haz clic en un cliente para abrir su detalle.
                      </span>
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
                  ? `${fmtKg(filteredTargetCustomers, 0)} con meta`
                  : `${fmtKg(filtered.length, 0)} art.`}
              </Badge>
            </div>

            <div
              className="mt-space-sm flex flex-wrap items-center gap-space-2xs"
              role="group"
              aria-label={mode === 'customer' ? 'Filtros de clientes vs meta' : 'Filtros de la desviación por producto'}
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
                <>
                  <FilterChip
                    active={onlyWithTarget}
                    onClick={() => setOnlyWithTarget((value) => !value)}
                    label="Con meta"
                  />
                  <FilterChip active={onlyWithSales} onClick={() => setOnlyWithSales((value) => !value)} label="Con venta" />
                </>
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
                      No se pudo cargar la venta por cliente: {customerError.message}
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
                    <CustomerPortfolioStrip report={customerReport} />
                    <CustomerMetaBars
                      rows={customerDeviationPreview}
                      focus={focusCustomer}
                      showProjection={isOpen}
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
                  <p className="text-label-sm text-outline">Semanas del Asignador · por defecto por días del bloque</p>
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

      {mode === 'customer' && customerReport && focusCustomerRow && (
        <>
          <div
            aria-hidden
            className="animate-fade fixed inset-0 z-40 bg-[#081d2c]/45 backdrop-blur-[2px]"
            onClick={closeCustomer}
          />
          <aside
            ref={detailRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-customer-title"
            tabIndex={-1}
            className="animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto overscroll-contain bg-surface-container-lowest shadow-2xl outline-none"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-space-md border-b border-surface-container bg-surface-container-lowest/95 px-space-md py-space-sm backdrop-blur">
              <div className="min-w-0">
                <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Detalle del cliente</p>
                <h2
                  id="focus-customer-title"
                  className="flex flex-wrap items-baseline gap-space-sm text-title-md font-bold text-on-surface"
                >
                  <span className="tabular-nums text-primary">{focusCustomerRow.customerCode}</span>
                  <span className="min-w-0 truncate text-body-md font-normal text-on-surface-variant">
                    {focusCustomerRow.customerName}
                  </span>
                </h2>
                <p className="text-label-md text-on-surface-variant">
                  {focusCustomerRow.customerType ?? 'Sin tipo'}
                  {focusCustomerRow.vendor ? ` · ${focusCustomerRow.vendor}` : ''}
                  {focusCustomerRow.lastInvoiceDate
                    ? ` · última entrega ${fmtDate(focusCustomerRow.lastInvoiceDate)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCustomer}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
                aria-label="Cerrar detalle del cliente"
              >
                <X aria-hidden className="size-4" />
              </button>
            </header>

            <div className="flex flex-col gap-space-md p-space-md">
              <div>
                <div className="mb-space-2xs flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Venta real
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-full bg-[#1d5a96]" /> Mes en curso
                  </span>
                  {focusCustomerRow.targetKg > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-[#95C800]" /> Meta promedio
                    </span>
                  )}
                  {focusCustomerRow.history.some((entry) => entry.kg > 0) && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className="h-0.5 w-3 rounded-pill bg-[#dc2626]" /> Crecimiento % (franja superior)
                    </span>
                  )}
                </div>
                <EChart
                  option={focusCustomerOption}
                  height={300}
                  ariaLabel={`Histórico de ventas de ${focusCustomerRow.customerName}`}
                />
                <p className="mt-space-2xs text-label-sm text-outline">
                  La línea verde punteada es la meta promedio del cliente ({fmtKg(focusCustomerRow.targetKg)} kg); la línea
                  roja es la variación % contra el mes anterior y va en su propia franja para no cruzar las barras. El mes
                  en curso va con su venta parcial, hasta el corte.
                </p>
              </div>

              {/* Meta histórica y los meses que la componen. */}
              <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
                <header className="flex flex-wrap items-start justify-between gap-space-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-label-sm font-semibold uppercase tracking-wide text-outline">
                      <Target aria-hidden className="size-3.5 shrink-0 text-primary" /> Meta histórica
                    </p>
                    <p className="tabular-nums text-headline-md font-black text-primary">
                      {focusCustomerRow.targetKg > 0 ? `${fmtKg(focusCustomerRow.targetKg)} kg` : 'Sin meta'}
                    </p>
                    <p className="text-label-sm text-on-surface-variant">
                      {focusCustomerRow.targetKg > 0
                        ? `Promedio de ${fmtKg(focusCustomerRow.targetMonths, 0)} ${
                            focusCustomerRow.targetMonths === 1 ? 'mes con compra' : 'meses con compra'
                          }${focusCustomerWindowLabel ? ` · ${focusCustomerWindowLabel}` : ''}`
                        : 'Sin compras en los 3 meses cerrados: se mide solo por su venta'}
                    </p>
                  </div>
                  <PctPill pct={focusCustomerRow.projectedAttainmentPct ?? focusCustomerRow.attainmentPct} />
                </header>

                <div className="my-space-sm h-px bg-surface-container" />

                <div className="grid grid-cols-3 gap-space-2xs">
                  {focusCustomerHistory.map((month) => (
                    <div
                      key={`${month.year}-${month.month}`}
                      className={cx(
                        'rounded-xl border p-space-2xs',
                        month.kg > 0
                          ? 'border-outline-variant/30 bg-surface'
                          : 'border-dashed border-outline-variant/40 bg-surface-container-lowest',
                      )}
                    >
                      <p className="text-label-sm font-semibold uppercase text-outline">
                        {monthLabel(month.year, month.month, true)}
                      </p>
                      <p
                        className={cx(
                          'tabular-nums text-title-md font-black',
                          month.kg > 0 ? 'text-on-surface' : 'text-outline',
                        )}
                      >
                        {fmtKg(month.kg)} kg
                      </p>
                      <p className="text-label-sm text-outline">{month.kg > 0 ? 'con compra' : 'sin compra'}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-space-2xs text-label-sm text-outline">
                  Los meses sin compra no entran al promedio; la meta es un benchmark de cartera y no reemplaza el forecast
                  de Profit.
                </p>
              </section>

              <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                <MiniStat
                  label="Venta del mes"
                  value={`${fmtKg(focusCustomerRow.actualKg)} kg`}
                  hint={`${fmtKg(focusCustomerRow.actualUnits)} unid. · ${fmtPct(focusCustomerRow.sharePct)} de la venta ABA`}
                />
                <MiniStat
                  label={isOpen ? 'Proyección' : 'Cierre real'}
                  value={focusCustomerRow.projectedKg === null ? '—' : `${fmtKg(focusCustomerRow.projectedKg)} kg`}
                  hint={
                    focusCustomerRow.projectedAttainmentPct === null
                      ? 'sin meta'
                      : `${fmtPct(focusCustomerRow.projectedAttainmentPct)} de su meta histórica`
                  }
                  tone={salesTone(focusCustomerRow.projectedAttainmentPct)}
                />
                <MiniStat
                  label="Promedio/día"
                  value={`${fmtKg(focusCustomerRow.dailyAvgKg)} kg`}
                  hint={`por ${basisLabel}`}
                />
                <MiniStat
                  label={isOpen ? 'Ritmo necesario' : 'Brecha'}
                  value={
                    isOpen
                      ? focusCustomerRow.requiredDailyKg === null
                        ? '—'
                        : `${fmtKg(focusCustomerRow.requiredDailyKg)} kg/día`
                      : focusCustomerRow.gapKg === null
                        ? '—'
                        : `${focusCustomerRow.gapKg > 0 ? '+' : ''}${fmtKg(focusCustomerRow.gapKg)} kg`
                  }
                  hint={
                    isOpen
                      ? focusCustomerRow.requiredDailyKg === null
                        ? 'sin meta'
                        : 'para cerrar en su meta histórica'
                      : focusCustomerRow.gapKg === null
                        ? report.status === 'FUTURE'
                          ? 'aún sin venta en el mes'
                          : 'sin meta'
                        : 'cierre real menos meta'
                  }
                  tone={
                    isOpen
                      ? 'warn'
                      : focusCustomerRow.gapKg === null
                        ? 'none'
                        : focusCustomerRow.gapKg < 0
                          ? 'bad'
                          : 'good'
                  }
                />
              </div>

              <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
                <header className="mb-space-2xs flex flex-wrap items-center justify-between gap-space-sm">
                  <h3 className="text-label-md font-bold text-on-surface">Productos comprados</h3>
                  <Badge tone="muted">
                    {fmtKg(focusCustomerRow.productCount, 0)}{' '}
                    {focusCustomerRow.productCount === 1 ? 'producto' : 'productos'}
                  </Badge>
                </header>
                <CustomerProductsTable row={focusCustomerRow} />
              </section>
            </div>
          </aside>
        </>
      )}

      {/* ---------- Tabla ---------- */}
      <Card className="overflow-hidden">
        <div
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
              Los filtros se aplican desde «{mode === 'customer' ? 'Meta histórica por cliente' : 'Desviación por producto'}».
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="w-full sm:w-64">
              {mode === 'customer' ? (
                <CustomerPicker
                  value={focusCustomer}
                  onChange={(code) => (code ? openCustomer(code) : closeCustomer())}
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
                    ? `${fmtKg(customerReport.totals.actualKg)} kg vendidos en el mes a la fecha contra una meta de cartera de ${fmtKg(
                        customerReport.totals.targetKg,
                      )} kg (promedio de los meses con compra de los últimos 3 meses cerrados). Proyección de cierre: ${fmtKg(
                        customerReport.totals.projectedKg,
                      )} kg.`
                    : 'Cargando clientes vs meta histórica…'
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
            onRowClick={(row) => openCustomer(row.customerCode)}
            empty={
              <EmptyState
                icon={Users}
                title={customerError ? 'No se pudo cargar la venta por cliente' : 'Sin clientes registrados'}
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
              <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Venta del mes
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-secondary-container" /> Proyección de cierre
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="h-3 w-[2px] rounded-pill bg-secondary" /> 100 % de la meta histórica
            </span>
            <span className="text-outline">·</span>
            La meta de cada cliente es el promedio de los meses con compra de los últimos 3 meses cerrados; no es el
            forecast oficial de Profit. Orden: mayor promedio primero. Los sacos no se suman con kg.
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
            El color de «Avance» y del semáforo lee el ritmo (cierre proyectado ÷ meta), no lo vendido a la fecha.
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
  // Si el cliente solo compra granel no hay sacos que mostrar: la columna se
  // omite para darle ancho al nombre del producto.
  const hasSacks = row.products.some((product) => product.sacks !== null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-label-md">
        <caption className="sr-only">Productos de {row.customerName}</caption>
        <thead>
          <tr className="text-label-sm uppercase tracking-[0.08em] text-outline">
            <th scope="col" className="py-1 pr-3 text-left font-semibold">Producto</th>
            <th scope="col" className="w-12 py-1 text-center font-semibold">UOM</th>
            <th scope="col" className="w-20 py-1 text-right font-semibold">Venta kg</th>
            <th scope="col" className="w-16 py-1 text-right font-semibold" title="Unidades">Unid.</th>
            {hasSacks && (
              <th scope="col" className="w-16 py-1 text-right font-semibold">Sacos</th>
            )}
            <th scope="col" className="w-20 py-1 text-right font-semibold" title="% del cliente">% cliente</th>
            <th scope="col" className="w-20 py-1 text-right font-semibold" title="% del producto">% producto</th>
          </tr>
        </thead>
        <tbody>
          {row.products.map((product) => (
            <tr key={product.productCode} className="border-t border-surface-container/70">
              <td className="py-1.5 pr-3">
                <span className="block leading-snug text-on-surface" title={product.description}>
                  {product.description}
                </span>
                <span className="mt-0.5 block text-label-sm tabular-nums text-outline">{product.productCode}</span>
              </td>
              <td className="py-1.5 text-center">
                <Badge tone="muted">{product.uom}</Badge>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums font-semibold text-primary">
                {fmtKg(product.kg)}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-on-surface-variant">
                {fmtKg(product.units)}
              </td>
              {hasSacks && (
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-on-surface-variant">
                  {product.sacks === null ? '—' : fmtKg(product.sacks, 1)}
                </td>
              )}
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                {fmtPct(product.shareOfCustomerPct)}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-secondary">
                {fmtPct(product.shareOfProductPct)}
              </td>
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

function CustomerPortfolioStrip({ report }: { report: ForecastCustomerSalesResponse }) {
  const totals = report.totals;
  const first = report.historyMonths[0];
  const last = report.historyMonths[report.historyMonths.length - 1];
  const windowLabel =
    first && last ? `${monthLabel(first.year, first.month, true)} – ${monthLabel(last.year, last.month, true)}` : null;
  const tone = salesTone(totals.projectedAttainmentPct ?? totals.attainmentPct);

  return (
    <section
      aria-label="Cartera de clientes"
      className="mb-space-sm rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-2xs">
        <p className="flex items-center gap-1.5 text-label-sm font-bold uppercase tracking-[0.12em] text-outline">
          <Target aria-hidden className="size-3.5 shrink-0 text-primary" />
          Cartera de clientes
        </p>
        <span className="text-label-sm text-outline">
          {windowLabel ? `Meta = promedio ${windowLabel}` : 'Meta histórica por cliente'}
        </span>
      </div>
      <div className="mt-space-2xs grid grid-cols-3 gap-space-2xs">
        <div className="rounded-lg bg-surface-container-low p-space-2xs">
          <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">Meta</p>
          <p className="tabular-nums text-label-md font-black text-on-surface">{fmtKg(totals.targetKg)} kg</p>
          <p className="text-label-sm text-outline">{fmtKg(totals.targetCustomerCount, 0)} con meta</p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-space-2xs">
          <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">Venta</p>
          <p className="tabular-nums text-label-md font-black text-primary">{fmtKg(totals.actualKg)} kg</p>
          <p className="text-label-sm text-outline">{fmtPct(totals.attainmentPct)} de la meta</p>
        </div>
        <div className="rounded-lg bg-surface-container-low p-space-2xs">
          <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">Proyección</p>
          <p className={cx('tabular-nums text-label-md font-black', TONE_TEXT[tone])}>{fmtKg(totals.projectedKg)} kg</p>
          <p className="text-label-sm text-outline">{fmtPct(totals.projectedAttainmentPct)} al cierre</p>
        </div>
      </div>
    </section>
  );
}

const CustomerMetaBars = memo(function CustomerMetaBars({
  rows,
  focus,
  showProjection,
  onFocus,
}: {
  rows: ForecastCustomerSalesRow[];
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
    return <p className="py-space-lg text-center text-body-md text-on-surface-variant">Sin clientes para el filtro.</p>;
  }

  return (
    <div className="flex flex-col gap-space-2xs">
      <div className="max-h-[520px] overflow-y-auto pr-1">
        <div className="sticky top-0 z-10 border-b border-surface-container bg-surface-container-lowest pb-space-2xs">
          <DeviationScale markerPct={META_MARKER_PCT} metaLabel="meta 100 %" />
        </div>
        <ul className="flex flex-col gap-space-2xs">
          {rows.map((row) => {
            // El % que se lee es la proyección: si cruza el marcador, se dice cuánto.
            const pct = row.projectedAttainmentPct ?? row.attainmentPct;
            const tone = salesTone(pct);
            const geo = customerTargetGeometry(row);
            const overPct = pct !== null && Number.isFinite(pct) && pct > 100 ? pct - 100 : null;
            const gapKg = row.projectedKg === null ? null : row.projectedKg - row.targetKg;
            const monthsLabel = `${fmtKg(row.targetMonths, 0)} ${row.targetMonths === 1 ? 'mes' : 'meses'}`;

            return (
              <li key={row.customerCode}>
                <button
                  type="button"
                  onClick={() => onFocus(row.customerCode)}
                  aria-pressed={focus === row.customerCode}
                  title={`${row.customerName} · meta ${fmtKg(row.targetKg)} kg (promedio de ${monthsLabel}) · venta ${fmtKg(
                    row.actualKg,
                  )} kg${showProjection && row.projectedKg !== null ? ` · proyección ${fmtKg(row.projectedKg)} kg` : ''}`}
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
                      <span className={cx('tabular-nums text-label-md font-bold', TONE_TEXT[tone])}>
                        {geo.hasMeta ? fmtPct(pct) : 'Sin meta'}
                      </span>
                      {overPct !== null ? (
                        <span className="whitespace-nowrap text-label-sm font-semibold text-success">
                          +{fmtPct(overPct)} sobre meta
                        </span>
                      ) : geo.hasMeta && gapKg !== null ? (
                        <span className="whitespace-nowrap text-label-sm text-on-surface-variant">
                          faltan {fmtKg(Math.abs(gapKg))} kg
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-label-sm text-outline">{fmtKg(row.actualKg)} kg vendidos</span>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-label-sm text-outline">
                    meta {geo.hasMeta ? `${fmtKg(row.targetKg)} kg · ${monthsLabel}` : 'sin histórico'}
                    {' · '}venta {fmtKg(row.actualKg)} kg
                    {showProjection && row.projectedKg !== null ? ` · proyección ${fmtKg(row.projectedKg)} kg` : ''}
                  </p>
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
          <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Venta del mes
        </span>
        {showProjection && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-secondary-container/60" /> Proyección
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-3 w-[2px] rounded-pill bg-secondary" /> 100 % de la meta histórica
        </span>
        <span className="text-outline">La meta es el promedio de los meses con compra de los 3 meses cerrados.</span>
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

function cumulativeOption(
  report: ForecastSalesResponse,
  pinnedDate: string | null = null,
  withPending = false,
): Record<string, unknown> {
  const points = buildCumulativeSeries(report);
  const forecastKg = report.totals.forecastKg;
  const labels = points.map((point) => point.label);
  const actual = points.map((point) => point.actual);
  const projected = points.map((point) => point.projected);
  const pace = points.map((point) => point.pace);
  const committed = points.map((point) => point.committed);
  const committedKg = report.totals.actualKg + report.totals.pendingKg;
  const showCommitted = withPending && report.totals.pendingKg > 0;
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
    grid: { left: 8, right: showCommitted ? 86 : 16, top: 14, bottom: 4, containLabel: true },
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
      ...(showCommitted
        ? [
            {
              // Techo comprometido: real + cartera por fecha de entrega. Es una
              // lectura aparte de la proyección de ritmo, no se suman.
              name: 'Real + pedidos',
              type: 'line',
              step: 'end',
              showSymbol: false,
              connectNulls: false,
              data: committed,
              lineStyle: { width: 2.5, color: C.amber, type: 'solid' },
              itemStyle: { color: C.amber },
              endLabel: {
                show: true,
                formatter: () => `${compact(committedKg)} kg`,
                color: C.amber,
                fontSize: 10,
                fontWeight: 'bold',
                backgroundColor: 'rgba(255,255,255,0.92)',
                borderRadius: 4,
                padding: [2, 4],
                distance: 4,
              },
              z: 5,
            },
          ]
        : []),
    ],
  };
}

interface CustomSeriesApi {
  value: (dimension: number) => number;
  coord: (point: number[]) => [number, number];
  size: (range: [number, number]) => [number, number];
}

/**
 * Guion de meta por barra: si la barra la supera, el tramo de exceso se tiñe de
 * verde sobre la barra en vez de alargar la línea. Lo comparten el detalle de
 * producto (meta por mes) y el de cliente (meta promedio del cliente).
 */
function metaMarkerSeries(marks: Array<Array<number | undefined>>): Record<string, unknown> {
  return {
    name: 'Meta',
    type: 'custom',
    silent: true,
    tooltip: { show: false },
    data: marks,
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
  };
}

/** Histórico de 3 meses + mes en curso de un cliente, contra su meta promedio. */
function customerHistoryOption(
  report: ForecastCustomerSalesResponse,
  row: ForecastCustomerSalesRow,
): Record<string, unknown> {
  const categories = [
    ...row.history.map((entry) => monthLabel(entry.year, entry.month, true)),
    monthLabel(report.year, report.month, true),
  ];
  const values = [...row.history.map((entry) => entry.kg), row.actualKg];
  const lastIndex = values.length - 1;
  const meta = row.targetKg > 0 ? row.targetKg : null;
  const growth = monthOverMonthPct(values);
  const numericGrowth = growth.filter((value): value is number => value !== null);
  // La banda superior solo existe si hay al menos dos meses comparables.
  const withBand = numericGrowth.length > 0;
  const growthSpan = withBand ? Math.max(...numericGrowth) - Math.min(...numericGrowth) : 0;
  const growthPad = Math.max(6, growthSpan * 0.18);
  const growthMin = withBand ? Math.min(0, ...numericGrowth) - growthPad : 0;
  const growthMax = withBand ? Math.max(0, ...numericGrowth) + growthPad : 0;
  const axisMax = Math.max(...values, meta ?? 0, 1) * 1.08;
  // 0 = banda de crecimiento (arriba), 1 = barras. Sin banda, las barras usan
  // el grid único y la serie apunta al índice 0.
  const mainIndex = withBand ? 1 : 0;
  // Misma franja horizontal en ambos grids para que meses y línea queden
  // alineados: `containLabel` desplazaría cada grid de forma distinta.
  const plot = { left: 54, right: 42 };

  const tipRow = (name: string, value: string, color = '#fff') =>
    `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px;">
      <span style="color:rgba(255,255,255,.72);">${name}</span>
      <strong style="font-variant-numeric:tabular-nums;color:${color};">${value}</strong>
    </div>`;

  return {
    animationDuration: 450,
    grid: withBand
      ? [
          { ...plot, top: 6, height: 46 },
          { ...plot, top: 74, bottom: 28 },
        ]
      : [{ ...plot, top: 26, bottom: 28 }],
    axisPointer: withBand ? { link: [{ xAxisIndex: 'all' }] } : undefined,
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
        const actual = values[index] ?? 0;
        const delta = meta !== null ? actual - meta : null;
        const growthPct = growth[index] ?? null;
        const lines = [tipRow('Venta real', `${fmtKg(actual)} kg`)];
        if (delta !== null && meta !== null) {
          lines.push(tipRow('Meta promedio', `${fmtKg(meta)} kg`, '#d9f99d'));
          if (delta > 0) {
            lines.push(
              tipRow('Sobre su meta', `+${fmtKg(delta)} kg (${fmtSignedPct((delta / meta) * 100)})`, '#d9f99d'),
            );
          } else if (delta < 0) {
            lines.push(
              tipRow('Bajo su meta', `-${fmtKg(Math.abs(delta))} kg (${fmtSignedPct((delta / meta) * 100)})`, '#fca5a5'),
            );
          } else {
            lines.push(tipRow('Meta', 'cumplida exacta', '#d9f99d'));
          }
        } else {
          lines.push(tipRow('Meta promedio', 'sin meta', 'rgba(255,255,255,.6)'));
        }
        if (growthPct !== null && index > 0) {
          lines.push(tipRow('Crecimiento', `${fmtSignedPct(growthPct)} vs ${categories[index - 1]}`, '#fca5a5'));
        }
        return `<div style="min-width:190px;"><strong>${label}</strong>${lines.join('')}</div>`;
      },
    },
    xAxis: withBand
      ? [
          // Eje del la banda: oculto, solo comparte las categorías.
          { type: 'category', gridIndex: 0, data: categories, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
          {
            type: 'category',
            gridIndex: 1,
            data: categories,
            axisLine: { lineStyle: { color: '#d6ebff' } },
            axisTick: { show: false },
            axisLabel: { color: C.outline, fontSize: 10 },
          },
        ]
      : [
          {
            type: 'category',
            data: categories,
            axisLine: { lineStyle: { color: '#d6ebff' } },
            axisTick: { show: false },
            axisLabel: { color: C.outline, fontSize: 10 },
          },
        ],
    yAxis: [
      ...(withBand
        ? [
            {
              type: 'value',
              gridIndex: 0,
              position: 'right',
              min: growthMin,
              max: growthMax,
              splitNumber: 2,
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
      {
        type: 'value',
        gridIndex: mainIndex,
        max: axisMax,
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.outline, fontSize: 10, formatter: (value: number) => compact(value) },
      },
    ],
    series: [
      {
        name: 'Venta real',
        type: 'bar',
        xAxisIndex: mainIndex,
        yAxisIndex: mainIndex,
        barMaxWidth: 38,
        data: values.map((value, index) => ({
          value,
          itemStyle: {
            color: index === lastIndex ? C.navyLight : C.navy,
            borderRadius: [6, 6, 0, 0],
          },
        })),
        // Meta promedio: una sola referencia continua, porque es la misma para
        // todos los meses (a diferencia de la meta mensual de producto).
        markLine:
          meta === null
            ? undefined
            : {
                symbol: 'none',
                silent: true,
                lineStyle: { color: C.lime, type: 'dashed', width: 2 },
                label: {
                  position: 'insideEndTop',
                  formatter: `meta ${fmtKg(meta)} kg`,
                  color: '#3f6212',
                  fontSize: 9,
                  fontWeight: 'bold',
                },
                data: [{ yAxis: meta }],
              },
      },
      ...(withBand
        ? [
            {
              name: 'Crecimiento',
              type: 'line',
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: growth,
              smooth: 0.25,
              symbol: 'circle',
              symbolSize: 5,
              connectNulls: false,
              lineStyle: { width: 2, color: C.red },
              itemStyle: { color: C.red, borderColor: '#fff', borderWidth: 1 },
              z: 5,
              // 0 % como referencia tenue dentro de la banda.
              markLine: {
                symbol: 'none',
                silent: true,
                lineStyle: { color: 'rgba(220, 38, 38, 0.3)', type: 'dashed', width: 1 },
                label: {
                  position: 'insideEndTop',
                  formatter: '0 %',
                  color: 'rgba(185, 28, 28, 0.75)',
                  fontSize: 8,
                },
                data: [{ yAxis: 0 }],
              },
            },
          ]
        : []),
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
      metaMarkerSeries(metaMarks),
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

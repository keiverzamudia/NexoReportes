'use client';

// ============================================================
// «Vendedor vs Forecast» — informe ejecutivo de la fuerza de ventas.
//
//  �� Hero: cierre proyectado de la red, su cuota global y la franja de
//    reparto de la venta del mes (qué representación tiene cada vendedor).
//  �� Acumulado de la red: real vs proyección vs ritmo de la cuota.
//  �� Ranking: cada vendedor con su cuota, su meta y su cumplimiento.
//  �� Expediente: clientes del vendedor con la meta que a cada uno le toca.
//  �� Tabla completa + CSV.
//
// Las cifras las calcula el API (`/forecast/sellers`); aquí solo se da formato.
// ============================================================

import type { ForecastSellerRow, ForecastSellersResponse } from '@nexo/contracts';
import { AlertTriangle, CalendarDays, Download, Info, ListFilter, RotateCw, Search, Trophy, Users, X } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Badge, Card, Column, DataTable, EmptyState, Skeleton, TextInput, cx, fmtDate } from '../ui';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import {
  SELLER_COLUMN_HELP,
  SELLERS_HELP_RULES,
  SELLERS_HELP_TITLE,
  SELLERS_HELP_TERMS,
} from '../../content/help/sellers';
import { useHelpRow } from '../../lib/use-help-row';
import {
  META_MARKER_PCT,
  buildSellerNarrative,
  buildSellersCsv,
  buildShareSlices,
  filterSellers,
  fmtAttainmentPct,
  quotaGeometry,
  sellersCsvFileName,
  topQuotaSeller,
} from '../../lib/sellers-report';
import {
  dayLabel,
  fmtKg,
  fmtPct,
  fmtTonnes,
  monthLabel,
  salesTone,
} from '../../lib/sales-report';
import { SellerDetailDrawer } from './SellerDetailDrawer';
import {
  AttainmentRing,
  HERO_TONE,
  HeroStat,
  PctPill,
  QuotaBar,
  SellerAvatar,
  ShareStrip,
  TONE_TEXT,
  cumulativeOption,
  useCountUp,
} from './seller-ui';

const STATUS_LABEL: Record<ForecastSellersResponse['status'], string> = {
  OPEN: 'Mes en curso',
  CLOSED: 'Mes cerrado',
  FUTURE: 'Mes futuro',
};

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function SellerReport({
  report,
  isLoading,
  error,
  onRetry,
  historyMonths,
  onHistoryMonthsChange,
  includeToday,
}: {
  report?: ForecastSellersResponse;
  isLoading: boolean;
  error?: Error | null;
  onRetry: () => void;
  historyMonths: number;
  onHistoryMonthsChange: (months: number) => void;
  includeToday: boolean;
}) {
  const [search, setSearch] = useState('');
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithQuota, setOnlyWithQuota] = useState(false);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [helpRow, setHelpRow] = useHelpRow();
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(
    () =>
      report
        ? filterSellers(report.sellers, {
            search: deferredSearch,
            onlyWithSales,
            onlyWithQuota,
          })
        : [],
    [report, deferredSearch, onlyWithSales, onlyWithQuota],
  );

  const slices = useMemo(() => (report ? buildShareSlices(report) : []), [report]);
  const narrative = useMemo(() => (report ? buildSellerNarrative(report) : ''), [report]);
  const chart = useMemo(
    () =>
      report
        ? cumulativeOption({
            daily: report.daily,
            forecastKg: report.totals.forecastKg,
            asOf: report.asOf,
            today: report.days.today,
          })
        : {},
    [report],
  );

  const projectedTonnes = useCountUp(
    report && report.totals.projectedKg !== null ? report.totals.projectedKg / 1000 : null,
  );
  const focusSeller = report && focusCode ? report.sellers.find((seller) => seller.sellerCode === focusCode) ?? null : null;

  const hasFilters = Boolean(search.trim()) || onlyWithSales || onlyWithQuota;
  const clearFilters = useCallback(() => {
    setSearch('');
    setOnlyWithSales(false);
    setOnlyWithQuota(false);
  }, []);

  const openSeller = useCallback((code: string) => {
    if (code === '__otras__') return;
    setFocusCode((current) => (current === code ? null : code));
  }, []);
  const closeSeller = useCallback(() => setFocusCode(null), []);

  if (isLoading && !report) return <SellerSkeleton />;

  if (error && !report) {
    return (
      <Card className="flex flex-col items-start gap-space-sm p-space-lg">
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" />
          No se pudo cargar el informe de vendedores: {error.message}
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
            <p className="text-body-md text-on-warning-container/90">
              El informe no muestra ceros como si fueran ventas. Revisa la conexión con Profit y vuelve a intentar.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-space-2xs rounded-lg bg-warning px-space-md text-label-md font-semibold text-white transition-transform hover:-translate-y-0.5"
        >
          <RotateCw aria-hidden className="size-4" /> Reintentar
        </button>
      </Card>
    );
  }

  const totals = report.totals;
  const isOpen = report.status === 'OPEN';
  const projectedAttainment = totals.projectedAttainmentPct;
  const attainment = totals.attainmentPct;
  const tone = salesTone(projectedAttainment ?? attainment);
  const gapKg = totals.gapKg;
  const leader = topQuotaSeller(report);

  const columns: Column<ForecastSellerRow>[] = [
    {
      key: 'vendedor',
      header: 'Vendedor',
      kind: 'id',
      help: SELLER_COLUMN_HELP.vendedor,
      sortValue: (row) => row.sellerName,
      render: (row) => (
        <div className="flex items-center gap-space-xs">
          <SellerAvatar name={row.sellerName} rank={1} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1 truncate font-semibold text-on-surface" title={row.sellerName}>
              {row.sellerName}
              {row.isInternal && <Badge tone="muted">Cuenta interna</Badge>}
            </p>
            <p className="text-label-sm tabular-nums text-outline">{row.sellerCode || 'sin código'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'clientes',
      header: 'Clientes',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.clientes,
      sortValue: (row) => row.clientCount,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-on-surface">{fmtKg(row.clientCount, 0)}</p>
          <p className="text-label-sm text-outline">
            {fmtKg(row.activeClientCount, 0)} con venta
            {row.assignedClientCount !== row.clientCount
              ? ` · ${fmtKg(row.assignedClientCount, 0)} en cartera`
              : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'cuota',
      header: 'Cuota %',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.cuota,
      sortValue: (row) => row.quotaPct ?? -1,
      render: (row) => (
        <span className="tabular-nums font-semibold text-primary">{row.quotaPct === null ? '—' : fmtPct(row.quotaPct)}</span>
      ),
    },
    {
      key: 'meta',
      header: 'Meta kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.meta,
      sortValue: (row) => row.targetKg,
      render: (row) => (
        <span className="tabular-nums font-semibold text-on-surface">{row.targetKg > 0 ? fmtKg(row.targetKg) : '—'}</span>
      ),
    },
    {
      key: 'venta',
      header: 'Venta kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.venta,
      sortValue: (row) => row.actualKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.actualKg)}</p>
          {row.executedKg !== row.actualKg && (
            <p className="text-label-sm text-outline">nota {fmtKg(row.executedKg)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'cumplimiento',
      header: 'Cumplimiento',
      align: 'right',
      kind: 'status',
      help: SELLER_COLUMN_HELP.cumplimiento,
      sortValue: (row) => row.projectedAttainmentPct ?? row.attainmentPct ?? -1,
      render: (row) => <PctPill pct={row.projectedAttainmentPct ?? row.attainmentPct} emptyLabel="—" />,
    },
    {
      key: 'proyeccion',
      header: 'Proyección kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.proyeccion,
      sortValue: (row) => row.projectedKg ?? -1,
      render: (row) => (
        <span className="tabular-nums text-on-surface">{row.projectedKg === null ? '—' : fmtKg(row.projectedKg)}</span>
      ),
    },
    {
      key: 'brecha',
      header: 'Brecha kg',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.brecha,
      sortValue: (row) => row.gapKg ?? -1,
      render: (row) => {
        const gap = row.gapKg;
        if (gap === null) return <span className="text-outline">—</span>;
        return (
          <span className={cx('tabular-nums font-semibold', gap < 0 ? 'text-critical' : 'text-success')}>
            {gap > 0 ? '+' : ''}
            {fmtKg(gap)} kg
          </span>
        );
      },
    },
    {
      key: 'reparto',
      header: 'Reparto mes',
      align: 'right',
      kind: 'metric',
      help: SELLER_COLUMN_HELP.reparto,
      sortValue: (row) => row.currentSharePct ?? -1,
      render: (row) => (
        <span className="tabular-nums text-on-surface-variant">
          {row.currentSharePct === null ? '—' : fmtPct(row.currentSharePct)}
        </span>
      ),
    },
    {
      key: 'ritmo',
      header: 'Ritmo nec.',
      align: 'right',
      kind: 'detail',
      help: SELLER_COLUMN_HELP.ritmo,
      sortValue: (row) => row.requiredDailyKg ?? -1,
      render: (row) => (
        <span className="tabular-nums text-on-surface-variant">
          {row.requiredDailyKg === null ? '—' : `${fmtKg(row.requiredDailyKg)} kg/día`}
        </span>
      ),
    },
    {
      key: 'ultimaNota',
      header: 'Última nota',
      kind: 'detail',
      help: SELLER_COLUMN_HELP.ultimaNota,
      sortValue: (row) => row.lastInvoiceDate ?? '',
      render: (row) => <span className="text-label-md text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  return (
    <>
      {/* Avisos de origen de la meta */}
      {!report.forecastAvailable && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-md py-space-sm text-body-md text-on-warning-container">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          No se pudo leer la meta de Profit ni hay snapshot: se muestra la venta y el reparto, pero los porcentajes de
          cumplimiento quedan en «—».
        </p>
      )}

      {report.allocationBasis === 'EQUAL_FALLBACK' && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-primary-fixed/40 px-space-md py-space-sm text-body-md text-primary">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          La ventana histórica no tiene meses cerrados: la meta se repartió en partes iguales entre los vendedores.
          Cuando haya histórico, la cuota pasará a ser proporcional a la venta.
        </p>
      )}

      {report.status !== 'OPEN' && report.forecastSource === 'NONE' && (
        <p role="status" className="flex items-start gap-space-sm rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-md text-on-surface-variant">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          No hay meta en Profit ni snapshot guardado para {monthLabel(report.year, report.month)}. Se muestra la venta real y
          el reparto; las cuotas no se pueden calcular.
        </p>
      )}

      {/* ---------- Hero ---------- */}
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
              <span className="rounded-pill bg-white/10 px-space-sm py-1 text-label-sm font-semibold normal-case tracking-normal text-white/75">
                {report.attribution === 'PORTFOLIO' ? 'Cartera Profit' : 'Nota de entrega'}
              </span>
              <span className="text-label-md text-white/65">
                Corte {report.asOf ? dayLabel(report.asOf) : 'sin ventas'} · {report.days.workingElapsed}/
                {report.days.workingInMonth} días hábiles
              </span>
              <span className="text-label-md text-white/45">·</span>
              <span className="text-label-md text-white/65">
                {fmtKg(totals.sellerCount, 0)} vendedores ·{' '}
                {report.attribution === 'PORTFOLIO'
                  ? `${fmtKg(totals.assignedClientCount, 0)} en cartera`
                  : `${fmtKg(totals.clientCount, 0)} clientes`}{' '}
                · {fmtKg(totals.activeClientCount, 0)} con venta este mes
              </span>
              <span className="text-label-md text-white/45">·</span>
              <span className="text-label-md text-white/65">
                Histórico: {report.sellers[0]?.history.length ?? 0} meses cerrados
              </span>
            </div>

            <div>
              <p className="text-label-sm font-semibold uppercase tracking-[0.16em] text-white/55">
                {report.status === 'FUTURE' ? 'Meta del mes' : isOpen ? 'Proyección de cierre de la red' : 'Venta del mes'}
              </p>
              <div className="mt-space-2xs flex flex-wrap items-end gap-space-sm">
                <span
                  className="font-display tabular-nums text-[3.4rem] font-black leading-none tracking-tight"
                  style={{ color: tone === 'none' ? 'rgb(255 255 255 / 0.75)' : HERO_TONE[tone] }}
                >
                  {totals.projectedKg === null ? '—' : fmtKg(projectedTonnes, 1)}
                </span>
                <span className="pb-2 text-title-md font-semibold text-white/55">t</span>
                <span className="mb-1.5 rounded-pill bg-white/10 px-space-sm py-1 text-label-md font-semibold text-white/75">
                  {totals.projectedKg === null ? 'sin proyección' : `${fmtKg(totals.projectedKg)} kg`}
                </span>
              </div>
              <p className="mt-space-xs max-w-2xl text-body-md text-white/70">{narrative}</p>
            </div>

            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
              <HeroStat label="Venta acumulada" value={`${fmtKg(totals.actualKg)} kg`} hint={`${fmtTonnes(totals.actualKg)} t`} />
              <HeroStat
                label="Forecast"
                value={totals.forecastKg > 0 ? `${fmtKg(totals.forecastKg)} kg` : 'Sin meta'}
                hint={totals.forecastKg > 0 ? `${fmtTonnes(totals.forecastKg)} t` : 'no hay meta repartible'}
              />
              <HeroStat
                label="Brecha"
                value={gapKg === null ? '—' : `${gapKg > 0 ? '+' : ''}${fmtKg(gapKg)} kg`}
                hint={gapKg === null ? 'depende de la meta' : gapKg >= 0 ? 'por encima del forecast' : 'por debajo del forecast'}
              />
              <HeroStat
                label={isOpen ? 'Ritmo necesario' : 'Entregas'}
                value={
                  isOpen
                    ? totals.requiredDailyKg === null
                      ? '—'
                      : `${fmtKg(totals.requiredDailyKg)} kg/día`
                    : fmtKg(totals.invoiceCount, 0)
                }
                hint={
                  isOpen
                    ? `${report.days.workingRemaining} días hábiles restantes`
                    : `última ${totals.lastInvoiceDate ? dayLabel(totals.lastInvoiceDate) : '—'}`
                }
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-space-sm justify-self-center rounded-2xl border border-white/10 bg-white/5 p-space-md">
            <AttainmentRing pct={report.status === 'FUTURE' ? null : projectedAttainment} tone={tone} label="del forecast" />
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

        {slices.length > 0 && (
          <div className="relative mt-space-lg border-t border-white/10 pt-space-md">
            <div className="mb-space-xs flex flex-wrap items-baseline justify-between gap-space-sm">
              <div>
                <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-white/55">
                  Reparto de la venta del mes
                </p>
                <p className="text-label-md text-white/55">
                  Qué representación tiene cada vendedor en la venta de la red. Clic en un tramo para abrir su expediente.
                </p>
              </div>
              {leader && leader.quotaPct !== null && (
                <span className="inline-flex items-center gap-1 rounded-pill bg-secondary-container/15 px-space-sm py-1 text-label-sm font-semibold text-secondary-container">
                  <Trophy aria-hidden className="size-3.5" /> Mayor cuota: {leader.sellerName.split(' ')[0]} ·{' '}
                  {fmtPct(leader.quotaPct)}
                </span>
              )}
            </div>
            <ShareStrip slices={slices} onSelect={openSeller} />
          </div>
        )}
      </section>

      {/* ---------- Gráficas ---------- */}
      <div className="grid items-start gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden animate-rise">
          <header className="flex flex-wrap items-end justify-between gap-space-sm px-space-md pt-space-md">
            <div>
              <h2 className="text-title-md font-bold text-on-surface">Acumulado de la red</h2>
              <p className="text-label-md text-on-surface-variant">
                {isOpen
                  ? 'Real hasta el corte · proyección punteada · ritmo uniforme de la meta'
                  : 'Venta real acumulada · ritmo uniforme de la meta'}
              </p>
            </div>
            {totals.actualKg > 0 && (
              <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded-pill bg-primary-container" /> Real
                </span>
                {isOpen && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-4 rounded-pill bg-secondary-container" /> Proyección
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded-pill bg-outline" /> Ritmo de cuota
                </span>
              </div>
            )}
          </header>
          <div className="px-space-sm pb-space-sm">
            {report.daily.length > 0 && totals.actualKg > 0 ? (
              <EChart
                option={chart}
                height={300}
                ariaLabel="Acumulado de la red: venta real, proyección y ritmo de la meta"
              />
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
                  Desempeño por vendedor
                </h2>
                <p className="text-label-md text-on-surface-variant">
                  {hasFilters ? `${fmtKg(filtered.length, 0)} de ${fmtKg(report.sellers.length, 0)}` : fmtKg(report.sellers.length, 0)}{' '}
                  vendedores · cada barra se mide contra su cuota
                  <span className="block text-outline">Haz clic en un vendedor para abrir su expediente.</span>
                </p>
              </div>
              <Badge tone="primary">{fmtKg(filtered.length, 0)}</Badge>
            </div>

            <div className="mt-space-sm flex flex-wrap items-center gap-space-2xs" role="group" aria-label="Filtros del ranking">
              <TextInput
                icon={Search}
                value={search}
                onChange={setSearch}
                placeholder="Buscar vendedor…"
                ariaLabel="Buscar vendedor"
                className="min-w-[11rem] flex-1"
              />
              <button
                type="button"
                onClick={() => setOnlyWithSales((value) => !value)}
                aria-pressed={onlyWithSales}
                className={cx(
                  'inline-flex h-10 shrink-0 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                  onlyWithSales
                    ? 'bg-primary-container text-on-primary'
                    : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                )}
              >
                Con venta
              </button>
              <button
                type="button"
                onClick={() => setOnlyWithQuota((value) => !value)}
                aria-pressed={onlyWithQuota}
                className={cx(
                  'inline-flex h-10 shrink-0 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                  onlyWithQuota
                    ? 'bg-primary-container text-on-primary'
                    : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                )}
              >
                Con cuota
              </button>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl px-space-xs text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X aria-hidden className="size-3.5" /> Limpiar
                </button>
              )}
            </div>
          </header>

          <div className="px-space-md pb-space-md pt-space-sm">
            <div className="mb-space-xs px-space-xs">
              <div className="relative h-4 text-label-sm text-outline">
                <span className="absolute left-0 top-0 leading-none">0 %</span>
                <span
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-semibold leading-none text-secondary"
                  style={{ left: `${META_MARKER_PCT}%` }}
                >
                  cuota 100 %
                </span>
              </div>
              <div className="relative h-3">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-surface-container-high" />
                <span
                  aria-hidden
                  className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-pill bg-secondary"
                  style={{ left: `calc(${META_MARKER_PCT}% - 1px)` }}
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Sin vendedores para el filtro"
                description="Prueba con otro texto o desactiva los filtros."
              />
            ) : (
              <ul className="flex max-h-[560px] flex-col gap-space-2xs overflow-y-auto pr-1">
                {filtered.map((seller, index) => {
                  const pct = seller.projectedAttainmentPct ?? seller.attainmentPct;
                  const sellerTone = salesTone(pct);
                  const geometry = quotaGeometry(seller);
                  const overPct = pct !== null && Number.isFinite(pct) && pct > 100 && pct <= 999 ? pct - 100 : null;
                  return (
                    <li key={seller.sellerCode || seller.sellerName}>
                      <button
                        type="button"
                        onClick={() => openSeller(seller.sellerCode)}
                        aria-haspopup="dialog"
                        title={`Abrir el expediente de ${seller.sellerName}`}
                        className="group w-full rounded-xl px-2 py-2 text-left transition-all duration-200 hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70"
                      >
                        <div className="flex items-start gap-space-sm">
                          <span className="mt-0.5 w-4 shrink-0 text-center tabular-nums text-label-sm font-black text-outline">
                            {index + 1}
                          </span>
                          <SellerAvatar name={seller.sellerName} rank={index + 1} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-space-sm">
                              <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate font-semibold text-on-surface">{seller.sellerName}</span>
                                {seller.isInternal && <Badge tone="muted">Interna</Badge>}
                              </span>
                              <span className="flex shrink-0 flex-col items-end leading-tight">
                                <span className={cx('tabular-nums text-label-md font-bold', TONE_TEXT[sellerTone])}>
                                  {geometry.hasMeta ? fmtAttainmentPct(pct) : 'Sin cuota'}
                                </span>
                                {overPct !== null && (
                                  <span className="whitespace-nowrap text-label-sm font-semibold text-success">
                                    +{fmtPct(overPct)} sobre cuota
                                  </span>
                                )}
                              </span>
                            </div>
                            <p className="truncate text-label-sm text-outline">
                              Cuota {seller.quotaPct === null ? '—' : fmtPct(seller.quotaPct)} ·{' '}
                              {report.attribution === 'PORTFOLIO'
                                ? `${fmtKg(seller.assignedClientCount, 0)} en cartera`
                                : `${fmtKg(seller.clientCount, 0)} clientes`}{' '}
                              · {fmtKg(seller.activeClientCount, 0)} con venta ·{' '}
                              {seller.currentSharePct === null ? '—' : fmtPct(seller.currentSharePct)} del mes
                            </p>
                            <QuotaBar
                              targetKg={seller.targetKg}
                              actualKg={seller.actualKg}
                              projectedKg={seller.projectedKg}
                              showProjection={isOpen}
                              className="mt-1.5"
                            />
                            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-space-sm gap-y-0.5 text-label-sm">
                              <span className="tabular-nums text-on-surface-variant">
                                Meta <strong className="text-on-surface">{fmtKg(seller.targetKg)}</strong> kg
                              </span>
                              <span className="tabular-nums text-on-surface-variant">
                                Venta <strong className="text-on-surface">{fmtKg(seller.actualKg)}</strong> kg
                              </span>
                              {seller.executedKg !== seller.actualKg && (
                                <span className="tabular-nums text-outline">
                                  Nota <strong className="text-on-surface-variant">{fmtKg(seller.executedKg)}</strong> kg
                                </span>
                              )}
                              <span
                                className={cx(
                                  'tabular-nums font-semibold',
                                  seller.gapKg === null ? 'text-outline' : seller.gapKg < 0 ? 'text-critical' : 'text-success',
                                )}
                              >
                                {seller.gapKg === null ? '—' : `${seller.gapKg > 0 ? '+' : ''}${fmtKg(seller.gapKg)} kg`}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-space-xs flex flex-wrap items-center gap-space-sm border-t border-surface-container pt-space-xs text-label-sm text-on-surface-variant">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Real
              </span>
              {isOpen && (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="size-2 rounded-full bg-secondary-container/60" /> Proyección
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="h-3 w-[2px] rounded-pill bg-secondary" /> Marcador verde = 100 % de su cuota
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------- Tabla completa ---------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container px-space-md py-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm text-label-md text-on-surface-variant">
            <span>
              <strong className="tabular-nums text-on-surface">{fmtKg(report.sellers.length, 0)}</strong> vendedores · Σ meta{' '}
              <strong className="tabular-nums text-on-surface">{fmtKg(totals.forecastKg)} kg</strong> · Σ venta{' '}
              <strong className="tabular-nums text-on-surface">{fmtKg(totals.actualKg)} kg</strong>
            </span>
            <span className="hidden text-outline md:inline">
              La cuota de cada uno se calcula con su participación histórica.
            </span>
            <button
              type="button"
              onClick={() => setHelpRow(!helpRow)}
              aria-pressed={helpRow}
              className={cx(
                'inline-flex h-8 items-center rounded-lg px-space-xs font-semibold transition-colors',
                helpRow ? 'bg-primary-container/10 text-primary' : 'text-on-surface-variant hover:text-primary',
              )}
            >
              {helpRow ? 'Ocultar explicaciones' : 'Explicar columnas'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <button
              type="button"
              onClick={() => downloadCsv(buildSellersCsv(report), sellersCsvFileName(report))}
              className="inline-flex h-9 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-sm text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
            >
              <Download aria-hidden className="size-4" /> CSV
            </button>
            <ModuleHelp
              title={SELLERS_HELP_TITLE}
              narrative="La venta se atribuye a la cartera asignada en Profit (o a la nota de entrega, según el criterio). La meta de la empresa se reparte por participación histórica y cada vendedor reparte la suya entre sus clientes."
              rules={SELLERS_HELP_RULES}
              terms={SELLERS_HELP_TERMS}
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.sellerCode || row.sellerName}
          showHelpRow={helpRow}
          empty={
            <EmptyState
              icon={Users}
              title="Sin vendedores para el filtro"
              description="Prueba con otro texto o desactiva los filtros."
            />
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-xs text-label-sm text-on-surface-variant">
          <span>
            {report.allocationBasis === 'HISTORY'
              ? 'Cuota = participación en los meses cerrados de la ventana histórica.'
              : report.allocationBasis === 'EQUAL_FALLBACK'
                ? 'Sin histórico: cuota igualitaria entre vendedores.'
                : 'Sin meta: no hay cuota que repartir.'}
          </span>
          <span>
            Σ cuotas = 100 % · Σ metas = meta de la empresa · fuente:{' '}
            {report.attribution === 'PORTFOLIO' ? 'cartera Profit (clientes.co_ven)' : 'notas de entrega ABA'}
          </span>
        </div>
      </Card>

      {focusSeller && (
        <SellerDetailDrawer
          seller={focusSeller}
          report={report}
          onClose={closeSeller}
          historyMonths={historyMonths}
          onHistoryMonthsChange={onHistoryMonthsChange}
          includeToday={includeToday}
        />
      )}
    </>
  );
}

function SellerSkeleton() {
  return (
    <div className="flex flex-col gap-space-lg">
      <Skeleton className="h-[300px] w-full rounded-card" />
      <div className="grid gap-space-lg xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Skeleton className="h-[380px] rounded-card" />
        <Skeleton className="h-[380px] rounded-card" />
      </div>
      <Skeleton className="h-[280px] rounded-card" />
    </div>
  );
}

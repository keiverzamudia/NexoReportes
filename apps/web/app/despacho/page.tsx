'use client';

// ============================================================
// Despacho — bandeja de trabajo del almacén.
//
//   · Pendientes → todo lo abierto, sin importar quién lo publicó.
//   · Publicados por mí → lo que envié desde el simulador (solo con permiso).
//   · Historial → despachos cerrados o anulados + resumen y reporte de tiempos.
//
// La simulación se envía completa desde Pedidos. Aquí no hay acuse: el primer
// operador que inicia la carga toma la hoja. Nada escribe en Profit.
// ============================================================

import type {
  DispatchMetricsResponse,
  DispatchPulse,
  DispatchSheetListResponse,
  DispatchSheetStatus,
  DispatchSheetSummary,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ClipboardList,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DispatchPulseStrip } from '../../components/DispatchPulseStrip';
import { DispatchTimesReport } from '../../components/DispatchTimesReport';
import { SheetStatusBadge } from '../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DataTable, EmptyState, PageHeader, Select, Segmented, TextInput, type Column, cx } from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import { formatBusinessDate, formatDateTime, formatNumber, relativeTime, sortSheets } from '../../lib/dispatch-sheet';
import { hasPermission } from '../../lib/permissions';

type Scope = 'pending' | 'created' | 'history';
type HistoryPreset = '7d' | '30d' | '90d' | '12m' | 'custom';

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'EN_PROCESO', label: 'En carga' },
  { value: 'DESPACHADO', label: 'Despachados' },
  { value: 'CANCELADO', label: 'Anulados' },
];

const HISTORY_PRESETS: Array<{ value: HistoryPreset; label: string }> = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'custom', label: 'Personalizado' },
];

const SCOPE_LABELS: Record<Scope, string> = {
  pending: 'Pendientes',
  created: 'Publicados por mí',
  history: 'Historial',
};

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: HistoryPreset): { from: string; to: string } {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '90d':
      start.setDate(start.getDate() - 89);
      break;
    case '12m':
      start.setMonth(start.getMonth() - 11, 1);
      break;
    case '30d':
    default:
      start.setDate(start.getDate() - 29);
      break;
  }
  return { from: isoDate(start), to: isoDate(end) };
}

function HistoryMetric({
  value,
  label,
  tone = 'text-primary',
}: {
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cx('text-label-lg font-bold tabular-nums', tone)}>{value}</span>
      <span className="text-label-sm text-on-surface-variant">{label}</span>
    </span>
  );
}

export default function DespachoPage() {
  const [tick, setTick] = useState(0);
  const [scope, setScope] = useState<Scope>('pending');
  const [status, setStatus] = useState<DispatchSheetStatus | ''>('');
  const [q, setQ] = useState('');
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('30d');
  const [historyRange, setHistoryRange] = useState(() => rangeForPreset('30d'));
  const [historyStatsOpen, setHistoryStatsOpen] = useState(false);

  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const isOperator = hasPermission(permissions, 'despacho', 'update');
  // «Armar y enviar simulación» se habilita con el permiso de Despacho.
  const canSendSimulation = hasPermission(permissions, 'despacho', 'create');
  const canSeeCreated = canSendSimulation;
  const canSeeHistory = true;
  // Mismo criterio que la API: rol con visibilidad total o permiso individual.
  const canViewAll =
    ['ADMIN', 'GERENCIA', 'ALMACEN'].includes(sessionUser?.role ?? '') ||
    hasPermission(permissions, 'despacho', 'view_all');
  // Franja de pendientes: permiso propio, asignable por usuario. Por defecto
  // solo lo tiene ADMIN (la matriz lo concede después, sin tocar el código).
  const canSeePulse = hasPermission(permissions, 'despacho', 'view_summary');

  // La bandeja siempre arranca en lo que hay por cargar.
  useEffect(() => {
    setScope('pending');
  }, [sessionUser?.id]);

  const params = new URLSearchParams();
  params.set('scope', scope);
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  if (scope === 'history') {
    params.set('from', historyRange.from);
    params.set('to', historyRange.to);
  }

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchSheetListResponse>({
    queryKey: [
      'dispatch-sheets',
      tick,
      scope,
      status,
      q,
      scope === 'history' ? historyRange.from : '',
      scope === 'history' ? historyRange.to : '',
    ],
    queryFn: () => apiFetch<DispatchSheetListResponse>(`/dispatch-sheets?${params.toString()}`),
    refetchInterval: 20_000,
    // El tablero del almacén no se congela cuando la pestaña no tiene foco.
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  // Se pide solo a quien tiene el permiso. No depende del tab: siempre mide
  // las hojas abiertas, no el filtro que esté viendo el operador.
  const {
    data: pulse,
    isLoading: pulseLoading,
    error: pulseError,
  } = useQuery<DispatchPulse>({
    queryKey: ['dispatch-pulse'],
    queryFn: () => apiFetch<DispatchPulse>('/dispatch-sheets/pulse'),
    enabled: canSeePulse,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  // Resumen del historial: solo despachos cerrados y por fecha de cierre.
  const historyStatsParams = new URLSearchParams({
    from: historyRange.from,
    to: historyRange.to,
    granularity: 'day',
    invoiceStatus: 'all',
    onlyClosed: 'true',
  });
  const {
    data: historyStats,
    isLoading: historyStatsLoading,
    error: historyStatsError,
  } = useQuery<DispatchMetricsResponse>({
    queryKey: ['dispatch-metrics', historyRange.from, historyRange.to, 'day', '', 'all', true],
    queryFn: () => apiFetch<DispatchMetricsResponse>(`/dispatch-sheets/metrics?${historyStatsParams.toString()}`),
    enabled: scope === 'history',
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const sheets = useMemo(() => sortSheets(data?.items ?? []), [data]);
  const hasFilters = Boolean(status || q);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const columns: Column<DispatchSheetSummary>[] = [
    {
      key: 'number',
      header: 'Despacho',
      kind: 'id',
      sortValue: (row) => row.number,
      render: (row) => (
        <Link href={`/despacho/${row.id}`} className="flex flex-col leading-tight">
          <span className="font-bold tabular-nums text-primary">{row.number}</span>
          <span className="max-w-[18rem] truncate text-body-md text-on-surface-variant" title={row.title}>
            Enviado por {row.createdByName ?? row.createdByCode ?? '—'}
          </span>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      kind: 'status',
      sortValue: (row) => row.status,
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <SheetStatusBadge status={row.status} />
          {row.status === 'CANCELADO' && row.cancelReason && (
            <span className="max-w-[16rem] truncate text-label-sm text-outline" title={row.cancelReason}>
              {row.cancelReason}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'orders',
      header: scope === 'history' ? 'Pedidos' : 'Pedidos pend.',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => (scope === 'history' ? row.plannedOrders : row.pendingOrders),
      render: (row) => {
        const value = scope === 'history' ? row.plannedOrders : row.pendingOrders;
        return (
          <span className="flex flex-col items-end leading-tight tabular-nums">
            <span className="font-semibold text-on-surface">{value}</span>
            {scope !== 'history' && row.plannedOrders !== value && (
              <span className="text-label-sm text-outline">de {row.plannedOrders}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'progress',
      header: 'Renglones',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.progress,
      render: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-semibold tabular-nums text-on-surface">
            {row.linesDone}/{row.plannedLines}
          </span>
          <span className="h-1 w-16 overflow-hidden rounded-pill bg-surface-container-high">
            <span className="block h-full rounded-pill bg-secondary-container" style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </span>
        </span>
      ),
    },
    {
      key: 'sacks',
      header: scope === 'history' ? 'Sacos' : 'Sacos plan',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.plannedSacks,
      render: (row) => (
        <span className="tabular-nums">
          <span className="font-semibold text-primary">{formatNumber(row.plannedSacks)}</span>
          {row.loadedSacks > 0 && row.loadedSacks !== row.plannedSacks && (
            <span className="ml-space-xs text-label-sm text-secondary">({formatNumber(row.loadedSacks)} real)</span>
          )}
        </span>
      ),
    },
    {
      key: 'kg',
      header: scope === 'history' ? 'Kg' : 'Kg plan',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.plannedKg,
      render: (row) => (
        <span className="flex flex-col items-end leading-tight tabular-nums">
          <span className="font-semibold text-on-surface">{formatNumber(row.plannedKg)}</span>
          {row.status === 'DESPACHADO' && (
            <span className={cx('text-label-sm', row.differenceKg < 0 ? 'text-error' : 'text-secondary')}>
              {row.differenceKg === 0 ? 'sin diferencia' : `${formatNumber(row.differenceKg)} kg`}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'delivery',
      header: 'Entrega',
      kind: 'field',
      sortValue: (row) => row.nextDeliveryDate ?? '9999-12-31',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{formatBusinessDate(row.nextDeliveryDate)}</span>,
    },
    ...(scope === 'history'
      ? [
          {
            key: 'closed',
            header: 'Cerrado',
            kind: 'field',
            sortValue: (row: DispatchSheetSummary) => row.completedAt ?? row.canceledAt ?? '',
            render: (row: DispatchSheetSummary) => {
              const at = row.completedAt ?? row.canceledAt;
              return (
                <span className="flex flex-col leading-tight">
                  <span className="tabular-nums text-on-surface-variant">{formatDateTime(at)}</span>
                  {row.status === 'CANCELADO' && <span className="text-label-sm text-outline">anulado</span>}
                </span>
              );
            },
          } as Column<DispatchSheetSummary>,
        ]
      : []),
    {
      key: 'customers',
      header: 'Clientes',
      kind: 'field',
      render: (row) => (
        <span className="block max-w-[14rem] truncate text-on-surface-variant" title={row.customers.join(' · ')}>
          {row.customers.length > 0 ? row.customers.join(' · ') : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      kind: 'action',
      align: 'right',
      render: (row) => (
        <Link
          href={`/despacho/${row.id}`}
          className={cx(
            'inline-flex h-10 items-center gap-space-xs rounded-pill px-space-sm font-semibold text-label-md transition-all md:h-8',
            row.canOperate && row.status !== 'DESPACHADO' && row.status !== 'CANCELADO'
              ? 'bg-secondary-container text-on-secondary shadow-soft hover:-translate-y-0.5'
              : 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
          )}
        >
          Abrir
        </Link>
      ),
    },
  ];

  const scopeOptions = [
    { value: 'pending' as const, label: SCOPE_LABELS.pending },
    ...(canSeeCreated ? [{ value: 'created' as const, label: SCOPE_LABELS.created }] : []),
    ...(canSeeHistory ? [{ value: 'history' as const, label: SCOPE_LABELS.history }] : []),
  ];

  // En el historial no tiene sentido filtrar por «En carga»: solo se cierra
  // o se anula. Al cambiar de pestaña se limpia el estado para no arrastrarlo.
  const statusOptions =
    scope === 'history'
      ? [
          { value: '', label: 'Estado: Todos' },
          { value: 'DESPACHADO', label: 'Despachados' },
          { value: 'CANCELADO', label: 'Anulados' },
        ]
      : STATUS_OPTIONS;

  const subtitle =
    scope === 'pending'
      ? 'Todo lo que falta por cargar. El primer operador que inicia la carga toma el despacho.'
      : scope === 'created'
        ? 'Las simulaciones que enviaste al almacén y su avance.'
        : canViewAll
          ? 'Historial completo: despachos cerrados y anulados. El resumen y las estadísticas usan la fecha de cierre.'
          : 'Tus despachos cerrados y anulados. El resumen y las estadísticas usan la fecha de cierre.';

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Almacén · Bandeja de despacho"
          icon={ClipboardList}
          title="Despacho"
          subtitle={subtitle}
          actions={
            canSendSimulation ? (
              <Link
                href="/pedidos"
                className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
              >
                <Truck aria-hidden className="size-4" /> Armar y enviar simulación
              </Link>
            ) : null
          }
        />

        {canSeePulse && scope !== 'history' && (
          <DispatchPulseStrip pulse={pulse} loading={pulseLoading} error={pulseError} />
        )}

        {scope === 'history' && (
          <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-space-md py-space-sm">
            <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Resumen del período</span>
            <span className="text-label-sm tabular-nums text-outline">
              {formatBusinessDate(historyRange.from)} – {formatBusinessDate(historyRange.to)}
            </span>
            {historyStatsLoading && !historyStats ? (
              <span className="text-label-sm text-on-surface-variant">Calculando…</span>
            ) : historyStats ? (
              <>
                <HistoryMetric value={formatNumber(historyStats.summary.dispatches)} label="despachos" />
                <HistoryMetric value={formatNumber(historyStats.summary.orders)} label="pedidos" />
                <HistoryMetric value={formatNumber(historyStats.summary.lines)} label="renglones" />
                <HistoryMetric value={formatNumber(historyStats.summary.kg)} label="kg" />
                <HistoryMetric
                  value={historyStats.summary.onTime.pct === null ? '—' : `${historyStats.summary.onTime.pct}%`}
                  label="a tiempo"
                  tone={
                    historyStats.summary.onTime.pct === null
                      ? 'text-outline'
                      : historyStats.summary.onTime.pct < 90
                        ? 'text-warning'
                        : 'text-secondary'
                  }
                />
                <HistoryMetric
                  value={formatNumber(historyStats.summary.invoice.pending)}
                  label="facturas pend."
                  tone={historyStats.summary.invoice.pending > 0 ? 'text-warning' : 'text-secondary'}
                />
              </>
            ) : (
              <span className="text-label-sm text-on-surface-variant">Sin datos en el período.</span>
            )}
            <button
              type="button"
              onClick={() => setHistoryStatsOpen((open) => !open)}
              className="ml-auto inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-expanded={historyStatsOpen}
            >
              <BarChart3 aria-hidden className="size-4" />
              {historyStatsOpen ? 'Ocultar reporte' : 'Ver reporte completo'}
              <ChevronDown aria-hidden className={cx('size-3.5 transition-transform', historyStatsOpen && 'rotate-180')} />
            </button>
          </Card>
        )}

        {historyStatsError && !(historyStatsError instanceof AuthRequiredError) && scope === 'history' && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {historyStatsError instanceof Error ? historyStatsError.message : 'No se pudo consultar el resumen'}
          </p>
        )}

        <Card className="flex flex-col">
          <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
            <div className="flex flex-wrap items-center gap-space-sm">
              <Segmented
                ariaLabel="Bandeja de despacho"
                value={scope}
                onChange={(value) => {
                  setScope(value as Scope);
                  setStatus('');
                }}
                options={scopeOptions}
              />
              {scope === 'history' && (
                <>
                  <Select
                    className="w-44"
                    value={historyPreset}
                    onChange={(value) => {
                      const next = value as HistoryPreset;
                      setHistoryPreset(next);
                      if (next !== 'custom') setHistoryRange(rangeForPreset(next));
                    }}
                    options={HISTORY_PRESETS}
                    ariaLabel="Período del historial"
                  />
                  <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    Desde
                    <input
                      type="date"
                      value={historyRange.from}
                      max={historyRange.to}
                      onChange={(event) => {
                        setHistoryPreset('custom');
                        setHistoryRange((current) => ({ ...current, from: event.target.value }));
                      }}
                      className="h-9 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    Hasta
                    <input
                      type="date"
                      value={historyRange.to}
                      min={historyRange.from}
                      onChange={(event) => {
                        setHistoryPreset('custom');
                        setHistoryRange((current) => ({ ...current, to: event.target.value }));
                      }}
                      className="h-9 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
                    />
                  </label>
                </>
              )}
              <Select className="w-44" value={status} onChange={(value) => setStatus(value as DispatchSheetStatus | '')} options={statusOptions} ariaLabel="Estado" />
              <TextInput className="w-56" icon={Search} value={q} onChange={setQ} placeholder="Buscar N° o título…" ariaLabel="Buscar despacho" />
            </div>
            <div className="flex items-center gap-space-sm">
              {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
              <span className="text-label-sm normal-case text-on-surface-variant">
                {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
              </span>
              <Badge tone={hasFilters ? 'primary' : 'muted'} dot>
                {sheets.length} despacho{sheets.length === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={sheets}
            rowKey={(row) => row.id}
            loading={isLoading}
            defaultSortKey={scope === 'history' ? 'closed' : 'number'}
            maxHeightClass="md:max-h-[min(72vh,900px)]"
            mobileSummary={<span>{sheets.length} despacho(s) en {SCOPE_LABELS[scope].toLowerCase()}</span>}
            empty={
              <EmptyState
                icon={ClipboardList}
                title={
                  hasFilters
                    ? 'Sin despachos para este filtro'
                    : scope === 'pending'
                      ? 'No hay despachos pendientes'
                      : scope === 'created'
                        ? 'Todavía no has enviado simulaciones'
                        : 'Sin historial en el período'
                }
                description={
                  hasFilters
                    ? 'Prueba con otro estado o limpia la búsqueda.'
                    : scope === 'pending'
                      ? 'Cuando envíes una simulación desde Pedidos aparecerá aquí para cargarla.'
                      : scope === 'created'
                        ? 'Arma el plan en Pedidos y usa «Guardar y enviar a despacho».'
                        : 'Cambia el período o espera a que se cierre un despacho.'
                }
                action={
                  !hasFilters && canSendSimulation ? (
                    <Link
                      href="/pedidos"
                      className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
                    >
                      <ShoppingCart aria-hidden className="size-4" /> Ir al simulador
                    </Link>
                  ) : null
                }
              />
            }
          />
        </Card>

        {scope === 'history' && historyStatsOpen && (
          <DispatchTimesReport
            key={`${historyRange.from}-${historyRange.to}`}
            initialFrom={historyRange.from}
            initialTo={historyRange.to}
            onlyClosed
          />
        )}

        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'No se pudo consultar la bandeja'}
          </p>
        )}

        <p className="flex flex-wrap items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
          <Users aria-hidden className="size-3.5" />
          {isOperator
            ? 'Los despachos abiertos los toma el primer operador que inicia la carga. Enviar o cargar nunca escribe en Profit.'
            : 'Ves todo lo pendiente del almacén. La carga la realizan los operadores con permiso «Abrir».'}
        </p>
      </main>
    </>
  );
}

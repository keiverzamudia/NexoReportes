'use client';

// ============================================================
// Historial de despachos — pantalla hermana de la bandeja.
//
// Antes vivía como tercer tab de /despacho y ensuciaba la vista del operador.
// Aquí se consultan las hojas cerradas o anuladas, con resumen y reporte de
// tiempos. El permiso `despacho:view_history` lo controla; por defecto solo
// lo tiene ADMIN y se concede desde la matriz de roles/usuarios.
// ============================================================

import type {
  DispatchMetricsResponse,
  DispatchSheetListResponse,
  DispatchSheetStatus,
  DispatchSheetSummary,
} from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DespachoAccessDenied } from '../../../components/DespachoAccessDenied';
import { DespachoSubNav } from '../../../components/DespachoSubNav';
import { DispatchHistoryBrief } from '../../../components/DispatchHistoryBrief';
import { DispatchTimesReport } from '../../../components/DispatchTimesReport';
import { SheetStatusBadge } from '../../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, DataTable, EmptyState, PageHeader, Select, Skeleton, TextInput, type Column, cx } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import { formatDateTime, formatNumber, relativeTime, sortSheets } from '../../../lib/dispatch-sheet';
import { hasPermission } from '../../../lib/permissions';

type HistoryPreset = '7d' | '30d' | '90d' | '12m' | 'custom';

const HISTORY_PRESETS: Array<{ value: HistoryPreset; label: string }> = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'custom', label: 'Personalizado' },
];

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

export default function DispatchHistoryPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DispatchSheetStatus | ''>('');
  const [q, setQ] = useState('');
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('30d');
  const [historyRange, setHistoryRange] = useState(() => rangeForPreset('30d'));
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const canOpenDespacho = hasPermission(permissions, 'despacho', 'read');
  const canSeeHistory = canOpenDespacho && hasPermission(permissions, 'despacho', 'view_history');

  const params = new URLSearchParams();
  params.set('scope', 'history');
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  params.set('from', historyRange.from);
  params.set('to', historyRange.to);

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchSheetListResponse>({
    queryKey: ['dispatch-sheets', 'history', status, q, historyRange.from, historyRange.to],
    queryFn: () => apiFetch<DispatchSheetListResponse>(`/dispatch-sheets?${params.toString()}`),
    enabled: canSeeHistory,
    refetchInterval: 30_000,
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
    refetch: refetchHistoryStats,
  } = useQuery<DispatchMetricsResponse>({
    queryKey: ['dispatch-metrics', historyRange.from, historyRange.to, 'day', '', 'all', true],
    queryFn: () => apiFetch<DispatchMetricsResponse>(`/dispatch-sheets/metrics?${historyStatsParams.toString()}`),
    enabled: canSeeHistory,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const sheets = useMemo(() => sortSheets(data?.items ?? []), [data]);
  const hasFilters = Boolean(status || q);

  if (sessionLoading) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Skeleton className="h-10 w-56 rounded-pill" />
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </main>
      </>
    );
  }

  if (!sessionUser) {
    return (
      <LoginScreen
        onSuccess={(user) => {
          queryClient.setQueryData(['me'], user);
          void queryClient.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  if (error instanceof AuthRequiredError) {
    return (
      <LoginScreen
        onSuccess={(user) => {
          queryClient.setQueryData(['me'], user);
          void queryClient.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
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
      header: 'Pedidos',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.plannedOrders,
      render: (row) => <span className="font-semibold tabular-nums text-on-surface">{row.plannedOrders}</span>,
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
      header: 'Sacos',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.plannedSacks,
      render: (row) => <span className="font-semibold tabular-nums text-primary">{formatNumber(row.plannedSacks)}</span>,
    },
    {
      key: 'kg',
      header: 'Kg',
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
      key: 'closed',
      header: 'Cerrado',
      kind: 'field',
      sortValue: (row) => row.completedAt ?? row.canceledAt ?? '',
      render: (row) => {
        const at = row.completedAt ?? row.canceledAt;
        return (
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums text-on-surface-variant">{formatDateTime(at)}</span>
            {row.status === 'CANCELADO' && <span className="text-label-sm text-outline">anulado</span>}
          </span>
        );
      },
    },
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
          className="inline-flex h-8 items-center rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          Abrir
        </Link>
      ),
    },
  ];

  const statusOptions = [
    { value: '', label: 'Estado: Todos' },
    { value: 'DESPACHADO', label: 'Despachados' },
    { value: 'CANCELADO', label: 'Anulados' },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Almacén · Despacho"
          icon={History}
          title="Historial de despachos"
          subtitle="Hojas cerradas o anuladas. El resumen y las estadísticas usan la fecha de cierre; la tabla incluye las anuladas."
        />

        <DespachoSubNav permissions={permissions} />

        {!canSeeHistory ? (
          <DespachoAccessDenied
            title="Historial restringido"
            description="No tienes el permiso «Ver historial» del módulo Despacho. Pídeselo a un administrador desde Usuarios → Roles."
          />
        ) : (
          <>
            <DispatchHistoryBrief
              stats={historyStats}
              loading={historyStatsLoading}
              error={historyStatsError}
              range={historyRange}
              reportOpen={statsOpen}
              onToggleReport={() => setStatsOpen((open) => !open)}
              onRetry={() => void refetchHistoryStats()}
            />

            <Card className="flex flex-col">
              <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                <div className="flex flex-wrap items-center gap-space-sm">
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
                defaultSortKey="closed"
                defaultSortDir="desc"
                maxHeightClass="md:max-h-[min(72vh,900px)]"
                mobileSummary={<span>{sheets.length} despacho(s) en el historial</span>}
                empty={
                  <EmptyState
                    icon={History}
                    title={hasFilters ? 'Sin despachos para este filtro' : 'Sin historial en el período'}
                    description={
                      hasFilters
                        ? 'Prueba con otro estado o limpia la búsqueda.'
                        : 'Cambia el período o espera a que se cierre un despacho.'
                    }
                  />
                }
              />
            </Card>

            {statsOpen && (
              <DispatchTimesReport key={`${historyRange.from}-${historyRange.to}`} initialFrom={historyRange.from} initialTo={historyRange.to} onlyClosed />
            )}

            {error && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'No se pudo consultar el historial'}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

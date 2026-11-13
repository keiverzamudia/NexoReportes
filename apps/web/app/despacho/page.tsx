'use client';

// ============================================================
// Despacho — bandeja de trabajo del almacén.
//
//   · Pendientes → todo lo abierto, sin importar quién lo publicó.
//   · Publicados por mí → lo que envié desde el simulador (solo con permiso).
//
// La bandeja se lee POR CLIENTE: cada renglón de la tabla es un cliente del
// despacho, no la hoja completa. El código DSP queda como referencia al final.
//
// El historial y los retiros de simulación son pantallas hermanas
// (`/despacho/historial` y `/despacho/retiros`) con permiso propio, para que
// la bandeja del operador quede limpia. La simulación se envía completa desde
// Pedidos. Aquí no hay acuse: el primer operador que inicia la carga toma la
// hoja. Nada escribe en Profit.
// ============================================================

import type {
  DispatchCustomerRowStatus,
  DispatchPulse,
  DispatchSheetListResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DespachoSubNav } from '../../components/DespachoSubNav';
import { DispatchClientExpansion } from '../../components/DispatchClientExpansion';
import { DispatchPulseStrip } from '../../components/DispatchPulseStrip';
import { CustomerStatusBadge } from '../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DataTable, EmptyState, PageHeader, Select, Segmented, TextInput, type Column, cx } from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import {
  clientRowsFrom,
  formatBusinessDate,
  formatDateTime,
  formatNumber,
  relativeTime,
  type DispatchClientRow,
} from '../../lib/dispatch-sheet';
import { hasPermission } from '../../lib/permissions';

type Scope = 'pending' | 'created';

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'PENDIENTE', label: 'Sin iniciar' },
  { value: 'EN_CARGA', label: 'En carga' },
  { value: 'CARGA_CERRADA', label: 'Carga cerrada' },
  { value: 'FACTURADA', label: 'Facturada' },
];

const SCOPE_LABELS: Record<Scope, string> = {
  pending: 'Pendientes',
  created: 'Publicados por mí',
};

export default function DespachoPage() {
  const [tick, setTick] = useState(0);
  const [scope, setScope] = useState<Scope>('pending');
  const [status, setStatus] = useState<DispatchCustomerRowStatus | ''>('');
  const [q, setQ] = useState('');
  // Cliente abierto dentro de la bandeja (`sheetId:customerKey`).
  const [openRow, setOpenRow] = useState<string | null>(null);

  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const isAdmin = sessionUser?.role === 'ADMIN';
  const isOperator = hasPermission(permissions, 'despacho', 'update');
  // «Armar y enviar simulación» se habilita con el permiso de Despacho.
  const canSendSimulation = hasPermission(permissions, 'despacho', 'create');
  const canSeeCreated = canSendSimulation;
  // Franja de pendientes: permiso propio, asignable por usuario. Por defecto
  // solo lo tiene ADMIN (la matriz lo concede después, sin tocar el código).
  const canSeePulse = hasPermission(permissions, 'despacho', 'view_summary');
  const canSeeTimes = hasPermission(permissions, 'despacho', 'view_history');

  // La bandeja siempre arranca en lo que hay por cargar.
  useEffect(() => {
    setScope('pending');
  }, [sessionUser?.id]);

  // La bandeja se pide completa por tab: el estado y la búsqueda son por
  // cliente, así que se filtran en memoria sobre las filas ya aplanadas.
  const params = new URLSearchParams();
  params.set('scope', scope);

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchSheetListResponse>({
    queryKey: ['dispatch-sheets', tick, scope],
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
    refetch: refetchPulse,
  } = useQuery<DispatchPulse>({
    queryKey: ['dispatch-pulse'],
    queryFn: () => apiFetch<DispatchPulse>('/dispatch-sheets/pulse'),
    enabled: canSeePulse,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const clientRows = useMemo(() => clientRowsFrom(data?.items ?? []), [data]);
  const rowKey = (row: DispatchClientRow) => `${row.sheet.id}:${row.customerKey}`;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clientRows.filter((row) => {
      if (status && row.status !== status) return false;
      if (!needle) return true;
      return [row.customerName, row.customerCode ?? '', row.sheet.number, row.sheet.title].some((value) =>
        value.toLowerCase().includes(needle),
      );
    });
  }, [clientRows, status, q]);
  const hasFilters = Boolean(status || q);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const columns: Column<DispatchClientRow>[] = [
    {
      key: 'delivery',
      header: 'Entrega',
      kind: 'field',
      sortValue: (row) => row.nextDeliveryDate ?? '9999-12-31',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{formatBusinessDate(row.nextDeliveryDate)}</span>,
    },
    {
      key: 'customer',
      header: 'Cliente',
      kind: 'id',
      sortValue: (row) => row.customerName,
      render: (row) => {
        const parts: string[] = [];
        if (row.partialLines > 0) parts.push(`${row.partialLines} parcial(es)`);
        if (row.missingLines > 0) parts.push(`${row.missingLines} no cargado(s)`);
        const novedades = parts.join(' · ');
        return (
          <span className="flex flex-col leading-tight">
            <span className="flex min-w-0 items-center gap-space-xs">
              <span className="block max-w-[20rem] truncate text-on-surface" title={row.customerName}>
                {row.customerName}
              </span>
              {novedades && (
                <span
                  className="inline-flex shrink-0 items-center text-warning"
                  title={`Novedad en el despacho: ${novedades}`}
                  aria-label={`Novedad en el despacho: ${novedades}`}
                >
                  <AlertTriangle aria-hidden className="size-4" />
                </span>
              )}
            </span>
            {row.customerCode && <span className="text-label-sm tabular-nums text-outline">{row.customerCode}</span>}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Estado',
      kind: 'status',
      sortValue: (row) => row.status,
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <CustomerStatusBadge status={row.status} />
          {row.sheet.status === 'CANCELADO' && row.sheet.cancelReason && (
            <span className="max-w-[16rem] truncate text-label-sm text-outline" title={row.sheet.cancelReason}>
              {row.sheet.cancelReason}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'orders',
      header: 'Pedidos pend.',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.pendingOrders,
      render: (row) => (
        <span className="flex flex-col items-end leading-tight tabular-nums">
          <span className="font-semibold text-on-surface">{row.pendingOrders}</span>
          {row.plannedOrders !== row.pendingOrders && (
            <span className="text-label-sm text-outline">de {row.plannedOrders}</span>
          )}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Renglones',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => (row.plannedLines > 0 ? row.linesDone / row.plannedLines : 0),
      render: (row) => {
        const ratio = row.plannedLines > 0 ? row.linesDone / row.plannedLines : 0;
        return (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-semibold tabular-nums text-on-surface">
              {row.linesDone}/{row.plannedLines}
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-pill bg-surface-container-high">
              <span className="block h-full rounded-pill bg-secondary-container" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
          </span>
        );
      },
    },
    {
      key: 'sacks',
      header: 'Sacos plan',
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
      header: 'Kg plan',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.plannedKg,
      render: (row) => (
        <span className="tabular-nums">
          <span className="font-semibold text-on-surface">{formatNumber(row.plannedKg)}</span>
          {row.loadedKg > 0 && row.loadedKg !== row.plannedKg && (
            <span className="ml-space-xs text-label-sm text-secondary">({formatNumber(row.loadedKg)} real)</span>
          )}
        </span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendedor',
      kind: 'field',
      sortValue: (row) => row.vendor ?? '',
      title: (row) => row.vendor ?? undefined,
      render: (row) => (
        <span className="block max-w-[14rem] truncate text-on-surface-variant">{row.vendor ?? '—'}</span>
      ),
    },
    {
      key: 'number',
      header: 'Despacho',
      kind: 'field',
      sortValue: (row) => row.sheet.number,
      render: (row) => (
        <span className="flex flex-col leading-tight">
          <span className="flex flex-wrap items-baseline gap-x-space-xs">
            <span className="font-bold tabular-nums text-primary">{row.sheet.number}</span>
            <span className="text-label-sm tabular-nums text-outline">{formatDateTime(row.sheet.sentAt)}</span>
          </span>
          <span className="max-w-[14rem] truncate text-body-md text-on-surface-variant" title={row.sheet.title}>
            Enviado por {row.sheet.createdByName ?? row.sheet.createdByCode ?? '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      kind: 'action',
      align: 'right',
      render: (row) => {
        const key = rowKey(row);
        const open = openRow === key;
        return (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpenRow(open ? null : key)}
            className={cx(
              'inline-flex h-10 items-center gap-space-xs rounded-pill px-space-sm font-semibold text-label-md transition-all md:h-8',
              open
                ? 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low'
                : row.sheet.canOperate && row.sheet.status !== 'DESPACHADO' && row.sheet.status !== 'CANCELADO'
                  ? 'bg-secondary-container text-on-secondary shadow-soft hover:-translate-y-0.5'
                  : 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
            )}
          >
            {open ? 'Cerrar' : 'Abrir'}
          </button>
        );
      },
    },
  ];

  const scopeOptions = [
    { value: 'pending' as const, label: SCOPE_LABELS.pending },
    ...(canSeeCreated ? [{ value: 'created' as const, label: SCOPE_LABELS.created }] : []),
  ];

  // «Publicados por mí» conserva el filtro de sus propias hojas cerradas; la
  // bandeja de pendientes solo trabaja con clientes en curso.
  const statusOptions =
    scope === 'created' ? [...STATUS_OPTIONS, { value: 'ANULADO', label: 'Anulados' }] : STATUS_OPTIONS;

  const subtitle =
    scope === 'pending'
      ? 'Todo lo que falta por cargar. El primer operador que inicia la carga toma el despacho.'
      : 'Las simulaciones que enviaste al almacén y su avance.';

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
            canSeeTimes || canSendSimulation ? (
              <div className="flex flex-wrap items-center gap-space-xs">
                {canSeeTimes && (
                  <Link
                    href="/despacho/historial"
                    className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                  >
                    <Clock aria-hidden className="size-4" /> Reporte de tiempos
                  </Link>
                )}
                {canSendSimulation && (
                  <Link
                    href="/pedidos"
                    className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
                  >
                    <Truck aria-hidden className="size-4" /> Armar y enviar simulación
                  </Link>
                )}
              </div>
            ) : null
          }
        />

        <DespachoSubNav permissions={permissions} />

        {canSeePulse && (
          <DispatchPulseStrip
            pulse={pulse}
            loading={pulseLoading}
            error={pulseError}
            onRetry={() => void refetchPulse()}
          />
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
              <Select className="w-44" value={status} onChange={(value) => setStatus(value as DispatchCustomerRowStatus | '')} options={statusOptions} ariaLabel="Estado" />
              <TextInput className="w-56" icon={Search} value={q} onChange={setQ} placeholder="Buscar cliente, N° o título…" ariaLabel="Buscar cliente o despacho" />
            </div>
            <div className="flex items-center gap-space-sm">
              {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
              <span className="text-label-sm normal-case text-on-surface-variant">
                {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
              </span>
              <Badge tone={hasFilters ? 'primary' : 'muted'} dot>
                {rows.length} cliente{rows.length === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            expandedKey={openRow}
            onRowClick={(row) => setOpenRow((current) => (current === rowKey(row) ? null : rowKey(row)))}
            renderExpanded={(row) => (
              <DispatchClientExpansion
                sheetId={row.sheet.id}
                customerKey={row.customerKey}
                isAdmin={isAdmin}
              />
            )}
            loading={isLoading}
            defaultSortKey="delivery"
            defaultSortDir="asc"
            maxHeightClass="md:max-h-[min(72vh,900px)]"
            mobileSummary={<span>{rows.length} cliente(s) en {SCOPE_LABELS[scope].toLowerCase()}</span>}
            empty={
              <EmptyState
                icon={ClipboardList}
                title={
                  hasFilters
                    ? 'Sin clientes para este filtro'
                    : scope === 'pending'
                      ? 'No hay clientes por cargar'
                      : 'Todavía no has enviado simulaciones'
                }
                description={
                  hasFilters
                    ? 'Prueba con otro estado o limpia la búsqueda.'
                    : scope === 'pending'
                      ? 'Cuando envíes una simulación desde Pedidos, cada cliente aparecerá aquí para cargarlo.'
                      : 'Arma el plan en Pedidos y usa «Guardar y enviar a despacho».'
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

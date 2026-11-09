'use client';

// ============================================================
// Despacho — bandeja de trabajo del almacén.
//
//   · Pendientes → todo lo abierto, sin importar quién lo publicó.
//   · Publicados por mí → lo que envié desde el simulador (solo con permiso).
//   · Historial → despachos cerrados o anulados.
//
// La simulación se envía completa desde Pedidos. Aquí no hay acuse: el primer
// operador que inicia la carga toma la hoja. Nada escribe en Profit.
// ============================================================

import type { DispatchSheetListResponse, DispatchSheetStatus, DispatchSheetSummary } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, RefreshCw, Search, ShoppingCart, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DispatchTimesReport } from '../../components/DispatchTimesReport';
import { SheetStatusBadge } from '../../components/DispatchSheetParts';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DataTable, EmptyState, PageHeader, Select, Segmented, TextInput, type Column, cx, useGreeting } from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import { formatBusinessDate, formatNumber, relativeTime, sortSheets } from '../../lib/dispatch-sheet';
import { hasPermission } from '../../lib/permissions';

type Scope = 'pending' | 'created' | 'history';
type Tab = Scope | 'tiempos';

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'EN_PROCESO', label: 'En carga' },
  { value: 'DESPACHADO', label: 'Despachados' },
  { value: 'CANCELADO', label: 'Anulados' },
];

const SCOPE_LABELS: Record<Scope, string> = {
  pending: 'Pendientes',
  created: 'Publicados por mí',
  history: 'Historial',
};

export default function DespachoPage() {
  const [tick, setTick] = useState(0);
  const greeting = useGreeting();
  const [scope, setScope] = useState<Scope>('pending');
  const [tab, setTab] = useState<Tab>('pending');
  const [status, setStatus] = useState<DispatchSheetStatus | ''>('');
  const [q, setQ] = useState('');

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

  // La bandeja siempre arranca en lo que hay por cargar.
  useEffect(() => {
    setScope('pending');
    setTab('pending');
  }, [sessionUser?.id]);

  const params = new URLSearchParams();
  params.set('scope', scope);
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchSheetListResponse>({
    queryKey: ['dispatch-sheets', tick, scope, status, q],
    queryFn: () => apiFetch<DispatchSheetListResponse>(`/dispatch-sheets?${params.toString()}`),
    enabled: tab !== 'tiempos',
    refetchInterval: 20_000,
    // El tablero del almacén no se congela cuando la pestaña no tiene foco.
    refetchIntervalInBackground: true,
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
      render: (row) => <SheetStatusBadge status={row.status} />,
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
      key: 'delivery',
      header: 'Entrega',
      kind: 'field',
      sortValue: (row) => row.nextDeliveryDate ?? '9999-12-31',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{formatBusinessDate(row.nextDeliveryDate)}</span>,
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
    { value: 'tiempos' as const, label: 'Tiempos' },
  ];

  const subtitle =
    tab === 'tiempos'
      ? 'Tiempos de carga y facturación por cliente, día o mes. Incluye pendientes de facturar y cumplimiento contra la fecha plan.'
      : scope === 'pending'
        ? 'Todo lo que falta por cargar. El primer operador que inicia la carga toma el despacho.'
        : scope === 'created'
          ? 'Las simulaciones que enviaste al almacén y su avance.'
          : canViewAll
            ? 'Historial completo: despachos cerrados y anulados de todos los usuarios. Solo lectura.'
            : 'Tus despachos cerrados y anulados. Solo lectura.';

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Almacén · Bandeja de despacho"
          icon={ClipboardList}
          greeting={greeting}
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

        <Card className="flex flex-col">
          <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
            <div className="flex flex-wrap items-center gap-space-sm">
              <Segmented
                ariaLabel="Bandeja de despacho"
                value={tab}
                onChange={(value) => {
                  const next = value as Tab;
                  setTab(next);
                  if (next !== 'tiempos') setScope(next);
                }}
                options={scopeOptions}
              />
              {tab !== 'tiempos' && (
                <>
                  <Select className="w-44" value={status} onChange={(value) => setStatus(value as DispatchSheetStatus | '')} options={STATUS_OPTIONS} ariaLabel="Estado" />
                  <TextInput className="w-56" icon={Search} value={q} onChange={setQ} placeholder="Buscar N° o título…" ariaLabel="Buscar despacho" />
                </>
              )}
            </div>
            {tab !== 'tiempos' && (
              <div className="flex items-center gap-space-sm">
                {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
                <span className="text-label-sm normal-case text-on-surface-variant">
                  {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
                </span>
                <Badge tone={hasFilters ? 'primary' : 'muted'} dot>
                  {sheets.length} despacho{sheets.length === 1 ? '' : 's'}
                </Badge>
              </div>
            )}
          </div>

          {tab === 'tiempos' ? (
            <div className="p-space-md">
              <DispatchTimesReport />
            </div>
          ) : (
          <DataTable
            columns={columns}
            rows={sheets}
            rowKey={(row) => row.id}
            loading={isLoading}
            defaultSortKey="number"
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
                        : 'Sin historial todavía'
                }
                description={
                  hasFilters
                    ? 'Prueba con otro estado o limpia la búsqueda.'
                    : scope === 'pending'
                      ? 'Cuando envíes una simulación desde Pedidos aparecerá aquí para cargarla.'
                      : scope === 'created'
                        ? 'Arma el plan en Pedidos y usa «Guardar y enviar a despacho».'
                        : 'Los despachos cerrados o anulados se guardan aquí.'
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
          )}
        </Card>

        {error && !(error instanceof AuthRequiredError) && tab !== 'tiempos' && (
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

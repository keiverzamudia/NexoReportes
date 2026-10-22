'use client';

// ============================================================
// Despacho — tablero del almacén (Fase 6b).
//
// Dos caras en la misma pantalla, según el rol:
//   · ALMACEN  → «Mi jornada»: lo que le toca cargar, ordenado por urgencia.
//   · PLANIFICADOR / GERENCIA / ADMIN → «Seguimiento»: lo publicado y su acuse
//     (enviado, abierto por quién, en carga, con novedad, despachado).
//
// La simulación de Pedidos se materializa aquí como orden de trabajo con
// acuse de recibo: el «túnel» se ve en cada fila y en la campana del shell.
// ============================================================

import type { DispatchSheetDetail, DispatchSheetListResponse, DispatchSheetStatus, DispatchSheetSummary } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, Clock3, PackageCheck, RefreshCw, Search, ShoppingCart, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AcuseSummary, SheetStatusBadge } from '../../components/DispatchSheetParts';
import { PublishDispatchDialog } from '../../components/PublishDispatchDialog';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DataTable, EmptyState, HeroCard, Kpi, PageHeader, Select, Segmented, TextInput, type Column, cx, useGreeting } from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import { formatBusinessDate, formatNumber, relativeTime, sortSheets } from '../../lib/dispatch-sheet';
import { hasPermission } from '../../lib/permissions';

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'ENVIADO', label: 'Sin abrir' },
  { value: 'RECIBIDO', label: 'Recibidos' },
  { value: 'EN_PROCESO', label: 'En carga' },
  { value: 'CON_NOVEDAD', label: 'Con novedad' },
  { value: 'DESPACHADO', label: 'Despachados' },
  { value: 'CANCELADO', label: 'Anulados' },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'assigned', label: 'Para cargar' },
  { value: 'created', label: 'Publicados por mí' },
] as const;

export default function DespachoPage() {
  const [tick, setTick] = useState(0);
  const greeting = useGreeting();
  const [scope, setScope] = useState<'all' | 'assigned' | 'created'>('all');
  const [status, setStatus] = useState<DispatchSheetStatus | ''>('');
  const [q, setQ] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const isOperator = hasPermission(permissions, 'despacho', 'update');
  const canPublish = hasPermission(permissions, 'despacho', 'create');

  // El alcance por defecto sigue la plantilla del rol: el almacén ve su
  // trabajo, el planificador lo que publicó y gerencia todo.
  useEffect(() => {
    const baseRole = sessionUser?.baseRole;
    if (!baseRole) return;
    setScope(baseRole === 'ALMACEN' ? 'assigned' : baseRole === 'PLANIFICADOR' ? 'created' : 'all');
  }, [sessionUser?.baseRole]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const params = new URLSearchParams();
  params.set('scope', scope);
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading, error, dataUpdatedAt, isFetching } = useQuery<DispatchSheetListResponse>({
    queryKey: ['dispatch-sheets', tick, scope, status, q],
    queryFn: () => apiFetch<DispatchSheetListResponse>(`/dispatch-sheets?${params.toString()}`),
    refetchInterval: 20_000,
    // El tablero del almacén no se congela cuando la pestaña no tiene foco.
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const sheets = useMemo(() => sortSheets(data?.items ?? []), [data]);
  const counters = data?.counters ?? { pending: 0, inProgress: 0, doneToday: 0, kgPending: 0, kgDoneToday: 0 };
  const hasFilters = Boolean(status || q);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const heroLabel = isOperator ? 'Por cargar' : 'Despachado hoy';
  const heroValue = isOperator ? counters.kgPending : counters.kgDoneToday;
  const heroHint = isOperator
    ? `${counters.pending} sin abrir · ${counters.inProgress} en curso · ${formatNumber(counters.kgDoneToday)} kg ya despachados`
    : `${counters.pending} esperando acuse · ${counters.inProgress} en carga · ${counters.doneToday} cerrados hoy`;
  const heroProgress =
    counters.kgPending + counters.kgDoneToday > 0
      ? Math.round((counters.kgDoneToday / (counters.kgPending + counters.kgDoneToday)) * 100)
      : 0;

  const columns: Column<DispatchSheetSummary>[] = [
    {
      key: 'number',
      header: 'Despacho',
      kind: 'id',
      sortValue: (row) => row.number,
      render: (row) => (
        <Link href={`/despacho/${row.id}`} className="flex flex-col leading-tight">
          <span className="font-bold tabular-nums text-primary">{row.number}</span>
          <span className="max-w-[16rem] truncate text-body-md text-on-surface-variant" title={row.title}>
            {row.title}
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
      key: 'acuse',
      header: 'Acuse',
      kind: 'field',
      render: (row) => <AcuseSummary sheet={row} />,
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
            'inline-flex h-8 items-center gap-space-xs rounded-pill px-space-sm font-semibold text-label-md transition-all',
            row.canOperate && row.status === 'ENVIADO'
              ? 'bg-secondary-container text-on-secondary shadow-soft hover:-translate-y-0.5'
              : 'border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
          )}
        >
          {row.canOperate && row.status === 'ENVIADO' ? 'Recibir' : 'Abrir'}
        </Link>
      ),
    },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow={isOperator ? 'Almacén · Mi jornada' : 'Almacén · Seguimiento de despacho'}
          icon={ClipboardList}
          greeting={greeting}
          title="Despacho"
          subtitle={
            isOperator
              ? 'Abre un despacho para recibirlo, carga renglón por renglón y ciérralo. Cada paso avisa a planificación.'
              : 'Lo que publicaste al almacén y su acuse: enviado, abierto por quién, en carga, con novedad o despachado.'
          }
          actions={
            canPublish ? (
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
              >
                <Truck aria-hidden className="size-4" /> Publicar despacho
              </button>
            ) : null
          }
        />

        <section className="grid gap-space-md xl:grid-cols-12">
          <div className="flex flex-col gap-space-md xl:col-span-4">
            <HeroCard
              label={heroLabel}
              value={formatNumber(heroValue)}
              suffix="kg"
              hint={heroHint}
              progress={heroProgress}
              icon={isOperator ? PackageCheck : Truck}
            />
            <div className="stagger grid grid-cols-2 gap-space-sm">
              <Kpi label="Sin abrir" value={formatNumber(counters.pending)} suffix="desp." tone={counters.pending > 0 ? 'warning' : 'muted'} icon={Clock3} />
              <Kpi label="En carga" value={formatNumber(counters.inProgress)} suffix="desp." tone="primary" icon={Truck} />
              <Kpi label="Cerrados hoy" value={formatNumber(counters.doneToday)} suffix="desp." tone="success" icon={PackageCheck} />
              <Kpi
                label={isOperator ? 'Falta por cargar' : 'Pendiente de carga'}
                value={formatNumber(counters.kgPending)}
                suffix="kg"
                tone={counters.kgPending > 0 ? 'danger' : 'muted'}
              />
            </div>
          </div>

          <Card className="flex flex-col xl:col-span-8">
            <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
              <div className="flex flex-wrap items-center gap-space-sm">
                <Segmented
                  ariaLabel="Alcance de la bandeja"
                  value={scope}
                  onChange={(value) => setScope(value)}
                  options={SCOPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
                <Select className="w-44" value={status} onChange={(value) => setStatus(value as DispatchSheetStatus | '')} options={STATUS_OPTIONS} ariaLabel="Estado" />
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
              defaultSortKey="number"
              maxHeightClass="md:max-h-[min(64vh,820px)]"
              mobileSummary={
                <span>
                  {formatNumber(counters.kgPending)} kg por cargar · {counters.pending} sin abrir · {counters.inProgress} en curso
                </span>
              }
              empty={
                <EmptyState
                  icon={ClipboardList}
                  title={hasFilters ? 'Sin despachos para este filtro' : isOperator ? 'No tienes despachos asignados' : 'Todavía no has publicado despachos'}
                  description={
                    hasFilters
                      ? 'Prueba con otro estado o limpia la búsqueda.'
                      : isOperator
                        ? 'Cuando planificación publique uno, aparecerá aquí y te llegará una notificación.'
                        : 'Arma el plan en Pedidos, guárdalo con nombre y publícalo al almacén desde aquí.'
                  }
                  action={
                    !hasFilters && canPublish ? (
                      <button
                        type="button"
                        onClick={() => setPublishOpen(true)}
                        className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
                      >
                        <Truck aria-hidden className="size-4" /> Publicar despacho
                      </button>
                    ) : !hasFilters ? (
                      <Link
                        href="/pedidos"
                        className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                      >
                        <ShoppingCart aria-hidden className="size-4" /> Ver pedidos
                      </Link>
                    ) : null
                  }
                />
              }
            />
          </Card>
        </section>

        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'No se pudo consultar la bandeja'}
          </p>
        )}

        <p className="flex flex-wrap items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
          <Users aria-hidden className="size-3.5" />
          Los despachos de bandeja compartida los toma el primer operador que los abre. Restaurar o publicar nunca escribe en Profit.
        </p>
      </main>

      <PublishDispatchDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        canManageUsers={hasPermission(permissions, 'usuarios', 'update')}
        onPublished={(sheet: DispatchSheetDetail) => {
          setToast(`${sheet.number} publicado: ${sheet.plannedLines} renglón(es) al almacén.`);
          setTick((t) => t + 1);
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[85] -translate-x-1/2 rounded-pill bg-primary px-space-lg py-2 text-label-md font-semibold text-on-primary shadow-lift"
        >
          {toast}
        </div>
      )}
    </>
  );
}

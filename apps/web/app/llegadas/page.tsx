'use client';

// ============================================================
// Llegadas de clientes — tablero de PCP.
//
// Los registros NO se crean aquí: nacen solos cuando planificación publica un
// despacho. Esta pantalla es la portería: quién viene, a qué hora llegó y qué
// incidencias hay. Misma gramática visual que Despacho (hero + KPIs + tabla).
// ============================================================

import type { ArrivalDetail, ArrivalListResponse, ArrivalStatus, ArrivalSummary } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCheck, Clock3, DoorOpen, RefreshCw, Search, Truck, UserX, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrivalStatusBadge } from '../../components/ArrivalParts';
import { CheckInDialog } from '../../components/ArrivalDialogs';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  HeroCard,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  type Column,
  cx,
  useGreeting,
} from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import {
  arrivalPulse,
  arrivalTimeLabel,
  businessDayLabel,
  businessToday,
  businessTomorrow,
  minutesOnSite,
  sortArrivals,
} from '../../lib/arrival';
import { formatNumber, relativeTime } from '../../lib/dispatch-sheet';
import { hasPermission } from '../../lib/permissions';

type Range = 'today' | 'tomorrow' | 'all';

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
  { value: 'all', label: 'Histórico' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'ESPERADO', label: 'Esperados' },
  { value: 'EN_PLANTA', label: 'En planta' },
  { value: 'ATENDIDO', label: 'Atendidos' },
  { value: 'CON_INCIDENCIA', label: 'Con incidencia' },
  { value: 'AUSENTE', label: 'No vinieron' },
  { value: 'CANCELADO', label: 'Cancelados' },
];

export default function LlegadasPage() {
  const queryClient = useQueryClient();
  const greeting = useGreeting();
  const [range, setRange] = useState<Range>('today');
  const [status, setStatus] = useState<ArrivalStatus | ''>('');
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const [checkIn, setCheckIn] = useState<ArrivalSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Reloj de la bandeja: mantiene frescos los «hace X min» sin recargar.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const permissions = sessionUser?.permissions;
  const canCheckIn = hasPermission(permissions, 'llegadas', 'create');

  const date = range === 'today' ? businessToday() : range === 'tomorrow' ? businessTomorrow() : undefined;
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading, isFetching, dataUpdatedAt, error } = useQuery<ArrivalListResponse>({
    queryKey: ['arrivals', date ?? 'all', status, q.trim()],
    queryFn: () => apiFetch<ArrivalListResponse>(`/arrivals?${params.toString()}`),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const items = useMemo(() => sortArrivals(data?.items ?? []), [data?.items]);
  const pulse = useMemo(() => arrivalPulse(items), [items]);
  const total = items.length;
  const attendedPct = total > 0 ? Math.round((pulse.attended / total) * 100) : 0;
  const heroHint =
    total > 0
      ? `${pulse.attended} de ${total} atendidos · ${formatNumber(pulse.kgExpected)} kg pendientes`
      : 'Cuando planificación envíe un despacho, sus clientes aparecen aquí.';

  function onSaved(detail: ArrivalDetail) {
    queryClient.setQueryData(['arrival', detail.id], detail);
    queryClient.invalidateQueries({ queryKey: ['arrivals'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    setToast(`Llegada de ${detail.customerName} marcada a las ${new Date(detail.arrivedAt ?? Date.now()).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}.`);
  }

  const columns: Column<ArrivalSummary>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      kind: 'id',
      sortValue: (row) => row.customerName,
      render: (row) => (
        <Link href={`/llegadas/${row.id}`} className="group flex min-w-0 flex-col">
          <span className="truncate font-semibold text-on-surface group-hover:text-primary">{row.customerName}</span>
          <span className="text-label-sm normal-case text-on-surface-variant">
            {row.customerCode} · {row.sheetNumber}
          </span>
        </Link>
      ),
    },
    {
      key: 'time',
      header: 'Llegada',
      kind: 'field',
      sortValue: (row) => row.arrivedAt ?? row.expectedDate ?? '',
      render: (row) => {
        const onSite = minutesOnSite(row.arrivedAt);
        return (
          <span className="flex flex-col">
            <span className={cx('tabular-nums', row.arrivedAt ? 'font-bold text-primary' : 'text-on-surface-variant')}>
              {arrivalTimeLabel(row)}
            </span>
            {row.arrivedByName && (
              <span className="text-label-sm normal-case text-on-surface-variant">
                {row.arrivedByName}
                {onSite !== null && onSite > 0 ? ` · ${onSite} min` : ''}
              </span>
            )}
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
        <span className="flex flex-wrap items-center gap-space-xs">
          <ArrivalStatusBadge status={row.status} />
          {row.openIncidentCount > 0 && <Badge tone="warning">{row.openIncidentCount} abierta(s)</Badge>}
        </span>
      ),
    },
    {
      key: 'orders',
      header: 'Pedidos',
      kind: 'field',
      sortValue: (row) => row.orderNumbers.length,
      render: (row) => (
        <span className="text-on-surface-variant" title={row.orderNumbers.join(' · ')}>
          {row.orderNumbers.length > 0 ? row.orderNumbers.join(' · ') : '—'}
        </span>
      ),
    },
    {
      key: 'sacks',
      header: 'Sacos',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.plannedSacks,
      render: (row) => <span className="tabular-nums">{formatNumber(row.plannedSacks)}</span>,
    },
    {
      key: 'kg',
      header: 'Kg',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.plannedKg,
      render: (row) => <span className="tabular-nums font-semibold text-primary">{formatNumber(row.plannedKg)}</span>,
    },
    {
      key: 'actions',
      header: '',
      kind: 'action',
      align: 'right',
      render: (row) =>
        row.canCheckIn ? (
          <button
            type="button"
            onClick={() => setCheckIn(row)}
            className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary shadow-soft transition-all hover:-translate-y-0.5"
          >
            <DoorOpen aria-hidden className="size-3.5" /> Marcar llegada
          </button>
        ) : (
          <Link
            href={`/llegadas/${row.id}`}
            className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Abrir
          </Link>
        ),
    },
  ];

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Planta · PCP · Llegada de clientes"
          icon={DoorOpen}
          greeting={greeting}
          title="Llegadas"
          subtitle="Los clientes que vienen a cargar, con la hora en que se marcó su llegada, sus incidencias y la bitácora. Se llenan solos cuando despacho publica el plan."
          actions={
            <Link
              href="/despacho"
              className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-md font-semibold text-body-md text-primary shadow-soft transition-colors hover:bg-surface-container-low"
            >
              <Truck aria-hidden className="size-4" /> Ver despachos
            </Link>
          }
        />

        <section className="grid gap-space-md xl:grid-cols-12">
          <div className="flex flex-col gap-space-md xl:col-span-4">
            <HeroCard
              label={range === 'today' ? 'Clientes por llegar hoy' : range === 'tomorrow' ? 'Clientes esperados mañana' : 'Clientes en el histórico'}
              value={formatNumber(pulse.waiting)}
              suffix="clientes"
              hint={heroHint}
              progress={attendedPct}
              icon={Users}
            />
            <div className="stagger grid grid-cols-2 gap-space-sm">
              <Kpi
                label="En planta"
                value={formatNumber(pulse.onSite)}
                suffix="ahora"
                tone="primary"
                icon={DoorOpen}
              />
              <Kpi
                label="Atendidos"
                value={formatNumber(pulse.attended)}
                suffix="hoy"
                tone="success"
                icon={CheckCheck}
              />
              <Kpi
                label="Con incidencia"
                value={formatNumber(pulse.withIncident)}
                suffix="clientes"
                tone={pulse.withIncident > 0 ? 'warning' : 'muted'}
                icon={AlertTriangle}
              />
              <Kpi
                label="No vinieron"
                value={formatNumber(pulse.missed)}
                suffix="clientes"
                tone={pulse.missed > 0 ? 'danger' : 'muted'}
                icon={UserX}
              />
            </div>
          </div>

          <Card className="flex flex-col xl:col-span-8">
            <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
              <div className="flex flex-wrap items-center gap-space-sm">
                <Segmented
                  ariaLabel="Día de la bandeja"
                  value={range}
                  onChange={(value) => setRange(value)}
                  options={RANGE_OPTIONS}
                />
                <Select
                  className="w-44"
                  value={status}
                  onChange={(value) => setStatus(value as ArrivalStatus | '')}
                  options={STATUS_OPTIONS}
                  ariaLabel="Estado de la llegada"
                />
                <TextInput
                  className="w-56"
                  icon={Search}
                  value={q}
                  onChange={setQ}
                  placeholder="Buscar cliente, pedido o despacho…"
                  ariaLabel="Buscar llegada"
                />
              </div>
              <div className="flex items-center gap-space-sm">
                {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
                <span className="text-label-sm normal-case text-on-surface-variant">
                  {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
                </span>
                <Badge tone={status || q ? 'primary' : 'muted'} dot>
                  {items.length} cliente{items.length === 1 ? '' : 's'}
                </Badge>
              </div>
            </div>

            <DataTable
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              loading={isLoading}
              defaultSortKey="time"
              maxHeightClass="md:max-h-[min(64vh,820px)]"
              mobileSummary={
                <span>
                  {formatNumber(pulse.kgExpected)} kg por cargar · {pulse.onSite} en planta · {pulse.withIncident} con incidencia
                </span>
              }
              empty={
                <EmptyState
                  icon={DoorOpen}
                  title={
                    status || q
                      ? 'Sin clientes para este filtro'
                      : range === 'tomorrow'
                        ? 'Mañana no hay clientes esperados'
                        : 'Todavía no hay clientes esperados'
                  }
                  description={
                    status || q
                      ? 'Prueba con otro estado o limpia la búsqueda.'
                      : 'Aparecen automáticamente cuando planificación envía un despacho: no hay que hacer nada más aquí.'
                  }
                  action={
                    !status && !q ? (
                      <Link
                        href="/despacho"
                        className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                      >
                        <Truck aria-hidden className="size-4" /> Ir a Despacho
                      </Link>
                    ) : null
                  }
                />
              }
            />
          </Card>
        </section>

        <div className="stagger grid gap-space-md md:grid-cols-3">
          <Card className="flex items-start gap-space-sm p-space-md">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-fixed text-primary">
              <Clock3 aria-hidden className="size-4" />
            </span>
            <div>
              <p className="font-semibold text-primary">La hora la sella el servidor</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Al marcar la llegada se guarda el instante y el usuario. Nadie puede «adelantarla» desde el navegador.
              </p>
            </div>
          </Card>
          <Card className="flex items-start gap-space-sm p-space-md">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-warning-container text-on-warning-container">
              <AlertTriangle aria-hidden className="size-4" />
            </span>
            <div>
              <p className="font-semibold text-primary">Incidencias con nombre y apellido</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Faltantes, demoras, daños o documentos: cada una queda abierta hasta que alguien la resuelve por escrito.
              </p>
            </div>
          </Card>
          <Card className="flex items-start gap-space-sm p-space-md">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary-container text-on-secondary">
              <CheckCheck aria-hidden className="size-4" />
            </span>
            <div>
              <p className="font-semibold text-primary">Corregir deja rastro</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                El jefe de PCP y los administradores pueden corregir una hora o un estado; el motivo y el antes → después
                quedan en la bitácora.
              </p>
            </div>
          </Card>
        </div>

        <p className="text-label-sm normal-case text-on-surface-variant">
          {tick >= 0 && range === 'today' ? `Bandeja de hoy · ${businessDayLabel(businessToday())}` : ''}
        </p>
      </main>

      {toast && (
        <div
          role="status"
          className="animate-rise fixed bottom-space-lg left-1/2 z-50 flex -translate-x-1/2 items-center gap-space-sm rounded-pill bg-primary px-space-lg py-space-sm text-body-md font-semibold text-on-primary shadow-hero"
        >
          <DoorOpen aria-hidden className="size-4" /> {toast}
        </div>
      )}

      <CheckInDialog open={Boolean(checkIn)} arrival={checkIn} onClose={() => setCheckIn(null)} onSaved={onSaved} />
    </>
  );
}

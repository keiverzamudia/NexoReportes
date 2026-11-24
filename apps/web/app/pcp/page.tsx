'use client';

import type {
  ArrivalDetail,
  ArrivalStatus,
  RomanaArrivalDetail,
  RomanaArrivalSummary,
  RomanaListResponse,
  RomanaStatus,
} from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Camera,
  CheckCheck,
  DoorOpen,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckInDialog } from '../../components/ArrivalDialogs';
import { ArrivalStatusBadge } from '../../components/ArrivalParts';
import { RomanaCheckInDialog, RomanaValidateDialog } from '../../components/romana/RomanaDialogs';
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
import { AuthRequiredError, apiFetch } from '../../lib/api';
import {
  arrivalTimeLabel,
  businessDayLabel,
  businessToday,
  businessTomorrow,
  clockLabel,
  minutesOnSite,
} from '../../lib/arrival';
import { formatNumber, relativeTime } from '../../lib/dispatch-sheet';
import { formatBytes, romanaProgress, romanaStatusMeta, sortRomanaArrivals } from '../../lib/romana';

// ============================================================
// PCP — clientes esperados por los despachos.
//
// Unifica las antiguas pantallas de Llegadas y Romana: el registro nace solo
// al enviar la simulación desde Despacho. Aquí se marca la llegada a planta,
// se suben la cédula y el carnet por pedido y Romana valida (y borra las
// fotos). La pestaña Hoy arrastra lo atrasado que sigue sin atenderse.
// ============================================================

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

const ROMANA_OPTIONS = [
  { value: '', label: 'Fotos: Todas' },
  { value: 'PENDIENTE', label: 'Faltan fotos' },
  { value: 'LISTO', label: 'Listos para marcar' },
  { value: 'EN_ROMANA', label: 'En Romana' },
  { value: 'VALIDADO', label: 'Validados' },
  { value: 'EXPIRADO', label: 'Fotos expiradas' },
  { value: 'CANCELADO', label: 'Cancelados' },
];

export default function PcpPage() {
  const queryClient = useQueryClient();
  const greeting = useGreeting();
  const [range, setRange] = useState<Range>('today');
  const [status, setStatus] = useState<ArrivalStatus | ''>('');
  const [romanaStatus, setRomanaStatus] = useState<RomanaStatus | ''>('');
  const [q, setQ] = useState('');
  const [checkInPcp, setCheckInPcp] = useState<RomanaArrivalSummary | null>(null);
  const [checkInRomana, setCheckInRomana] = useState<RomanaArrivalSummary | null>(null);
  const [validate, setValidate] = useState<RomanaArrivalSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const date = range === 'today' ? businessToday() : range === 'tomorrow' ? businessTomorrow() : undefined;
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  // La bandeja de hoy también muestra lo atrasado que nadie atendió.
  if (range === 'today') params.set('overdue', '1');
  if (status) params.set('status', status);
  if (romanaStatus) params.set('romanaStatus', romanaStatus);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading, isFetching, dataUpdatedAt, error } = useQuery<RomanaListResponse>({
    queryKey: ['pcp-arrivals', date ?? 'all', range, status, romanaStatus, q.trim()],
    queryFn: () => apiFetch<RomanaListResponse>(`/romana/arrivals?${params.toString()}`),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const items = useMemo(() => sortRomanaArrivals(data?.items ?? []), [data?.items]);
  const pulse = useMemo(() => {
    return {
      waiting: items.filter((item) => item.status === 'ESPERADO' || item.status === 'CON_INCIDENCIA').length,
      onSite: items.filter((item) => item.status === 'EN_PLANTA').length,
      docsPending: items.filter((item) => item.romana.pendingDocs > 0).length,
      inRomana: items.filter((item) => item.romana.status === 'EN_ROMANA').length,
      validated: items.filter((item) => item.romana.status === 'VALIDADO').length,
      kgExpected: items
        .filter((item) => !['ATENDIDO', 'AUSENTE', 'CANCELADO'].includes(item.status))
        .reduce((sum, item) => sum + item.plannedKg, 0),
    };
  }, [items]);

  const total = items.length;
  const validatedPct = total > 0 ? Math.round((pulse.validated / total) * 100) : 0;
  const heroHint =
    total > 0
      ? `${pulse.docsPending} con fotos pendientes · ${pulse.validated} validados · ${formatNumber(
          pulse.kgExpected,
        )} kg por cargar`
      : 'Cuando planificación envíe un despacho, sus clientes aparecen aquí.';

  function refresh(detail?: RomanaArrivalDetail) {
    if (detail) queryClient.setQueryData(['pcp-arrival', detail.id], detail);
    queryClient.invalidateQueries({ queryKey: ['pcp-arrivals'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  const columns: Column<RomanaArrivalSummary>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      kind: 'id',
      sortValue: (row) => row.customerName,
      render: (row) => (
        <Link href={`/pcp/${row.id}`} className="group flex min-w-0 flex-col">
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
            <span className="text-label-sm normal-case text-on-surface-variant">
              {row.arrivedByName
                ? `${row.arrivedByName}${onSite !== null && onSite > 0 ? ` · ${onSite} min` : ''}`
                : businessDayLabel(row.expectedDate)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'docs',
      header: 'Fotos',
      kind: 'metric',
      sortValue: (row) => romanaProgress(row).ratio,
      render: (row) => {
        const progress = romanaProgress(row);
        if (progress.required === 0) {
          return (
            <span className="flex flex-col text-label-sm normal-case text-on-surface-variant">
              <span className="font-semibold">Sin documentos</span>
              <span className="text-outline">llegada anterior a Romana</span>
            </span>
          );
        }
        return (
          <span className="flex min-w-[9rem] flex-col gap-1">
            <span className="flex items-center justify-between gap-space-xs">
              <span className="tabular-nums font-bold text-on-surface">
                {progress.uploaded}/{progress.required}
              </span>
              <span className="text-label-sm normal-case text-outline">{formatBytes(row.romana.totalBytes)}</span>
            </span>
            <span aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-surface-container-high">
              <span
                className={cx(
                  'block h-full rounded-pill transition-all',
                  progress.pending === 0 ? 'bg-success' : 'bg-warning',
                )}
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </span>
          </span>
        );
      },
    },
    {
      key: 'romana',
      header: 'Romana',
      kind: 'status',
      sortValue: (row) => row.romana.status,
      render: (row) => {
        const meta = romanaStatusMeta(row.romana.status);
        const onSite = minutesOnSite(row.romana.arrivedAt);
        return (
          <span className="flex flex-col gap-0.5">
            <Badge tone={row.romana.requiredDocs === 0 ? 'muted' : meta.tone} dot>
              {row.romana.requiredDocs === 0 ? 'Sin docs' : meta.short}
            </Badge>
            <span className="text-label-sm normal-case text-on-surface-variant">
              {row.romana.validatedAt
                ? `validado ${relativeTime(row.romana.validatedAt)}`
                : row.romana.arrivedAt
                  ? `${clockLabel(row.romana.arrivedAt)}${onSite && onSite > 0 ? ` · ${onSite} min` : ''}`
                  : 'sin marcar'}
            </span>
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
      render: (row) => (
        <span className="flex flex-wrap items-center justify-end gap-space-xs">
          {row.canCheckIn && (
            <button
              type="button"
              onClick={() => setCheckInPcp(row)}
              className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary shadow-soft transition-all hover:-translate-y-0.5"
            >
              <DoorOpen aria-hidden className="size-3.5" /> Marcar llegada
            </button>
          )}
          {row.romana.canCheckIn && (
            <button
              type="button"
              onClick={() => setCheckInRomana(row)}
              className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
            >
              <Scale aria-hidden className="size-3.5" /> Romana
            </button>
          )}
          {row.romana.canValidate && (
            <button
              type="button"
              onClick={() => setValidate(row)}
              className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-primary-container px-space-sm font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5"
            >
              <ShieldCheck aria-hidden className="size-3.5" /> Validar
            </button>
          )}
          <Link
            href={`/pcp/${row.id}`}
            className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Abrir
          </Link>
        </span>
      ),
    },
  ];

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  if (error) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Card className="p-space-lg">
            <EmptyState
              icon={AlertTriangle}
              title="No se pudo abrir PCP"
              description={error instanceof Error ? error.message : 'Revisa tus permisos con un administrador.'}
              action={
                <Link
                  href="/"
                  className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  Volver al inicio
                </Link>
              }
            />
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Planta · PCP · Llegada de clientes"
          icon={DoorOpen}
          greeting={greeting}
          title="PCP"
          subtitle="Los clientes que vienen a cargar con su llegada a planta, las fotos de cédula y carnet por pedido y la validación en Romana. Se llenan solos cuando despacho envía la simulación."
        />

        <section className="grid gap-space-md xl:grid-cols-12">
          <div className="flex flex-col gap-space-md xl:col-span-4">
            <HeroCard
              label={
                range === 'today'
                  ? 'Clientes por llegar hoy'
                  : range === 'tomorrow'
                    ? 'Clientes esperados mañana'
                    : 'Clientes en el histórico'
              }
              value={formatNumber(pulse.waiting)}
              suffix="clientes"
              hint={heroHint}
              progress={validatedPct}
              icon={Users}
            />
            <div className="stagger grid grid-cols-2 gap-space-sm">
              <Kpi label="En planta" value={formatNumber(pulse.onSite)} suffix="ahora" tone="primary" icon={DoorOpen} />
              <Kpi
                label="Faltan fotos"
                value={formatNumber(pulse.docsPending)}
                suffix="clientes"
                tone={pulse.docsPending > 0 ? 'warning' : 'muted'}
                icon={Camera}
              />
              <Kpi label="En Romana" value={formatNumber(pulse.inRomana)} suffix="ahora" tone="primary" icon={Scale} />
              <Kpi
                label="Validados"
                value={formatNumber(pulse.validated)}
                suffix="fotos borradas"
                tone="success"
                icon={ShieldCheck}
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
                <Select
                  className="w-48"
                  value={romanaStatus}
                  onChange={(value) => setRomanaStatus(value as RomanaStatus | '')}
                  options={ROMANA_OPTIONS}
                  ariaLabel="Estado de los documentos"
                />
                <TextInput
                  className="w-56"
                  icon={Search}
                  value={q}
                  onChange={setQ}
                  placeholder="Buscar cliente, pedido o despacho…"
                  ariaLabel="Buscar en PCP"
                />
              </div>
              <div className="flex items-center gap-space-sm">
                {isFetching && <RefreshCw aria-hidden className="size-3.5 animate-spin text-outline" />}
                <span className="text-label-sm normal-case text-on-surface-variant">
                  {dataUpdatedAt ? `actualizado ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : 'sincronizando…'}
                </span>
                <Badge tone={romanaStatus || status || q ? 'primary' : 'muted'} dot>
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
                  {pulse.docsPending} con fotos pendientes · {pulse.onSite} en planta · {pulse.validated} validados
                </span>
              }
              empty={
                <EmptyState
                  icon={DoorOpen}
                  title={
                    romanaStatus || status || q
                      ? 'Sin clientes para este filtro'
                      : range === 'tomorrow'
                        ? 'Mañana no hay clientes esperados'
                        : 'Todavía no hay clientes esperados'
                  }
                  description={
                    romanaStatus || status || q
                      ? 'Prueba con otro estado o limpia la búsqueda.'
                      : 'Aparecen automáticamente cuando planificación envía un despacho: no hay que hacer nada más aquí.'
                  }
                />
              }
            />
          </Card>
        </section>

        <p className="text-label-sm normal-case text-on-surface-variant">
          {range === 'today' ? `Bandeja de hoy · ${businessDayLabel(businessToday())}` : ''}
        </p>
      </main>

      {toast && (
        <div
          role="status"
          className="animate-rise fixed bottom-space-lg left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-space-sm rounded-pill bg-primary px-space-lg py-space-sm text-body-md font-semibold text-on-primary shadow-hero"
        >
          <CheckCheck aria-hidden className="size-4" /> {toast}
        </div>
      )}

      <CheckInDialog
        open={Boolean(checkInPcp)}
        arrival={checkInPcp}
        onClose={() => setCheckInPcp(null)}
        onSaved={(detail: ArrivalDetail) => {
          refresh(fullFromArrival(checkInPcp, detail));
          setToast(`Llegada de ${detail.customerName} marcada a las ${clockLabel(detail.arrivedAt)}.`);
          setCheckInPcp(null);
        }}
      />
      <RomanaCheckInDialog
        open={Boolean(checkInRomana)}
        arrival={checkInRomana}
        onClose={() => setCheckInRomana(null)}
        onSaved={(detail) => {
          refresh(detail);
          setToast(`Llegada de ${detail.customerName} marcada en Romana.`);
          setCheckInRomana(null);
        }}
      />
      <RomanaValidateDialog
        open={Boolean(validate)}
        arrival={validate}
        onClose={() => setValidate(null)}
        onSaved={(detail) => {
          refresh(detail);
          setToast(`Documentos de ${detail.customerName} validados y fotos eliminadas.`);
          setValidate(null);
        }}
      />
    </>
  );
}

/**
 * El diálogo de PCP devuelve `ArrivalDetail` (sin el bloque de Romana). Para no
 * perder la fila al refrescar se fusiona con la que ya tenía el tablero.
 */
function fullFromArrival(
  row: RomanaArrivalSummary | null,
  detail: ArrivalDetail,
): RomanaArrivalDetail | undefined {
  if (!row) return undefined;
  return {
    ...row,
    ...detail,
    romana: row.romana,
    incidents: detail.incidents,
    events: detail.events,
  };
}

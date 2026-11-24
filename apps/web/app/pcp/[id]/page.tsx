'use client';

import type { ArrivalDetail, ArrivalIncident, RomanaArrivalDetail } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCheck,
  ClipboardList,
  DoorOpen,
  Loader2,
  MessageSquare,
  PencilLine,
  Scale,
  Send,
  ShieldCheck,
  Truck,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CheckInDialog,
  CloseArrivalDialog,
  EditArrivalDialog,
  IncidentDialog,
} from '../../../components/ArrivalDialogs';
import { ArrivalStamp, ArrivalStatusBadge, ArrivalTimeline, IncidentKindBadge } from '../../../components/ArrivalParts';
import { RomanaCheckInDialog, RomanaValidateDialog } from '../../../components/romana/RomanaDialogs';
import { RomanaDocuments } from '../../../components/romana/RomanaDocuments';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, EmptyState, PageHeader, Skeleton, cx } from '../../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../../lib/api';
import { INCIDENT_KIND_META, INCIDENT_SEVERITY_META, arrivalStatusMeta } from '../../../lib/arrival';
import { formatNumber, relativeTime } from '../../../lib/dispatch-sheet';
import { hasPermission } from '../../../lib/permissions';
import { ROMANA_STATUS_META, formatBytes } from '../../../lib/romana';

// ============================================================
// Detalle de una llegada en PCP.
//
// Izquierda: ficha del cliente, hora de planta y hora de Romana. Derecha:
// documentos por pedido (cédula + carnet), incidencias y bitácora. Las fotos
// se comprimen al subir y se borran cuando Romana valida.
// ============================================================

function RomanaStamp({ arrival }: { arrival: RomanaArrivalDetail }) {
  const meta = ROMANA_STATUS_META[arrival.romana.status];
  const at = arrival.romana.validatedAt ?? arrival.romana.arrivedAt;

  if (arrival.romana.requiredDocs === 0 && !at) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-low/60 px-space-md py-space-sm">
        <p className="text-label-sm font-bold uppercase tracking-wider text-outline">Llegada a Romana</p>
        <p className="text-headline-md text-on-surface-variant">Sin documentos</p>
        <p className="text-label-sm normal-case text-on-surface-variant">
          Llegada anterior a Romana: no exige cédula ni carnet. Puedes subirlos si hacen falta.
        </p>
      </div>
    );
  }

  if (!at) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-low/60 px-space-md py-space-sm">
        <p className="text-label-sm font-bold uppercase tracking-wider text-outline">Llegada a Romana</p>
        <p className="text-headline-md text-on-surface-variant">Sin marcar</p>
        <p className="text-label-sm normal-case text-on-surface-variant">
          {arrival.romana.pendingDocs > 0
            ? `Faltan ${arrival.romana.pendingDocs} foto(s): ${arrival.romana.uploadedDocs}/${arrival.romana.requiredDocs} subidas.`
            : meta.hint}
        </p>
      </div>
    );
  }

  const date = new Date(at);
  const time = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
  const validated = Boolean(arrival.romana.validatedAt);

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl px-space-md py-space-sm shadow-hero',
        validated ? 'bg-success-container text-on-success-container' : 'bg-hero text-white',
      )}
    >
      <p className={cx('relative text-label-sm font-bold uppercase tracking-[0.14em]', validated ? 'text-on-success-container/70' : 'text-white/70')}>
        {validated ? 'Documentos validados' : 'Llegada a Romana'}
      </p>
      <p
        className={cx(
          'relative flex items-baseline gap-2 tabular-nums text-headline-lg font-black',
          validated ? 'text-on-success-container' : 'text-secondary-container',
        )}
      >
        {time}
        <span className={cx('text-label-sm font-semibold uppercase', validated ? 'text-on-success-container/60' : 'text-white/60')}>
          {day}
        </span>
      </p>
      <p className={cx('relative text-label-sm normal-case', validated ? 'text-on-success-container/80' : 'text-white/80')}>
        {validated
          ? `Validó ${arrival.romana.validatedByName ?? 'Romana'} · fotos eliminadas`
          : `Marcó ${arrival.romana.arrivedByName ?? 'Romana'}`}
      </p>
    </div>
  );
}

export default function PcpDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();

  const [checkInPcpOpen, setCheckInPcpOpen] = useState(false);
  const [checkInRomanaOpen, setCheckInRomanaOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [closeMode, setCloseMode] = useState<'ATENDIDO' | 'AUSENTE' | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const { data: sessionUser } = useQuery({ queryKey: ['me'], queryFn: currentUser, staleTime: 60_000, retry: false });
  const permissions = sessionUser?.permissions;

  const { data: arrival, isLoading, error } = useQuery<RomanaArrivalDetail>({
    queryKey: ['pcp-arrival', id],
    queryFn: () => apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${id}`),
    enabled: Boolean(id),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function apply(detail: RomanaArrivalDetail, text?: string) {
    queryClient.setQueryData(['pcp-arrival', detail.id], detail);
    queryClient.invalidateQueries({ queryKey: ['pcp-arrivals'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (text) setToast(text);
  }

  // Los diálogos compartidos devuelven `ArrivalDetail` (sin el bloque Romana):
  // se invalida la consulta para traer el detalle completo.
  function applyShared(_detail: ArrivalDetail, text?: string) {
    void queryClient.invalidateQueries({ queryKey: ['pcp-arrival', id] });
    queryClient.invalidateQueries({ queryKey: ['pcp-arrivals'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (text) setToast(text);
  }

  async function sendMessage() {
    if (!arrival || !message.trim() || sending) return;
    setSending(true);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${arrival.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: message.trim() }),
      });
      apply(detail);
      setMessage('');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo guardar la nota');
    } finally {
      setSending(false);
    }
  }

  async function resolve(incident: ArrivalIncident) {
    if (!arrival) return;
    const text = (resolution[incident.id] ?? '').trim();
    if (text.length < 3) {
      setToast('Escribe cómo se resolvió la incidencia.');
      return;
    }
    setResolving(incident.id);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${arrival.id}/incidents/${incident.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolution: text }),
      });
      apply(detail);
      setResolution((current) => ({ ...current, [incident.id]: '' }));
      setToast('Incidencia resuelta.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo resolver la incidencia');
    } finally {
      setResolving(null);
    }
  }

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
              title="No se pudo abrir esta llegada"
              description={error instanceof Error ? error.message : 'Revisa tus permisos con un administrador.'}
              action={
                <Link
                  href="/pcp"
                  className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  Volver a PCP
                </Link>
              }
            />
          </Card>
        </main>
      </>
    );
  }

  if (isLoading || !arrival) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-md p-space-lg md:p-space-xl">
          <Skeleton className="h-10 w-56 rounded-pill" />
          <Skeleton className="h-28 rounded-card" />
          <div className="grid gap-space-md lg:grid-cols-12">
            <Skeleton className="h-80 rounded-card lg:col-span-5" />
            <Skeleton className="h-80 rounded-card lg:col-span-7" />
          </div>
        </main>
      </>
    );
  }

  const meta = arrivalStatusMeta(arrival.status);
  const romanaMeta = ROMANA_STATUS_META[arrival.romana.status];
  const canResolve = hasPermission(permissions, 'pcp', 'update');
  const openIncidents = arrival.incidents.filter((incident) => incident.status === 'ABIERTA');

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg pb-space-2xl md:p-space-xl">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <Link
            href="/pcp"
            className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <ArrowLeft aria-hidden className="size-4" /> PCP de hoy
          </Link>
          <div className="flex flex-wrap items-center gap-space-xs">
            <Link
              href={`/despacho/${arrival.sheetId}`}
              className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <Truck aria-hidden className="size-4" /> {arrival.sheetNumber}
            </Link>
            {arrival.canEdit && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-primary transition-colors hover:bg-surface-container-low"
              >
                <PencilLine aria-hidden className="size-4" /> Corregir
              </button>
            )}
          </div>
        </div>

        <PageHeader
          eyebrow={`PCP · Llegada ${arrival.number}`}
          icon={DoorOpen}
          title={arrival.customerName}
          subtitle={`${arrival.customerCode} · despacho ${arrival.sheetNumber} («${arrival.sheetTitle}») · ${arrival.orderNumbers.length} pedido(s)`}
          actions={
            <span className="flex flex-wrap items-center gap-space-xs">
              <Badge tone={romanaMeta.tone} dot>
                {romanaMeta.short}
              </Badge>
              <ArrivalStatusBadge status={arrival.status} />
            </span>
          }
        />

        <div className="grid gap-space-md lg:grid-cols-12">
          {/* ---------- Ficha del cliente + acciones ---------- */}
          <div className="flex flex-col gap-space-md lg:col-span-4">
            <Card className="flex flex-col gap-space-md p-space-md">
              <ArrivalStamp
                arrivedAt={arrival.arrivedAt}
                arrivedByName={arrival.arrivedByName}
                arrivedByCode={arrival.arrivedByCode}
                status={arrival.status}
              />
              <RomanaStamp arrival={arrival} />

              <div className="grid grid-cols-2 gap-space-sm">
                <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Sacos</p>
                  <p className="text-headline-md tabular-nums font-black text-primary">{formatNumber(arrival.plannedSacks)}</p>
                </div>
                <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Kilogramos</p>
                  <p className="text-headline-md tabular-nums font-black text-primary">{formatNumber(arrival.plannedKg)}</p>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-space-sm text-body-md">
                <div>
                  <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Fecha esperada</dt>
                  <dd className="text-on-surface">{arrival.expectedDate ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Pedidos</dt>
                  <dd className="truncate text-on-surface" title={arrival.orderNumbers.join(' · ')}>
                    {arrival.orderNumbers.join(' · ') || '—'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Último cambio</dt>
                  <dd className="text-on-surface-variant">
                    {relativeTime(arrival.updatedAt)}
                    {arrival.updatedByName ? ` · ${arrival.updatedByName}` : ''}
                  </dd>
                </div>
              </dl>

              {arrival.note && (
                <p className="rounded-xl border border-outline-variant/35 bg-surface-container-low/60 px-space-sm py-space-xs text-body-md text-on-surface">
                  {arrival.note}
                </p>
              )}

              <div className="flex flex-col gap-space-xs">
                {arrival.canCheckIn && (
                  <button
                    type="button"
                    onClick={() => setCheckInPcpOpen(true)}
                    className="flex h-11 items-center justify-center gap-space-sm rounded-pill bg-secondary-container px-space-lg text-body-lg font-bold text-on-secondary shadow-soft transition-all hover:-translate-y-0.5"
                  >
                    <DoorOpen aria-hidden className="size-5" /> Marcar llegada en planta
                  </button>
                )}

                {arrival.romana.canCheckIn && (
                  <button
                    type="button"
                    onClick={() => setCheckInRomanaOpen(true)}
                    className="flex h-11 items-center justify-center gap-space-sm rounded-pill bg-primary-container px-space-lg text-body-lg font-bold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary active:translate-y-0"
                  >
                    <Scale aria-hidden className="size-5" /> Marcar llegada en Romana
                  </button>
                )}

                {arrival.romana.canValidate && (
                  <button
                    type="button"
                    onClick={() => setValidateOpen(true)}
                    className="flex h-10 items-center justify-center gap-space-xs rounded-pill bg-success-container px-space-md font-semibold text-on-success-container shadow-soft transition-all hover:-translate-y-0.5"
                  >
                    <ShieldCheck aria-hidden className="size-4" /> Validar y borrar fotos
                  </button>
                )}

                {!arrival.romana.canCheckIn && arrival.romana.status === 'PENDIENTE' && (
                  <p className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning-container/30 px-space-sm py-space-xs text-body-md text-on-warning-container">
                    <Camera aria-hidden className="mt-0.5 size-4 shrink-0" />
                    Faltan {arrival.romana.pendingDocs} foto(s) para poder marcar la llegada en Romana. Súbelas en
                    «Documentos por pedido».
                  </p>
                )}

                {arrival.canClose && arrival.arrivedAt && (
                  <div className="flex flex-wrap gap-space-xs">
                    <button
                      type="button"
                      onClick={() => setCloseMode('ATENDIDO')}
                      className="flex h-10 flex-1 items-center justify-center gap-space-xs rounded-pill bg-secondary-container px-space-md font-semibold text-on-secondary shadow-soft transition-all hover:-translate-y-0.5"
                    >
                      <CheckCheck aria-hidden className="size-4" /> Atendido
                    </button>
                    <button
                      type="button"
                      onClick={() => setCloseMode('AUSENTE')}
                      className="flex h-10 flex-1 items-center justify-center gap-space-xs rounded-pill border border-critical/40 px-space-md font-semibold text-error transition-colors hover:bg-critical-container/40"
                    >
                      <UserX aria-hidden className="size-4" /> No vino
                    </button>
                  </div>
                )}

                {arrival.status === 'ESPERADO' && !arrival.arrivedAt && arrival.canClose && (
                  <button
                    type="button"
                    onClick={() => setCloseMode('AUSENTE')}
                    className="flex h-10 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                  >
                    <UserX aria-hidden className="size-4" /> Marcar que no vino
                  </button>
                )}

                {arrival.canReportIncident && (
                  <button
                    type="button"
                    onClick={() => setIncidentOpen(true)}
                    className="flex h-10 items-center justify-center gap-space-xs rounded-pill border border-warning/50 px-space-md font-semibold text-on-surface transition-colors hover:bg-warning-container/40"
                  >
                    <AlertTriangle aria-hidden className="size-4 text-warning" /> Registrar incidencia
                  </button>
                )}
              </div>
            </Card>

            <Card className="p-space-md">
              <p className="mb-space-sm font-bold uppercase tracking-wider text-label-md text-primary">
                Resumen del despacho
              </p>
              <ul className="flex flex-col gap-space-xs text-body-md text-on-surface-variant">
                <li className="flex items-center gap-space-xs">
                  <ClipboardList aria-hidden className="size-4 text-primary" /> {arrival.lineCount} renglón(es) del plan
                </li>
                <li className="flex items-center gap-space-xs">
                  <Camera aria-hidden className="size-4 text-primary" />{' '}
                  {arrival.romana.requiredDocs === 0
                    ? 'Sin documentos exigidos'
                    : `${arrival.romana.uploadedDocs}/${arrival.romana.requiredDocs} fotos · ${formatBytes(
                        arrival.romana.totalBytes,
                      )}`}
                </li>
                <li className="flex items-center gap-space-xs">
                  <AlertTriangle aria-hidden className="size-4 text-warning" /> {arrival.incidentCount} incidencia(s),{' '}
                  {arrival.openIncidentCount} abierta(s)
                </li>
              </ul>
              <p className="mt-space-sm text-label-sm normal-case text-outline">{meta.hint}</p>
            </Card>
          </div>

          {/* ---------- Documentos + incidencias + bitácora ---------- */}
          <div className="flex flex-col gap-space-md lg:col-span-8">
            <Card className="p-space-md">
              <div className="mb-space-sm flex flex-wrap items-center justify-between gap-space-sm">
                <div>
                  <p className="font-bold uppercase tracking-wider text-label-md text-primary">Documentos por pedido</p>
                  <p className="text-label-sm normal-case text-on-surface-variant">
                    Cédula del chofer y carnet de circulación. Se comprimen al subir; al validar se borran.
                  </p>
                </div>
                {arrival.romana.photosPurgedAt && (
                  <Badge tone="success" dot>
                    fotos eliminadas
                  </Badge>
                )}
              </div>
              <RomanaDocuments arrival={arrival} onSaved={(detail) => apply(detail)} />
            </Card>

            <Card className="p-space-md">
              <div className="mb-space-sm flex flex-wrap items-center justify-between gap-space-sm">
                <div>
                  <p className="font-bold uppercase tracking-wider text-label-md text-primary">Incidencias</p>
                  <p className="text-label-sm normal-case text-on-surface-variant">
                    Se abren con tipo y severidad; se cierran con la explicación de cómo se resolvieron.
                  </p>
                </div>
                {openIncidents.length > 0 && <Badge tone="warning">{openIncidents.length} abierta(s)</Badge>}
              </div>

              {arrival.incidents.length === 0 ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Sin incidencias"
                  description="Si algo sale mal con este cliente, regístralo desde la ficha; queda en la bitácora y avisa al despacho."
                />
              ) : (
                <ul className="flex flex-col gap-space-sm">
                  {arrival.incidents.map((incident) => (
                    <li
                      key={incident.id}
                      className={cx(
                        'rounded-xl border px-space-sm py-space-sm',
                        incident.status === 'ABIERTA'
                          ? 'border-warning/40 bg-warning/5'
                          : 'border-outline-variant/35 bg-surface-container-low/40',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-space-xs">
                        <IncidentKindBadge kind={incident.kind} severity={incident.severity} />
                        <Badge tone={INCIDENT_SEVERITY_META[incident.severity].tone}>{INCIDENT_SEVERITY_META[incident.severity].label}</Badge>
                        <Badge tone={incident.status === 'ABIERTA' ? 'warning' : 'success'} dot>
                          {incident.status === 'ABIERTA' ? 'abierta' : 'resuelta'}
                        </Badge>
                        <span className="ml-auto text-label-sm normal-case text-outline">
                          {relativeTime(incident.createdAt)}
                          {incident.reportedByName ? ` · ${incident.reportedByName}` : ''}
                        </span>
                      </div>
                      <p className="mt-space-xs text-body-md text-on-surface">{incident.body}</p>
                      <p className="text-label-sm normal-case text-on-surface-variant">
                        {INCIDENT_KIND_META[incident.kind]?.hint}
                      </p>

                      {incident.resolution && (
                        <p className="mt-space-xs rounded-lg bg-success-container/40 px-space-sm py-space-xs text-body-md text-on-surface">
                          <span className="font-semibold text-on-success-container">Resolución: </span>
                          {incident.resolution}
                          {incident.resolvedByName ? ` — ${incident.resolvedByName}` : ''}
                        </p>
                      )}

                      {incident.status === 'ABIERTA' && canResolve && (
                        <div className="mt-space-xs flex flex-col gap-space-xs sm:flex-row">
                          <input
                            value={resolution[incident.id] ?? ''}
                            onChange={(event) =>
                              setResolution((current) => ({ ...current, [incident.id]: event.target.value }))
                            }
                            placeholder="Cómo se resolvió…"
                            maxLength={500}
                            className="h-9 flex-1 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                          />
                          <button
                            type="button"
                            onClick={() => void resolve(incident)}
                            disabled={resolving === incident.id}
                            className="flex h-9 items-center justify-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
                          >
                            {resolving === incident.id ? (
                              <Loader2 aria-hidden className="size-3.5 animate-spin" />
                            ) : (
                              <CheckCheck aria-hidden className="size-3.5" />
                            )}
                            Resolver
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-space-md">
              <p className="mb-space-sm font-bold uppercase tracking-wider text-label-md text-primary">Bitácora</p>
              <ArrivalTimeline events={arrival.events} />

              <div className="mt-space-md flex flex-col gap-space-xs border-t border-outline-variant/30 pt-space-sm sm:flex-row">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Agregar una nota al registro…"
                  maxLength={500}
                  className="h-10 flex-1 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={sending || !message.trim()}
                  className="flex h-10 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
                >
                  {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                  Enviar
                </button>
              </div>
            </Card>
          </div>
        </div>
      </main>

      {toast && (
        <div
          role="status"
          className="animate-rise fixed bottom-space-lg left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-space-sm rounded-pill bg-primary px-space-lg py-space-sm text-body-md font-semibold text-on-primary shadow-hero"
        >
          <MessageSquare aria-hidden className="size-4" /> {toast}
        </div>
      )}

      <CheckInDialog
        open={checkInPcpOpen}
        arrival={arrival}
        onClose={() => setCheckInPcpOpen(false)}
        onSaved={(detail) => applyShared(detail, 'Llegada marcada en planta.')}
      />
      <RomanaCheckInDialog
        open={checkInRomanaOpen}
        arrival={arrival}
        onClose={() => setCheckInRomanaOpen(false)}
        onSaved={(detail) => apply(detail, 'Llegada marcada en Romana.')}
      />
      <RomanaValidateDialog
        open={validateOpen}
        arrival={arrival}
        onClose={() => setValidateOpen(false)}
        onSaved={(detail) => apply(detail, 'Documentos validados y fotos eliminadas.')}
      />
      <IncidentDialog
        open={incidentOpen}
        arrival={arrival}
        basePath="/romana/arrivals"
        scope="PCP"
        onClose={() => setIncidentOpen(false)}
        onSaved={(detail) => applyShared(detail, 'Incidencia registrada.')}
      />
      <EditArrivalDialog
        open={editOpen}
        arrival={arrival}
        onClose={() => setEditOpen(false)}
        onSaved={(detail) => applyShared(detail, 'Registro corregido.')}
      />
      <CloseArrivalDialog
        open={Boolean(closeMode)}
        arrival={arrival}
        mode={closeMode ?? 'ATENDIDO'}
        basePath="/romana/arrivals"
        scope="PCP"
        onClose={() => setCloseMode(null)}
        onSaved={(detail) => applyShared(detail, 'Atención cerrada.')}
      />
    </>
  );
}

'use client';

// ============================================================
// Llegada de PCP para teléfono.
//
// Las fotos de la cédula y el carnet se toman en el patio: esta vista pone el
// avance de fotos arriba, cada pedido con dos tomas grandes (cámara directa +
// galería) y una barra inferior fija con el siguiente paso. El resto (datos,
// incidencias, bitácora) queda plegado para no competir con la cámara.
// ============================================================

import type {
  ArrivalIncident,
  RomanaArrivalDetail,
  RomanaDocKind,
  RomanaDocument,
  RomanaDocumentResponse,
  RomanaOrderDocuments,
} from '@nexo/contracts';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CopyPlus,
  DoorOpen,
  Eye,
  ImagePlus,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Scale,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  UserX,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { apiFetch, apiUpload } from '../../lib/api';
import {
  INCIDENT_KIND_META,
  INCIDENT_SEVERITY_META,
  arrivalStatusMeta,
  arrivalTimeLabel,
  clockLabel,
} from '../../lib/arrival';
import { formatNumber, relativeTime } from '../../lib/dispatch-sheet';
import { ROMANA_DOC_META, ROMANA_STATUS_META, compressForUpload, formatBytes } from '../../lib/romana';
import { ArrivalStatusBadge, ArrivalTimeline, IncidentKindBadge } from '../ArrivalParts';
import { Badge, Card, cx } from '../ui';

const DOC_KINDS: RomanaDocKind[] = ['CEDULA', 'CARNET'];

type DocTarget = { orderNumber: string; kind: RomanaDocKind };
type CloseMode = 'ATENDIDO' | 'AUSENTE';

function docKey(orderNumber: string, kind: RomanaDocKind) {
  return `${orderNumber}:${kind}`;
}

function findDoc(order: RomanaOrderDocuments, kind: RomanaDocKind): RomanaDocument | undefined {
  return order.documents.find((document) => document.kind === kind);
}

export function PcpArrivalMobile({
  arrival,
  canResolve,
  onSaved,
  onNotify,
  onOpenPlantArrival,
  onOpenRomanaArrival,
  onOpenValidate,
  onOpenIncident,
  onOpenEdit,
  onOpenClose,
}: {
  arrival: RomanaArrivalDetail;
  canResolve: boolean;
  onSaved: (detail: RomanaArrivalDetail) => void;
  onNotify: (message: string) => void;
  onOpenPlantArrival: () => void;
  onOpenRomanaArrival: () => void;
  onOpenValidate: () => void;
  onOpenIncident: () => void;
  onOpenEdit: () => void;
  onOpenClose: (mode: CloseMode) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [target, setTarget] = useState<DocTarget | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reusing, setReusing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [uploadError, setUploadError] = useState<{ key: string; message: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, string>>({});

  const romana = arrival.romana;
  const editable = romana.canUploadDocs;
  const arrivalMeta = arrivalStatusMeta(arrival.status);
  const romanaMeta = ROMANA_STATUS_META[romana.status];
  const openIncidents = arrival.incidents.filter((incident) => incident.status === 'ABIERTA');
  const ratio = romana.requiredDocs > 0 ? romana.uploadedDocs / romana.requiredDocs : 0;

  // Primera foto que falta, en el orden en que se trabaja: pedido y luego
  // cédula → carnet. Alimenta los botones de cámara.
  const nextMissing = useMemo<DocTarget | null>(() => {
    for (const order of romana.orders) {
      for (const kind of DOC_KINDS) {
        const document = findDoc(order, kind);
        if (!document?.url) return { orderNumber: order.orderNumber, kind };
      }
    }
    return null;
  }, [romana.orders]);

  function pick(next: DocTarget, source: 'camera' | 'gallery') {
    if (!editable) return;
    setUploadError(null);
    setTarget(next);
    const input = source === 'camera' ? cameraRef.current : galleryRef.current;
    input?.click();
  }

  async function upload(file: File) {
    const current = target;
    if (!current) return;
    const key = docKey(current.orderNumber, current.kind);
    setBusyKey(key);
    setUploadError(null);
    try {
      const compressed = await compressForUpload(file);
      const response = await apiUpload<RomanaDocumentResponse>(
        `/romana/arrivals/${arrival.id}/orders/${encodeURIComponent(current.orderNumber)}/documents/${current.kind}`,
        compressed,
      );
      onSaved(response.detail);
      onNotify(`${ROMANA_DOC_META[current.kind].short} del pedido ${current.orderNumber} lista.`);
    } catch (err) {
      setUploadError({
        key,
        message: err instanceof Error ? err.message : 'No se pudo subir la foto',
      });
    } finally {
      setBusyKey(null);
      setTarget(null);
    }
  }

  async function remove(orderNumber: string, kind: RomanaDocKind) {
    if (!editable || busyKey) return;
    const key = docKey(orderNumber, kind);
    setBusyKey(key);
    setUploadError(null);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(
        `/romana/arrivals/${arrival.id}/orders/${encodeURIComponent(orderNumber)}/documents/${kind}`,
        { method: 'DELETE' },
      );
      onSaved(detail);
      onNotify('Foto quitada.');
    } catch (err) {
      setUploadError({
        key,
        message: err instanceof Error ? err.message : 'No se pudo quitar la foto',
      });
    } finally {
      setBusyKey(null);
    }
  }

  /** Copia la foto a los pedidos del mismo cliente que aún no la tienen. */
  async function reuse(orderNumber: string, kind: RomanaDocKind, targets: string[]) {
    if (reusing || targets.length === 0) return;
    const key = docKey(orderNumber, kind);
    setReusing(key);
    try {
      const response = await apiFetch<{ detail: RomanaArrivalDetail; applied: string[] }>(
        `/romana/arrivals/${arrival.id}/orders/${encodeURIComponent(orderNumber)}/documents/${kind}/apply`,
        { method: 'POST', body: JSON.stringify({ orderNumbers: targets }) },
      );
      onSaved(response.detail);
      onNotify(
        response.applied.length > 0
          ? `${ROMANA_DOC_META[kind].short} copiada a ${response.applied.length} pedido(s).`
          : 'Los demás pedidos ya tienen su propio documento.',
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudo reutilizar la foto.');
    } finally {
      setReusing(null);
    }
  }

  async function sendNote() {
    const text = note.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${arrival.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      onSaved(detail);
      setNote('');
      onNotify('Nota guardada.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudo guardar la nota');
    } finally {
      setSending(false);
    }
  }

  async function resolveIncident(incident: ArrivalIncident) {
    const text = (resolution[incident.id] ?? '').trim();
    if (text.length < 3) {
      onNotify('Escribe cómo se resolvió la incidencia.');
      return;
    }
    setResolving(incident.id);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(
        `/romana/arrivals/${arrival.id}/incidents/${incident.id}`,
        { method: 'PATCH', body: JSON.stringify({ resolution: text }) },
      );
      onSaved(detail);
      setResolution((current) => ({ ...current, [incident.id]: '' }));
      onNotify('Incidencia resuelta.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudo resolver la incidencia');
    } finally {
      setResolving(null);
    }
  }

  const primary: { label: string; icon: LucideIcon; tone: string; run: () => void } | null = (() => {
    if (arrival.canCheckIn) {
      return {
        label: 'Marcar llegada en planta',
        icon: DoorOpen,
        tone: 'bg-secondary-container text-on-secondary',
        run: onOpenPlantArrival,
      };
    }
    if (romana.canCheckIn) {
      return {
        label: 'Marcar llegada en Romana',
        icon: Scale,
        tone: 'bg-primary-container text-on-primary',
        run: onOpenRomanaArrival,
      };
    }
    if (romana.canValidate) {
      return {
        label: 'Validar y borrar fotos',
        icon: ShieldCheck,
        tone: 'bg-success-container text-on-success-container',
        run: onOpenValidate,
      };
    }
    if (arrival.canClose && arrival.arrivedAt) {
      return {
        label: 'Cerrar atención',
        icon: CheckCheck,
        tone: 'bg-secondary-container text-on-secondary',
        run: () => onOpenClose('ATENDIDO'),
      };
    }
    return null;
  })();

  const moreActions: { label: string; icon: LucideIcon; run: () => void; tone?: string }[] = [];
  if (arrival.canReportIncident) {
    moreActions.push({ label: 'Registrar incidencia', icon: AlertTriangle, run: onOpenIncident });
  }
  if (arrival.canClose && arrival.arrivedAt) {
    moreActions.push({
      label: 'Marcar atención como atendida',
      icon: CheckCheck,
      run: () => onOpenClose('ATENDIDO'),
    });
    moreActions.push({
      label: 'Marcar que no vino',
      icon: UserX,
      run: () => onOpenClose('AUSENTE'),
      tone: 'text-error',
    });
  } else if (arrival.status === 'ESPERADO' && !arrival.arrivedAt && arrival.canClose) {
    moreActions.push({
      label: 'Marcar que no vino',
      icon: UserX,
      run: () => onOpenClose('AUSENTE'),
      tone: 'text-error',
    });
  }
  if (arrival.canEdit) {
    moreActions.push({ label: 'Corregir registro', icon: PencilLine, run: onOpenEdit });
  }

  return (
    <>
      <main className="mx-auto w-full max-w-2xl px-space-md pb-40 pt-space-sm">
        {/* Barra superior: volver, despacho y corrección */}
        <div className="flex items-center justify-between gap-space-sm">
          <Link
            href="/pcp"
            className="inline-flex h-11 items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-sm font-semibold text-body-md text-on-surface-variant"
          >
            <ArrowLeft aria-hidden className="size-4" /> PCP
          </Link>
          <div className="flex items-center gap-space-xs">
            <Link
              href={`/despacho/${arrival.sheetId}`}
              aria-label={`Abrir despacho ${arrival.sheetNumber}`}
              className="grid size-11 place-items-center rounded-full border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant"
            >
              <Truck aria-hidden className="size-4" />
            </Link>
            {arrival.canEdit && (
              <button
                type="button"
                onClick={onOpenEdit}
                aria-label="Corregir registro"
                className="grid size-11 place-items-center rounded-full border border-outline-variant/50 bg-surface-container-lowest text-primary"
              >
                <PencilLine aria-hidden className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Ficha del cliente */}
        <header className="mt-space-md">
          <p className="flex items-center gap-space-xs text-label-sm font-bold uppercase tracking-[0.14em] text-outline">
            <DoorOpen aria-hidden className="size-3.5" /> PCP · {arrival.number}
          </p>
          <h1 className="mt-1 font-display text-headline-lg leading-[1.08] tracking-[0.01em] text-primary">
            {arrival.customerName}
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            {arrival.customerCode} · {arrival.orderNumbers.length} pedido(s) · {arrival.sheetNumber}
          </p>
          <div className="mt-space-xs flex flex-wrap items-center gap-space-xs">
            <Badge tone={romanaMeta.tone} dot>
              {romanaMeta.short}
            </Badge>
            <ArrivalStatusBadge status={arrival.status} />
            {openIncidents.length > 0 && (
              <Badge tone="warning" dot>
                {openIncidents.length} incidencia(s)
              </Badge>
            )}
          </div>
        </header>

        {/* Horas clave */}
        <div className="mt-space-md grid grid-cols-2 gap-space-sm">
          <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-space-sm shadow-soft">
            <p className="flex items-center gap-space-2xs text-label-sm font-bold uppercase tracking-wider text-outline">
              <DoorOpen aria-hidden className="size-3.5" /> En planta
            </p>
            <p className="mt-1 font-display text-headline-md leading-none tabular-nums text-primary">
              {arrival.arrivedAt ? clockLabel(arrival.arrivedAt) : 'Sin marcar'}
            </p>
            <p className="mt-1 line-clamp-2 text-label-sm normal-case text-on-surface-variant">
              {arrival.arrivedAt
                ? (arrival.arrivedByName ?? arrivalMeta.label)
                : 'Marca la hora al aparecer en portería.'}
            </p>
          </div>
          <div
            className={cx(
              'rounded-2xl border p-space-sm shadow-soft',
              romana.validatedAt
                ? 'border-success/30 bg-success-container text-on-success-container'
                : romana.arrivedAt
                  ? 'border-primary/20 bg-primary-container text-on-primary'
                  : 'border-outline-variant/35 bg-surface-container-lowest',
            )}
          >
            <p
              className={cx(
                'flex items-center gap-space-2xs text-label-sm font-bold uppercase tracking-wider',
                romana.arrivedAt ? 'opacity-75' : 'text-outline',
              )}
            >
              <Scale aria-hidden className="size-3.5" /> Romana
            </p>
            <p className="mt-1 font-display text-headline-md leading-none tabular-nums">
              {romana.validatedAt || romana.arrivedAt
                ? clockLabel(romana.validatedAt ?? romana.arrivedAt)
                : 'Sin marcar'}
            </p>
            <p className={cx('mt-1 line-clamp-2 text-label-sm normal-case', romana.arrivedAt ? 'opacity-80' : 'text-on-surface-variant')}>
              {romana.validatedAt
                ? `Validó ${romana.validatedByName ?? 'Romana'}`
                : romana.arrivedAt
                  ? `Marcó ${romana.arrivedByName ?? 'Romana'}`
                  : romanaMeta.hint}
            </p>
          </div>
        </div>

        {/* Fotos: el corazón de la vista móvil */}
        <Card className="mt-space-md overflow-hidden">
          <div className="relative overflow-hidden bg-hero p-space-md text-white">
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-14 size-36 rounded-full bg-secondary-container/20 blur-2xl" />
            <div className="relative flex items-start justify-between gap-space-sm">
              <div className="min-w-0">
                <p className="flex items-center gap-space-xs text-label-sm font-bold uppercase tracking-[0.14em] text-white/65">
                  <Camera aria-hidden className="size-3.5" /> Fotos del cliente
                </p>
                <p className="mt-1 font-display text-[2rem] leading-none tabular-nums text-secondary-container">
                  {romana.uploadedDocs}
                  <span className="text-white/45">/{romana.requiredDocs || '—'}</span>
                </p>
                <p className="mt-1 text-label-md text-white/75">
                  {romana.requiredDocs === 0
                    ? 'Esta llegada no exige cédula ni carnet.'
                    : romana.pendingDocs > 0
                      ? `Faltan ${romana.pendingDocs} foto(s) · ${formatBytes(romana.totalBytes)}`
                      : `Completas · ${formatBytes(romana.totalBytes)}`}
                </p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-secondary-container">
                <Camera aria-hidden className="size-5" />
              </span>
            </div>
            {romana.requiredDocs > 0 && (
              <div className="relative mt-space-sm h-2.5 overflow-hidden rounded-pill bg-white/15">
                <div
                  className="h-full rounded-pill bg-secondary-container transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                />
              </div>
            )}
          </div>

          {editable && nextMissing ? (
            <button
              type="button"
              onClick={() => pick(nextMissing, 'camera')}
              className="flex w-full items-center gap-space-sm p-space-sm text-left transition-colors active:bg-surface-container-low"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary-container text-on-secondary shadow-soft">
                <Camera aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-body-lg text-primary">Tomar la siguiente foto</span>
                <span className="block truncate text-label-md text-on-surface-variant">
                  {ROMANA_DOC_META[nextMissing.kind].label} · pedido {nextMissing.orderNumber}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-outline" />
            </button>
          ) : romana.requiredDocs > 0 && romana.pendingDocs === 0 ? (
            <p className="flex items-center gap-space-xs bg-success-container/50 p-space-sm text-body-md font-semibold text-on-success-container">
              <CheckCheck aria-hidden className="size-4" /> Fotos completas de todos los pedidos.
            </p>
          ) : null}
        </Card>

        {/* Documentos por pedido */}
        <section className="mt-space-lg">
          <div className="flex items-end justify-between gap-space-sm">
            <div>
              <h2 className="font-bold uppercase tracking-wider text-label-md text-primary">Documentos por pedido</h2>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Toca una foto para tomarla con la cámara.
              </p>
            </div>
            {romana.photosPurgedAt && (
              <Badge tone="success" dot>
                eliminadas
              </Badge>
            )}
          </div>

          {romana.orders.length === 0 ? (
            <Card className="mt-space-sm p-space-md text-center text-body-md text-on-surface-variant">
              Esta llegada no tiene pedidos; no se pueden pedir documentos.
            </Card>
          ) : (
            <div className="mt-space-sm flex flex-col gap-space-sm">
              {romana.orders.map((order) => (
                <Card key={order.orderNumber} className="p-space-sm">
                  <div className="mb-space-sm flex items-center justify-between gap-space-xs">
                    <div className="min-w-0">
                      <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Pedido</p>
                      <p className="truncate font-bold text-body-lg text-primary">{order.orderNumber}</p>
                    </div>
                    <Badge
                      tone={
                        order.complete || romana.status === 'VALIDADO'
                          ? 'success'
                          : romana.status === 'EXPIRADO'
                            ? 'muted'
                            : 'warning'
                      }
                      dot
                    >
                      {order.complete
                        ? 'completo'
                        : romana.status === 'VALIDADO'
                          ? 'validado'
                          : romana.status === 'EXPIRADO'
                            ? 'expirado'
                            : 'incompleto'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-space-sm">
                    {DOC_KINDS.map((kind) => {
                      const meta = ROMANA_DOC_META[kind];
                      const document = findDoc(order, kind);
                      const key = docKey(order.orderNumber, kind);
                      const live = Boolean(document?.url);
                      const busy = busyKey === key;
                      const error = uploadError?.key === key ? uploadError.message : null;
                      const reuseTargets = romana.orders
                        .filter((other) => other.orderNumber !== order.orderNumber)
                        .filter(
                          (other) => !other.documents.some((doc) => doc.kind === kind && doc.url),
                        )
                        .map((other) => other.orderNumber);

                      return (
                        <div key={kind} className="flex min-w-0 flex-col gap-space-xs">
                          <div className="relative">
                            {live && document?.thumbUrl ? (
                              <div className="relative overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low">
                                <button
                                  type="button"
                                  onClick={() => setPreview({ url: document.url!, label: `${meta.label} · pedido ${order.orderNumber}` })}
                                  className="block aspect-[4/3] w-full"
                                  aria-label={`Ver ${meta.label} del pedido ${order.orderNumber}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={document.thumbUrl}
                                    alt={`${meta.label} · pedido ${order.orderNumber}`}
                                    className="size-full object-cover"
                                  />
                                </button>
                                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-primary/75 px-space-xs py-1 text-label-sm font-semibold text-white">
                                  <span className="inline-flex items-center gap-1">
                                    <Eye aria-hidden className="size-3" /> Ver
                                  </span>
                                  <span className="tabular-nums">{formatBytes(document.bytes)}</span>
                                </span>
                              </div>
                            ) : document && !document.url ? (
                              <button
                                type="button"
                                onClick={() => pick({ orderNumber: order.orderNumber, kind }, 'camera')}
                                disabled={!editable || busy}
                                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-outline-variant/60 bg-surface-container-lowest px-space-xs text-center disabled:opacity-60"
                              >
                                <ShieldCheck aria-hidden className="size-6 text-success" />
                                <span className="text-label-md font-bold text-on-surface">Foto eliminada</span>
                                <span className="text-[10px] leading-tight text-on-surface-variant">
                                  {document.purgeReason === 'VALIDACION'
                                    ? 'Validada y borrada'
                                    : document.purgeReason === 'CANCELACION'
                                      ? 'Despacho cancelado'
                                      : 'Expirada por antigüedad'}
                                </span>
                                {editable && <span className="text-label-sm font-semibold text-primary">Volver a subir</span>}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => pick({ orderNumber: order.orderNumber, kind }, 'camera')}
                                disabled={!editable || busy}
                                className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-secondary/60 bg-secondary-container/10 px-space-xs text-center transition-colors active:bg-secondary-container/25 disabled:opacity-60"
                              >
                                <span className="grid size-10 place-items-center rounded-full bg-primary-fixed text-primary">
                                  <Camera aria-hidden className="size-5" />
                                </span>
                                <span className="text-label-md font-bold text-primary">{meta.short}</span>
                                <span className="text-[10px] leading-tight text-on-surface-variant">
                                  {editable ? 'Toca para tomar la foto' : 'Falta la foto'}
                                </span>
                              </button>
                            )}

                            {busy && (
                              <div className="absolute inset-0 grid place-items-center rounded-2xl bg-surface-container-lowest/85 backdrop-blur-[1px]">
                                <span className="flex items-center gap-space-xs rounded-pill bg-primary px-space-sm py-1 text-label-sm font-semibold text-on-primary">
                                  <Loader2 aria-hidden className="size-3.5 animate-spin" /> Subiendo…
                                </span>
                              </div>
                            )}

                            {live && editable && (
                              <button
                                type="button"
                                onClick={() => void remove(order.orderNumber, kind)}
                                disabled={busy}
                                aria-label={`Quitar ${meta.label} del pedido ${order.orderNumber}`}
                                className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-primary/70 text-white disabled:opacity-50"
                              >
                                <Trash2 aria-hidden className="size-4" />
                              </button>
                            )}
                          </div>

                          <div className="flex min-h-8 items-center justify-between gap-1">
                            <span className="truncate text-label-sm font-semibold text-on-surface">
                              {live ? meta.short : ''}
                            </span>
                            {editable && (
                              <button
                                type="button"
                                onClick={() => pick({ orderNumber: order.orderNumber, kind }, 'gallery')}
                                disabled={busy}
                                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-pill px-space-xs text-label-sm font-semibold text-on-surface-variant active:bg-surface-container-low disabled:opacity-50"
                              >
                                <ImagePlus aria-hidden className="size-3.5" />
                                {live ? 'Cambiar' : 'Galería'}
                              </button>
                            )}
                          </div>

                          {live && editable && reuseTargets.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void reuse(order.orderNumber, kind, reuseTargets)}
                              disabled={reusing === key || busy}
                              className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-pill border border-primary/30 bg-primary-fixed/40 px-space-xs font-semibold text-label-sm text-primary disabled:opacity-50"
                            >
                              {reusing === key ? (
                                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                              ) : (
                                <CopyPlus aria-hidden className="size-3.5" />
                              )}
                              {reusing === key
                                ? 'Copiando…'
                                : reuseTargets.length === 1
                                  ? `Usar en ${reuseTargets[0]}`
                                  : `Usar en ${reuseTargets.length} pedidos`}
                            </button>
                          )}

                          {error && (
                            <p role="alert" className="flex items-start gap-1 text-label-sm normal-case text-error">
                              <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" /> {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!editable && romana.status === 'VALIDADO' && (
            <p className="mt-space-sm flex items-center gap-space-xs rounded-xl bg-success-container/50 px-space-sm py-space-xs text-body-md text-on-success-container">
              <ShieldCheck aria-hidden className="size-4" /> Documentos validados; las fotos ya se borraron.
            </p>
          )}
        </section>

        {/* Datos del despacho (plegados) */}
        <details className="group mt-space-md rounded-card border border-outline-variant/35 bg-surface-container-lowest shadow-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-space-sm p-space-md">
            <span className="flex items-center gap-space-xs font-bold uppercase tracking-wider text-label-md text-primary">
              <ClipboardList aria-hidden className="size-4" /> Datos del despacho
            </span>
            <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-2 gap-space-sm px-space-md pb-space-md">
            <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
              <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Sacos</p>
              <p className="font-display text-headline-md tabular-nums text-primary">{formatNumber(arrival.plannedSacks)}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
              <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Kilogramos</p>
              <p className="font-display text-headline-md tabular-nums text-primary">{formatNumber(arrival.plannedKg)}</p>
            </div>
            <div>
              <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Fecha esperada</p>
              <p className="text-body-md text-on-surface">{arrival.expectedDate ?? '—'}</p>
            </div>
            <div>
              <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Pedidos</p>
              <p className="text-body-md text-on-surface">{arrival.orderNumbers.join(' · ') || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Último cambio</p>
              <p className="text-body-md text-on-surface-variant">
                {relativeTime(arrival.updatedAt)}
                {arrival.updatedByName ? ` · ${arrival.updatedByName}` : ''}
              </p>
            </div>
            {arrival.note && (
              <p className="col-span-2 rounded-xl border border-outline-variant/35 bg-surface-container-low/60 px-space-sm py-space-xs text-body-md text-on-surface">
                {arrival.note}
              </p>
            )}
            <p className="col-span-2 text-label-sm normal-case text-outline">
              {arrivalMeta.hint} {arrivalTimeLabel(arrival)}
            </p>
          </div>
        </details>

        {/* Incidencias */}
        <details
          open={openIncidents.length > 0}
          className="group mt-space-md rounded-card border border-outline-variant/35 bg-surface-container-lowest shadow-soft"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-space-sm p-space-md">
            <span className="flex items-center gap-space-xs font-bold uppercase tracking-wider text-label-md text-primary">
              <AlertTriangle aria-hidden className="size-4" /> Incidencias
            </span>
            <span className="flex items-center gap-space-xs">
              {openIncidents.length > 0 && <Badge tone="warning">{openIncidents.length} abierta(s)</Badge>}
              <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
            </span>
          </summary>

          <div className="px-space-md pb-space-md">
            {arrival.incidents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant/50 px-space-sm py-space-md text-center">
                <p className="font-semibold text-body-md text-on-surface">Sin incidencias</p>
                <p className="mt-1 text-label-md normal-case text-on-surface-variant">
                  Si algo sale mal, regístralo: queda en la bitácora y avisa al despacho.
                </p>
                {arrival.canReportIncident && (
                  <button
                    type="button"
                    onClick={onOpenIncident}
                    className="mt-space-sm inline-flex h-10 items-center gap-space-xs rounded-pill border border-warning/50 px-space-md font-semibold text-body-md text-on-surface"
                  >
                    <AlertTriangle aria-hidden className="size-4 text-warning" /> Registrar incidencia
                  </button>
                )}
              </div>
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
                      <Badge tone={INCIDENT_SEVERITY_META[incident.severity].tone}>
                        {INCIDENT_SEVERITY_META[incident.severity].label}
                      </Badge>
                      <Badge tone={incident.status === 'ABIERTA' ? 'warning' : 'success'} dot>
                        {incident.status === 'ABIERTA' ? 'abierta' : 'resuelta'}
                      </Badge>
                    </div>
                    <p className="mt-space-xs text-body-md text-on-surface">{incident.body}</p>
                    <p className="text-label-sm normal-case text-on-surface-variant">
                      {INCIDENT_KIND_META[incident.kind]?.hint}
                    </p>
                    <p className="mt-1 text-label-sm normal-case text-outline">
                      {relativeTime(incident.createdAt)}
                      {incident.reportedByName ? ` · ${incident.reportedByName}` : ''}
                    </p>

                    {incident.resolution && (
                      <p className="mt-space-xs rounded-lg bg-success-container/40 px-space-sm py-space-xs text-body-md text-on-surface">
                        <span className="font-semibold text-on-success-container">Resolución: </span>
                        {incident.resolution}
                        {incident.resolvedByName ? ` — ${incident.resolvedByName}` : ''}
                      </p>
                    )}

                    {incident.status === 'ABIERTA' && canResolve && (
                      <div className="mt-space-xs flex flex-col gap-space-xs">
                        <textarea
                          value={resolution[incident.id] ?? ''}
                          onChange={(event) =>
                            setResolution((current) => ({ ...current, [incident.id]: event.target.value }))
                          }
                          placeholder="Cómo se resolvió…"
                          maxLength={500}
                          rows={2}
                          className="w-full resize-none rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-space-xs text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                        />
                        <button
                          type="button"
                          onClick={() => void resolveIncident(incident)}
                          disabled={resolving === incident.id}
                          className="flex h-11 items-center justify-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-label-md text-on-primary shadow-soft disabled:opacity-50"
                        >
                          {resolving === incident.id ? (
                            <Loader2 aria-hidden className="size-4 animate-spin" />
                          ) : (
                            <CheckCheck aria-hidden className="size-4" />
                          )}
                          Resolver incidencia
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {/* Bitácora */}
        <details className="group mt-space-md rounded-card border border-outline-variant/35 bg-surface-container-lowest shadow-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-space-sm p-space-md">
            <span className="flex items-center gap-space-xs font-bold uppercase tracking-wider text-label-md text-primary">
              <MessageSquare aria-hidden className="size-4" /> Bitácora
            </span>
            <span className="flex items-center gap-space-xs">
              <span className="text-label-sm normal-case text-outline">{arrival.events.length} movimiento(s)</span>
              <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="px-space-md pb-space-md">
            <ArrivalTimeline events={arrival.events} />

            <div className="mt-space-md flex flex-col gap-space-xs border-t border-outline-variant/30 pt-space-sm">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Agregar una nota al registro…"
                maxLength={500}
                rows={2}
                className="w-full resize-none rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-space-xs text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
              />
              <button
                type="button"
                onClick={() => void sendNote()}
                disabled={sending || !note.trim()}
                className="flex h-11 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 font-semibold text-body-md text-primary disabled:opacity-40"
              >
                {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                Guardar nota
              </button>
            </div>
          </div>
        </details>
      </main>

      {/* Entradas de cámara y galería: un solo par para todas las fotos. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      {/* Barra inferior fija: el siguiente paso siempre a la mano. */}
      <nav
        aria-label="Acciones de la llegada"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant/35 bg-surface-container-lowest/95 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex w-full max-w-2xl items-center gap-space-xs px-space-md py-space-xs">
          {editable && nextMissing && (
            <button
              type="button"
              onClick={() => pick(nextMissing, 'camera')}
              aria-label={`Tomar ${ROMANA_DOC_META[nextMissing.kind].label} del pedido ${nextMissing.orderNumber}`}
              className="grid size-12 shrink-0 place-items-center rounded-full border border-secondary/40 bg-secondary-container/15 text-primary"
            >
              <Camera aria-hidden className="size-5" />
            </button>
          )}
          {primary ? (
            <button
              type="button"
              onClick={primary.run}
              className={cx(
                'flex h-12 min-w-0 flex-1 items-center justify-center gap-space-xs rounded-pill px-space-md text-body-md font-bold shadow-soft transition-transform active:scale-[0.99]',
                primary.tone,
              )}
            >
              <primary.icon aria-hidden className="size-5 shrink-0" />
              <span className="truncate">{primary.label}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              disabled={moreActions.length === 0}
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 text-body-md font-semibold text-on-surface-variant disabled:opacity-50"
            >
              <MoreHorizontal aria-hidden className="size-5" /> Acciones
            </button>
          )}
          {primary && moreActions.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Más acciones"
              className="grid size-12 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant"
            >
              <MoreHorizontal aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </nav>

      {/* Acciones secundarias */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-end bg-primary/40 backdrop-blur-sm"
          onClick={() => setMoreOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Más acciones"
        >
          <div
            className="w-full rounded-t-3xl bg-surface-container-lowest p-space-md shadow-hero"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-space-sm flex items-center justify-between gap-space-sm">
              <p className="font-bold text-title-md text-primary">Más acciones</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar"
                className="grid size-10 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-space-xs">
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    action.run();
                  }}
                  className={cx(
                    'flex h-12 items-center gap-space-sm rounded-xl border border-outline-variant/40 px-space-sm text-left font-semibold text-body-md',
                    action.tone ?? 'text-on-surface',
                  )}
                >
                  <action.icon aria-hidden className="size-5 shrink-0" />
                  {action.label}
                </button>
              ))}
              <Link
                href={`/despacho/${arrival.sheetId}`}
                onClick={() => setMoreOpen(false)}
                className="flex h-12 items-center gap-space-sm rounded-xl border border-outline-variant/40 px-space-sm font-semibold text-body-md text-on-surface"
              >
                <Truck aria-hidden className="size-5" /> Abrir despacho {arrival.sheetNumber}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Vista de la foto */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={preview.label}
          className="fixed inset-0 z-[60] flex flex-col justify-center bg-primary/95 p-space-sm backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label="Cerrar"
            className="absolute right-space-sm top-space-sm z-10 grid size-11 place-items-center rounded-full bg-white/15 text-white"
          >
            <X aria-hidden className="size-5" />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.label}
              className="max-h-full w-full rounded-2xl object-contain"
            />
          </div>
          <p className="pb-space-md text-center text-label-md font-semibold text-white">{preview.label}</p>
        </div>
      )}
    </>
  );
}

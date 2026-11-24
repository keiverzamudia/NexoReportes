'use client';

import type {
  RomanaArrivalDetail,
  RomanaArrivalSummary,
  RomanaDocKind,
  RomanaDocument,
  RomanaDocumentResponse,
} from '@nexo/contracts';
import {
  AlertTriangle,
  Camera,
  Eye,
  Loader2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { apiFetch, apiUpload } from '../../lib/api';
import { ROMANA_DOC_META, compressForUpload, formatBytes } from '../../lib/romana';
import { Badge, cx } from '../ui';

// ============================================================
// Documentos de Romana por pedido: una cédula y un carnet por pedido.
// La subida es inmediata (sobrevive cerrar el diálogo) y la miniatura se
// sirve por un endpoint autenticado.
// ============================================================

function DocSlot({
  arrivalId,
  orderNumber,
  kind,
  document,
  editable,
  onSaved,
  onPreview,
}: {
  arrivalId: string;
  orderNumber: string;
  kind: RomanaDocKind;
  document?: RomanaDocument;
  editable: boolean;
  onSaved: (detail: RomanaArrivalDetail) => void;
  onPreview: (url: string, label: string) => void;
}) {
  const meta = ROMANA_DOC_META[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const compressed = await compressForUpload(file);
      const response = await apiUpload<RomanaDocumentResponse>(
        `/romana/arrivals/${arrivalId}/orders/${encodeURIComponent(orderNumber)}/documents/${kind}`,
        compressed,
      );
      onSaved(response.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la foto');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy(false);
    }
  }

  async function remove() {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(
        `/romana/arrivals/${arrivalId}/orders/${encodeURIComponent(orderNumber)}/documents/${kind}`,
        { method: 'DELETE' },
      );
      onSaved(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar la foto');
    } finally {
      setBusy(false);
    }
  }

  const hasLive = Boolean(document?.url);

  return (
    <div className="flex min-w-0 flex-col gap-space-xs">
      <div
        className={cx(
          'relative overflow-hidden rounded-xl border',
          hasLive
            ? 'border-outline-variant/40 bg-surface-container-low'
            : 'border-dashed border-outline-variant/60 bg-surface-container-lowest',
        )}
      >
        {hasLive && document?.thumbUrl ? (
          <button
            type="button"
            onClick={() => onPreview(document.url!, `${meta.label} · pedido ${orderNumber}`)}
            className="group relative block aspect-[4/3] w-full"
            aria-label={`Ver ${meta.label} del pedido ${orderNumber}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={document.thumbUrl}
              alt={`${meta.label} · pedido ${orderNumber}`}
              className="size-full object-cover transition-transform group-hover:scale-[1.02]"
            />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-space-xs bg-primary/70 px-space-xs py-1 text-label-sm font-semibold text-white">
              <span className="inline-flex items-center gap-1">
                <Eye aria-hidden className="size-3" /> Ver
              </span>
              <span className="tabular-nums">{formatBytes(document.bytes)}</span>
            </span>
          </button>
        ) : document && !document.url ? (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-space-xs px-space-sm text-center">
            <ShieldCheck aria-hidden className="size-6 text-success" />
            <p className="text-label-sm font-semibold text-on-surface">Foto eliminada</p>
            <p className="text-label-sm normal-case text-on-surface-variant">
              {document.purgeReason === 'VALIDACION'
                ? 'Validada y borrada'
                : document.purgeReason === 'CANCELACION'
                  ? 'Despacho cancelado'
                  : 'Expirada por antigüedad'}
            </p>
            {editable && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="mt-1 inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-sm text-primary transition-colors hover:bg-surface-container-low disabled:opacity-50"
              >
                <Camera aria-hidden className="size-3.5" /> Volver a subir
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!editable || busy}
            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-space-xs px-space-sm text-center transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="grid size-9 place-items-center rounded-full bg-primary-fixed text-primary">
              <Camera aria-hidden className="size-4" />
            </span>
            <span className="font-semibold text-body-md text-primary">
              {editable ? 'Subir foto' : 'Falta la foto'}
            </span>
            <span className="text-label-sm normal-case text-on-surface-variant">{meta.hint}</span>
          </button>
        )}

        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-surface-container-lowest/80 backdrop-blur-[1px]">
            <span className="flex items-center gap-space-xs rounded-pill bg-primary px-space-sm py-1 text-label-sm font-semibold text-on-primary">
              <Loader2 aria-hidden className="size-3.5 animate-spin" /> Procesando…
            </span>
          </div>
        )}

        {hasLive && editable && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={`Quitar ${meta.label} del pedido ${orderNumber}`}
            className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-primary/70 text-white transition-colors hover:bg-error disabled:opacity-50"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-space-xs">
        <span className="truncate font-semibold text-label-md text-on-surface">{meta.short}</span>
        {document?.url ? (
          <Badge tone="success" dot>
            lista
          </Badge>
        ) : document ? (
          <Badge tone="muted">borrada</Badge>
        ) : (
          <Badge tone="warning">falta</Badge>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1 text-label-sm normal-case text-error">
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" /> {error}
        </p>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

export function RomanaDocuments({
  arrival,
  onSaved,
}: {
  arrival: RomanaArrivalSummary;
  onSaved: (detail: RomanaArrivalDetail) => void;
}) {
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const editable = arrival.romana.canUploadDocs;

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <p className="text-label-sm normal-case text-on-surface-variant">
          Una cédula y un carnet por cada pedido. Se comprimen al subir y se borran al validar.
        </p>
        <div className="flex items-center gap-space-xs">
          <Badge tone={arrival.romana.pendingDocs > 0 ? 'warning' : 'success'} dot>
            {arrival.romana.requiredDocs === 0
              ? 'sin documentos exigidos'
              : `${arrival.romana.uploadedDocs}/${arrival.romana.requiredDocs} fotos`}
          </Badge>
          <span className="text-label-sm normal-case text-outline">{formatBytes(arrival.romana.totalBytes)}</span>
        </div>
      </div>

      {arrival.romana.orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/50 px-space-sm py-space-md text-center text-body-md text-on-surface-variant">
          Esta llegada no tiene pedidos; no se pueden pedir documentos.
        </div>
      ) : (
        <div className="grid gap-space-md md:grid-cols-2 xl:grid-cols-3">
          {arrival.romana.orders.map((order) => (
            <div
              key={order.orderNumber}
              className="flex flex-col gap-space-sm rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-space-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-space-xs">
                <div className="min-w-0">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Pedido</p>
                  <p className="truncate font-bold text-body-md text-primary" title={order.orderNumber}>
                    {order.orderNumber}
                  </p>
                </div>
                <Badge
                  tone={
                    order.complete || arrival.romana.status === 'VALIDADO'
                      ? 'success'
                      : arrival.romana.status === 'EXPIRADO'
                        ? 'muted'
                        : 'warning'
                  }
                  dot
                >
                  {order.complete
                    ? 'completo'
                    : arrival.romana.status === 'VALIDADO'
                      ? 'validado'
                      : arrival.romana.status === 'EXPIRADO'
                        ? 'expirado'
                        : 'incompleto'}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-space-sm">
                {(['CEDULA', 'CARNET'] as RomanaDocKind[]).map((kind) => (
                  <DocSlot
                    key={kind}
                    arrivalId={arrival.id}
                    orderNumber={order.orderNumber}
                    kind={kind}
                    document={order.documents.find((document) => document.kind === kind)}
                    editable={editable}
                    onSaved={onSaved}
                    onPreview={(url, label) => setPreview({ url, label })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!editable && arrival.romana.status === 'VALIDADO' && (
        <p className="flex items-center gap-space-xs rounded-xl bg-success-container/50 px-space-sm py-space-xs text-body-md text-on-success-container">
          <ShieldCheck aria-hidden className="size-4" /> Documentos validados; las fotos ya se borraron.
        </p>
      )}

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={preview.label}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/80 p-space-sm backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-h-[92vh] w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Cerrar"
              className="absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full bg-primary text-white shadow-hero"
            >
              <X aria-hidden className="size-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.label}
              className="max-h-[88vh] w-full rounded-2xl bg-surface-container-lowest object-contain shadow-hero"
            />
            <p className="mt-space-xs text-center text-label-sm font-semibold text-white">{preview.label}</p>
          </div>
        </div>
      )}
    </div>
  );
}

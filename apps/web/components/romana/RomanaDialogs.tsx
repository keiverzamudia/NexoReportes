'use client';

import type { RomanaArrivalDetail, RomanaArrivalSummary } from '@nexo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Scale, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { clockLabel } from '../../lib/arrival';
import { ROMANA_STATUS_META, formatBytes } from '../../lib/romana';
import { Badge } from '../ui';
import { Sheet } from '../ArrivalDialogs';
import { RomanaDocuments } from './RomanaDocuments';

// ============================================================
// Diálogos de Romana: marcar la llegada (con las fotos ya subidas) y
// validar los documentos (borra las fotos del volumen).
// ============================================================

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-space-sm flex items-start gap-space-xs text-body-md text-error">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
    </p>
  );
}

export function RomanaCheckInDialog({
  open,
  arrival,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: RomanaArrivalSummary | null;
  onClose: () => void;
  onSaved: (detail: RomanaArrivalDetail) => void;
}) {
  const [detail, setDetail] = useState<RomanaArrivalSummary | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const arrivalId = arrival?.id;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setDetail(arrival);
    setNote('');
    setBusy(false);
    setError(null);
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
    // Se reinicia al abrir o al cambiar de llegada, no en cada refresco de la
    // bandeja: si no, el refetch de 20/30 s borraría la nota que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, arrivalId]);

  async function submit() {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${detail.id}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar la llegada en Romana');
    } finally {
      setBusy(false);
    }
  }

  const time = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const ready = Boolean(detail?.romana.canCheckIn);

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="Báscula · Romana"
      title={`Llegada de ${arrival?.customerName ?? 'el cliente'}`}
      description="Sube la cédula del chofer y el carnet de circulación de cada pedido. Sin las dos fotos no se puede marcar la llegada."
      icon={Scale}
      tone="bg-secondary-container text-on-secondary"
      footer={
        <>
          <span className="hidden text-label-sm normal-case text-on-surface-variant sm:block">
            {detail
              ? detail.romana.requiredDocs === 0
                ? 'Sin documentos exigidos'
                : `${detail.romana.uploadedDocs}/${detail.romana.requiredDocs} fotos`
              : ''}
          </span>
          <div className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready || busy}
              className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Scale aria-hidden className="size-4" />}
              Marcar llegada
            </button>
          </div>
        </>
      }
    >
      <div className="rounded-2xl bg-hero px-space-md py-space-sm text-center text-white shadow-hero">
        <p className="text-label-sm font-bold uppercase tracking-[0.14em] text-white/70">Hora del servidor</p>
        <p className="tabular-nums text-headline-xl font-black tracking-tight text-secondary-container">{time}</p>
        <p className="text-label-sm normal-case text-white/70">
          {arrival?.number} · {arrival?.sheetNumber} · {arrival?.orderNumbers.length ?? 0} pedido(s)
        </p>
      </div>

      <div className="mt-space-md flex flex-wrap items-center justify-between gap-space-sm">
        <Badge tone={ready ? 'success' : 'warning'} dot>
          {ready ? 'Listo para marcar' : `${detail?.romana.pendingDocs ?? 0} foto(s) pendiente(s)`}
        </Badge>
        <span className="text-label-sm normal-case text-outline">
          {detail ? formatBytes(detail.romana.totalBytes) : ''}
        </span>
      </div>

      <div className="mt-space-md">
        {detail && (
          <RomanaDocuments
            arrival={detail}
            onSaved={(next) => {
              setDetail(next);
              void queryClient.invalidateQueries({ queryKey: ['pcp-arrivals'] });
              void queryClient.invalidateQueries({ queryKey: ['pcp-arrival', next.id] });
            }}
          />
        )}
      </div>

      <label className="mt-space-md flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={240}
          rows={2}
          placeholder="Ej. el chofer trae los documentos del camión 12"
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

export function RomanaValidateDialog({
  open,
  arrival,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: RomanaArrivalSummary | null;
  onClose: () => void;
  onSaved: (detail: RomanaArrivalDetail) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setBusy(false);
    setError(null);
  }, [open]);

  async function submit() {
    if (!arrival || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<RomanaArrivalDetail>(`/romana/arrivals/${arrival.id}/validate`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      onSaved(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron validar los documentos');
    } finally {
      setBusy(false);
    }
  }

  const status = arrival ? ROMANA_STATUS_META[arrival.romana.status] : null;
  const liveDocuments =
    arrival?.romana.orders.flatMap((order) => order.documents).filter((document) => document.url) ?? [];
  const liveBytes = liveDocuments.reduce((sum, document) => sum + document.bytes, 0);

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="Báscula · Validación"
      title="Validar documentos y borrar fotos"
      description="Revisa que la cédula y el carnet se lean. Al validar, las fotos se eliminan del servidor de forma permanente."
      icon={ShieldCheck}
      tone="bg-success-container text-on-success-container"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !arrival?.romana.canValidate}
            className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ShieldCheck aria-hidden className="size-4" />}
            Validar y borrar
          </button>
        </>
      }
    >
      <div className="rounded-2xl border border-warning/40 bg-warning-container/40 px-space-md py-space-sm">
        <p className="flex items-start gap-space-sm text-body-md text-on-warning-container">
          <Trash2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Se eliminarán <strong>{liveDocuments.length} foto(s)</strong> ({formatBytes(liveBytes)}) y solo quedarán los
            metadatos del registro. Esta acción no se puede deshacer.
          </span>
        </p>
      </div>

      <dl className="mt-space-md grid grid-cols-2 gap-space-sm text-body-md">
        <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
          <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Cliente</dt>
          <dd className="truncate text-on-surface">{arrival?.customerName ?? '—'}</dd>
        </div>
        <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
          <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Llegada Romana</dt>
          <dd className="text-on-surface">{clockLabel(arrival?.romana.arrivedAt)}</dd>
        </div>
        <div className="col-span-2 rounded-xl bg-surface-container-low/70 p-space-sm">
          <dt className="text-label-sm font-semibold uppercase tracking-wider text-outline">Estado</dt>
          <dd className="text-on-surface">{status?.label ?? '—'}</dd>
        </div>
      </dl>

      <label className="mt-space-md flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={240}
          rows={2}
          placeholder="Ej. documentos legibles y coinciden con el vehículo"
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

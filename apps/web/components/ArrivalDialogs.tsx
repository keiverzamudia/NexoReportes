'use client';

// ============================================================
// Diálogos de la vista de llegadas (PCP).
//
//   · CheckInDialog   → confirma la llegada con reloj en vivo (hora del
//                       servidor; se muestra la hora local para el operador).
//   · IncidentDialog  → tipo + severidad + descripción.
//   · EditArrivalDialog → corrección del jefe de PCP: exige motivo y el
//                       servidor deja el antes → después en la bitácora.
//
// Todos comparten la misma hoja (cabecera con icono, cuerpo con scroll y
// pie fijo) para que en el teléfono la acción quede siempre a la vista.
// ============================================================

import type {
  ArrivalDetail,
  ArrivalIncidentKind,
  ArrivalIncidentSeverity,
  ArrivalStatus,
  ArrivalSummary,
} from '@nexo/contracts';
import { AlertTriangle, CheckCheck, DoorOpen, Loader2, PencilLine, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ARRIVAL_STATUS_META, INCIDENT_KIND_META } from '../lib/arrival';
import { Badge, Select, cx } from './ui';

// ---------- Hoja base ----------

function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  description,
  icon,
  tone = 'bg-primary-container text-secondary-container',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow: string;
  description: string;
  icon: typeof DoorOpen;
  tone?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const Icon = icon;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arrival-dialog-title"
        className="animate-rise relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />
        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl shadow-soft', tone)}>
              <Icon aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">{eyebrow}</p>
              <h2 id="arrival-dialog-title" className="text-headline-md text-primary">
                {title}
              </h2>
              <p className="text-body-md text-on-surface-variant">{description}</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-space-md">{children}</div>
        <footer className="flex shrink-0 items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
          {footer}
        </footer>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-space-sm flex items-start gap-space-xs text-body-md text-error">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
    </p>
  );
}

// ---------- Marcar llegada ----------

export function CheckInDialog({
  open,
  arrival,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: ArrivalSummary | null;
  onClose: () => void;
  onSaved: (detail: ArrivalDetail) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!open) return;
    setNote('');
    setBusy(false);
    setError(null);
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  async function submit() {
    if (!arrival || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<ArrivalDetail>(`/arrivals/${arrival.id}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      onSaved(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar la llegada');
    } finally {
      setBusy(false);
    }
  }

  const time = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="Portería · PCP"
      title={`¿Llegó ${arrival?.customerName ?? 'el cliente'}?`}
      description="Se registrará la hora del servidor y quién la marcó. Después solo el jefe de PCP puede corregirla."
      icon={DoorOpen}
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
            disabled={busy}
            className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <DoorOpen aria-hidden className="size-4" />}
            Confirmar llegada
          </button>
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

      <label className="mt-space-md flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={240}
          rows={2}
          placeholder="Ej. entró por la puerta 2 con el camión 12"
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

// ---------- Registrar incidencia ----------

const KIND_ORDER: ArrivalIncidentKind[] = ['FALTANTE', 'DEMORA', 'DANO', 'DOCUMENTO', 'RECHAZO', 'OTRO'];
const SEVERITIES: ArrivalIncidentSeverity[] = ['BAJA', 'MEDIA', 'ALTA'];

export function IncidentDialog({
  open,
  arrival,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: ArrivalSummary | null;
  onClose: () => void;
  onSaved: (detail: ArrivalDetail) => void;
}) {
  const [kind, setKind] = useState<ArrivalIncidentKind>('FALTANTE');
  const [severity, setSeverity] = useState<ArrivalIncidentSeverity>('MEDIA');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind('FALTANTE');
    setSeverity('MEDIA');
    setBody('');
    setBusy(false);
    setError(null);
  }, [open]);

  async function submit() {
    if (!arrival || busy) return;
    if (body.trim().length < 3) {
      setError('Describe la incidencia (mínimo 3 caracteres).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<ArrivalDetail>(`/arrivals/${arrival.id}/incidents`, {
        method: 'POST',
        body: JSON.stringify({ kind, severity, body: body.trim() }),
      });
      onSaved(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la incidencia');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="PCP · Novedad"
      title="Registrar incidencia"
      description={`${arrival?.customerName ?? 'Cliente'} · ${arrival?.sheetNumber ?? ''}. Queda en la bitácora y avisa al despacho.`}
      icon={AlertTriangle}
      tone="bg-warning-container text-on-warning-container"
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
            disabled={busy}
            className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <AlertTriangle aria-hidden className="size-4" />}
            Registrar incidencia
          </button>
        </>
      }
    >
      <p className="mb-space-xs font-semibold uppercase tracking-wider text-label-md text-outline">Tipo</p>
      <div className="grid grid-cols-2 gap-space-xs sm:grid-cols-3">
        {KIND_ORDER.map((option) => {
          const meta = INCIDENT_KIND_META[option];
          const active = kind === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={active}
              title={meta.hint}
              className={cx(
                'rounded-xl border px-space-sm py-2 text-left transition-colors',
                active
                  ? 'border-primary-container/50 bg-primary-fixed/50 shadow-soft'
                  : 'border-outline-variant/35 bg-surface-container-lowest hover:bg-surface-container-low',
              )}
            >
              <span className="block font-semibold text-body-md text-on-surface">{meta.label}</span>
              <span className="block text-label-sm normal-case text-on-surface-variant">{meta.hint}</span>
            </button>
          );
        })}
      </div>

      <p className="mb-space-xs mt-space-md font-semibold uppercase tracking-wider text-label-md text-outline">Severidad</p>
      <div className="flex flex-wrap items-center gap-space-xs">
        {SEVERITIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSeverity(option)}
            aria-pressed={severity === option}
            className={cx(
              'h-8 rounded-pill border px-space-md font-semibold text-label-md uppercase tracking-wider transition-colors',
              severity === option
                ? 'border-transparent bg-primary-container text-on-primary shadow-soft'
                : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <label className="mt-space-md flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Descripción</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Qué pasó, qué falta y qué se acordó con el cliente"
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

// ---------- Cerrar la atención ----------

export function CloseArrivalDialog({
  open,
  arrival,
  mode,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: ArrivalSummary | null;
  mode: 'ATENDIDO' | 'AUSENTE';
  onClose: () => void;
  onSaved: (detail: ArrivalDetail) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setBusy(false);
    setError(null);
  }, [open, mode]);

  async function submit() {
    if (!arrival || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await apiFetch<ArrivalDetail>(`/arrivals/${arrival.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ status: mode, note: note.trim() || undefined }),
      });
      onSaved(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la llegada');
    } finally {
      setBusy(false);
    }
  }

  const isAttended = mode === 'ATENDIDO';

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="PCP · Cierre"
      title={isAttended ? 'Cerrar como atendido' : 'Marcar como no presentado'}
      description={
        isAttended
          ? 'El cliente cargó y se fue. El registro queda cerrado en la bitácora.'
          : 'El cliente no vino. Queda registrado con la hora y, si quieres, el motivo.'
      }
      icon={isAttended ? DoorOpen : AlertTriangle}
      tone={isAttended ? 'bg-success-container text-on-success-container' : 'bg-critical-container text-on-critical-container'}
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
            disabled={busy}
            className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : isAttended ? <CheckCheck aria-hidden className="size-4" /> : <AlertTriangle aria-hidden className="size-4" />}
            {isAttended ? 'Confirmar atención' : 'Confirmar ausencia'}
          </button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota (opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder={isAttended ? 'Ej. cargó completo y firmó la guía' : 'Ej. llamó y no alcanzó a venir; se reprograma'}
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

// ---------- Corregir un registro (jefe de PCP / ADMIN) ----------

const EDIT_STATUSES: ArrivalStatus[] = ['ESPERADO', 'EN_PLANTA', 'ATENDIDO', 'AUSENTE', 'CON_INCIDENCIA'];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EditArrivalDialog({
  open,
  arrival,
  onClose,
  onSaved,
}: {
  open: boolean;
  arrival: ArrivalSummary | null;
  onClose: () => void;
  onSaved: (detail: ArrivalDetail) => void;
}) {
  const [arrived, setArrived] = useState('');
  const [status, setStatus] = useState<ArrivalStatus>('ESPERADO');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !arrival) return;
    setArrived(toLocalInput(arrival.arrivedAt));
    setStatus(arrival.status);
    setNote(arrival.note ?? '');
    setReason('');
    setBusy(false);
    setError(null);
  }, [open, arrival]);

  async function submit() {
    if (!arrival || busy) return;
    if (reason.trim().length < 3) {
      setError('Escribe el motivo de la corrección: queda en la bitácora.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextArrived = arrived ? new Date(arrived).toISOString() : null;
      const originalArrived = arrival.arrivedAt;
      const detail = await apiFetch<ArrivalDetail>(`/arrivals/${arrival.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          arrivedAt: nextArrived === originalArrived ? undefined : nextArrived,
          status: status === arrival.status ? undefined : status,
          note: note.trim() === (arrival.note ?? '') ? undefined : note.trim() || null,
          reason: reason.trim(),
        }),
      });
      onSaved(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo corregir el registro');
    } finally {
      setBusy(false);
    }
  }

  const arrivedPreview = arrived
    ? new Date(arrived).toLocaleString('es-VE', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : 'sin hora';

  return (
    <Sheet
      open={open && Boolean(arrival)}
      onClose={onClose}
      eyebrow="PCP · Corrección"
      title="Corregir registro"
      description={`${arrival?.customerName ?? ''} · ${arrival?.number ?? ''}. Todo cambio queda firmado con tu nombre y el motivo.`}
      icon={PencilLine}
      tone="bg-secondary-container text-on-secondary"
      footer={
        <>
          <span className="hidden text-label-sm normal-case text-on-surface-variant sm:block">Hora: {arrivedPreview}</span>
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
              disabled={busy}
              className="flex h-10 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-50"
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <PencilLine aria-hidden className="size-4" />}
              Guardar corrección
            </button>
          </div>
        </>
      }
    >
      <div className="grid gap-space-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Hora de llegada</span>
          <input
            type="datetime-local"
            value={arrived}
            onChange={(event) => setArrived(event.target.value)}
            className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
          />
          <button
            type="button"
            onClick={() => setArrived('')}
            className="self-start text-label-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            Quitar hora (vuelve a «sin marcar»)
          </button>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Estado</span>
          <Select
            value={status}
            onChange={(value) => setStatus(value as ArrivalStatus)}
            ariaLabel="Estado de la llegada"
            options={EDIT_STATUSES.map((option) => ({ value: option, label: ARRIVAL_STATUS_META[option].label }))}
          />
        </label>
      </div>

      <label className="mt-space-sm flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota del registro</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>

      <label className="mt-space-sm flex flex-col gap-1">
        <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-label-sm text-outline">
          Motivo de la corrección
          <Badge tone="danger">obligatorio</Badge>
        </span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={240}
          placeholder="Ej. el cliente marcó a las 13:05, no a las 13:25"
          className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
        />
      </label>
      <ErrorLine error={error} />
    </Sheet>
  );
}

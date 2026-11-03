'use client';

// ============================================================
// Modal de motivo de una diferencia del despacho.
//
// La cantidad se digita en la fila (input «Cargado»). Cuando baja del plan o
// queda en cero, este modal captura el porqué antes de guardar. Es el mismo
// para parcial y para no cargado: solo cambia el texto del encabezado.
// El motivo se guarda en la nota del renglón (reemplaza la nota anterior).
// ============================================================

import type { DispatchSheetLine } from '@nexo/contracts';
import { AlertTriangle, Loader2, PackageX, Split, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../lib/dispatch-sheet';
import { cx } from './ui';

interface DispatchLineDialogProps {
  line: DispatchSheetLine;
  status: 'PARCIAL' | 'FALTANTE';
  loadedQty: number;
  initialNote: string;
  saving: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}

const REASONS = [
  'No alcanzó el stock',
  'Producto dañado',
  'Cliente no lo recibió',
  'Falta de transporte',
] as const;

export function DispatchLineDialog({
  line,
  status,
  loadedQty,
  initialNote,
  saving,
  onClose,
  onSave,
}: DispatchLineDialogProps) {
  const [note, setNote] = useState(initialNote);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const unit = line.uom ?? '';
  const unitLabel = line.uom === 'SAC' ? 'sacos' : line.uom === 'KG' ? 'kg' : 'unidades';
  const remainingQty = Math.max(0, Math.round((line.plannedQty - loadedQty) * 100) / 100);
  const loadedKg = line.plannedQty > 0 ? (loadedQty * line.plannedKg) / line.plannedQty : loadedQty;
  const remainingKg = line.plannedQty > 0 ? (remainingQty * line.plannedKg) / line.plannedQty : remainingQty;
  const fmtQty = (value: number) => formatNumber(value, Number.isInteger(value) ? 0 : 2);
  const noteOk = note.trim().length >= 3;
  const partial = status === 'PARCIAL';
  // La nota anterior solo es del planificador si el renglón aún no tenía
  // una diferencia; en ese caso se muestra como referencia, no se reutiliza.
  const plannerNote =
    line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD' ? null : line.note;

  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!noteOk || saving) return;
    onSave(note.trim());
  }

  return (
    <div
      role="presentation"
      className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-space-md backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-line-title"
        onSubmit={submit}
        className="animate-rise flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div className="flex items-start justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 p-space-md">
          <div className="min-w-0">
            <p className="font-semibold uppercase tracking-wider text-label-md text-primary">
              Pedido {line.orderNumber} · turno {line.position}
            </p>
            <h2 id="dispatch-line-title" className="truncate text-body-lg font-bold text-on-surface" title={line.description ?? ''}>
              {line.productCode} · {line.description ?? '—'}
            </h2>
            <p className="text-label-md tabular-nums text-on-surface-variant">
              Plan: {formatNumber(line.plannedQty)} {unit} · {formatNumber(line.plannedKg)} kg
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
          <div
            className={cx(
              'flex items-start gap-space-sm rounded-xl px-space-sm py-2',
              partial ? 'bg-warning-container/30 text-on-warning-container' : 'bg-critical-container/30 text-on-critical-container',
            )}
          >
            {partial ? (
              <Split aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <PackageX aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-bold">
                {partial ? 'Carga parcial' : 'No cargado'}: {fmtQty(loadedQty)} de{' '}
                {fmtQty(line.plannedQty)} {unitLabel}
              </p>
              <p className="text-label-md tabular-nums">
                {partial
                  ? `Quedan ${fmtQty(remainingQty)} ${unitLabel} · ${formatNumber(remainingKg)} kg sin cargar.`
                  : 'No sale nada de este renglón. El motivo queda en el reporte.'}
              </p>
              <p className="text-label-sm tabular-nums">
                Se cargan {formatNumber(loadedKg)} kg de {formatNumber(line.plannedKg)} kg planificados.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-space-xs">
            {REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setNote(reason)}
                className={cx(
                  'rounded-pill border px-space-sm py-1 text-label-sm font-semibold transition-colors',
                  note.trim() === reason
                    ? 'border-secondary-container bg-secondary-container text-on-secondary'
                    : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
                )}
              >
                {reason}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
              Motivo (obligatorio)
            </span>
            <textarea
              ref={noteRef}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={240}
              placeholder="Ej. El proveedor no despachó el lote completo…"
              className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
            />
          </label>

          {plannerNote && (
            <p className="flex items-start gap-space-xs rounded-lg bg-surface-container-low px-space-sm py-1 text-label-md normal-case text-on-surface-variant">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>Nota del planificador: {plannerNote}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!noteOk || saving}
            className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : partial ? (
              <Split aria-hidden className="size-4" />
            ) : (
              <PackageX aria-hidden className="size-4" />
            )}
            Guardar motivo
          </button>
        </div>
      </form>
    </div>
  );
}

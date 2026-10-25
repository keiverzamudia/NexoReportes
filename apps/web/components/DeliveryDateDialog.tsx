'use client';

// ============================================================
// Modal de fecha tentativa para uno o varios renglones.
//
// Se abre encima del plan (no navega). Aplica la misma fecha a todos
// los ítems o restaura la original de Profit. La fecha original nunca
// se modifica; la capa tentativa vive sólo en Nexo.
// ============================================================

import type { DeliveryDateApplyResponse, DeliveryDateItem } from '@nexo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { DateInput, TextInput, fmtDate } from './ui';

export interface DeliveryDateTargetItem extends DeliveryDateItem {
  description?: string | null;
  requestedDate: string | null;
  tentativeDate: string | null;
}

export interface DeliveryDateTarget {
  kind: 'cliente' | 'seleccion' | 'renglon';
  title: string;
  customerName: string;
  customerCode: string | null;
  items: DeliveryDateTargetItem[];
}

function uniqueIso(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function inputDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function DeliveryDateDialog({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: DeliveryDateTarget | null;
  onClose: () => void;
  onSaved: (result: DeliveryDateApplyResponse, mode: 'set' | 'restore') => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = target?.items ?? [];
  const originals = uniqueIso(items.map((item) => item.requestedDate));
  const tentatives = uniqueIso(items.map((item) => item.tentativeDate));
  const hasTentative = tentatives.length > 0;
  const originalLabel =
    originals.length === 0
      ? '—'
      : originals.length === 1
        ? fmtDate(originals[0]!)
        : `${fmtDate(originals[0]!)} – ${fmtDate(originals[originals.length - 1]!)}`;

  // Al abrir: si todos comparten la misma tentativa, se precarga.
  useEffect(() => {
    if (!open || !target) return;
    setDate(tentatives.length === 1 ? inputDate(tentatives[0]!) : '');
    setNote('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: ({ mode, value }: { mode: 'set' | 'restore'; value?: string }) => {
      const payload: Record<string, unknown> = {
        items: items.map(({ orderNumber, productCode }) => ({ orderNumber, productCode })),
      };
      if (note.trim()) payload.note = note.trim();
      if (mode === 'set' && value) payload.date = value;
      return apiFetch<DeliveryDateApplyResponse>('/orders/delivery-date', {
        method: mode === 'set' ? 'PUT' : 'DELETE',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['orders-grouped'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
      onSaved(result, variables.mode);
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la fecha.');
    },
  });

  if (!open || !target) return null;

  const pending = mutation.isPending;
  const apply = () => {
    if (!date) return;
    setError(null);
    mutation.mutate({ mode: 'set', value: date });
  };
  const restore = () => {
    setError(null);
    mutation.mutate({ mode: 'restore' });
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-date-title"
        className="flex min-w-0 max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-lift sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <CalendarRange aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Fecha tentativa</p>
              <h2 id="delivery-date-title" className="truncate text-title-md text-primary">
                {target.title}
              </h2>
              <p className="text-label-md text-on-surface-variant">
                {target.customerName}
                {target.customerCode ? ` · ${target.customerCode}` : ''} · {items.length} renglón(es)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:opacity-40"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          <div className="flex flex-col gap-space-md">
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-space-sm">
              <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Fecha original de Profit</p>
              <p className="mt-space-2xs text-title-md font-bold tabular-nums text-primary">{originalLabel}</p>
              <p className="mt-space-2xs text-label-sm text-on-surface-variant">
                No se modifica. La fecha tentativa sólo vive en Corpoagro.
              </p>
            </div>

            <label className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nueva fecha</span>
              <DateInput ariaLabel="Nueva fecha de entrega" value={date} onChange={setDate} className="w-full" autoFocus />
              {tentatives.length > 1 && (
                <span className="text-label-sm text-on-surface-variant">
                  Los renglones tienen fechas distintas; se aplicará esta a todos.
                </span>
              )}
            </label>

            <label className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Motivo (opcional)</span>
              <TextInput
                value={note}
                onChange={setNote}
                placeholder="Ej. el cliente pidió mover la entrega"
                ariaLabel="Motivo del cambio de fecha"
                maxLength={240}
              />
            </label>

            <div>
              <div className="flex items-center justify-between gap-space-sm">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Renglones</span>
                <span className="text-label-sm tabular-nums text-on-surface-variant">{items.length}</span>
              </div>
              <ul className="mt-space-xs max-h-44 divide-y divide-outline-variant/20 overflow-y-auto rounded-xl border border-outline-variant/30">
                {items.map((item) => (
                  <li
                    key={`${item.orderNumber}#${item.productCode}`}
                    className="flex items-center gap-space-sm px-space-sm py-2"
                  >
                    <span className="w-12 shrink-0 text-label-sm tabular-nums text-outline">{item.orderNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label-md font-semibold text-primary">{item.productCode}</span>
                      <span className="block truncate text-label-sm text-on-surface-variant">
                        {item.description ?? '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-outline">Original</span>
                      <span className="block text-label-sm tabular-nums text-on-surface-variant">
                        {fmtDate(item.requestedDate)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {hasTentative && (
              <p className="rounded-xl border border-secondary/25 bg-secondary-container/10 p-space-sm text-label-sm text-on-surface-variant">
                <strong className="text-secondary">Restaurar original</strong> quita la fecha tentativa de los renglones
                seleccionados. Los que no tengan tentativa quedan igual.
              </p>
            )}

            {error && (
              <p role="alert" className="flex items-start gap-space-xs rounded-xl bg-error-container/60 p-space-sm text-label-md text-error">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <div>
            {hasTentative && (
              <button
                type="button"
                onClick={restore}
                disabled={pending}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:opacity-40"
              >
                <RotateCcw aria-hidden className="size-4" /> Restaurar original
              </button>
            )}
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 rounded-pill px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={pending || !date}
              className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              {pending ? 'Guardando…' : 'Aplicar fecha'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

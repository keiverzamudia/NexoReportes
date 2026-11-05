'use client';

// ============================================================
// Factura entregada: hito de cierre del reloj de facturación.
//
// Se puede registrar por cliente o para todos los pendientes del despacho.
// El número de factura es opcional; la hora la sella el servidor.
// ============================================================

import type { DispatchInvoiceInput } from '@nexo/contracts';
import { Loader2, Receipt, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DispatchInvoiceDialogProps {
  open: boolean;
  mode: 'customer' | 'all';
  customerName?: string;
  pendingCount?: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: DispatchInvoiceInput) => void;
}

export function DispatchInvoiceDialog({
  open,
  mode,
  customerName,
  pendingCount = 0,
  busy,
  onClose,
  onConfirm,
}: DispatchInvoiceDialogProps) {
  const [invoiceRef, setInvoiceRef] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setInvoiceRef('');
    setNote('');
  }, [open, mode, customerName]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-primary/40 p-space-md backdrop-blur-sm sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-invoice-title"
        className="animate-rise w-full max-w-md overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div className="flex items-start justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 p-space-md">
          <div className="flex items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-fixed text-primary">
              <Receipt aria-hidden className="size-5" />
            </span>
            <div>
              <h2 id="dispatch-invoice-title" className="text-headline-md text-primary">
                Factura entregada
              </h2>
              <p className="text-body-md text-on-surface-variant">
                {mode === 'all'
                  ? `Se marcarán ${pendingCount} cliente(s) pendientes.`
                  : `Cliente: ${customerName ?? '—'}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-space-md p-space-md">
          <p className="rounded-xl bg-secondary-container/20 px-space-sm py-2 text-label-md text-on-surface-variant">
            Al confirmar se detiene el reloj de facturación y queda registrado quién lo hizo. La carga ya debe estar
            cerrada.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
              Número de factura (opcional)
            </span>
            <input
              value={invoiceRef}
              onChange={(event) => setInvoiceRef(event.target.value)}
              maxLength={60}
              placeholder="Ej. 000123"
              className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nota (opcional)</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={240}
              placeholder="Ej. Factura entregada en portería…"
              className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
          >
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                ...(invoiceRef.trim() ? { invoiceRef: invoiceRef.trim() } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
            className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Receipt aria-hidden className="size-4" />}
            Confirmar entrega
          </button>
        </div>
      </div>
    </div>
  );
}

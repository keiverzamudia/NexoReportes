'use client';

// ============================================================
// Vista del documento real de una nota de entrega de Profit.
//
// Se abre desde el panel de cierres y desde la ficha del pedido. Muestra el
// documento (cliente, renglones, origen y totales) y permite abrirlo o
// descargarlo en PDF. Los datos vienen de la API; no se escribe en Profit.
// ============================================================

import type { DeliveryNoteDocument, DeliveryNotesResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileText, Loader2, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, currentUser } from '../lib/api';
import { openDeliveryNotePdf, saveDeliveryNotePdf } from '../lib/delivery-note-pdf';
import { Badge, Skeleton, fmtDate } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—';
  const amount = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  if (currency === 'USD') return `US$ ${amount}`;
  if (currency === 'VES') return `Bs ${amount}`;
  return `${currency} ${amount}`;
}

function qty(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function statusLabel(note: DeliveryNoteDocument): string {
  if (note.annulled) return 'Anulada';
  if (note.status === '2') return 'Procesada';
  if (note.status === '1') return 'Emitida';
  return note.status ?? 'Sin estado';
}

export interface DeliveryNoteDialogProps {
  open: boolean;
  orderId: string | null;
  orderNumber: string;
  onClose: () => void;
}

export function DeliveryNoteDialog({ open, orderId, orderNumber, onClose }: DeliveryNoteDialogProps) {
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<'open' | 'save' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const { data: session } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const { data, isLoading, error } = useQuery<DeliveryNotesResponse>({
    queryKey: ['delivery-notes', orderId],
    queryFn: () => apiFetch<DeliveryNotesResponse>(`/orders/${orderId}/delivery-notes`),
    enabled: open && Boolean(orderId),
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setActive(0);
    setActionError(null);
    setActionNote(null);
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
  }, [open, orderId, onClose]);

  if (!open) return null;

  const notes = data?.notes ?? [];
  const note = notes[Math.min(active, Math.max(notes.length - 1, 0))] ?? null;
  const printedBy = session?.displayName ?? session?.profitCode ?? null;

  async function openPdf() {
    if (!note || busy) return;
    setBusy('open');
    setActionError(null);
    setActionNote(null);
    try {
      const result = await openDeliveryNotePdf(note, { printedBy });
      if (result === 'downloaded') {
        setActionNote('El navegador bloqueó la ventana: el PDF se descargó y puedes abrirlo desde tu lector.');
      }
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo generar el PDF de la nota de entrega.'));
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (!note || busy) return;
    setBusy('save');
    setActionError(null);
    setActionNote(null);
    try {
      await saveDeliveryNotePdf(note, { printedBy });
      setActionNote('PDF descargado.');
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo descargar el PDF de la nota de entrega.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center bg-primary/50 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-note-title"
        className="animate-rise flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
              Documento de Profit
            </p>
            <h2 id="delivery-note-title" className="text-headline-md text-primary">
              Nota de entrega
            </h2>
            <p className="text-body-md text-on-surface-variant">
              Pedido {orderNumber}
              {data?.notes.length ? ` · ${data.notes.length} nota${data.notes.length > 1 ? 's' : ''} vinculada${data.notes.length > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar nota de entrega"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-surface-container-low/40 p-space-md sm:p-space-lg">
          {isLoading && (
            <div className="flex flex-col gap-space-sm">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          )}

          {error && !isLoading && (
            <p role="alert" className="flex items-center gap-space-sm rounded-xl bg-error/10 px-space-sm py-space-xs text-body-md text-error">
              <AlertTriangle aria-hidden className="size-4" />
              {messageOf(error, 'No se pudo cargar la nota de entrega')}
            </p>
          )}

          {!isLoading && !error && !data?.available && (
            <p className="flex items-center gap-space-sm rounded-xl bg-warning/10 px-space-sm py-space-xs text-body-md text-warning">
              <AlertTriangle aria-hidden className="size-4" />
              No se pudo leer la nota en Profit. Intenta de nuevo en unos minutos.
            </p>
          )}

          {!isLoading && !error && data?.available && notes.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-lowest p-space-lg text-center">
              <FileText aria-hidden className="mx-auto size-8 text-outline" />
              <p className="mt-space-sm font-semibold text-primary">No hay una nota vinculada</p>
              <p className="text-body-md text-on-surface-variant">
                Profit no reporta una nota de entrega para el pedido {orderNumber}.
              </p>
            </div>
          )}

          {!isLoading && !error && note && (
            <>
              {notes.length > 1 && (
                <div className="mb-space-sm flex flex-wrap gap-space-xs">
                  {notes.map((item, index) => (
                    <button
                      key={item.number}
                      type="button"
                      onClick={() => setActive(index)}
                      className={`rounded-pill border px-space-sm py-1 text-label-md font-semibold transition-colors ${
                        index === active
                          ? 'border-primary-container bg-primary-container text-on-primary'
                          : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      Nota {item.number}
                    </button>
                  ))}
                </div>
              )}

              <article className="mx-auto w-full max-w-[820px] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-soft">
                <div className="flex items-start justify-between gap-space-md border-b border-slate-200 px-space-md py-space-sm">
                  <div className="flex items-center gap-space-sm">
                    <img src="/brand/corpoagro-logo.png" alt="Corpoagro" className="h-9 w-auto" />
                    <div>
                      <p className="text-label-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Corpoagro
                      </p>
                      <p className="text-label-sm text-slate-500">Corporación Agropecuaria Venezolana, C.A.</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Nota de entrega
                    </p>
                    <p className="text-headline-sm font-bold tabular-nums text-slate-900">Nº {note.number}</p>
                    <p className="text-label-md text-slate-500">{fmtDate(note.date)}</p>
                    <div className="mt-1 flex justify-end">
                      <Badge tone={note.annulled ? 'danger' : 'success'} dot>
                        {statusLabel(note)}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid gap-space-sm border-b border-slate-200 bg-slate-50 px-space-md py-space-sm sm:grid-cols-[1.4fr_1fr]">
                  <div>
                    <p className="text-label-sm font-semibold uppercase tracking-wider text-slate-500">Cliente</p>
                    <p className="text-title-sm font-semibold text-slate-900">{note.customerName}</p>
                    <p className="text-label-md text-slate-600">
                      Código {note.customerCode || '—'}
                      {note.customerRif ? ` · RIF ${note.customerRif}` : ''}
                    </p>
                    {note.customerAddress && (
                      <p className="mt-1 max-w-[36rem] text-label-md leading-snug text-slate-600">
                        {note.customerAddress}
                      </p>
                    )}
                    {note.customerPhone && (
                      <p className="text-label-md text-slate-600">Tel. {note.customerPhone}</p>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-space-sm gap-y-1 text-label-md">
                    <dt className="text-slate-500">Vendedor</dt>
                    <dd className="text-right font-medium text-slate-900">{note.vendor ?? '—'}</dd>
                    <dt className="text-slate-500">Condición</dt>
                    <dd className="text-right text-slate-900">{note.paymentTerms ?? '—'}</dd>
                    <dt className="text-slate-500">Vence</dt>
                    <dd className="text-right text-slate-900">{fmtDate(note.dueDate)}</dd>
                    <dt className="text-slate-500">Moneda</dt>
                    <dd className="text-right text-slate-900">
                      {note.currency === 'USD' ? 'US$' : note.currency === 'VES' ? 'Bs' : note.currency}
                    </dd>
                    <dt className="text-slate-500">Tasa</dt>
                    <dd className="text-right tabular-nums text-slate-900">
                      {note.exchangeRate ? qty(note.exchangeRate, 4) : '—'}
                    </dd>
                    <dt className="text-slate-500">Origen</dt>
                    <dd className="text-right text-slate-900">{note.orders.join(', ') || '—'}</dd>
                  </dl>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-label-md">
                    <thead>
                      <tr className="bg-slate-900 text-left text-white">
                        <th className="px-2 py-1.5 text-right font-semibold">#</th>
                        <th className="px-2 py-1.5 font-semibold">Código</th>
                        <th className="px-2 py-1.5 font-semibold">Descripción</th>
                        <th className="px-2 py-1.5 text-center font-semibold">Alm.</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Cant.</th>
                        <th className="px-2 py-1.5 text-center font-semibold">Unid.</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Precio</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Desc.</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Neto</th>
                        <th className="px-2 py-1.5 text-center font-semibold">Origen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {note.lines.map((line, index) => (
                        <tr key={`${line.line}-${line.productCode}`} className={index % 2 ? 'bg-slate-50' : 'bg-white'}>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{line.line}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-semibold tabular-nums text-slate-900">
                            {line.productCode}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{line.description || '—'}</td>
                          <td className="px-2 py-1.5 text-center text-slate-500">{line.warehouse ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">{qty(line.quantity)}</td>
                          <td className="px-2 py-1.5 text-center text-slate-500">{line.unit ?? '—'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-900">
                            {money(line.price, note.currency)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                            {line.discountPct ? `${qty(line.discountPct)}%` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                            {money(line.net, note.currency)}
                          </td>
                          <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{line.origin ?? '—'}</td>
                        </tr>
                      ))}
                      {note.lines.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-3 py-4 text-center text-slate-500">
                            Profit no reporta renglones para esta nota.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-space-sm border-t border-slate-200 px-space-md py-space-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-[26rem]">
                    {note.comments && (
                      <>
                        <p className="text-label-sm font-semibold uppercase tracking-wider text-slate-500">Observaciones</p>
                        <p className="text-label-md leading-snug text-slate-700">{note.comments}</p>
                      </>
                    )}
                    <p className="mt-2 text-label-sm text-slate-500">
                      Documento generado desde Profit. No es una factura; sirve como constancia de entrega.
                    </p>
                  </div>
                  <dl className="w-full max-w-[16rem] self-end text-label-md">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Subtotal</dt>
                      <dd className="tabular-nums text-slate-900">{money(note.subtotal, note.currency)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Descuento</dt>
                      <dd className="tabular-nums text-slate-900">{money(note.discount, note.currency)}</dd>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <dt className="text-slate-500">IVA</dt>
                      <dd className="tabular-nums text-slate-900">{money(note.tax, note.currency)}</dd>
                    </div>
                    <div className="mt-1 flex justify-between text-title-sm font-bold text-slate-900">
                      <dt>Total</dt>
                      <dd className="tabular-nums">{money(note.total, note.currency)}</dd>
                    </div>
                    {note.totalLocal !== null && (
                      <div className="flex justify-between text-label-sm text-slate-500">
                        <dt>Total en Bs</dt>
                        <dd className="tabular-nums">{qty(note.totalLocal)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </article>
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm sm:px-space-lg">
          <div className="min-w-0 text-label-sm text-on-surface-variant">
            {actionError ? (
              <span role="alert" className="text-error">{actionError}</span>
            ) : actionNote ? (
              <span>{actionNote}</span>
            ) : (
              'El PDF se genera con los datos de la nota en Profit.'
            )}
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={!note || Boolean(busy)}
              className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
              Descargar
            </button>
            <button
              type="button"
              onClick={() => void openPdf()}
              disabled={!note || Boolean(busy)}
              className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              {busy === 'open' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Printer aria-hidden className="size-4" />}
              Abrir / imprimir PDF
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

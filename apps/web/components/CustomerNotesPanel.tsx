'use client';

// ============================================================
// Notas de entrega de un cliente con su factura y la solicitud que las originó.
//
// Se carga solo al abrir la pestaña «Pedidos» de la ficha 360. La consulta
// vive en el backend (`/customers/:code/notes`): la factura se resuelve en
// Profit (`factura` + `reng_fac.num_doc`, tipo_doc = 'E') y el vínculo con el
// pedido está en `reng_nde.tipo_doc` + `num_doc` (y, si hace falta, `reng_ped`).
// Sin factura la nota se muestra como «N/T».
// ============================================================

import type {
  Customer,
  CustomerNote,
  CustomerNoteOrder,
  CustomerNotesResponse,
  CustomerStatementCurrency,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Receipt } from 'lucide-react';
import { Fragment, useState } from 'react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import { formatInsightMoney } from '../lib/customer-insights';
import { Skeleton, Td, Th, fmtDate, fmtQty } from './ui';

type MonthsWindow = '12' | '24' | '36';

function OrderChip({ order }: { order: CustomerNoteOrder }) {
  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-1 rounded-pill border border-primary-container/25 bg-primary-fixed/50 px-2 py-0.5"
      title={`Solicitud ${order.number} de Profit: es el número que ves en la pantalla Pedidos`}
    >
      <span className="text-label-sm font-medium text-on-surface-variant">Solicitud</span>
      <span className="font-bold tabular-nums text-primary">{order.number}</span>
    </span>
  );
}

function NoteTag({ number }: { number: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 text-label-sm text-on-surface-variant"
      title={`Nota de entrega ${number} en Profit`}
    >
      Nota <span className="tabular-nums">{number}</span>
    </span>
  );
}

function NoteItems({ note }: { note: CustomerNote }) {
  if (note.items.length === 0) {
    return (
      <p className="text-label-md normal-case text-on-surface-variant">
        Profit no registra renglones de artículo para esta nota.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="hidden gap-space-sm border-b border-outline-variant/25 pb-1 text-label-sm uppercase text-outline sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <span>Producto</span>
        <span className="text-right">Cantidad</span>
        <span className="text-right">Peso</span>
      </div>
      {note.items.map((item) => (
        <div
          key={item.code}
          className="flex flex-col gap-0.5 border-b border-outline-variant/15 pb-1 last:border-0 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:items-baseline sm:gap-space-sm sm:pb-0"
        >
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-medium text-on-surface">{item.description || item.code}</span>
            <span className="text-label-sm tabular-nums text-outline">{item.code}</span>
          </span>
          <span className="text-label-md tabular-nums text-on-surface-variant sm:text-right">
            {fmtQty(item.qty, item.unit === 'SAC' ? 0 : 2)} {item.unit || 'UN'}
          </span>
          <span className="text-label-md tabular-nums text-on-surface-variant sm:text-right">
            {fmtQty(item.kg, 1)} kg
          </span>
        </div>
      ))}
    </div>
  );
}

export function CustomerNotesPanel({
  customer,
  months,
  currency,
}: {
  customer: Customer;
  months: MonthsWindow;
  currency: CustomerStatementCurrency;
}) {
  // Solo una nota desplegada a la vez: abrir otra cierra la anterior.
  const [openNote, setOpenNote] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<CustomerNotesResponse>({
    queryKey: ['customer-notes', customer.externalCode, months, currency],
    queryFn: () =>
      apiFetch<CustomerNotesResponse>(
        `/customers/${encodeURIComponent(customer.externalCode)}/notes?months=${months}&currency=${currency}`,
      ),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-space-2xs" aria-hidden>
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="flex items-start gap-space-xs text-label-md text-error">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {error instanceof Error ? error.message : 'No se pudieron consultar las notas de entrega'}
      </p>
    );
  }

  if (!data) return null;

  const notes = data.notes;
  const totalSacks = notes.reduce((sum, note) => sum + note.sacks, 0);
  const totalTonnes = notes.reduce((sum, note) => sum + note.tonnes, 0);
  const missingAmount = notes.some((note) => note.amount === null);
  const totalAmount = missingAmount ? null : notes.reduce((sum, note) => sum + (note.amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-space-sm animate-fade">
      {!data.available && (
        <p role="status" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          No se pudieron leer las notas de entrega en Profit. Vuelve a intentar en unos minutos.
        </p>
      )}

      {data.available && !data.ordersAvailable && (
        <p role="status" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          No se pudo resolver el pedido de origen en Profit; las notas se muestran sin pedido.
        </p>
      )}

      {data.available && !data.itemsAvailable && (
        <p role="status" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          No se pudo leer el detalle de artículos de las notas; el desplegable puede estar vacío.
        </p>
      )}

      {data.available && !data.invoicesAvailable && (
        <p role="status" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          No se pudo leer la factura de las notas en Profit; «N/T» puede no ser definitivo.
        </p>
      )}

      {data.available && notes.length === 0 && (
        <div className="flex flex-col items-start gap-space-2xs rounded-xl border border-dashed border-outline-variant/50 p-space-md">
          <p className="flex items-center gap-space-xs font-semibold text-title-md text-primary">
            <Receipt aria-hidden className="size-4" /> Sin notas de entrega en el periodo
          </p>
          <p className="text-label-md normal-case text-on-surface-variant">
            Amplía la ventana a 24 o 36 meses para ver movimientos anteriores.
          </p>
        </div>
      )}

      {data.available && notes.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-outline-variant/35 bg-surface-container-lowest shadow-soft">
            <table className="w-full border-collapse text-label-md">
              <thead>
                <tr className="border-b border-outline-variant/30 bg-surface-container-low/80">
                  <Th>Factura</Th>
                  <Th>Fecha</Th>
                  <Th>Vendedor</Th>
                  <Th>Solicitud</Th>
                  <Th align="right">Sacos</Th>
                  <Th align="right">Toneladas</Th>
                  <Th align="right">Monto</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {notes.map((note) => {
                  const open = openNote === note.number;
                  return (
                    <Fragment key={note.number}>
                      <tr
                        className={`transition-colors ${open ? 'bg-surface-container-low/70' : 'hover:bg-surface-container-low/70'}`}
                      >
                        <Td>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenNote((current) => (current === note.number ? null : note.number))
                            }
                            aria-expanded={open}
                            aria-controls={open ? `nota-detalle-${note.number}` : undefined}
                            title={
                              note.invoices.length === 0
                                ? 'Nota de entrega sin factura en Profit · ver qué se entregó'
                                : `Factura ${note.invoices.join(' / ')} · ver qué se entregó`
                            }
                            className={`inline-flex items-center gap-1 rounded-md py-0.5 pr-1 text-left font-bold tabular-nums transition-colors hover:text-secondary ${
                              note.invoices.length === 0 ? 'text-outline' : 'text-primary'
                            }`}
                          >
                            <ChevronDown
                              aria-hidden
                              className={`size-3.5 shrink-0 text-outline transition-transform ${open ? 'rotate-180' : ''}`}
                            />
                            {note.invoices.length === 0 ? 'N/T' : note.invoices.join(' / ')}
                          </button>
                        </Td>
                        <Td className="tabular-nums text-on-surface-variant">{fmtDate(note.date)}</Td>
                        <Td className="normal-case">
                          <span
                            className="block max-w-[14rem] truncate text-on-surface-variant"
                            title={note.vendor ?? undefined}
                          >
                            {note.vendor ?? '—'}
                          </span>
                        </Td>
                        <Td>
                          {note.orders.length === 0 ? (
                            <NoteTag number={note.number} />
                          ) : (
                            <div className="flex flex-wrap items-baseline gap-space-2xs">
                              {note.orders.map((order) => (
                                <OrderChip key={`${order.number}-${order.profitOrder ?? ''}`} order={order} />
                              ))}
                              <NoteTag number={note.number} />
                            </div>
                          )}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {fmtQty(note.sacks, 0)}
                        </Td>
                        <Td align="right" className="tabular-nums text-on-surface-variant">
                          {fmtQty(note.tonnes, 1)}
                        </Td>
                        <Td align="right" className="font-semibold tabular-nums">
                          {formatInsightMoney(note.amount, currency)}
                        </Td>
                      </tr>
                      {open && (
                        <tr id={`nota-detalle-${note.number}`} className="bg-surface-container-low/50">
                          <Td colSpan={7} className="pb-space-sm pt-0">
                            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
                              <p className="mb-1 text-label-sm font-semibold uppercase text-outline">
                                Qué se entregó en la nota {note.number}
                                {note.invoices.length > 0
                                  ? ` · factura ${note.invoices.join(' / ')}`
                                  : ' · sin factura'}
                              </p>
                              <NoteItems note={note} />
                            </div>
                          </Td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <p className="text-label-sm normal-case text-on-surface-variant">
              {notes.length} nota{notes.length === 1 ? '' : 's'} · {fmtQty(totalSacks, 0)} sacos ·{' '}
              {fmtQty(totalTonnes, 1)} t
              {totalAmount !== null && ` · ${formatInsightMoney(totalAmount, currency)}`}
            </p>
            <p className="text-label-sm normal-case text-outline">
              La primera columna es la factura en Profit; <strong className="font-semibold">N/T</strong> = nota
              de entrega aún sin facturar. La solicitud es el número que ves en la pantalla Pedidos.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

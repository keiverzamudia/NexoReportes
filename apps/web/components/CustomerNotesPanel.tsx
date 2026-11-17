'use client';

// ============================================================
// Notas de entrega de un cliente con el pedido que las originó.
//
// Se carga solo al abrir la pestaña «Pedidos» de la ficha 360. La consulta
// vive en el backend (`/customers/:code/notes`) porque el vínculo nota →
// pedido está en Profit: `reng_nde.tipo_doc` + `num_doc` y, cuando la nota
// pasó por la tabla de pedidos, `reng_ped` hasta la solicitud.
// ============================================================

import type {
  Customer,
  CustomerNoteOrder,
  CustomerNotesResponse,
  CustomerStatementCurrency,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Receipt } from 'lucide-react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import { formatInsightMoney } from '../lib/customer-insights';
import { Skeleton, Td, Th, fmtDate, fmtQty } from './ui';

type MonthsWindow = '12' | '24' | '36';

function OrderChip({ order }: { order: CustomerNoteOrder }) {
  if (!order.profitOrder) {
    return (
      <span className="inline-flex items-baseline gap-1 rounded-pill border border-primary-container/25 bg-primary-fixed/50 px-2 py-0.5">
        <span className="font-bold tabular-nums text-primary">{order.number}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-1 rounded-pill border border-primary-container/25 bg-primary-fixed/50 px-2 py-0.5"
      title={`Pedido ${order.profitOrder} en Profit`}
    >
      <span className="font-bold tabular-nums text-primary">{order.number}</span>
      <span className="text-label-sm font-medium text-on-surface-variant">Profit {order.profitOrder}</span>
    </span>
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
                  <Th>Nota</Th>
                  <Th>Fecha</Th>
                  <Th>Pedido(s)</Th>
                  <Th align="right">Sacos</Th>
                  <Th align="right">Toneladas</Th>
                  <Th align="right">Monto</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {notes.map((note) => (
                  <tr key={note.number} className="transition-colors hover:bg-surface-container-low/70">
                    <Td className="font-bold tabular-nums text-primary">{note.number}</Td>
                    <Td className="tabular-nums text-on-surface-variant">{fmtDate(note.date)}</Td>
                    <Td>
                      {note.orders.length === 0 ? (
                        <span className="text-outline" title="Profit no registra el pedido de origen de esta nota">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-baseline gap-space-2xs">
                          {note.orders.map((order) => (
                            <OrderChip key={`${order.number}-${order.profitOrder ?? ''}`} order={order} />
                          ))}
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
                ))}
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
              El número grande es el pedido que ves en Pedidos; «Profit» es el pedido interno de Profit.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

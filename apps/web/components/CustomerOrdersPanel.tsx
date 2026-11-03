'use client';

// ============================================================
// Renglones pendientes de un cliente (notas de entrega en camino).
// Se usa en el desplegable rápido de Clientes y en la pestaña «Pedidos»
// de la ficha 360. La consulta se hace al abrir; no precarga la cartera.
// ============================================================

import type { Customer, OrderGroupedResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AuthRequiredError, apiFetch } from '../lib/api';
import { Badge, Td, Th, fmtDate, fmtQty } from './ui';

export function CustomerOrdersPanel({ customer }: { customer: Customer }) {
  const { data, isLoading, error } = useQuery<OrderGroupedResponse>({
    queryKey: ['customer-orders', customer.externalCode],
    queryFn: () =>
      apiFetch<OrderGroupedResponse>(
        `/orders/grouped?by=cliente&customerCode=${encodeURIComponent(customer.externalCode)}`,
      ),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (isLoading) {
    return <p className="text-label-md text-on-surface-variant">Consultando pedidos…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-label-md text-error">
        {error instanceof Error ? error.message : 'No se pudieron consultar los pedidos'}
      </p>
    );
  }

  const lines = (data?.groups ?? []).flatMap((group) => group.lines);
  if (lines.length === 0) {
    return <p className="text-label-md text-on-surface-variant">Este cliente no tiene renglones pendientes ahora mismo.</p>;
  }

  const pendingQty = lines.reduce((sum, line) => sum + line.pendingQty, 0);
  const pendingKg = lines.reduce((sum, line) => sum + (line.pendingKg ?? 0), 0);

  return (
    <div className="flex flex-col gap-space-sm animate-fade">
      <div className="flex flex-wrap items-center gap-space-sm">
        <Badge tone="primary" dot>
          {lines.length} renglón{lines.length === 1 ? '' : 'es'}
        </Badge>
        <Badge tone="success" dot>
          {fmtQty(pendingQty, 0)} unid. pendientes
        </Badge>
        <Badge tone="muted" dot>
          {fmtQty(pendingKg / 1000, 1)} t
        </Badge>
        <span className="ml-auto text-label-sm text-on-surface-variant">Despacho sugerido por entrega más próxima</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-outline-variant/35 bg-surface-container-lowest shadow-soft">
        <table className="w-full border-collapse text-label-md">
          <thead>
            <tr className="border-b border-outline-variant/30 bg-surface-container-low/80">
              <Th>Pedido</Th>
              <Th>Entrega</Th>
              <Th>Artículo</Th>
              <Th align="right">Pendiente</Th>
              <Th align="right">Kg</Th>
              <Th>Alm.</Th>
              <Th align="center">Aut.</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {lines.map((line) => (
              <tr key={`${line.orderId}#${line.productCode}`} className="transition-colors hover:bg-surface-container-low/70">
                <Td className="font-bold tabular-nums text-primary">{line.orderNumber}</Td>
                <Td
                  className={`tabular-nums ${line.tentativeDate ? 'font-semibold text-secondary' : 'text-on-surface-variant'}`}
                  title={line.tentativeDate ? `Original: ${fmtDate(line.requestedDate)}` : undefined}
                >
                  {fmtDate(line.tentativeDate ?? line.requestedDate)}
                </Td>
                <Td>
                  <span className="block max-w-[26rem] truncate" title={line.description ?? ''}>
                    <span className="font-bold text-primary">{line.productCode}</span>
                    <span className="text-on-surface-variant"> · {line.description ?? '—'}</span>
                  </span>
                </Td>
                <Td align="right" className={`tabular-nums font-bold ${line.pendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
                  {fmtQty(line.pendingQty, 0)}
                </Td>
                <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.pendingKg, 0)}</Td>
                <Td className="text-on-surface-variant">{line.warehouseCode ?? '—'}</Td>
                <Td align="center">
                  {line.authorized === null ? (
                    <span className="text-outline">—</span>
                  ) : (
                    <Badge tone={line.authorized ? 'success' : 'muted'} dot>{line.authorized ? 'SÍ' : 'NO'}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-label-sm text-on-surface-variant">
        {lines.length} renglón(es) · {fmtQty(pendingQty, 0)} unid. pendientes · {fmtQty(pendingKg / 1000, 1)} t
      </p>
    </div>
  );
}

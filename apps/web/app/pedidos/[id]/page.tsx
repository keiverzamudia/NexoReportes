'use client';

// ============================================================
// Detalle de pedido (Fase 4) — estilo Stitch.
// Renglones sincronizados desde Profit con pendiente, kg y las
// existencias del artículo en los almacenes Stock 03 / Stock 68.
// ============================================================

import type { OrderDetail, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../../components/shell';
import { Badge, Card, Kpi, PageHeader, Td, Th, fmtDate, fmtQty } from '../../../components/ui';
import { AuthRequiredError, apiFetch } from '../../../lib/api';

const STATUS_LABEL: Record<OrderStatus, string> = {
  ABIERTO: 'Abierto',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
};

const STATUS_TONE: Record<OrderStatus, 'success' | 'muted' | 'danger' | 'default'> = {
  ABIERTO: 'success',
  CERRADO: 'muted',
  CANCELADO: 'danger',
  DESCONOCIDO: 'default',
};

export default function PedidoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [tick, setTick] = useState(0);

  const { data, isLoading, error } = useQuery<OrderDetail>({
    queryKey: ['order', id, tick],
    queryFn: () => apiFetch<OrderDetail>(`/orders/${id}`),
    enabled: Boolean(id),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const order = data?.order;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <Link href="/pedidos" className="flex w-fit items-center gap-space-sm text-body-md text-on-surface-variant hover:text-primary">
          <ArrowLeft aria-hidden className="size-4" /> Volver a pedidos
        </Link>

        {isLoading && <p className="text-body-md text-on-surface-variant">Cargando pedido…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {order && (
          <>
            <PageHeader
              eyebrow={`Ventas y CxC · Solicitud ${order.externalNumber}`}
              icon={FileText}
              title={`Pedido ${order.externalNumber}`}
              subtitle={`${order.customerName ?? 'Cliente desconocido'}${order.customerCode ? ` (${order.customerCode})` : ''}`}
              actions={
                <div className="flex flex-wrap items-center gap-space-sm">
                  <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                  <Kpi label="Renglones" value={fmtQty(order.linesCount, 0)} tone="muted" />
                  <Kpi label="Pendiente total" value={fmtQty(order.totalPendingQty, 0)} tone="danger" suffix="unidades" />
                </div>
              }
            />

            <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
              <Kpi label="Emisión" value={fmtDate(order.orderDate)} tone="default" />
              <Kpi label="Entrega comprometida" value={fmtDate(order.requestedDate)} tone="default" />
              <Kpi label="Vendedor" value={order.vendor ?? '—'} tone="muted" />
              <Kpi label="Tipo de cliente" value={order.customerType ?? '—'} tone="muted" />
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-body-md">
                  <thead>
                    <tr className="border-b border-surface-container bg-surface-container">
                      <Th align="right">#</Th>
                      <Th>Código</Th>
                      <Th>Descripción</Th>
                      <Th>Unid.</Th>
                      <Th align="right">Cantidad</Th>
                      <Th align="right">Pendiente</Th>
                      <Th align="right">Kg</Th>
                      <Th>Alm.</Th>
                      <Th align="right">Stock 03</Th>
                      <Th align="right">Stock 68</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {data.lines.length === 0 && (
                      <tr>
                        <Td align="center" className="py-space-xl text-on-surface-variant">
                          El pedido no tiene renglones sincronizados.
                        </Td>
                      </tr>
                    )}
                    {data.lines.map((line) => (
                      <tr key={line.lineNumber} className="transition-colors hover:bg-surface-container-low">
                        <Td align="right" className="tabular-nums text-on-surface-variant">{line.lineNumber}</Td>
                        <Td className="font-bold tabular-nums text-primary">{line.productCode}</Td>
                        <Td className="max-w-md truncate" title={line.description ?? ''}>{line.description ?? '—'}</Td>
                        <Td className="text-on-surface-variant">{line.uom ?? '—'}</Td>
                        <Td align="right" className="tabular-nums text-outline">{fmtQty(line.quantity, 0)}</Td>
                        <Td align="right" className={`tabular-nums font-bold ${line.pendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
                          {fmtQty(line.pendingQty, 2)}
                        </Td>
                        <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.pendingKg, 0)}</Td>
                        <Td className="tabular-nums text-on-surface-variant">{line.warehouseCode ?? '—'}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(line.stock03, 0)}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(line.stock68, 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <p className="text-label-sm normal-case text-on-surface-variant">
              Valores crudos de Profit (cotización + renglones). «Autorizado» = cotización con estado 1. Los pendientes
              negativos son sobre-compromisos reales del ERP. Cualquier «—» significa que la fuente no expone el dato.
            </p>
          </>
        )}
      </main>
    </>
  );
}

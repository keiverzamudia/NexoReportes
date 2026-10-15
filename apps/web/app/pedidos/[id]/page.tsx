'use client';

// ============================================================
// Detalle de pedido (Fase 4): renglones sincronizados desde Profit,
// con cantidad pendiente y kg del renglón (valor crudo de la vista).
// ============================================================

import type { OrderDetail, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../../components/shell';
import { AuthRequiredError, apiFetch } from '../../../lib/api';

const STATUS_LABEL: Record<OrderStatus, string> = {
  ABIERTO: 'Abierto',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
};

const STATUS_CHIP: Record<OrderStatus, string> = {
  ABIERTO: 'bg-secondary-container text-on-secondary-container',
  CERRADO: 'bg-surface-container-highest text-on-surface',
  CANCELADO: 'bg-error-container text-on-error-container',
  DESCONOCIDO: 'bg-surface-container-low text-on-surface-variant border border-outline-variant',
};

function fmtQty(value: number): string {
  return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 }).format(value);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'long' }).format(new Date(iso));
}

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
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-space-lg p-space-xl">
        <Link href="/pedidos" className="flex w-fit items-center gap-space-sm text-body-md text-on-surface-variant hover:underline">
          <ArrowLeft aria-hidden className="size-4" /> Volver a pedidos
        </Link>

        {isLoading && <p className="text-body-md text-on-surface-variant">Cargando pedido…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {order && (
          <>
            <header className="flex flex-wrap items-end justify-between gap-space-md">
              <div>
                <h1 className="text-headline-lg italic">Pedido {order.externalNumber}</h1>
                <p className="text-body-md text-on-surface-variant">
                  {order.customerName ?? 'Cliente desconocido'}
                  {order.customerCode ? ` (${order.customerCode})` : ''}
                </p>
              </div>
              <span className={`rounded-full px-space-md py-space-sm text-label-md uppercase ${STATUS_CHIP[order.status]}`}>
                {STATUS_LABEL[order.status]}
              </span>
            </header>

            <section aria-label="Datos del pedido" className="grid gap-space-md sm:grid-cols-4">
              <Field label="Emisión" value={fmtDate(order.orderDate)} />
              <Field label="Entrega comprometida" value={fmtDate(order.requestedDate)} />
              <Field label="Renglones" value={String(order.linesCount)} />
              <Field label="Pendiente total (unidades)" value={fmtQty(order.totalPendingQty)} />
            </section>

            <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
              <table className="w-full border-collapse text-data-tabular-md">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-md uppercase text-on-surface-variant">
                    <th scope="col" className="px-space-md py-space-sm text-right">#</th>
                    <th scope="col" className="px-space-md py-space-sm">Código</th>
                    <th scope="col" className="px-space-md py-space-sm">Descripción</th>
                    <th scope="col" className="px-space-md py-space-sm">Unidad</th>
                    <th scope="col" className="px-space-md py-space-sm text-right">Pendiente</th>
                    <th scope="col" className="px-space-md py-space-sm text-right">Kg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-space-md py-space-xl text-center text-body-md text-on-surface-variant">
                        El pedido no tiene renglones sincronizados.
                      </td>
                    </tr>
                  )}
                  {data.lines.map((line) => (
                    <tr key={line.lineNumber} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                      <td className="px-space-md py-space-sm text-right tabular-nums">{line.lineNumber}</td>
                      <td className="px-space-md py-space-sm font-semibold">{line.productCode}</td>
                      <td className="max-w-md truncate px-space-md py-space-sm" title={line.description ?? ''}>
                        {line.description ?? '—'}
                      </td>
                      <td className="px-space-md py-space-sm">{line.uom ?? '—'}</td>
                      <td className={`px-space-md py-space-sm text-right tabular-nums ${line.pendingQty < 0 ? 'text-error' : ''}`}>
                        {fmtQty(line.pendingQty)}
                      </td>
                      <td className="px-space-md py-space-sm text-right tabular-nums">
                        {line.pendingKg === null ? '—' : fmtQty(line.pendingKg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-label-md normal-case text-on-surface-variant">
              Valores crudos de la vista de Profit. Los pendientes negativos corresponden a sobre-compromisos reales del ERP.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
      <p className="text-label-md uppercase text-on-surface-variant">{label}</p>
      <p className="text-data-tabular-lg tabular-nums">{value}</p>
    </div>
  );
}

'use client';

// ============================================================
// Pedidos (Fase 4): consulta de las solicitudes sincronizadas
// desde Profit. Filtros por texto de cliente/nº, estado y paginación.
// Cada fila enlaza al detalle con sus renglones.
// ============================================================

import type { OrderStatus, OrderSummary } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

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
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short' }).format(new Date(iso));
}

const PAGE_SIZE = 25;

export default function PedidosPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);
  // Filtro por cliente cuando se llega desde la pantalla de Clientes
  // (/pedidos?cliente=CODIGO).
  const [customerCode, setCustomerCode] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('cliente') ?? ''),
  );

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (customerCode) params.set('customerCode', customerCode);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<Paginated<OrderSummary>>({
    queryKey: ['orders', tick, q, status, customerCode, page],
    queryFn: () => apiFetch<Paginated<OrderSummary>>(`/orders?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-space-lg p-space-xl">
        <header className="flex flex-wrap items-end justify-between gap-space-md">
          <div>
            <h1 className="text-headline-lg italic">Pedidos</h1>
            <p className="text-body-md text-on-surface-variant">
              Solicitudes de clientes sincronizadas desde Profit (vista de pendientes).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <label className="flex items-center gap-space-sm rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm">
              <Search aria-hidden className="size-4 text-on-surface-variant" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por nº o cliente…"
                className="w-56 bg-transparent text-body-md text-on-surface outline-none"
                aria-label="Buscar pedido"
              />
            </label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as OrderStatus | '');
                setPage(1);
              }}
              aria-label="Filtrar por estado"
              className="rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm text-body-md text-on-surface"
            >
              <option value="">Todos los estados</option>
              <option value="ABIERTO">Abierto</option>
              <option value="CERRADO">Cerrado</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>
        </header>

        {customerCode && (
          <p className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
            Filtrando por cliente <strong className="text-on-surface">{customerCode}</strong>
            <button
              onClick={() => {
                setCustomerCode('');
                setPage(1);
                if (typeof window !== 'undefined') window.history.replaceState(null, '', '/pedidos');
              }}
              className="rounded border border-outline-variant px-space-sm py-space-2xs text-label-md uppercase hover:bg-surface-container-low"
            >
              Quitar filtro
            </button>
          </p>
        )}

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando pedidos…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
            <table className="w-full border-collapse text-data-tabular-md">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-md uppercase text-on-surface-variant">
                  <th scope="col" className="px-space-md py-space-sm">Nº Pedido</th>
                  <th scope="col" className="px-space-md py-space-sm">Cliente</th>
                  <th scope="col" className="px-space-md py-space-sm">Emisión</th>
                  <th scope="col" className="px-space-md py-space-sm">Entrega</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Renglones</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Pendiente</th>
                  <th scope="col" className="px-space-md py-space-sm">Estado</th>
                  <th scope="col" className="px-space-md py-space-sm" />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-space-md py-space-xl text-center text-body-md text-on-surface-variant">
                      Sin pedidos{q ? ` para “${q}”` : ''}.
                    </td>
                  </tr>
                )}
                {data.items.map((order) => (
                  <tr key={order.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                    <td className="px-space-md py-space-sm font-semibold">{order.externalNumber}</td>
                    <td className="max-w-xs truncate px-space-md py-space-sm" title={order.customerName ?? ''}>
                      {order.customerName ?? '—'}
                      {order.customerCode && (
                        <span className="ml-space-sm text-on-surface-variant">({order.customerCode})</span>
                      )}
                    </td>
                    <td className="px-space-md py-space-sm">{fmtDate(order.orderDate)}</td>
                    <td className="px-space-md py-space-sm">{fmtDate(order.requestedDate)}</td>
                    <td className="px-space-md py-space-sm text-right tabular-nums">{order.linesCount}</td>
                    <td className="px-space-md py-space-sm text-right tabular-nums">{fmtQty(order.totalPendingQty)}</td>
                    <td className="px-space-md py-space-sm">
                      <span className={`rounded-full px-space-sm py-space-2xs text-label-md uppercase ${STATUS_CHIP[order.status]}`}>
                        {STATUS_LABEL[order.status]}
                      </span>
                    </td>
                    <td className="px-space-md py-space-sm text-right">
                      <Link href={`/pedidos/${order.id}`} className="font-semibold text-primary-container hover:underline">
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > 0 && (
          <footer className="flex items-center justify-between text-body-md text-on-surface-variant">
            <span>
              {data.total} pedido{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
            </span>
            <div className="flex gap-space-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-outline-variant px-space-md py-space-sm hover:bg-surface-container-low disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-outline-variant px-space-md py-space-sm hover:bg-surface-container-low disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </footer>
        )}
      </main>
    </>
  );
}

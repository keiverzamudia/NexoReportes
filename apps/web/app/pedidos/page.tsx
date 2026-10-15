'use client';

// ============================================================
// Pedidos (Fase 4) — rediseño estilo Stitch.
// Consulta las solicitudes sincronizadas desde Profit con filtros
// por texto, estado, cliente y rangos de emisión/entrega.
// Los campos que la vista de Profit no expone (Vendedor, Tipo de
// cliente) se muestran como "—" (nunca inventados).
// ============================================================

import type { OrderListResponse, OrderStatus, OrderSummary } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Search, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DateInput, Kpi, PageHeader, Select, Td, TextInput, Th, fmtDate, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

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

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'ABIERTO', label: 'Abierto' },
  { value: 'CERRADO', label: 'Cerrado' },
  { value: 'CANCELADO', label: 'Cancelado' },
];

export default function PedidosPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [emisionDesde, setEmisionDesde] = useState('');
  const [emisionHasta, setEmisionHasta] = useState('');
  const [entregaDesde, setEntregaDesde] = useState('');
  const [entregaHasta, setEntregaHasta] = useState('');
  const [customerCode, setCustomerCode] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('cliente') ?? ''),
  );

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (customerCode) params.set('customerCode', customerCode);
  if (emisionDesde) params.set('emisionDesde', emisionDesde);
  if (emisionHasta) params.set('emisionHasta', emisionHasta);
  if (entregaDesde) params.set('entregaDesde', entregaDesde);
  if (entregaHasta) params.set('entregaHasta', entregaHasta);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<OrderListResponse>({
    queryKey: ['orders', tick, q, status, customerCode, emisionDesde, emisionHasta, entregaDesde, entregaHasta, page],
    queryFn: () => apiFetch<OrderListResponse>(`/orders?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters = Boolean(q || status || emisionDesde || emisionHasta || entregaDesde || entregaHasta || customerCode);

  function resetFilters() {
    setQ('');
    setStatus('');
    setEmisionDesde('');
    setEmisionHasta('');
    setEntregaDesde('');
    setEntregaHasta('');
    setCustomerCode('');
    setPage(1);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '/pedidos');
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Solicitudes de clientes"
          icon={ShoppingCart}
          title="Pedidos"
          subtitle="Solicitudes con sus renglones sincronizadas desde Profit. Filtra por número, cliente, estado y rangos de fecha de emisión o entrega."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Pedidos" value={data ? fmtQty(data.total, 0) : '—'} icon={ShoppingCart} />
              <Kpi label="Abiertos" value={data ? fmtQty(data.summary.openCount, 0) : '—'} tone="success" />
              <Kpi label="Renglones" value={data ? fmtQty(data.summary.linesTotal, 0) : '—'} tone="muted" />
              <Kpi label="Pendiente total" value={data ? fmtQty(data.summary.totalPendingQty, 0) : '—'} tone="danger" hint="unidades (mezcla SAC/KG)" />
            </div>
          }
        />

        {/* Panel de filtros */}
        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-12">
            <TextInput
              className="lg:col-span-4"
              icon={Search}
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="Buscar por N° de pedido o cliente…"
              ariaLabel="Buscar pedido"
            />
            <Select
              className="lg:col-span-2"
              value={status}
              onChange={(v) => {
                setStatus(v as OrderStatus | '');
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              ariaLabel="Filtrar por estado"
            />
            <div className="flex items-center gap-space-xs lg:col-span-4">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Entrega</span>
              <DateInput ariaLabel="Entrega desde" value={entregaDesde} onChange={(v) => { setEntregaDesde(v); setPage(1); }} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Entrega hasta" value={entregaHasta} onChange={(v) => { setEntregaHasta(v); setPage(1); }} className="w-full" />
            </div>
            <div className="flex items-center gap-space-xs lg:col-span-4">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Emisión</span>
              <DateInput ariaLabel="Emisión desde" value={emisionDesde} onChange={(v) => { setEmisionDesde(v); setPage(1); }} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Emisión hasta" value={emisionHasta} onChange={(v) => { setEmisionHasta(v); setPage(1); }} className="w-full" />
            </div>
            <div className="flex items-center lg:col-span-4">
              <button
                onClick={resetFilters}
                disabled={!hasFilters}
                className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
          {customerCode && (
            <p className="mt-space-sm flex items-center gap-space-sm text-body-md text-on-surface-variant">
              Filtrando por cliente <strong className="text-primary">{customerCode}</strong>
            </p>
          )}
        </Card>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando pedidos…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-surface-container bg-surface-container">
                    <Th>N° Pedido</Th>
                    <Th>Emisión</Th>
                    <Th>Entrega</Th>
                    <Th>Cliente</Th>
                    <Th>Vendedor</Th>
                    <Th>Tipo de cliente</Th>
                    <Th align="right">Renglones</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="center">Estado</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {data.items.length === 0 && (
                    <tr>
                      <Td className="py-space-xl text-center text-on-surface-variant" align="center">
                        {hasFilters ? 'Sin pedidos para los filtros aplicados.' : 'No hay pedidos sincronizados.'}
                      </Td>
                    </tr>
                  )}
                  {data.items.map((order: OrderSummary) => (
                    <tr key={order.id} className="transition-colors hover:bg-surface-container-low">
                      <Td className="font-bold tabular-nums text-primary">{order.externalNumber}</Td>
                      <Td className="tabular-nums text-on-surface-variant">{fmtDate(order.orderDate)}</Td>
                      <Td className="tabular-nums text-on-surface-variant">{fmtDate(order.requestedDate)}</Td>
                      <Td className="max-w-[22rem]">
                        <div className="flex flex-col">
                          <span className="truncate font-semibold text-on-surface" title={order.customerName ?? ''}>
                            {order.customerName ?? '—'}
                          </span>
                          {order.customerCode && <span className="text-label-sm text-outline tabular-nums">{order.customerCode}</span>}
                        </div>
                      </Td>
                      <Td className="text-on-surface-variant" title={order.vendor ? undefined : 'No disponible en la vista actual de Profit'}>
                        {order.vendor ?? '—'}
                      </Td>
                      <Td title={order.customerType ? undefined : 'No disponible en la vista actual de Profit'}>
                        {order.customerType ? <Badge tone="primary">{order.customerType}</Badge> : <span className="text-outline">—</span>}
                      </Td>
                      <Td align="right" className="tabular-nums">{order.linesCount}</Td>
                      <Td align="right" className={`tabular-nums font-bold ${order.totalPendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
                        {fmtQty(order.totalPendingQty, 0)}
                      </Td>
                      <Td align="center">
                        <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                      </Td>
                      <Td align="right">
                        <Link href={`/pedidos/${order.id}`} className="font-semibold text-primary-container hover:underline">
                          Ver
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-sm text-body-md text-on-surface-variant">
              <span>
                {data.total} pedido{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
              </span>
              <div className="flex items-center gap-space-sm">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex h-9 items-center gap-space-2xs rounded-lg border border-outline-variant px-space-md transition-colors hover:bg-surface-container-low disabled:opacity-40"
                >
                  <ChevronLeft aria-hidden className="size-4" /> Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex h-9 items-center gap-space-2xs rounded-lg border border-outline-variant px-space-md transition-colors hover:bg-surface-container-low disabled:opacity-40"
                >
                  Siguiente <ChevronRight aria-hidden className="size-4" />
                </button>
              </div>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

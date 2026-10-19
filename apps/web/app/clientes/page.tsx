'use client';

// ============================================================
// Clientes (Fase 4) — rediseño estilo Stitch.
// Catálogo derivado de la vista de Profit. Tipo de cliente y vendedor
// no vienen en la vista actual → "—" (nunca inventados).
// ============================================================

import type { Customer } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, Column, DataTable, EmptyState, Kpi, PageHeader, TextInput } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 50;

// Columnas del catálogo paginado.
const COLUMNS: Column<Customer>[] = [
  {
    key: 'codigo',
    header: 'Código',
    kind: 'id',
    sortValue: (c) => c.externalCode,
    render: (c) => <span className="font-bold tabular-nums text-primary">{c.externalCode}</span>,
  },
  { key: 'nombre', header: 'Nombre', title: (c) => c.name, sortValue: (c) => c.name, render: (c) => c.name },
  {
    key: 'tipo',
    header: 'Tipo',
    kind: 'status',
    sortValue: (c) => c.customerType ?? '',
    render: (c) =>
      c.customerType ? (
        <Badge tone="primary">{c.customerType}</Badge>
      ) : (
        <span className="text-outline" title="No disponible en la vista actual de Profit">
          —
        </span>
      ),
  },
  {
    key: 'vendedor',
    header: 'Vendedor',
    sortValue: (c) => c.vendor ?? '',
    render: (c) => <span className="text-on-surface-variant">{c.vendor ?? '—'}</span>,
  },
  {
    key: 'pedidos',
    header: 'Pedidos activos',
    align: 'right',
    kind: 'metric',
    sortValue: (c) => c.ordersCount,
    render: (c) => <span className="font-bold">{c.ordersCount}</span>,
  },
  {
    key: 'accion',
    header: ' ',
    align: 'right',
    kind: 'action',
    render: (c) =>
      c.ordersCount > 0 ? (
        <Link
          href={`/pedidos?cliente=${encodeURIComponent(c.externalCode)}`}
          className="font-semibold text-primary-container hover:underline"
        >
          Ver pedidos
        </Link>
      ) : null,
  },
];

export default function ClientesPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<Paginated<Customer>>({
    queryKey: ['customers', tick, q, page],
    queryFn: () => apiFetch<Paginated<Customer>>(`/customers?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const withOrders = useMemo(() => (data?.items ?? []).filter((c) => c.ordersCount > 0).length, [data]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · Cartera de clientes"
          icon={Users}
          title="Clientes"
          subtitle="Catálogo de clientes con pedidos sincronizados desde Profit y acceso directo a sus solicitudes."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Clientes" value={data ? new Intl.NumberFormat('es-VE').format(data.total) : '—'} icon={Users} />
              <Kpi label="Con pedidos (pág.)" value={String(withOrders)} tone="success" />
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
            <TextInput
              className="lg:col-span-4"
              icon={Search}
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="Buscar por código o nombre…"
              ariaLabel="Buscar cliente"
            />
          </div>
        </Card>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando clientes…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <Card className="overflow-hidden">
            <DataTable
              columns={COLUMNS}
              rows={data.items}
              rowKey={(c) => c.id}
              empty={
                <EmptyState
                  icon={Users}
                  title={q ? `Sin clientes para “${q}”` : 'No hay clientes sincronizados'}
                  description="Prueba con otro código o nombre, o vuelve a la primera página."
                />
              }
            />

            {data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-surface-container px-space-md py-space-sm text-body-md text-on-surface-variant">
                <span>
                  {data.total} cliente{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
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
            )}
          </Card>
        )}
      </main>
    </>
  );
}

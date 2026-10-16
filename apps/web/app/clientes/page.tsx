'use client';

// ============================================================
// Clientes — catálogo derivado de la vista de Profit.
// Tipo de cliente y vendedor no vienen en la vista actual → "—"
// (nunca inventados).
// Contrato de UI: docs/design/DESIGN_SYSTEM.md
// (PageHeader + tira de KPIs, Card/CardHeader, FilterBar, DataTable
//  —tabla en ≥md y tarjetas en phone—, EmptyState, ErrorNote).
// ============================================================

import type { Customer } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Button,
  Card,
  CardHeader,
  Column,
  DataTable,
  EmptyState,
  ErrorNote,
  FilterBar,
  Kpi,
  PageHeader,
  TextInput,
  fmtInt,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 50;

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

  const rows = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Una sola definición: la tabla densa (≥md) y la tarjeta del teléfono salen
  // de las mismas columnas. `kind` decide dónde cae cada dato en la tarjeta.
  const columns: Column<Customer>[] = [
    {
      key: 'code',
      header: 'Código',
      kind: 'id',
      render: (c) => c.externalCode,
      sortValue: (c) => c.externalCode,
    },
    {
      key: 'name',
      header: 'Nombre',
      kind: 'id',
      render: (c) => c.name,
      title: (c) => c.name,
      sortValue: (c) => c.name,
    },
    {
      key: 'type',
      header: 'Tipo',
      kind: 'field',
      render: (c) => (c.customerType ? <span className="font-semibold text-on-surface">{c.customerType}</span> : <span className="text-outline">—</span>),
      sortValue: (c) => c.customerType ?? '',
    },
    {
      key: 'vendor',
      header: 'Vendedor',
      kind: 'field',
      render: (c) => (c.vendor ? c.vendor : <span className="text-outline">—</span>),
      sortValue: (c) => c.vendor ?? '',
    },
    {
      key: 'orders',
      header: 'Pedidos activos',
      align: 'right',
      kind: 'metric',
      render: (c) => <span className={c.ordersCount > 0 ? 'font-bold text-on-surface' : 'text-outline'}>{fmtInt(c.ordersCount)}</span>,
      sortValue: (c) => c.ordersCount,
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      render: (c) =>
        c.ordersCount > 0 ? (
          <Link
            href={`/pedidos?cliente=${encodeURIComponent(c.externalCode)}`}
            className="inline-flex h-11 w-full items-center justify-center gap-space-xs rounded-lg border border-outline-variant bg-surface-container-lowest px-space-md font-semibold text-primary-container transition-colors hover:bg-surface-container-low md:h-9 md:w-auto"
          >
            <ShoppingCart aria-hidden className="size-4 shrink-0" />
            Ver pedidos
          </Link>
        ) : null,
    },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-xl">
        <PageHeader
          icon={Users}
          title="Clientes"
          subtitle="Catálogo de clientes con pedidos sincronizados desde Profit y acceso directo a sus solicitudes."
        />

        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
          <Kpi label="Clientes" value={data ? fmtInt(data.total) : '—'} icon={Users} />
          <Kpi
            label="En esta página"
            value={String(rows.length)}
            tone="default"
            hint={data && data.total > rows.length ? `de ${fmtInt(data.total)}` : undefined}
          />
          <Kpi label="Con pedidos (pág.)" value={String(withOrders)} tone="success" />
          <Kpi label="Página" value={`${data?.page ?? page} / ${totalPages}`} tone="muted" />
        </div>

        {error && !(error instanceof AuthRequiredError) && <ErrorNote>{error instanceof Error ? error.message : 'Error al consultar'}</ErrorNote>}

        <Card className="overflow-hidden">
          <CardHeader
            title="Catálogo de clientes"
            description="Se ordena por código. El tipo de cliente y el vendedor llegan de Profit; cuando la vista no los trae se muestran como «—»."
          />
          <FilterBar
            search={
              <TextInput
                icon={Search}
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setPage(1);
                }}
                placeholder="Buscar por código o nombre…"
                ariaLabel="Buscar cliente"
              />
            }
          />
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            loading={isLoading}
            loadingRows={6}
            defaultSortKey="code"
            empty={
              <EmptyState
                icon={Users}
                title={q ? `Sin clientes para “${q}”.` : 'No hay clientes sincronizados.'}
                description={
                  q
                    ? 'Revisa el código o el nombre: la búsqueda no distingue mayúsculas de minúsculas.'
                    : 'Sincroniza desde Profit para traer el catálogo de clientes.'
                }
                action={
                  q ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQ('');
                        setPage(1);
                      }}
                    >
                      Limpiar búsqueda
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {data && data.total > PAGE_SIZE && (
            <div className="flex flex-col gap-space-sm border-t border-surface-container px-space-lg py-space-md sm:flex-row sm:items-center sm:justify-between">
              <span className="text-body-md text-on-surface-variant">
                {fmtInt(data.total)} cliente{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
              </span>
              <div className="flex items-center gap-space-sm">
                <Button
                  variant="outline"
                  icon={ChevronLeft}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex-1 sm:flex-none"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  iconRight={ChevronRight}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex-1 sm:flex-none"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}

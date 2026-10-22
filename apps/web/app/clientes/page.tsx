'use client';

// ============================================================
// Clientes — cartera derivada de Profit.
//
// «Ver pedidos» despliega los renglones pendientes del cliente **aquí mismo**
// (no navega a otra pantalla): el detalle se pide al API al abrir la fila.
// Tipo de cliente y vendedor (clientes.co_ven) llegan desde la sync
// ampliada; si faltan, se muestran "—" (nunca inventados).
// ============================================================

import type { Customer, OrderGroupedResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Receipt, Search, ShoppingCart, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CustomerStatementDialog } from '../../components/CustomerStatementDialog';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Td,
  TextInput,
  Th,
  fmtDate,
  fmtQty,
  useGreeting,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 50;

// Columnas del catálogo paginado. La última despliega los pedidos en la fila
// o abre el estado de cuenta del cliente.
function buildColumns(
  expanded: string | null,
  onToggle: (id: string) => void,
  onStatement: (customer: Customer) => void,
): Column<Customer>[] {
  return [
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
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      render: (c) => (
        <div className="flex flex-wrap items-center justify-end gap-space-2xs">
          {c.ordersCount > 0 && (
            <button
              type="button"
              onClick={() => onToggle(c.id)}
              aria-expanded={expanded === c.id}
              className="inline-flex items-center gap-space-2xs rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
            >
              {expanded === c.id ? (
                <ChevronDown aria-hidden className="size-4" />
              ) : (
                <ChevronRight aria-hidden className="size-4" />
              )}
              {expanded === c.id ? 'Ocultar' : 'Ver pedidos'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onStatement(c)}
            title={`Ver estado de cuenta de ${c.name}`}
            className="inline-flex items-center gap-space-2xs rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
          >
            <Receipt aria-hidden className="size-4" />
            Cuenta
          </button>
        </div>
      ),
    },
  ];
}

export default function ClientesPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const greeting = useGreeting();

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<Paginated<Customer>>({
    queryKey: ['customers', tick, q, page],
    queryFn: () => apiFetch<Paginated<Customer>>(`/customers?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const columns = useMemo(
    () =>
      buildColumns(
        expanded,
        (id) => setExpanded((previous) => (previous === id ? null : id)),
        (customer) => setStatementCustomer(customer),
      ),
    [expanded],
  );

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
          greeting={greeting}
          title="Clientes"
          subtitle="Catálogo de clientes con pedidos sincronizados desde Profit. «Ver pedidos» despliega sus renglones pendientes y «Cuenta» abre su estado de cuenta de la cartera."
          actions={
            <div className="flex flex-wrap items-stretch gap-space-sm">
              <Kpi
                label="Clientes"
                value={data ? new Intl.NumberFormat('es-VE').format(data.total) : '—'}
                icon={Users}
                hint={data ? `página ${data.page} de ${totalPages}` : undefined}
              />
              <Kpi
                label="Con pedidos (pág.)"
                value={String(withOrders)}
                tone="success"
                icon={ShoppingCart}
                hint={data ? `${Math.round((withOrders / Math.max(1, data.items.length)) * 100)}% de la página` : undefined}
              />
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12 lg:items-center">
            <TextInput
              className="lg:col-span-5"
              icon={Search}
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
                setExpanded(null);
              }}
              placeholder="Buscar por código o nombre…"
              ariaLabel="Buscar cliente"
            />
            <p className="text-body-md text-on-surface-variant lg:col-span-5">
              {q.trim()
                ? `Resultados para “${q.trim()}” en la cartera de Profit.`
                : 'Escribe un código o un nombre para filtrar la cartera completa.'}
            </p>
            <div className="flex justify-start lg:col-span-2 lg:justify-end">
              <Badge tone="muted" dot>
                {data ? `${data.items.length} en pantalla` : 'Cargando'}
              </Badge>
            </div>
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
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
              <div className="flex flex-col">
                <span className="text-title-md font-semibold text-primary">Cartera sincronizada</span>
                <span className="text-label-sm text-on-surface-variant">
                  {data.total} cliente{data.total === 1 ? '' : 's'} · datos de solo lectura desde Profit
                </span>
              </div>
              <Badge tone="primary" dot>
                {withOrders} con pedidos en esta página
              </Badge>
            </div>
            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(c) => c.id}
              expandedKey={expanded}
              renderExpanded={(customer) => <ClientePedidos customer={customer} />}
              empty={
                <EmptyState
                  icon={Users}
                  title={q ? `Sin clientes para “${q}”` : 'No hay clientes sincronizados'}
                  description="Prueba con otro código o nombre, o vuelve a la primera página."
                />
              }
            />

            {data.total > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 px-space-md py-space-sm text-body-md text-on-surface-variant">
                <span>
                  {data.total} cliente{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
                </span>
                <div className="flex items-center gap-space-sm">
                  <button
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1));
                      setExpanded(null);
                    }}
                    disabled={page <= 1}
                    className="flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold transition-colors hover:bg-surface-container-low disabled:opacity-40"
                  >
                    <ChevronLeft aria-hidden className="size-4" /> Anterior
                  </button>
                  <button
                    onClick={() => {
                      setPage((p) => Math.min(totalPages, p + 1));
                      setExpanded(null);
                    }}
                    disabled={page >= totalPages}
                    className="flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold transition-colors hover:bg-surface-container-low disabled:opacity-40"
                  >
                    Siguiente <ChevronRight aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}
      </main>

      {statementCustomer && (
        <CustomerStatementDialog
          open
          customer={statementCustomer}
          onClose={() => setStatementCustomer(null)}
        />
      )}
    </>
  );
}

// Renglones pendientes del cliente, desplegados dentro de su fila.
function ClientePedidos({ customer }: { customer: Customer }) {
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
          {fmtQty(pendingKg, 0)} kg
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
        {lines.length} renglón(es) · {fmtQty(pendingQty, 0)} unid. pendientes · {fmtQty(pendingKg, 0)} kg
      </p>
    </div>
  );
}

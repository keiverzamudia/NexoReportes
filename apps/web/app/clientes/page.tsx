'use client';

// ============================================================
// Clientes — cartera derivada de Profit.
//
// «Ver pedidos» despliega los renglones pendientes del cliente **aquí mismo**
// (no navega a otra pantalla): el detalle se pide al API al abrir la fila.
// Tipo de cliente y vendedor (clientes.co_ven) llegan desde la sync
// ampliada; si faltan, se muestran "—" (nunca inventados).
// ============================================================

import type {
  Customer,
  CustomerListResponse,
  CustomerSalesPeriod,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, ChevronDown, ChevronLeft, ChevronRight, Receipt, Search, ShoppingCart, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { CustomerInsightsModal } from '../../components/CustomerInsightsModal';
import { CustomerOrdersPanel } from '../../components/CustomerOrdersPanel';
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
  Select,
  TextInput,
  fmtDate,
  fmtQty,
  useGreeting,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const PAGE_SIZE = 50;

// Periodos del filtro de ventas. «todos» = actividad de 12 meses
// (pedido activo o venta); el resto son ventanas móviles por mes calendario.
const SALES_PERIOD_OPTIONS: { value: CustomerSalesPeriod; label: string }[] = [
  { value: 'todos', label: 'Todas con actividad (12 meses)' },
  { value: 'mes', label: 'Ventas de este mes' },
  { value: '3m', label: 'Ventas últimos 3 meses' },
  { value: '6m', label: 'Ventas últimos 6 meses' },
  { value: '12m', label: 'Ventas últimos 12 meses' },
];

// Columnas del catálogo paginado. La última despliega los pedidos en la fila
// o abre el estado de cuenta del cliente.
function buildColumns(
  expanded: string | null,
  onToggle: (id: string) => void,
  onStatement: (customer: Customer) => void,
  onInsights: (customer: Customer) => void,
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
      key: 'ventas',
      header: 'Ventas del periodo',
      align: 'right',
      kind: 'metric',
      sortValue: (c) => c.sales?.totalKg ?? 0,
      render: (c) => <SalesCell sales={c.sales} />,
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
          <button
            type="button"
            onClick={() => onInsights(c)}
            title={`Ver ficha 360 de ${c.name}`}
            className="inline-flex items-center gap-space-2xs rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
          >
            <BarChart3 aria-hidden className="size-4" />
            Ficha
          </button>
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

// Ventas del periodo respetando la unidad: sacos para renglones SAC y kg
// para el resto. Si un cliente tiene ambos, se muestran las dos etiquetas.
function SalesCell({ sales }: { sales: Customer['sales'] }) {
  if (!sales) {
    return (
      <span className="text-outline" title="Sin datos de ventas para el periodo">
        —
      </span>
    );
  }
  const parts: string[] = [];
  if (sales.sacks !== 0) parts.push(`${fmtQty(sales.sacks, 0)} sacos`);
  if (sales.sacks === 0 && sales.kg !== 0) parts.push(`${fmtQty(sales.kg, 0)} kg`);
  if (parts.length === 0) return <span className="text-outline">—</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="font-bold tabular-nums text-primary">{parts.join(' · ')}</span>
      <span className="text-label-sm text-on-surface-variant">
        {fmtQty(sales.totalKg / 1000, 1)} t · {sales.notes} nota{sales.notes === 1 ? '' : 's'} · última{' '}
        {fmtDate(sales.lastSaleDate)}
      </span>
    </span>
  );
}

export default function ClientesPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [salesPeriod, setSalesPeriod] = useState<CustomerSalesPeriod>('todos');
  const [onlyWithOrders, setOnlyWithOrders] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [insightsCustomer, setInsightsCustomer] = useState<Customer | null>(null);
  const greeting = useGreeting();

  const openStatement = useCallback((customer: Customer) => {
    setInsightsCustomer(null);
    setStatementCustomer(customer);
  }, []);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  params.set('salesPeriod', salesPeriod);
  if (onlyWithOrders) params.set('onlyWithOrders', 'true');

  const { data, isLoading, error } = useQuery<CustomerListResponse>({
    queryKey: ['customers', tick, q, page, salesPeriod, onlyWithOrders],
    queryFn: () => apiFetch<CustomerListResponse>(`/customers?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const columns = useMemo(
    () =>
      buildColumns(
        expanded,
        (id) => setExpanded((previous) => (previous === id ? null : id)),
        openStatement,
        (customer) => setInsightsCustomer(customer),
      ),
    [expanded, openStatement],
  );

  const withOrders = useMemo(() => (data?.items ?? []).filter((c) => c.ordersCount > 0).length, [data]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // Cambiar de filtro siempre vuelve a la primera página y cierra el detalle.
  const resetView = () => {
    setPage(1);
    setExpanded(null);
  };

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · Cartera de clientes"
          icon={Users}
          greeting={greeting}
          title="Clientes"
          subtitle="Cartera con actividad de los últimos 12 meses (pedido activo o venta). Filtra por ventas del mes, 3, 6 o 12 meses; «Ficha» abre el informe 360 del cliente, «Ver pedidos» despliega sus renglones pendientes y «Cuenta» muestra su estado de cuenta."
          actions={
            <div className="flex flex-wrap items-stretch gap-space-sm">
              <Kpi
                label="Clientes"
                value={data ? new Intl.NumberFormat('es-VE').format(data.total) : '—'}
                icon={Users}
                hint={data ? `página ${data.page} de ${totalPages}` : undefined}
              />
              <Kpi
                label="Con ventas (periodo)"
                value={data ? String(data.summary.withSales) : '—'}
                tone="success"
                icon={ShoppingCart}
                hint={
                  data
                    ? `${fmtQty(data.summary.totalSacks, 0)} sacos · ${fmtQty(data.summary.totalKg / 1000, 1)} t`
                    : undefined
                }
              />
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12 lg:items-center">
            <TextInput
              className="lg:col-span-4"
              icon={Search}
              value={q}
              onChange={(v) => {
                setQ(v);
                resetView();
              }}
              placeholder="Buscar por código o nombre…"
              ariaLabel="Buscar cliente"
            />
            <Select
              className="lg:col-span-4"
              value={salesPeriod}
              onChange={(value) => {
                setSalesPeriod(value as CustomerSalesPeriod);
                resetView();
              }}
              options={SALES_PERIOD_OPTIONS}
              ariaLabel="Filtrar clientes por ventas"
            />
            <div className="flex flex-wrap items-center justify-start gap-space-sm lg:col-span-4 lg:justify-end">
              <button
                type="button"
                aria-pressed={onlyWithOrders}
                onClick={() => {
                  setOnlyWithOrders((value) => !value);
                  resetView();
                }}
                className={`inline-flex h-10 items-center gap-space-2xs rounded-pill border px-space-md font-semibold text-label-md transition-colors ${
                  onlyWithOrders
                    ? 'border-primary-container bg-primary-container text-on-primary'
                    : 'border-outline-variant/40 text-primary-container hover:bg-surface-container-low'
                }`}
              >
                Solo con pedidos activos
              </button>
              <Badge tone="muted" dot>
                {data ? `${data.items.length} en pantalla` : 'Cargando'}
              </Badge>
            </div>
          </div>
          <p className="mt-space-sm text-body-md text-on-surface-variant">
            {q.trim()
              ? `Resultados para “${q.trim()}” en la cartera de Profit.`
              : salesPeriod === 'todos'
                ? 'Cartera con pedido activo o venta en los últimos 12 meses.'
                : `Clientes con ventas en ${
                    salesPeriod === 'mes' ? 'el mes en curso' : salesPeriod === '3m' ? 'los últimos 3 meses' : salesPeriod === '6m' ? 'los últimos 6 meses' : 'los últimos 12 meses'
                  }.`}
          </p>
        </Card>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando clientes…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && !data.salesAvailable && (
          <p role="status" className="flex items-center gap-space-sm text-body-md text-warning">
            <AlertTriangle aria-hidden className="size-4" />
            No se pudieron leer las ventas en Profit; se muestra solo la cartera de pedidos.
          </p>
        )}

        {data && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
              <div className="flex flex-col">
                <span className="text-title-md font-semibold text-primary">Cartera sincronizada</span>
                <span className="text-label-sm text-on-surface-variant">
                  {data.total} cliente{data.total === 1 ? '' : 's'} ·{' '}
                  {salesPeriod === 'todos' ? 'actividad de 12 meses' : 'ventas del periodo'} · solo lectura desde Profit
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
              renderExpanded={(customer) => <CustomerOrdersPanel customer={customer} />}
              empty={
                <EmptyState
                  icon={Users}
                  title={
                    q
                      ? `Sin clientes para “${q}”`
                      : salesPeriod === 'todos'
                        ? 'No hay clientes con actividad'
                        : 'Sin clientes con ventas en el periodo'
                  }
                  description={
                    q
                      ? 'Prueba con otro código o nombre, o vuelve a la primera página.'
                      : 'Prueba con otro periodo o quita «Solo con pedidos activos».'
                  }
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

      <CustomerInsightsModal
        open={insightsCustomer !== null}
        customer={insightsCustomer}
        onClose={() => setInsightsCustomer(null)}
        onOpenStatement={openStatement}
      />
    </>
  );
}
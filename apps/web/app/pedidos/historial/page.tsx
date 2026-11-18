'use client';

// ============================================================
// Pedidos → Historial.
//
// La cartera del simulador solo muestra pedidos abiertos. Aquí se ven los
// pedidos que ya se procesaron (nota de entrega), los cancelados y los que
// siguen abiertos, con su estado de facturación local. Es una vista con
// permiso propio: `pedidos:view_history`.
// ============================================================

import type { OrderBillingStatus, OrderListResponse, OrderStatus, OrderSummary } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  History,
  PackageCheck,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PedidosDenied, PedidosTabs } from '../../../components/PedidosTabs';
import { AppNav, LoginScreen } from '../../../components/shell';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  TextInput,
  fmtDate,
  fmtQty,
  useGreeting,
  type Column,
} from '../../../components/ui';
import { apiFetch, currentUser } from '../../../lib/api';
import { hasPermission } from '../../../lib/permissions';
import { fmtTonnes } from '../../../lib/sales-analytics';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: 'NOTA_ENTREGA', label: 'Procesados' },
  { value: 'ABIERTO', label: 'Abiertos' },
  { value: 'CANCELADO', label: 'Cancelados' },
  { value: '', label: 'Todos' },
] as const;

const BILLING_OPTIONS: Array<{ value: '' | OrderBillingStatus; label: string }> = [
  { value: '', label: 'Facturación: todos' },
  { value: 'FACTURADO_ASUMIDO', label: 'Facturado asumido' },
  { value: 'PENDIENTE', label: 'Pendiente de facturar' },
  { value: 'FACTURADO', label: 'Facturado' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  ABIERTO: 'Abierto',
  NOTA_ENTREGA: 'Procesado',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
};

const STATUS_TONE: Record<OrderStatus, 'success' | 'muted' | 'danger' | 'default'> = {
  ABIERTO: 'success',
  NOTA_ENTREGA: 'muted',
  CERRADO: 'muted',
  CANCELADO: 'danger',
  DESCONOCIDO: 'default',
};

const BILLING_LABEL: Record<OrderBillingStatus, string> = {
  PENDIENTE: 'Pendiente',
  FACTURADO_ASUMIDO: 'Facturado asumido',
  FACTURADO: 'Facturado',
};

function billingTone(status: OrderBillingStatus | undefined): 'success' | 'warning' | 'muted' {
  if (status === 'FACTURADO') return 'success';
  // «Asumido» no es una factura real: se marca como advertencia para que no
  // se confunda con el documento de CxC.
  if (status === 'FACTURADO_ASUMIDO') return 'warning';
  return 'muted';
}

export default function PedidosHistorialPage() {
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['value']>('NOTA_ENTREGA');
  const [billing, setBilling] = useState<'' | OrderBillingStatus>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const greeting = useGreeting();

  const session = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const sessionUser = session.data;
  const canView = hasPermission(sessionUser?.permissions, 'pedidos', 'view_history');

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  params.set('includeClosed', 'true');
  if (status) params.set('status', status);
  if (billing) params.set('billingStatus', billing);
  if (q.trim()) params.set('q', q.trim());

  const historyQuery = useQuery<OrderListResponse>({
    queryKey: ['orders-history', page, status, billing, q],
    queryFn: () => apiFetch<OrderListResponse>(`/orders/history?${params.toString()}`),
    enabled: Boolean(sessionUser) && canView,
    staleTime: 30_000,
    retry: 1,
  });

  const data = historyQuery.data;

  const columns = useMemo<Column<OrderSummary>[]>(
    () => [
      {
        key: 'pedido',
        header: 'Pedido',
        kind: 'id',
        render: (row) => (
          <a
            href={`/pedidos/${row.id}`}
            className="font-bold tabular-nums text-primary underline decoration-dotted underline-offset-2"
          >
            {row.externalNumber}
          </a>
        ),
      },
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'field',
        render: (row) => (
          <span className="block max-w-[20rem] truncate" title={row.customerName ?? ''}>
            <span className="font-semibold text-primary">{row.customerName ?? '—'}</span>
            <span className="block text-label-sm text-on-surface-variant">{row.customerCode ?? '—'}</span>
          </span>
        ),
      },
      {
        key: 'emision',
        header: 'Emisión',
        kind: 'field',
        render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtDate(row.orderDate)}</span>,
      },
      {
        key: 'cierre',
        header: 'Cierre',
        kind: 'field',
        render: (row) => (
          <span className="tabular-nums text-on-surface-variant">{fmtDate(row.closedAt ?? null)}</span>
        ),
      },
      {
        key: 'vendedor',
        header: 'Vendedor',
        kind: 'field',
        render: (row) => (
          <span className="block max-w-[14rem] truncate text-on-surface-variant" title={row.vendor ?? ''}>
            {row.vendor ?? '—'}
          </span>
        ),
      },
      {
        key: 'kg',
        header: 'Kg',
        align: 'right',
        kind: 'metric',
        render: (row) => (
          <span className="font-bold tabular-nums text-primary">{fmtTonnes(row.totalKg ?? 0)}</span>
        ),
      },
      {
        key: 'unidades',
        header: 'Unid.',
        align: 'right',
        kind: 'metric',
        render: (row) => (
          <span className="tabular-nums text-on-surface-variant">{fmtQty(row.totalPendingQty, 0)}</span>
        ),
      },
      {
        key: 'estado',
        header: 'Estado',
        kind: 'status',
        render: (row) => (
          <Badge tone={STATUS_TONE[row.status]} dot>
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        key: 'facturacion',
        header: 'Facturación',
        kind: 'status',
        render: (row) => {
          const value = row.billingStatus ?? 'PENDIENTE';
          return (
            <Badge tone={billingTone(value)} dot>
              {BILLING_LABEL[value]}
            </Badge>
          );
        },
      },
      {
        key: 'accion',
        header: '',
        kind: 'action',
        align: 'right',
        render: (row) => (
          <a
            href={`/pedidos/${row.id}`}
            className="inline-flex items-center gap-space-2xs rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
          >
            Ver
          </a>
        ),
      },
    ],
    [],
  );

  async function exportAll() {
    if (!data) return;
    setExporting(true);
    try {
      const rows: OrderSummary[] = [];
      let current = 1;
      let total = Infinity;
      while (rows.length < total && current <= 60) {
        const exportParams = new URLSearchParams(params);
        exportParams.set('page', String(current));
        exportParams.set('pageSize', '200');
        const chunk = await apiFetch<OrderListResponse>(`/orders/history?${exportParams.toString()}`);
        rows.push(...chunk.items);
        total = chunk.total;
        if (chunk.items.length === 0) break;
        current += 1;
      }
      const header = ['Pedido', 'Cliente', 'Código', 'Emisión', 'Cierre', 'Vendedor', 'Kg', 'Unidades', 'Estado', 'Facturación'];
      const body = rows.map((row) => [
        row.externalNumber,
        row.customerName ?? '',
        row.customerCode ?? '',
        row.orderDate ?? '',
        row.closedAt ?? '',
        row.vendor ?? '',
        row.totalKg ?? 0,
        row.totalPendingQty,
        STATUS_LABEL[row.status],
        BILLING_LABEL[row.billingStatus ?? 'PENDIENTE'],
      ]);
      const csv = [header, ...body]
        .map((line) =>
          line
            .map((cell) => {
              const value = String(cell ?? '');
              return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
            })
            .join(';'),
        )
        .join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'pedidos-historial.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (session.isLoading) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-72" />
          <Skeleton className="h-40 w-full" />
        </main>
      </>
    );
  }

  if (!sessionUser) {
    return <LoginScreen onSuccess={() => void session.refetch()} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Pedidos procesados"
          icon={History}
          greeting={greeting}
          title="Historial de pedidos"
          subtitle="Todo lo que pasó por Pedidos: abiertos, procesados por nota de entrega y cancelados. Aquí sí aparecen los pedidos facturados que el simulador oculta."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Badge tone="muted" dot>
                {data ? `${data.total} pedidos` : 'Cargando'}
              </Badge>
              <button
                type="button"
                onClick={() => void historyQuery.refetch()}
                disabled={historyQuery.isFetching}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                <RefreshCw aria-hidden className={`size-4 ${historyQuery.isFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          }
        />

        <PedidosTabs active="historial" permissions={sessionUser.permissions} />

        {!canView ? (
          <PedidosDenied title="No tienes acceso al Historial" allowedHref="/pedidos" />
        ) : (
          <>
            <Card className="p-space-md">
              <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12 lg:items-end">
                <div className="lg:col-span-4">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Estado del pedido
                  </label>
                  <Segmented
                    ariaLabel="Estado del pedido"
                    value={status}
                    onChange={(value) => {
                      setStatus(value);
                      setPage(1);
                    }}
                    options={[...STATUS_OPTIONS]}
                  />
                </div>
                <div className="lg:col-span-3">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Facturación
                  </label>
                  <Select
                    ariaLabel="Filtrar por facturación"
                    value={billing}
                    options={BILLING_OPTIONS}
                    onChange={(value) => {
                      setBilling(value as '' | OrderBillingStatus);
                      setPage(1);
                    }}
                  />
                </div>
                <div className="lg:col-span-3">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Buscar
                  </label>
                  <TextInput
                    icon={Search}
                    value={q}
                    onChange={(value) => {
                      setQ(value);
                      setPage(1);
                    }}
                    placeholder="N° de pedido o cliente…"
                    ariaLabel="Buscar pedido"
                  />
                </div>
                <div className="flex items-center justify-end lg:col-span-2">
                  <button
                    type="button"
                    onClick={() => void exportAll()}
                    disabled={exporting || !data}
                    className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
                  >
                    <FileSpreadsheet aria-hidden className="size-4" />
                    {exporting ? 'Exportando…' : 'Exportar'}
                  </button>
                </div>
              </div>
            </Card>

            <section className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label="Pedidos en el filtro"
                value={data ? String(data.total) : '—'}
                hint={`${data?.summary.linesTotal ?? 0} renglones`}
                icon={ShoppingCart}
              />
              <Kpi
                label="Kg del filtro"
                value={fmtTonnes(data?.summary.totalKg ?? 0, 1)}
                hint={`${fmtQty(data?.summary.totalPendingQty ?? 0, 0)} unidades`}
                icon={PackageCheck}
              />
              <Kpi
                label="Procesados"
                value={status === 'NOTA_ENTREGA' && data ? String(data.total) : '—'}
                hint="cerrados por nota de entrega"
                tone="success"
                icon={Receipt}
              />
              <Kpi
                label="Abiertos"
                value={data ? String(data.summary.openCount) : '—'}
                hint="siguen en la cartera del simulador"
                tone="warning"
                icon={History}
              />
            </section>

            {historyQuery.error && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" />
                {historyQuery.error instanceof Error
                  ? historyQuery.error.message
                  : 'No se pudo cargar el historial'}
              </p>
            )}

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                <div>
                  <p className="text-title-md font-semibold text-primary">Pedidos procesados</p>
                  <p className="text-label-sm text-on-surface-variant">
                    «Facturado asumido» es la regla del cierre por nota de entrega; la factura real vive en CxC.
                  </p>
                </div>
                <Badge tone="muted" dot>
                  {data ? `página ${data.page} de ${totalPages}` : '—'}
                </Badge>
              </div>
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(row) => row.id}
                sortable={false}
                loading={historyQuery.isLoading}
                empty={
                  <EmptyState
                    icon={History}
                    title={q ? `Sin pedidos para “${q}”` : 'Sin pedidos en este filtro'}
                    description="Prueba con «Todos» o cambia el estado de facturación."
                  />
                }
              />
              {data && data.total > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 px-space-md py-space-sm text-body-md text-on-surface-variant">
                  <span>
                    {data.total} pedidos · página {data.page} de {totalPages}
                  </span>
                  <div className="flex items-center gap-space-sm">
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={page <= 1}
                      className="flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold transition-colors hover:bg-surface-container-low disabled:opacity-40"
                    >
                      <ChevronLeft aria-hidden className="size-4" /> Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                      disabled={page >= totalPages}
                      className="flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold transition-colors hover:bg-surface-container-low disabled:opacity-40"
                    >
                      Siguiente <ChevronRight aria-hidden className="size-4" />
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}

'use client';

// ============================================================
// Detalle de pedido — renglones sincronizados desde Profit con
// pendiente, kg y existencia por almacén (Stock 03 / Stock 68).
//
//  Presentación: PageHeader + tira de KPIs + `DataTable` (tabla densa en
//  ≥md, tarjeta por renglón en teléfono). Contrato:
//  docs/design/DESIGN_SYSTEM.md — solo lectura, no escribe en Profit.
// ============================================================

import type { OrderDetail, OrderLine, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, PackageSearch } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../../components/shell';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorNote,
  Kpi,
  PageHeader,
  cx,
  fmtDate,
  fmtInt,
  fmtQty,
  type Column,
} from '../../../components/ui';
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

// Cantidades: enteras sin decimales; con decimales reales, dos cifras.
function fmtUnits(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? fmtInt(value) : fmtQty(value, 2);
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

  const columns: Column<OrderLine>[] = [
    {
      key: 'productCode',
      header: 'Código',
      kind: 'id',
      render: (l) => l.productCode,
      sortValue: (l) => l.productCode,
    },
    {
      key: 'description',
      header: 'Descripción',
      kind: 'id',
      className: 'max-w-[30rem]',
      render: (l) => l.description ?? '—',
      title: (l) => l.description ?? undefined,
    },
    {
      key: 'lineNumber',
      header: 'Renglón',
      kind: 'field',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.lineNumber)}</span>,
      sortValue: (l) => l.lineNumber,
    },
    {
      key: 'uom',
      header: 'Unidad',
      kind: 'field',
      render: (l) => l.uom ?? '—',
      sortValue: (l) => l.uom ?? '',
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      kind: 'metric',
      align: 'right',
      render: (l) => <span className="tabular-nums text-on-surface-variant">{fmtUnits(l.quantity)}</span>,
      sortValue: (l) => l.quantity ?? 0,
    },
    {
      key: 'pendingQty',
      header: 'Pendiente',
      kind: 'metric',
      align: 'right',
      render: (l) => (
        <span className={cx('font-bold tabular-nums', l.pendingQty < 0 ? 'text-critical' : 'text-on-surface')}>{fmtUnits(l.pendingQty)}</span>
      ),
      sortValue: (l) => l.pendingQty,
    },
    {
      key: 'pendingKg',
      header: 'Kg pendiente',
      kind: 'metric',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.pendingKg)}</span>,
      sortValue: (l) => l.pendingKg ?? 0,
    },
    {
      key: 'warehouseCode',
      header: 'Almacén',
      kind: 'detail',
      render: (l) => <span className="tabular-nums text-on-surface-variant">{l.warehouseCode ?? '—'}</span>,
    },
    {
      key: 'stock03',
      header: 'Stock 03',
      kind: 'detail',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.stock03)}</span>,
      sortValue: (l) => l.stock03 ?? 0,
    },
    {
      key: 'stock68',
      header: 'Stock 68',
      kind: 'detail',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.stock68)}</span>,
      sortValue: (l) => l.stock68 ?? 0,
    },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-xl">
        <Link
          href="/pedidos"
          className="inline-flex h-11 w-fit items-center gap-space-sm rounded-lg px-space-sm font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low hover:text-primary md:h-9"
        >
          <ArrowLeft aria-hidden className="size-4" /> Volver a la cola de pedidos
        </Link>

        {isLoading && (
          <Card className="overflow-hidden">
            <DataTable columns={[]} rows={[]} rowKey={() => ''} loading loadingRows={6} />
          </Card>
        )}

        {error && !(error instanceof AuthRequiredError) && (
          <ErrorNote>
            {error instanceof Error
              ? error.message
              : 'No se pudo consultar el pedido. Revisa la conexión con el API e inténtalo de nuevo.'}
          </ErrorNote>
        )}

        {order && data && (
          <>
            <PageHeader
              icon={FileText}
              title={`Pedido ${order.externalNumber}`}
              subtitle={`${order.customerName ?? 'Cliente desconocido'}${order.customerCode ? ` (${order.customerCode})` : ''} · Vendedor ${
                order.vendor ?? '—'
              } · Tipo de cliente ${order.customerType ?? '—'}`}
              actions={<Badge tone={STATUS_TONE[order.status]} dot>{STATUS_LABEL[order.status]}</Badge>}
            />

            <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
              <Kpi label="Renglones" value={fmtInt(order.linesCount)} tone="muted" icon={PackageSearch} />
              <Kpi
                label="Pendiente total"
                value={fmtUnits(order.totalPendingQty)}
                suffix="unid."
                tone={order.totalPendingQty < 0 ? 'danger' : 'primary'}
              />
              <Kpi label="Emisión" value={fmtDate(order.orderDate)} tone="default" />
              <Kpi label="Entrega comprometida" value={fmtDate(order.requestedDate)} tone="default" />
            </div>

            <Card className="overflow-hidden">
              <CardHeader
                title="Renglones del pedido"
                description="Pendiente, kilogramos y existencia por almacén (Stock 03 / Stock 68) tal como los expone Profit."
                action={<Badge tone="muted">{fmtInt(data.lines.length)} renglones</Badge>}
              />
              <DataTable
                columns={columns}
                rows={data.lines}
                rowKey={(l) => String(l.lineNumber)}
                defaultSortKey="lineNumber"
                empty={
                  <EmptyState
                    icon={PackageSearch}
                    title="El pedido no tiene renglones sincronizados"
                    description="Ejecuta «Sincronizar» en la barra superior para traer los renglones desde Profit."
                  />
                }
              />
              <div className="border-t border-surface-container px-space-lg py-space-sm text-label-sm text-on-surface-variant">
                Valores crudos de Profit (cotización + renglones). «Autorizado» = cotización con estado 1. Un pendiente negativo es un
                sobre-compromiso real del ERP. Cualquier «—» significa que la fuente no expone el dato.
              </div>
            </Card>
          </>
        )}
      </main>
    </>
  );
}

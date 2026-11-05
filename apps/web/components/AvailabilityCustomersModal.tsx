'use client';

// ============================================================
// Desglose por cliente del solicitado de un producto.
//
// Se abre con doble clic en una fila de Disponibilidad. Reutiliza el lenguaje
// visual de la Ficha 360 de Clientes: cabecera, KPIs y tabla ordenable.
// Es solo lectura: los datos salen de los pedidos activos ya sincronizados.
// ============================================================

import type { AvailabilityCustomer, AvailabilityProductCustomers, AvailabilityRow } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Boxes, Package, RefreshCw, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import type { Column } from './ui';
import {
  Badge,
  DataTable,
  EmptyState,
  Skeleton,
  cx,
  fmtQty,
} from './ui';

const TONE_TEXT: Record<'primary' | 'success' | 'warning' | 'danger', string> = {
  primary: 'text-primary',
  success: 'text-secondary',
  warning: 'text-warning',
  danger: 'text-error',
};

function MetricCard({
  label,
  value,
  hint,
  tone = 'primary',
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_TEXT;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-space-md">
      <div className="flex items-start justify-between gap-space-sm">
        <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">{label}</span>
        {Icon && (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-fixed/70 text-primary">
            <Icon aria-hidden className="size-4" />
          </span>
        )}
      </div>
      <p className={cx('mt-space-xs text-title-md font-black tabular-nums', TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="mt-space-2xs text-label-sm normal-case text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export function AvailabilityCustomersModal({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: AvailabilityRow | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const code = product?.productCode ?? '';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const { data, error, isPending, isFetching, refetch } = useQuery<AvailabilityProductCustomers>({
    queryKey: ['availability-customers', code],
    queryFn: () => apiFetch<AvailabilityProductCustomers>(`/availability/${encodeURIComponent(code)}/customers`),
    enabled: open && product !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const columns = useMemo<Column<AvailabilityCustomer>[]>(
    () => [
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'id',
        sortValue: (customer) => customer.customerName,
        render: (customer) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-bold tabular-nums text-primary">{customer.customerCode}</span>
            <span className="max-w-[20rem] truncate text-label-sm font-normal text-on-surface-variant" title={customer.customerName}>
              {customer.customerName}
            </span>
          </span>
        ),
      },
      {
        key: 'pedidos',
        header: 'Pedidos',
        align: 'right',
        sortValue: (customer) => customer.ordersCount,
        render: (customer) => <span className="tabular-nums text-on-surface-variant">{customer.ordersCount}</span>,
      },
      {
        key: 'sacos',
        header: 'Sacos',
        align: 'right',
        kind: 'metric',
        sortValue: (customer) => customer.sacks,
        render: (customer) => <span className="font-semibold tabular-nums">{fmtQty(customer.sacks, 0)}</span>,
      },
      {
        key: 'kg',
        header: 'Kilogramos',
        align: 'right',
        kind: 'metric',
        sortValue: (customer) => customer.kg,
        render: (customer) => <span className="font-bold tabular-nums text-primary">{fmtQty(customer.kg, 0)}</span>,
      },
      {
        key: 'share',
        header: '% del total',
        align: 'right',
        kind: 'metric',
        sortValue: (customer) => customer.sharePct,
        render: (customer) => (
          <span className="inline-flex flex-col items-end gap-1">
            <span className="font-bold tabular-nums text-primary">{fmtQty(customer.sharePct, 1)}%</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-pill bg-surface-container">
              <span
                className="block h-full rounded-pill bg-primary-container"
                style={{ width: `${Math.max(0, Math.min(100, customer.sharePct))}%` }}
              />
            </span>
          </span>
        ),
      },
    ],
    [],
  );

  if (!open || !product) return null;

  const message =
    error instanceof AuthRequiredError
      ? 'Tu sesión expiró. Cierra la ventana y vuelve a iniciar sesión.'
      : error instanceof Error
        ? error.message
        : 'No se pudo consultar el desglose por cliente.';

  const description = data?.description ?? product.description;
  const uom = data?.uom ?? product.uom;
  const totalCustomers = data?.customers.length ?? 0;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="availability-customers-title"
        className="animate-rise flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:max-h-[94vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <Users aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Disponibilidad · Clientes del producto
              </p>
              <h2 id="availability-customers-title" className="truncate text-title-md text-primary" title={description}>
                {description}
              </h2>
              <p className="truncate text-label-md normal-case text-on-surface-variant">
                {product.productCode} · unidad de venta {uom}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-space-xs">
            <span className="hidden sm:inline-flex">
              <Badge tone={data ? 'success' : error ? 'danger' : 'muted'} dot>
                {data ? 'Pedidos activos' : error ? 'Sin conexión' : 'Consultando'}
              </Badge>
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Actualizar desglose"
              title="Actualizar desglose"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <RefreshCw aria-hidden className={cx('size-4', isFetching && 'animate-spin')} />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar desglose"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-space-md overflow-y-auto p-space-md sm:p-space-lg">
          {error && !data && (
            <div className="flex flex-col items-center gap-space-sm rounded-xl border border-critical/40 bg-critical-container/30 p-space-lg text-center">
              <AlertTriangle aria-hidden className="size-6 text-error" />
              <p className="font-semibold text-title-md text-on-surface">No se pudo consultar el desglose</p>
              <p className="max-w-md text-body-md text-on-surface-variant">{message}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-space-xs flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
              >
                <RefreshCw aria-hidden className="size-4" /> Reintentar
              </button>
            </div>
          )}

          {error && data && (
            <p role="alert" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              No se pudo actualizar: {message}
            </p>
          )}

          {isPending && !data ? (
            <div className="flex flex-col gap-space-md" aria-hidden>
              <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
              </div>
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : data ? (
            <>
              <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Solicitado"
                  value={`${fmtQty(data.demandQty, 0)} ${data.uom}`}
                  hint="Pendiente de pedidos activos"
                  tone="primary"
                  icon={Boxes}
                />
                <MetricCard
                  label="Clientes"
                  value={String(totalCustomers)}
                  hint={totalCustomers === 1 ? 'cliente con pedido' : 'clientes con pedido'}
                  tone="primary"
                  icon={Users}
                />
                <MetricCard
                  label="Sacos"
                  value={fmtQty(data.totalSacks, 0)}
                  hint={data.kgPerUom !== null ? `Empaque de ${fmtQty(data.kgPerUom, 0)} kg` : 'Sin empaque declarado'}
                  tone="success"
                  icon={Package}
                />
                <MetricCard
                  label="Kilogramos"
                  value={fmtQty(data.totalKg, 0)}
                  hint={`Existencia actual: ${fmtQty(data.stockTotal, 0)} ${data.uom}`}
                  tone="warning"
                  icon={Package}
                />
              </div>

              <div className="overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
                <DataTable
                  columns={columns}
                  rows={data.customers}
                  rowKey={(customer) => customer.customerCode}
                  sortable
                  sticky={false}
                  maxHeightClass="md:max-h-[min(50vh,560px)]"
                  empty={
                    <EmptyState
                      icon={Users}
                      title="Sin solicitado por cliente"
                      description="Este producto no tiene pedidos activos con pendiente en este momento."
                    />
                  }
                />
              </div>

              <p className="text-label-sm normal-case text-on-surface-variant">
                El % se calcula sobre el 100 % de lo solicitado de este producto. Los kilogramos son el equivalente real
                del pendiente; los sacos usan el empaque declarado del artículo.
              </p>
            </>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <span className="text-label-sm normal-case text-on-surface-variant">
            {data
              ? `${data.productCode} · ${data.customers.length} cliente(s) · solo lectura desde Profit`
              : error
                ? 'No se pudo consultar'
                : 'Consultando desglose…'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}

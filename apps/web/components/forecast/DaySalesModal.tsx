'use client';

// ============================================================
// Modal «Desglose del día» (Ventas vs Forecast).
//
// Se abre al hacer clic en una barra de «Ventas por día» (o en un punto del
// acumulado). Muestra el día en dos pestañas:
//   · Productos: kg, sacos y % del día; al expandir, los clientes del producto.
//   · Clientes:  kg, sacos y % del día; al expandir, los productos de cada
//     cliente con su presentación (sacos) y kg.
//
// El detalle se pide a `/forecast/sales/day` solo al abrir el modal. Mientras
// llega, la pestaña de productos usa el desglose que ya trae el informe.
// ============================================================

import type {
  ForecastSalesDayCustomer,
  ForecastSalesDayDetail,
  ForecastSalesDayDetailProduct,
  ForecastSalesResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  PackageSearch,
  RotateCw,
  Users,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import {
  clientsForProduct,
  fmtKg,
  fmtPct,
  productsForDay,
  sharePct,
  type SalesDayBar,
} from '../../lib/sales-report';
import { Badge, Segmented, Skeleton, TextInput, cx } from '../ui';

type DayTab = 'product' | 'customer';

function longDayLabel(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  const year = Number(date.slice(0, 4));
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
      <p className="tabular-nums text-title-md font-black text-on-surface">{value}</p>
      {hint && <p className="truncate text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function ShareBar({ pct, strong = false }: { pct: number | null; strong?: boolean }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-pill bg-surface-container-high">
        <div
          className={cx(
            'h-full rounded-pill transition-[width] duration-700 ease-out',
            strong ? 'bg-secondary' : 'bg-primary-container',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-label-sm font-semibold tabular-nums text-on-surface-variant">
        {fmtPct(pct)}
      </span>
    </div>
  );
}

/**
 * Sacos de un cliente: suma solo las líneas SAC con presentación conocida.
 * Null si compró únicamente granel, para no pintar un 0 engañoso.
 */
function customerSacks(customer: ForecastSalesDayCustomer): number | null {
  let total = 0;
  let hasSacks = false;
  for (const product of customer.products) {
    if (product.sacks === null) continue;
    total += product.sacks;
    hasSacks = true;
  }
  return hasSacks ? Math.round(total * 10) / 10 : null;
}

export function DaySalesModal({
  date,
  bar,
  report,
  goalKg,
  onClose,
}: {
  date: string;
  bar: SalesDayBar;
  report: ForecastSalesResponse;
  /** Meta uniforme por día del forecast; null si el mes no tiene meta. */
  goalKg: number | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DayTab>('product');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const detail = useQuery<ForecastSalesDayDetail, Error>({
    queryKey: ['forecast-sales-day', date],
    queryFn: () => apiFetch<ForecastSalesDayDetail>(`/forecast/sales/day?date=${encodeURIComponent(date)}`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (count) => count < 2,
  });

  // Escape cierra, el fondo no scrollea y el foco entra al modal.
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  // Mientras el API responde, los productos ya están en el informe mensual.
  const fallbackProducts = useMemo<ForecastSalesDayDetailProduct[]>(
    () =>
      productsForDay(report, date).map((line) => {
        const row = report.rows.find((entry) => entry.productCode === line.productCode);
        return {
          productCode: line.productCode,
          description: line.description,
          uom: line.uom,
          kgPerUom: row?.kgPerUom ?? null,
          kg: line.kg,
          units: line.units,
          sacks: line.sacks,
          sharePct: sharePct(line.kg, bar.kg),
        };
      }),
    [bar.kg, date, report],
  );

  const unavailable = Boolean(detail.data && !detail.data.available);
  const products = detail.data?.available ? detail.data.products : fallbackProducts;
  const customers = detail.data?.available ? detail.data.customers : [];
  const totalKg = detail.data?.available ? detail.data.kg : bar.kg;
  const totalSacks = products.reduce((acc, product) => acc + (product.sacks ?? 0), 0);
  const hasSacks = products.some((product) => product.sacks !== null);
  const loadingProducts = detail.isLoading && products.length === 0;
  const loadingCustomers = detail.isLoading;

  const goal = goalKg !== null && goalKg > 0 ? goalKg : null;
  const goalPct = goal !== null ? (totalKg / goal) * 100 : null;
  const goalReached = goalPct !== null && goalPct >= 100;

  const visibleCustomers = useMemo(() => {
    const needle = customerSearch.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter(
      (customer) =>
        customer.customerCode.toLowerCase().includes(needle) ||
        customer.customerName.toLowerCase().includes(needle),
    );
  }, [customerSearch, customers]);

  const productClients = useMemo(() => {
    const map = new Map<string, ReturnType<typeof clientsForProduct>>();
    if (!expandedProduct) return map;
    map.set(expandedProduct, clientsForProduct(customers, expandedProduct));
    return map;
  }, [customers, expandedProduct]);

  const errorMessage = detail.error
    ? detail.error.message
    : unavailable
      ? 'Profit no devolvió el desglose de este día.'
      : null;

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
        aria-labelledby="day-sales-title"
        className="animate-rise flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:max-h-[94vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <CalendarDays aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Ventas del día · Desglose
              </p>
              <h2 id="day-sales-title" className="truncate text-title-md font-bold text-primary">
                {longDayLabel(date)}
              </h2>
              <p className="flex flex-wrap items-center gap-2 text-label-md text-on-surface-variant">
                <span className="tabular-nums">
                  {fmtKg(totalKg)} kg · {fmtKg(bar.invoices)} notas
                </span>
                {bar.partial && (
                  <Badge tone="warning" dot>
                    En curso
                  </Badge>
                )}
                {bar.isToday && !bar.partial && <Badge tone="primary">Hoy</Badge>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-space-xs">
            {errorMessage && (
              <span className="hidden sm:inline-flex">
                <Badge tone="danger" dot>
                  Sin detalle
                </Badge>
              </span>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar desglose del día"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-space-sm overflow-y-auto overscroll-contain px-space-md py-space-sm sm:px-space-lg">
          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <Stat
              label="Vendido"
              value={`${fmtKg(totalKg)} kg`}
              hint={bar.partial ? 'día en curso' : 'día completo'}
            />
            <Stat label="Notas" value={fmtKg(bar.invoices)} hint="notas de entrega" />
            <Stat
              label="Sacos"
              value={hasSacks ? fmtKg(totalSacks, 1) : '—'}
              hint={hasSacks ? 'solo artículos SAC' : 'sin artículos SAC'}
            />
            <Stat
              label="Clientes"
              value={loadingCustomers || (errorMessage && customers.length === 0) ? '—' : fmtKg(customers.length)}
              hint={
                loadingCustomers
                  ? 'consultando…'
                  : errorMessage && customers.length === 0
                    ? 'sin detalle'
                    : 'con despachos'
              }
            />
          </div>

          {goal !== null && (
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/50 px-space-sm py-space-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">Meta diaria</p>
                <p className="text-label-md tabular-nums text-on-surface-variant">
                  {fmtKg(totalKg)} de {fmtKg(goal)} kg
                </p>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-container-high">
                  <div
                    className={cx(
                      'h-full rounded-pill transition-[width] duration-700 ease-out',
                      goalReached ? 'bg-secondary' : 'bg-primary-container',
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, goalPct ?? 0))}%` }}
                  />
                </div>
                <span
                  className={cx(
                    'shrink-0 text-label-md font-bold tabular-nums',
                    goalReached ? 'text-success' : 'text-primary',
                  )}
                >
                  {fmtPct(goalPct)}
                </span>
              </div>
              <p className="mt-1 text-label-sm text-outline">
                {goalReached
                  ? `Meta superada por ${fmtKg(totalKg - goal)} kg`
                  : `Faltan ${fmtKg(Math.max(0, goal - totalKg))} kg para la meta`}
                {' · meta uniforme por día hábil (lun–sáb)'}
              </p>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-sm py-space-xs text-label-md text-on-warning-container"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">No se pudo leer el desglose completo.</p>
                <p className="text-on-warning-container/80">
                  {errorMessage}
                  {products.length > 0 && ' Los productos se muestran desde el informe mensual.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void detail.refetch()}
                className="inline-flex h-7 items-center gap-1 rounded-pill border border-warning/50 bg-white/60 px-space-sm text-label-sm font-bold text-on-warning-container transition-colors hover:bg-white disabled:opacity-60"
                disabled={detail.isFetching}
              >
                <RotateCw aria-hidden className={cx('size-3.5', detail.isFetching && 'animate-spin')} /> Reintentar
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container pb-space-xs">
            <Segmented<DayTab>
              ariaLabel="Ver el desglose por"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'product', label: 'Por producto' },
                { value: 'customer', label: 'Por cliente' },
              ]}
            />
            {tab === 'customer' && customers.length > 0 && (
              <TextInput
                icon={PackageSearch}
                value={customerSearch}
                onChange={setCustomerSearch}
                placeholder="Buscar cliente…"
                ariaLabel="Buscar cliente del día"
                className="min-w-[11rem] flex-1 sm:max-w-xs"
              />
            )}
          </div>

          {tab === 'product' ? (
            loadingProducts ? (
              <div className="flex flex-col gap-2 py-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center gap-space-xs rounded-xl border border-dashed border-outline-variant/50 px-space-md py-space-lg text-center">
                <PackageSearch aria-hidden className="size-6 text-outline" />
                <p className="text-title-sm font-semibold text-on-surface">
                  {errorMessage ? 'No se pudo consultar el desglose' : 'Este día no tiene productos'}
                </p>
                <p className="text-label-md text-on-surface-variant">
                  {errorMessage
                    ? 'Profit no respondió. Reintenta o elige otro día.'
                    : 'No hay despachos registrados para la fecha.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-label-md">
                  <caption className="sr-only">Desglose por producto del día</caption>
                  <thead>
                    <tr className="text-label-sm uppercase tracking-[0.1em] text-outline">
                      <th scope="col" className="py-1 text-left font-semibold">
                        Producto
                      </th>
                      <th scope="col" className="w-20 py-1 text-right font-semibold">
                        Kg
                      </th>
                      <th scope="col" className="w-20 py-1 text-right font-semibold">
                        Sacos
                      </th>
                      <th scope="col" className="w-[34%] py-1 pl-3 text-left font-semibold">
                        % del día
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const open = expandedProduct === product.productCode;
                      const clients = open ? productClients.get(product.productCode) ?? [] : [];
                      return (
                        <Fragment key={product.productCode}>
                          <tr className="border-t border-surface-container/70 align-top">
                            <td className="py-1.5 pr-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedProduct((current) =>
                                    current === product.productCode ? null : product.productCode,
                                  )
                                }
                                aria-expanded={open}
                                className="flex w-full items-start gap-1.5 text-left"
                              >
                                <ChevronDown
                                  aria-hidden
                                  className={cx(
                                    'mt-0.5 size-3.5 shrink-0 text-outline transition-transform',
                                    open && 'rotate-180',
                                  )}
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-on-surface" title={product.description}>
                                    {product.description}
                                  </span>
                                  <span className="text-label-sm text-outline">
                                    {product.productCode}
                                    {product.uom ? ` · ${product.uom}` : ''}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-on-surface">{fmtKg(product.kg)}</td>
                            <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                              {product.sacks === null ? '—' : fmtKg(product.sacks, 1)}
                            </td>
                            <td className="py-1.5 pl-3">
                              <ShareBar pct={product.sharePct} />
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-surface-container-low/45">
                              <td colSpan={4} className="px-3 py-2">
                                <p className="mb-1 text-label-sm font-semibold uppercase tracking-wide text-outline">
                                  Clientes que compraron este producto
                                </p>
                                {clients.length === 0 ? (
                                  <p className="text-label-md text-on-surface-variant">Sin detalle por cliente.</p>
                                ) : (
                                  <ul className="flex flex-col gap-1">
                                    {clients.map((client) => (
                                      <li
                                        key={client.customerCode}
                                        className="flex items-center justify-between gap-3 text-label-md"
                                      >
                                        <span className="min-w-0 truncate text-on-surface">
                                          {client.customerName}
                                          {client.customerCode !== '__sin_cliente__' && (
                                            <span className="text-outline"> · {client.customerCode}</span>
                                          )}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-on-surface-variant">
                                          {fmtKg(client.kg)} kg · <strong className="text-on-surface">{fmtPct(client.sharePct)}</strong>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-outline-variant/40 text-label-md font-semibold">
                      <td className="py-1.5 text-on-surface">Total del día</td>
                      <td className="py-1.5 text-right tabular-nums text-on-surface">{fmtKg(totalKg)}</td>
                      <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                        {hasSacks ? fmtKg(totalSacks, 1) : '—'}
                      </td>
                      <td className="py-1.5 pl-3 text-label-sm text-outline">
                        {detail.data?.truncated ? 'Datos truncados' : '100 % de la venta del día'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : loadingCustomers ? (
            <div className="flex flex-col gap-2 py-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : errorMessage && customers.length === 0 ? (
            <div className="flex flex-col items-center gap-space-xs rounded-xl border border-dashed border-outline-variant/50 px-space-md py-space-lg text-center">
              <Users aria-hidden className="size-6 text-outline" />
              <p className="text-title-sm font-semibold text-on-surface">No se pudo consultar por cliente</p>
              <p className="text-label-md text-on-surface-variant">
                Profit no devolvió el desglose de clientes de este día.
              </p>
              <button
                type="button"
                onClick={() => void detail.refetch()}
                disabled={detail.isFetching}
                className="mt-1 inline-flex h-8 items-center gap-1 rounded-lg bg-primary-container px-space-sm text-label-md font-semibold text-on-primary disabled:opacity-60"
              >
                <RotateCw aria-hidden className={cx('size-3.5', detail.isFetching && 'animate-spin')} /> Reintentar
              </button>
            </div>
          ) : visibleCustomers.length === 0 ? (
            <div className="flex flex-col items-center gap-space-xs rounded-xl border border-dashed border-outline-variant/50 px-space-md py-space-lg text-center">
              <Users aria-hidden className="size-6 text-outline" />
              <p className="text-title-sm font-semibold text-on-surface">
                {customers.length === 0 ? 'Sin clientes este día' : 'Ningún cliente coincide'}
              </p>
              <p className="text-label-md text-on-surface-variant">
                {customers.length === 0
                  ? 'No hay notas de entrega con cliente para la fecha.'
                  : 'Prueba con otro nombre o código de cliente.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-label-md">
                <caption className="sr-only">Desglose por cliente del día</caption>
                <thead>
                  <tr className="text-label-sm uppercase tracking-[0.1em] text-outline">
                    <th scope="col" className="py-1 text-left font-semibold">
                      Cliente
                    </th>
                    <th scope="col" className="w-20 py-1 text-right font-semibold">
                      Kg
                    </th>
                    <th scope="col" className="w-20 py-1 text-right font-semibold" title="solo artículos SAC">
                      Sacos
                    </th>
                    <th scope="col" className="w-24 py-1 text-right font-semibold">
                      Productos
                    </th>
                    <th scope="col" className="w-[34%] py-1 pl-3 text-left font-semibold">
                      % del día
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((customer) => {
                    const open = expandedCustomer === customer.customerCode;
                    const sacks = customerSacks(customer);
                    return (
                      <Fragment key={customer.customerCode}>
                        <tr className="border-t border-surface-container/70 align-top">
                          <td className="py-1.5 pr-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCustomer((current) =>
                                  current === customer.customerCode ? null : customer.customerCode,
                                )
                              }
                              aria-expanded={open}
                              className="flex w-full items-start gap-1.5 text-left"
                            >
                              <ChevronDown
                                aria-hidden
                                className={cx(
                                  'mt-0.5 size-3.5 shrink-0 text-outline transition-transform',
                                  open && 'rotate-180',
                                )}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-on-surface" title={customer.customerName}>
                                  {customer.customerName}
                                </span>
                                <span className="text-label-sm text-outline">
                                  {customer.customerCode === '__sin_cliente__'
                                    ? 'notas sin cliente asignado'
                                    : customer.customerCode}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface">{fmtKg(customer.kg)}</td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                            {sacks === null ? '—' : fmtKg(sacks, 1)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                            {fmtKg(customer.products.length)}
                          </td>
                          <td className="py-1.5 pl-3">
                            <ShareBar pct={customer.sharePct} strong />
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-surface-container-low/45">
                            <td colSpan={5} className="px-3 py-2">
                              <p className="mb-1 text-label-sm font-semibold uppercase tracking-wide text-outline">
                                Productos de este cliente
                              </p>
                              {customer.products.length === 0 ? (
                                <p className="text-label-md text-on-surface-variant">Sin detalle por producto.</p>
                              ) : (
                                <ul className="flex flex-col gap-1">
                                  {customer.products.map((product) => (
                                    <li
                                      key={product.productCode}
                                      className="flex items-center justify-between gap-3 text-label-md"
                                    >
                                      <span className="min-w-0 truncate text-on-surface">
                                        {product.description}
                                        <span className="text-outline">
                                          {' '}
                                          · {product.productCode}
                                          {product.uom ? ` · ${product.uom}` : ''}
                                        </span>
                                      </span>
                                      <span className="shrink-0 tabular-nums text-on-surface-variant">
                                        {product.sacks !== null && (
                                          <>
                                            <strong className="text-on-surface">
                                              {fmtKg(product.sacks, 1)}
                                            </strong>{' '}
                                            sacos ·{' '}
                                          </>
                                        )}
                                        {fmtKg(product.kg)} kg ·{' '}
                                        <strong className="text-on-surface">
                                          {fmtPct(sharePct(product.kg, customer.kg))}
                                        </strong>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-outline-variant/40 text-label-md font-semibold">
                    <td className="py-1.5 text-on-surface">Total del día</td>
                    <td className="py-1.5 text-right tabular-nums text-on-surface">{fmtKg(totalKg)}</td>
                    <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                      {hasSacks ? fmtKg(totalSacks, 1) : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-on-surface-variant">{fmtKg(products.length)}</td>
                    <td className="py-1.5 pl-3 text-label-sm text-outline">100 % de la venta del día</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-label-sm text-outline">
            Porcentajes calculados sobre el total vendido del día ({fmtKg(totalKg)} kg). Las notas sin cliente se
            agrupan como «Sin cliente» para que el reparto sume 100 %. Los sacos solo suman artículos SAC.
          </p>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-space-xs border-t border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}

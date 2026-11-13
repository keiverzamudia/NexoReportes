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
  ForecastSalesDayPendingLine,
  ForecastSalesResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  PackageSearch,
  RotateCw,
  Truck,
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

/** Ámbar del pronóstico: el mismo tono de la tira de barras. */
const AMBER = '#d18700';

/** Renglón pendiente con su cliente, para poder listarlo en ambos desgloses. */
interface PendingLineView extends ForecastSalesDayPendingLine {
  customerCode: string;
  customerName: string;
}

/** Fila unificada: venta real del día + pedidos pendientes con entrega ese día. */
interface DayProductRow extends ForecastSalesDayDetailProduct {
  pendingKg: number;
  pendingOrders: number;
  pendingLines: PendingLineView[];
}

interface DayCustomerRow extends ForecastSalesDayCustomer {
  pendingKg: number;
  pendingOrders: number;
  pendingLines: PendingLineView[];
}

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

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Fecha del pedido pendiente: tentativa si se movió, si no la de Profit. */
function pendingDateLabel(line: ForecastSalesDayPendingLine): string {
  const tentative = line.tentativeDate ? shortDate(line.tentativeDate) : null;
  const original = line.requestedDate ? shortDate(line.requestedDate) : null;
  if (tentative && tentative !== original) {
    return `tentativa ${tentative}${original ? ` · Profit ${original}` : ''}`;
  }
  return original ? `Profit ${original}` : 'sin fecha';
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'amber' }) {
  return (
    <div
      className={cx(
        'rounded-xl border p-space-sm',
        tone === 'amber' ? 'border-warning/40 bg-warning-container/30' : 'border-outline-variant/30 bg-surface-container-lowest',
      )}
    >
      <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">{label}</p>
      <p
        className="tabular-nums text-title-md font-black text-on-surface"
        style={tone === 'amber' ? { color: AMBER } : undefined}
      >
        {value}
      </p>
      {hint && <p className="truncate text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

/**
 * Barra de participación del día con dos segmentos: vendido (azul) y pendiente
 * (ámbar). Ambos porcentajes se miden sobre el total comprometido del día.
 */
function CommittedShare({ soldPct, pendingPct }: { soldPct: number | null; pendingPct: number | null }) {
  const sold = Math.max(0, Math.min(100, soldPct ?? 0));
  const pending = Math.max(0, Math.min(100, pendingPct ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 min-w-14 flex-1 overflow-hidden rounded-pill bg-surface-container-high">
        <div className="h-full bg-primary-container" style={{ width: `${sold}%` }} />
        <div className="h-full" style={{ width: `${pending}%`, background: AMBER }} />
      </div>
      <span className="w-16 shrink-0 text-right text-label-sm font-semibold tabular-nums text-on-surface-variant">
        {sold > 0 ? fmtPct(sold) : '—'}
        {pending > 0 && (
          <span className="block text-[10px] font-bold" style={{ color: AMBER }}>
            +{fmtPct(pending)}
          </span>
        )}
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
  const [tab, setTab] = useState<DayTab>(bar.kg > 0 ? 'product' : 'customer');
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
  const pendingUnavailable = Boolean(detail.data && !detail.data.pendingAvailable);

  const soldProducts = detail.data?.available ? detail.data.products : fallbackProducts;
  const soldCustomers = detail.data?.available ? detail.data.customers : [];
  const totalKg = detail.data?.available ? detail.data.kg : bar.kg;
  // Mientras llega el detalle, el total pendiente ya se conoce por la barra.
  const pendingKg = detail.data?.pendingAvailable ? detail.data.pendingKg : bar.pendingKg;
  const pendingOrders = detail.data?.pendingAvailable ? detail.data.pendingOrders : bar.pendingOrders;
  const committedKg = totalKg + pendingKg;

  // Renglones pendientes aplanados con su cliente: sirven para expandir tanto
  // el producto como el cliente sin volver a consultar.
  const pendingLines = useMemo<PendingLineView[]>(
    () =>
      (detail.data?.pendingCustomers ?? []).flatMap((customer) =>
        customer.lines.map((line) => ({
          ...line,
          customerCode: customer.customerCode,
          customerName: customer.customerName,
        })),
      ),
    [detail.data],
  );

  const productRows = useMemo<DayProductRow[]>(() => {
    const map = new Map<string, DayProductRow>();
    for (const product of soldProducts) {
      map.set(product.productCode, { ...product, pendingKg: 0, pendingOrders: 0, pendingLines: [] });
    }
    for (const product of detail.data?.pendingProducts ?? []) {
      const lines = pendingLines.filter((line) => line.productCode === product.productCode);
      const existing = map.get(product.productCode);
      if (existing) {
        existing.pendingKg = product.kg;
        existing.pendingOrders = product.orderCount;
        existing.pendingLines = lines;
      } else {
        map.set(product.productCode, {
          productCode: product.productCode,
          description: product.description,
          uom: product.uom,
          kgPerUom: null,
          kg: 0,
          units: 0,
          sacks: null,
          sharePct: null,
          pendingKg: product.kg,
          pendingOrders: product.orderCount,
          pendingLines: lines,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => b.kg + b.pendingKg - (a.kg + a.pendingKg) || a.productCode.localeCompare(b.productCode),
    );
  }, [soldProducts, detail.data, pendingLines]);

  const customerRows = useMemo<DayCustomerRow[]>(() => {
    const map = new Map<string, DayCustomerRow>();
    for (const customer of soldCustomers) {
      map.set(customer.customerCode, { ...customer, pendingKg: 0, pendingOrders: 0, pendingLines: [] });
    }
    for (const customer of detail.data?.pendingCustomers ?? []) {
      const lines = customer.lines.map((line) => ({
        ...line,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
      }));
      const existing = map.get(customer.customerCode);
      if (existing) {
        existing.pendingKg = customer.kg;
        existing.pendingOrders = customer.orderCount;
        existing.pendingLines = lines;
      } else {
        map.set(customer.customerCode, {
          customerCode: customer.customerCode,
          customerName: customer.customerName,
          kg: 0,
          units: 0,
          sharePct: null,
          products: [],
          pendingKg: customer.kg,
          pendingOrders: customer.orderCount,
          pendingLines: lines,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => b.kg + b.pendingKg - (a.kg + a.pendingKg) || a.customerName.localeCompare(b.customerName),
    );
  }, [soldCustomers, detail.data]);

  // Alias: el JSX de las tablas habla de productos y clientes.
  const products = productRows;
  const customers = customerRows;

  const totalSacks = soldProducts.reduce((acc, product) => acc + (product.sacks ?? 0), 0);
  const hasSacks = soldProducts.some((product) => product.sacks !== null);
  const loadingProducts = detail.isLoading && products.length === 0;
  const loadingCustomers = detail.isLoading;

  const goal = goalKg !== null && goalKg > 0 ? goalKg : null;
  const goalPct = goal !== null ? (totalKg / goal) * 100 : null;
  const goalReached = goalPct !== null && goalPct >= 100;

  // Participación sobre el total comprometido del día (vendido + pendiente).
  const soldShare = (kg: number) => (committedKg > 0 ? (kg / committedKg) * 100 : null);
  const pendingShare = (kg: number) => (committedKg > 0 ? (kg / committedKg) * 100 : null);

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
    map.set(expandedProduct, clientsForProduct(soldCustomers, expandedProduct));
    return map;
  }, [soldCustomers, expandedProduct]);

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
                Ventas y pedidos del día · Desglose
              </p>
              <h2 id="day-sales-title" className="truncate text-title-md font-bold text-primary">
                {longDayLabel(date)}
              </h2>
              <p className="flex flex-wrap items-center gap-2 text-label-md text-on-surface-variant">
                <span className="tabular-nums">
                  {fmtKg(totalKg)} kg vendidos
                  {pendingKg > 0 ? ` · ${fmtKg(pendingKg)} kg pendientes` : ''} · {fmtKg(bar.invoices)} notas
                </span>
                {bar.partial && (
                  <Badge tone="warning" dot>
                    En curso
                  </Badge>
                )}
                {bar.isToday && !bar.partial && <Badge tone="primary">Hoy</Badge>}
                {pendingKg > 0 && (
                  <Badge tone="warning" dot>
                    {pendingOrders} {pendingOrders === 1 ? 'pedido pendiente' : 'pedidos pendientes'}
                  </Badge>
                )}
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
          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-5">
            <Stat
              label="Vendido"
              value={`${fmtKg(totalKg)} kg`}
              hint={totalKg > 0 ? (bar.partial ? 'día en curso' : 'día completo') : 'sin ventas registradas'}
            />
            <Stat
              label="Pendiente de despacho"
              tone={pendingKg > 0 ? 'amber' : undefined}
              value={pendingKg > 0 ? `${fmtKg(pendingKg)} kg` : '—'}
              hint={
                pendingKg > 0
                  ? `${fmtKg(pendingOrders)} ${pendingOrders === 1 ? 'pedido' : 'pedidos'} con entrega este día`
                  : 'sin pedidos con esta entrega'
              }
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
                    : pendingKg > 0
                      ? 'con venta o pedido'
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

          {pendingUnavailable && (
            <p
              role="status"
              className="flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-sm py-space-xs text-label-md text-on-warning-container"
            >
              <Truck aria-hidden className="mt-0.5 size-4 shrink-0" />
              No se pudo leer la cartera de pedidos: el total pendiente sale de la barra, sin desglose por cliente.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-primary-container" /> Vendido
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full" style={{ background: AMBER }} /> Pendiente de despacho
              {committedKg > 0 ? ` · ${fmtPct((pendingKg / committedKg) * 100)} del comprometido` : ''}
            </span>
            <span className="text-outline">Las filas ámbar son las ventas que faltaron ese día.</span>
          </div>

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
                        Vendido
                      </th>
                      <th scope="col" className="w-24 py-1 text-right font-semibold">
                        Pendiente
                      </th>
                      <th scope="col" className="w-20 py-1 text-right font-semibold">
                        Sacos
                      </th>
                      <th scope="col" className="w-[30%] py-1 pl-3 text-left font-semibold">
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
                          <tr
                            className={cx(
                              'border-t border-surface-container/70 align-top',
                              product.pendingKg > 0 && 'bg-warning-container/35',
                            )}
                          >
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
                                  <span className="flex flex-wrap items-center gap-1.5 text-label-sm text-outline">
                                    <span>
                                      {product.productCode}
                                      {product.uom ? ` · ${product.uom}` : ''}
                                    </span>
                                    {product.pendingKg > 0 && (
                                      <Badge tone="warning" dot>
                                        Pendiente
                                      </Badge>
                                    )}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-on-surface">
                              {product.kg > 0 ? fmtKg(product.kg) : <span className="text-outline">—</span>}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {product.pendingKg > 0 ? (
                                <span className="font-semibold" style={{ color: AMBER }}>
                                  {fmtKg(product.pendingKg)}
                                  <span className="block text-[10px] font-normal text-outline">
                                    {fmtKg(product.pendingOrders)} {product.pendingOrders === 1 ? 'pedido' : 'pedidos'}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-outline">—</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                              {product.sacks === null ? '—' : fmtKg(product.sacks, 1)}
                            </td>
                            <td className="py-1.5 pl-3">
                              <CommittedShare
                                soldPct={soldShare(product.kg)}
                                pendingPct={pendingShare(product.pendingKg)}
                              />
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-surface-container-low/45">
                              <td colSpan={5} className="px-3 py-2">
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
                                {product.pendingLines.length > 0 && (
                                  <>
                                    <p className="mb-1 mt-3 text-label-sm font-semibold uppercase tracking-wide" style={{ color: AMBER }}>
                                      Pedidos pendientes de este producto
                                    </p>
                                    <ul className="flex flex-col gap-1">
                                      {product.pendingLines.map((line) => (
                                        <li
                                          key={`${line.orderNumber}-${line.lineNumber}`}
                                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-label-md"
                                        >
                                          <span className="min-w-0 truncate text-on-surface">
                                            <strong className="tabular-nums">#{line.orderNumber}</strong> ·{' '}
                                            {line.customerName}
                                            {line.authorized === false && (
                                              <span className="text-outline"> · sin autorizar</span>
                                            )}
                                          </span>
                                          <span className="shrink-0 tabular-nums" style={{ color: AMBER }}>
                                            {fmtKg(line.kg)} kg · <span className="text-outline">{pendingDateLabel(line)}</span>
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
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
                      <td className="py-1.5 text-right tabular-nums" style={{ color: pendingKg > 0 ? AMBER : undefined }}>
                        {pendingKg > 0 ? fmtKg(pendingKg) : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                        {hasSacks ? fmtKg(totalSacks, 1) : '—'}
                      </td>
                      <td className="py-1.5 pl-3 text-label-sm text-outline">
                        {detail.data?.truncated ? 'Datos truncados' : '100 % del comprometido del día'}
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
                      Vendido
                    </th>
                    <th scope="col" className="w-24 py-1 text-right font-semibold">
                      Pendiente
                    </th>
                    <th scope="col" className="w-20 py-1 text-right font-semibold" title="solo artículos SAC">
                      Sacos
                    </th>
                    <th scope="col" className="w-24 py-1 text-right font-semibold">
                      Productos
                    </th>
                    <th scope="col" className="w-[28%] py-1 pl-3 text-left font-semibold">
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
                        <tr
                          className={cx(
                            'border-t border-surface-container/70 align-top',
                            customer.pendingKg > 0 && 'bg-warning-container/35',
                          )}
                        >
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
                                <span className="flex flex-wrap items-center gap-1.5 text-label-sm text-outline">
                                  <span>
                                    {customer.customerCode === '__sin_cliente__'
                                      ? 'notas sin cliente asignado'
                                      : customer.customerCode}
                                  </span>
                                  {customer.pendingKg > 0 && (
                                    <Badge tone="warning" dot>
                                      Pendiente
                                    </Badge>
                                  )}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface">
                            {customer.kg > 0 ? fmtKg(customer.kg) : <span className="text-outline">—</span>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {customer.pendingKg > 0 ? (
                              <span className="font-semibold" style={{ color: AMBER }}>
                                {fmtKg(customer.pendingKg)}
                                <span className="block text-[10px] font-normal text-outline">
                                  {fmtKg(customer.pendingOrders)} {customer.pendingOrders === 1 ? 'pedido' : 'pedidos'}
                                </span>
                              </span>
                            ) : (
                              <span className="text-outline">—</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                            {sacks === null ? '—' : fmtKg(sacks, 1)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                            {fmtKg(customer.products.length)}
                          </td>
                          <td className="py-1.5 pl-3">
                            <CommittedShare
                              soldPct={soldShare(customer.kg)}
                              pendingPct={pendingShare(customer.pendingKg)}
                            />
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-surface-container-low/45">
                            <td colSpan={6} className="px-3 py-2">
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
                              {customer.pendingLines.length > 0 && (
                                <>
                                  <p className="mb-1 mt-3 text-label-sm font-semibold uppercase tracking-wide" style={{ color: AMBER }}>
                                    Pedidos pendientes de este cliente
                                  </p>
                                  <ul className="flex flex-col gap-1">
                                    {customer.pendingLines.map((line) => (
                                      <li
                                        key={`${line.orderNumber}-${line.lineNumber}`}
                                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-label-md"
                                      >
                                        <span className="min-w-0 truncate text-on-surface">
                                          <strong className="tabular-nums">#{line.orderNumber}</strong> ·{' '}
                                          {line.description}
                                          <span className="text-outline">
                                            {' '}
                                            · {line.productCode}
                                            {line.uom ? ` · ${line.uom}` : ''}
                                            {line.authorized === false ? ' · sin autorizar' : ''}
                                          </span>
                                        </span>
                                        <span className="shrink-0 tabular-nums" style={{ color: AMBER }}>
                                          {fmtKg(line.kg)} kg · <span className="text-outline">{pendingDateLabel(line)}</span>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </>
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
                    <td className="py-1.5 text-right tabular-nums" style={{ color: pendingKg > 0 ? AMBER : undefined }}>
                      {pendingKg > 0 ? fmtKg(pendingKg) : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-on-surface-variant">
                      {hasSacks ? fmtKg(totalSacks, 1) : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-on-surface-variant">{fmtKg(products.length)}</td>
                    <td className="py-1.5 pl-3 text-label-sm text-outline">100 % del comprometido del día</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-label-sm text-outline">
            Las filas y celdas en ámbar son pedidos con entrega ese día que siguen pendientes de despacho: las ventas
            que faltaron. Los porcentajes se miden sobre el total comprometido ({fmtKg(committedKg)} kg = vendido +
            pendiente). Las notas sin cliente se agrupan como «Sin cliente» y los sacos solo suman artículos SAC.
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

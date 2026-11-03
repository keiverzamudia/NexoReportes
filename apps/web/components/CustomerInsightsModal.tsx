'use client';

// ============================================================
// Ficha 360 de un cliente.
//
// Se abre desde la cartera de Clientes. Resume en una sola ventana:
//  · cuánto compra (sacos y toneladas) y cuánto factura,
//  · cómo evoluciona mes a mes y por año,
//  · qué productos dejó de comprar,
//  · qué compran clientes de su mismo segmento,
//  · qué acciones comerciales priorizar.
//
// Es solo lectura: no escribe en Profit ni modifica pedidos.
// ============================================================

import type {
  Customer,
  CustomerInsightAlert,
  CustomerInsightProduct,
  CustomerInsightResponse,
  CustomerStatementCurrency,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  Lightbulb,
  Package,
  RefreshCw,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import {
  ALERT_META,
  PRODUCT_STATUS_META,
  SEGMENT_META,
  buildProductsCsv,
  formatInsightMoney,
  formatSignedPct,
  formatTonnesFromKg,
  formatTonnesValue,
  monthLabel,
  periodLabel,
  productLastSaleLabel,
  productsCsvFileName,
  topProducts,
} from '../lib/customer-insights';
import { statementUpdatedAt } from '../lib/statement';
import { CustomerOrdersPanel } from './CustomerOrdersPanel';
import { EChart } from './EChart';
import type { Column } from './ui';
import {
  Badge,
  DataTable,
  EmptyState,
  Segmented,
  Select,
  Skeleton,
  Td,
  Th,
  TrendPill,
  cx,
  fmtDate,
  fmtQty,
} from './ui';

type InsightTab = 'resumen' | 'productos' | 'oportunidades' | 'pedidos';
type ProductFilter = 'todos' | 'perdidos' | 'cayendo' | 'nuevos';

const CHART_TOOLTIP = {
  backgroundColor: '#001a33',
  borderWidth: 0,
  padding: [8, 12] as [number, number],
  textStyle: { color: '#ffffff', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 16px 40px -20px rgba(0,30,64,.6);',
};

const TONE_TEXT: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-secondary',
  danger: 'text-error',
  warning: 'text-warning',
  muted: 'text-on-surface-variant',
  default: 'text-on-surface',
};

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function buildMonthlyOption(data: CustomerInsightResponse): Record<string, unknown> {
  const labels = data.monthly.map((item) => monthLabel(item.month));
  const series: Record<string, unknown>[] = [
    {
      name: 'Toneladas',
      type: 'bar',
      data: data.monthly.map((item) => item.tonnes),
      color: '#003366',
      barMaxWidth: 16,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    },
  ];
  const hasBilling = data.billingAvailable && data.monthly.some((item) => item.billed !== null);
  if (hasBilling) {
    series.push({
      name: data.currency === 'USD' ? 'Facturado USD' : 'Facturado Bs',
      type: 'line',
      yAxisIndex: 1,
      data: data.monthly.map((item) => item.billed ?? 0),
      color: '#95c800',
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
    });
  }

  return {
    grid: { left: 4, right: hasBilling ? 58 : 16, top: 18, bottom: 38, containLabel: true },
    tooltip: {
      ...CHART_TOOLTIP,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,51,102,0.06)' } },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{ dataIndex?: number; seriesName?: string; value?: number }>)
          : [];
        const index = items[0]?.dataIndex ?? 0;
        const item = data.monthly[index];
        if (!item) return '';
        const lines = [`<strong>${item.month}</strong>`, `${formatTonnesValue(item.tonnes)} despachadas`];
        if (item.billed !== null) {
          lines.push(`${formatInsightMoney(item.billed, data.currency)} facturados`);
        }
        lines.push(`${item.notes} nota${item.notes === 1 ? '' : 's'}`);
        return lines.join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: '#737780', fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: '#737780',
        fontSize: 10,
        interval: data.monthly.length > 18 ? 2 : 0,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 't',
        nameTextStyle: { color: '#737780', fontSize: 10 },
        axisLabel: { color: '#737780', fontSize: 10 },
        splitLine: { lineStyle: { color: '#e6eff9', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      ...(hasBilling
        ? [
            {
              type: 'value',
              name: data.currency === 'USD' ? '$' : 'Bs',
              nameTextStyle: { color: '#737780', fontSize: 10 },
              axisLabel: { color: '#737780', fontSize: 10, formatter: (value: number) => compactNumber(value) },
              splitLine: { show: false },
              axisLine: { show: false },
              axisTick: { show: false },
            },
          ]
        : []),
    ],
    series,
  };
}

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
      <p className={cx('mt-space-xs text-title-md font-black tabular-nums', TONE_TEXT[tone] ?? TONE_TEXT.primary)}>
        {value}
      </p>
      {hint && <p className="mt-space-2xs text-label-sm normal-case text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function AlertIcon({ severity }: { severity: CustomerInsightAlert['severity'] }) {
  if (severity === 'critical' || severity === 'warning') return <AlertTriangle aria-hidden className="size-4" />;
  if (severity === 'success') return <CheckCircle2 aria-hidden className="size-4" />;
  return <Lightbulb aria-hidden className="size-4" />;
}

function AlertsBlock({ alerts, currency }: { alerts: CustomerInsightAlert[]; currency: CustomerStatementCurrency }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-start gap-space-sm rounded-xl border border-success/30 bg-success-container/25 p-space-md">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-secondary" />
        <div>
          <p className="font-semibold text-title-md text-primary">Sin alertas críticas</p>
          <p className="text-body-md text-on-surface-variant">
            El cliente mantiene actividad y no hay productos perdidos ni cobranza vencida en este corte.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Diagnóstico de ataque" className="grid gap-space-sm md:grid-cols-2 xl:grid-cols-3">
      {alerts.map((alert) => {
        const meta = ALERT_META[alert.severity];
        return (
          <article
            key={alert.key}
            className="flex flex-col gap-space-xs rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft"
          >
            <div className="flex items-start justify-between gap-space-sm">
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
              <span className={cx('shrink-0', TONE_TEXT[meta.tone] ?? TONE_TEXT.primary)}>
                <AlertIcon severity={alert.severity} />
              </span>
            </div>
            <p className="font-semibold text-title-md text-primary">{alert.title}</p>
            <p className="text-label-md normal-case text-on-surface-variant">{alert.detail}</p>
            {alert.amount !== null && alert.amount !== undefined && (
              <p className="mt-auto font-bold tabular-nums text-primary">
                {formatInsightMoney(alert.amount, currency)}
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function InsightBadge({ status }: { status: CustomerInsightProduct['status'] }) {
  const meta = PRODUCT_STATUS_META[status];
  return (
    <span title={meta.hint}>
      <Badge tone={meta.tone}>{meta.label}</Badge>
    </span>
  );
}

function AnnualTable({ data }: { data: CustomerInsightResponse }) {
  if (data.annual.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Sin histórico anual para este cliente.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-md">
        <thead>
          <tr className="border-b border-outline-variant/30">
            <Th>Año</Th>
            <Th align="right">Toneladas</Th>
            <Th align="right">Facturado</Th>
            <Th align="right">Notas</Th>
            <Th align="right">Meses con venta</Th>
            <Th align="right">Vs. año anterior</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/20">
          {data.annual.map((year, index) => {
            const older = data.annual[index + 1];
            const delta =
              older && older.tonnes > 0 ? Math.round(((year.tonnes - older.tonnes) / older.tonnes) * 1000) / 10 : null;
            return (
              <tr key={year.year} className="transition-colors hover:bg-surface-container-low/70">
                <Td className="font-bold tabular-nums text-primary">{year.year}</Td>
                <Td align="right" className="font-semibold tabular-nums">{fmtQty(year.tonnes, 1)}</Td>
                <Td align="right" className="tabular-nums text-on-surface-variant">
                  {formatInsightMoney(year.billed, data.currency)}
                </Td>
                <Td align="right" className="tabular-nums">{year.notes}</Td>
                <Td align="right" className="tabular-nums text-on-surface-variant">{year.monthsWithSales}</Td>
                <Td align="right">
                  {delta === null ? (
                    <span className="text-outline">—</span>
                  ) : (
                    <TrendPill
                      value={formatSignedPct(delta)}
                      tone={delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}
                    />
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResumenTab({
  data,
  customer,
  onOpenStatement,
  onSeeProducts,
  onSeeOrders,
}: {
  data: CustomerInsightResponse;
  customer: Customer;
  onOpenStatement: (customer: Customer) => void;
  onSeeProducts: () => void;
  onSeeOrders: () => void;
}) {
  const option = useMemo(() => buildMonthlyOption(data), [data]);
  const top = useMemo(() => topProducts(data.products, 5), [data.products]);
  const segment = SEGMENT_META[data.cadence.segment];
  const lastSale = data.totals.lastSaleDate ?? data.previousTotals?.lastSaleDate ?? null;
  const creditAvailable =
    data.account && data.account.limiteCredito !== null
      ? data.account.limiteCredito - data.account.saldo
      : null;

  return (
    <div className="flex flex-col gap-space-md">
      <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
        <div className="mb-space-sm flex flex-wrap items-end justify-between gap-space-sm">
          <div>
            <p className="text-title-md font-semibold text-primary">Evolución mensual</p>
            <p className="text-label-sm text-on-surface-variant">
              {periodLabel(data.currentPeriod.from, data.currentPeriod.to)} · toneladas despachadas y facturación
            </p>
          </div>
          <Badge tone={data.billingAvailable ? 'success' : 'warning'} dot>
            {data.billingAvailable ? 'Facturación neta' : 'Sin facturación'}
          </Badge>
        </div>
        <EChart option={option} height={260} ariaLabel="Toneladas despachadas y facturación mensual" />
        {!data.available && (
          <p role="status" className="mt-space-sm flex items-center gap-space-xs text-label-md text-warning">
            <AlertTriangle aria-hidden className="size-4" /> No se pudo leer el volumen en Profit.
          </p>
        )}
        {data.billingPartial && (
          <p role="status" className="mt-space-sm flex items-center gap-space-xs text-label-md text-warning">
            <AlertTriangle aria-hidden className="size-4" />
            Algunos documentos no tienen tasa: el monto en USD está incompleto.
          </p>
        )}
      </section>

      <div className="grid gap-space-md xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
          <div className="mb-space-sm flex items-center justify-between gap-space-sm">
            <div>
              <p className="text-title-md font-semibold text-primary">Por año calendario</p>
              <p className="text-label-sm text-on-surface-variant">Volumen, facturación y meses con actividad.</p>
            </div>
          </div>
          <AnnualTable data={data} />
        </section>

        <div className="flex flex-col gap-space-md">
          <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
            <div className="flex items-start justify-between gap-space-sm">
              <div>
                <p className="text-title-md font-semibold text-primary">Cadencia de compra</p>
                <p className="text-label-sm text-on-surface-variant">Ritmo y próxima compra esperada.</p>
              </div>
              <Badge tone={segment.tone}>{segment.label}</Badge>
            </div>
            <dl className="mt-space-sm grid grid-cols-2 gap-space-sm text-label-md">
              <div>
                <dt className="text-outline">Última compra</dt>
                <dd className="font-semibold tabular-nums text-primary">{fmtDate(lastSale)}</dd>
              </div>
              <div>
                <dt className="text-outline">Días sin comprar</dt>
                <dd className="font-semibold tabular-nums text-primary">
                  {data.cadence.daysSinceLastSale ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-outline">Cadencia</dt>
                <dd className="font-semibold tabular-nums text-primary">
                  {data.cadence.avgDaysBetweenNotes === null ? '—' : `${data.cadence.avgDaysBetweenNotes} días`}
                </dd>
              </div>
              <div>
                <dt className="text-outline">Próxima esperada</dt>
                <dd className="font-semibold tabular-nums text-primary">{fmtDate(data.cadence.expectedNextDate)}</dd>
              </div>
            </dl>
            <p className="mt-space-sm text-label-sm normal-case text-on-surface-variant">{segment.hint}</p>
          </section>

          <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
            <div className="flex items-start justify-between gap-space-sm">
              <div>
                <p className="text-title-md font-semibold text-primary">Cuenta por cobrar</p>
                <p className="text-label-sm text-on-surface-variant">Saldo y límite del cliente.</p>
              </div>
              <CircleDollarSign aria-hidden className="size-4 text-primary-container" />
            </div>
            {data.account ? (
              <>
                <div className="mt-space-sm grid grid-cols-2 gap-space-sm text-label-md">
                  <div>
                    <p className="text-outline">Saldo</p>
                    <p className="font-bold tabular-nums text-primary">
                      {formatInsightMoney(data.account.saldo, data.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-outline">Vencido</p>
                    <p className={cx('font-bold tabular-nums', data.account.saldoVencido > 0 ? 'text-error' : 'text-primary')}>
                      {formatInsightMoney(data.account.saldoVencido, data.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-outline">Límite</p>
                    <p className="font-semibold tabular-nums text-primary">
                      {formatInsightMoney(data.account.limiteCredito, data.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-outline">Disponible</p>
                    <p className={cx('font-semibold tabular-nums', creditAvailable !== null && creditAvailable < 0 ? 'text-error' : 'text-primary')}>
                      {formatInsightMoney(creditAvailable, data.currency)}
                    </p>
                  </div>
                </div>
                <p className="mt-space-xs text-label-sm text-on-surface-variant">
                  {data.account.documentos} documento(s) · {data.account.vencidos} vencido(s)
                </p>
              </>
            ) : (
              <p className="mt-space-sm text-body-md text-on-surface-variant">
                Sin datos de cartera en Profit para este cliente.
              </p>
            )}
            <button
              type="button"
              onClick={() => onOpenStatement(customer)}
              className="mt-space-sm inline-flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
            >
              <Receipt aria-hidden className="size-4" /> Abrir estado de cuenta
            </button>
          </section>
        </div>
      </div>

      <div className="grid gap-space-md xl:grid-cols-2">
        <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
          <div className="flex items-start justify-between gap-space-sm">
            <div>
              <p className="text-title-md font-semibold text-primary">Pedidos activos</p>
              <p className="text-label-sm text-on-surface-variant">Cartera pendiente del cliente.</p>
            </div>
            <ShoppingCart aria-hidden className="size-4 text-primary-container" />
          </div>
          <div className="mt-space-sm grid grid-cols-3 gap-space-sm text-label-md">
            <div>
              <p className="text-outline">Pedidos</p>
              <p className="font-bold tabular-nums text-primary">{data.orders.activeCount}</p>
            </div>
            <div>
              <p className="text-outline">Pendiente</p>
              <p className="font-bold tabular-nums text-primary">{fmtQty(data.orders.pendingQty, 0)}</p>
            </div>
            <div>
              <p className="text-outline">Próxima entrega</p>
              <p className="font-semibold tabular-nums text-primary">{fmtDate(data.orders.nextDeliveryDate)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSeeOrders}
            className="mt-space-sm inline-flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
          >
            Ver pedidos <ChevronRight aria-hidden className="size-4" />
          </button>
        </section>

        <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
          <div className="flex items-start justify-between gap-space-sm">
            <div>
              <p className="text-title-md font-semibold text-primary">Productos principales</p>
              <p className="text-label-sm text-on-surface-variant">Participación en el volumen actual.</p>
            </div>
            <Package aria-hidden className="size-4 text-primary-container" />
          </div>
          {top.length === 0 ? (
            <p className="mt-space-sm text-body-md text-on-surface-variant">Sin productos en el periodo.</p>
          ) : (
            <ul className="mt-space-sm flex flex-col gap-space-xs">
              {top.map((product) => (
                <li key={product.code} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-space-sm text-label-md">
                    <span className="min-w-0 truncate font-semibold text-primary" title={product.description ?? product.code}>
                      {product.description ?? product.code}
                    </span>
                    <span className="shrink-0 tabular-nums text-on-surface-variant">
                      {formatTonnesValue(product.current.tonnes)} · {fmtQty(product.sharePct, 1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-container">
                    <div
                      className="h-full rounded-pill bg-primary-container"
                      style={{ width: `${Math.max(2, Math.min(100, product.sharePct))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onSeeProducts}
            className="mt-space-sm inline-flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
          >
            Ver todos los productos <ChevronRight aria-hidden className="size-4" />
          </button>
        </section>
      </div>
    </div>
  );
}

function ProductsTab({
  data,
  filter,
  onFilter,
  currency,
}: {
  data: CustomerInsightResponse;
  filter: ProductFilter;
  onFilter: (filter: ProductFilter) => void;
  currency: CustomerStatementCurrency;
}) {
  const filtered = useMemo(() => {
    const rows =
      filter === 'perdidos'
        ? data.products.filter((product) => product.status === 'PERDIDO')
        : filter === 'cayendo'
          ? data.products.filter((product) => product.status === 'CAYENDO')
          : filter === 'nuevos'
            ? data.products.filter((product) => product.status === 'NUEVO')
            : data.products;
    return [...rows].sort((a, b) => b.current.kg - a.current.kg || b.previous.kg - a.previous.kg);
  }, [data.products, filter]);

  const columns = useMemo<Column<CustomerInsightProduct>[]>(
    () => [
      {
        key: 'producto',
        header: 'Producto',
        kind: 'id',
        sortValue: (product) => product.code,
        render: (product) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-bold text-primary">{product.code}</span>
            <span className="max-w-[22rem] truncate text-label-sm text-on-surface-variant" title={product.description ?? ''}>
              {product.description ?? '—'}
            </span>
          </span>
        ),
      },
      {
        key: 'estado',
        header: 'Estado',
        kind: 'status',
        sortValue: (product) => product.status,
        render: (product) => <InsightBadge status={product.status} />,
      },
      {
        key: 'sacos',
        header: 'Sacos',
        align: 'right',
        kind: 'metric',
        sortValue: (product) => product.current.sacks,
        render: (product) => <span className="font-semibold tabular-nums">{fmtQty(product.current.sacks, 0)}</span>,
      },
      {
        key: 'toneladas',
        header: 'Toneladas',
        align: 'right',
        kind: 'metric',
        sortValue: (product) => product.current.tonnes,
        render: (product) => <span className="font-bold tabular-nums text-primary">{fmtQty(product.current.tonnes, 1)}</span>,
      },
      {
        key: 'share',
        header: '% volumen',
        align: 'right',
        sortValue: (product) => product.sharePct,
        render: (product) => <span className="tabular-nums text-on-surface-variant">{fmtQty(product.sharePct, 1)}%</span>,
      },
      {
        key: 'money',
        header: 'Facturado est.',
        align: 'right',
        sortValue: (product) => product.current.billed ?? 0,
        render: (product) => (
          <span
            className="tabular-nums text-on-surface-variant"
            title={data.productBillingEstimated ? 'Reparto estimado del facturado según toneladas' : undefined}
          >
            {formatInsightMoney(product.current.billed, currency)}
          </span>
        ),
      },
      {
        key: 'anterior',
        header: '12m ant.',
        align: 'right',
        sortValue: (product) => product.previous.tonnes,
        render: (product) => (
          <span className="tabular-nums text-on-surface-variant">{fmtQty(product.previous.tonnes, 1)}</span>
        ),
      },
      {
        key: 'delta',
        header: 'Variación',
        align: 'right',
        sortValue: (product) => product.deltaPct ?? 0,
        render: (product) =>
          product.deltaPct === null ? (
            <span className="text-outline">—</span>
          ) : (
            <TrendPill
              value={formatSignedPct(product.deltaPct)}
              tone={product.deltaPct > 0 ? 'up' : product.deltaPct < 0 ? 'down' : 'neutral'}
            />
          ),
      },
      {
        key: 'ultima',
        header: 'Última compra',
        align: 'right',
        sortValue: (product) => productLastSaleLabel(product),
        render: (product) => <span className="tabular-nums text-on-surface-variant">{fmtDate(productLastSaleLabel(product))}</span>,
      },
    ],
    [currency, data.productBillingEstimated],
  );

  function downloadCsv() {
    if (typeof window === 'undefined') return;
    const csv = buildProductsCsv(currency, filtered);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = productsCsvFileName(data.customer.code, data.months);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const filters: { value: ProductFilter; label: string; count: number }[] = [
    { value: 'todos', label: 'Todos', count: data.products.length },
    { value: 'perdidos', label: 'Perdidos', count: data.products.filter((p) => p.status === 'PERDIDO').length },
    { value: 'cayendo', label: 'Cayendo', count: data.products.filter((p) => p.status === 'CAYENDO').length },
    { value: 'nuevos', label: 'Nuevos', count: data.products.filter((p) => p.status === 'NUEVO').length },
  ];

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex flex-wrap items-center gap-space-xs">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => onFilter(item.value)}
              className={cx(
                'inline-flex h-9 items-center gap-space-2xs rounded-pill border px-space-md font-semibold text-label-md transition-colors',
                filter === item.value
                  ? 'border-primary-container bg-primary-container text-on-primary'
                  : 'border-outline-variant/40 text-primary-container hover:bg-surface-container-low',
              )}
            >
              {item.label}
              <span className={cx('rounded-pill px-1.5 text-label-sm', filter === item.value ? 'bg-white/15' : 'bg-surface-container')}>
                {item.count}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          className="inline-flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low disabled:opacity-40"
        >
          <Download aria-hidden className="size-4" /> Exportar CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(product) => product.code}
          sortable
          sticky={false}
          maxHeightClass="md:max-h-[min(52vh,620px)]"
          empty={
            <EmptyState
              icon={Package}
              title={filter === 'todos' ? 'Sin productos en el periodo' : 'Sin productos en este filtro'}
              description={
                filter === 'perdidos'
                  ? 'No se detectaron productos que haya dejado de comprar en los últimos 12 meses.'
                  : 'Prueba con otro filtro o amplía la ventana de meses.'
              }
            />
          }
        />
      </div>
      <p className="text-label-sm normal-case text-on-surface-variant">
        {data.productBillingEstimated
          ? 'El facturado por producto es una estimación: se reparte el total facturado según las toneladas de cada producto.'
          : 'El facturado por producto no está disponible para este corte.'}
      </p>
    </div>
  );
}

function OpportunitiesTab({ data, currency }: { data: CustomerInsightResponse; currency: CustomerStatementCurrency }) {
  return (
    <div className="flex flex-col gap-space-md">
      <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-space-sm">
          <div>
            <p className="text-title-md font-semibold text-primary">Productos que dejó de comprar</p>
            <p className="text-label-sm text-on-surface-variant">
              Compras de los 12 meses anteriores que no se repitieron en el último año.
            </p>
          </div>
          <Badge tone={data.lostProducts.length > 0 ? 'warning' : 'success'} dot>
            {data.lostProducts.length} producto{data.lostProducts.length === 1 ? '' : 's'}
          </Badge>
        </div>

        {data.lostProducts.length === 0 ? (
          <div className="mt-space-sm">
            <EmptyState
              icon={CheckCircle2}
              title="Sin productos perdidos"
              description="El cliente no dejó de comprar ningún producto relevante frente a los 12 meses anteriores."
            />
          </div>
        ) : (
          <div className="mt-space-sm grid gap-space-sm md:grid-cols-2 xl:grid-cols-3">
            {data.lostProducts.map((product) => (
              <article
                key={product.code}
                className="flex flex-col gap-space-xs rounded-xl border border-warning/35 bg-warning-container/20 p-space-md"
              >
                <div className="flex items-start justify-between gap-space-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-primary" title={product.description ?? product.code}>
                      {product.description ?? product.code}
                    </p>
                    <p className="text-label-sm text-on-surface-variant">{product.code}</p>
                  </div>
                  <InsightBadge status="PERDIDO" />
                </div>
                <p className="text-title-md font-black tabular-nums text-primary">
                  {formatTonnesValue(product.previous.tonnes)}
                </p>
                <p className="text-label-sm text-on-surface-variant">
                  compradas en los 12 meses anteriores · última {fmtDate(productLastSaleLabel(product))}
                </p>
                <p className="mt-auto text-label-md normal-case text-on-surface-variant">
                  Recuperable estimado:{' '}
                  <strong className="text-primary">{formatInsightMoney(product.previous.billed, currency)}</strong>
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-space-sm">
          <div>
            <p className="text-title-md font-semibold text-primary">Clientes similares también compran</p>
            <p className="text-label-sm text-on-surface-variant">
              Surtido del segmento {data.customer.customerType ?? 'del cliente'} que todavía no aparece en su historial.
            </p>
          </div>
          <Badge tone="primary" dot>
            {data.similarProducts.length} sugerencia{data.similarProducts.length === 1 ? '' : 's'}
          </Badge>
        </div>

        {data.similarProducts.length === 0 ? (
          <div className="mt-space-sm">
            <EmptyState
              icon={Users}
              title="Sin surtido comparable"
              description="No hay suficientes clientes del mismo segmento o el cliente ya compra todo el surtido relevante."
            />
          </div>
        ) : (
          <div className="mt-space-sm grid gap-space-sm md:grid-cols-2 xl:grid-cols-3">
            {data.similarProducts.map((product) => (
              <article
                key={product.code}
                className="flex flex-col gap-space-xs rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-space-md"
              >
                <div className="flex items-start justify-between gap-space-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-primary" title={product.description ?? product.code}>
                      {product.description ?? product.code}
                    </p>
                    <p className="text-label-sm text-on-surface-variant">{product.code}</p>
                  </div>
                  <Badge tone="primary">Sugerido</Badge>
                </div>
                <p className="text-label-md normal-case text-on-surface-variant">
                  <strong className="text-primary">{product.adopters}</strong> cliente(s) del segmento lo compran
                  {product.adoptersPct !== null ? ` (${fmtQty(product.adoptersPct, 1)}%)` : ''}.
                </p>
                <p className="text-label-sm text-on-surface-variant">
                  Promedio por cliente: <strong className="text-primary">{formatTonnesValue(product.avgTonnes)}</strong>
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InsightSkeleton() {
  return (
    <div className="flex flex-col gap-space-md" aria-hidden>
      <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid gap-space-md xl:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export function CustomerInsightsModal({
  open,
  customer,
  onClose,
  onOpenStatement,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onOpenStatement: (customer: Customer) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<InsightTab>('resumen');
  const [months, setMonths] = useState<'12' | '24' | '36'>('24');
  const [currency, setCurrency] = useState<CustomerStatementCurrency>('USD');
  const [productFilter, setProductFilter] = useState<ProductFilter>('todos');

  const code = customer?.externalCode ?? '';

  useEffect(() => {
    if (!open) return;
    setTab('resumen');
    setMonths('24');
    setCurrency('USD');
    setProductFilter('todos');
  }, [open, customer?.id]);

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

  const { data, error, isPending, isFetching, refetch } = useQuery<CustomerInsightResponse>({
    queryKey: ['customer-insights', code, months, currency],
    queryFn: () =>
      apiFetch<CustomerInsightResponse>(
        `/customers/${encodeURIComponent(code)}/insights?months=${months}&currency=${currency}`,
      ),
    enabled: open && customer !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!open || !customer) return null;

  const message =
    error instanceof AuthRequiredError
      ? 'Tu sesión expiró. Cierra la ficha y vuelve a iniciar sesión.'
      : error instanceof Error
        ? error.message
        : 'No se pudo consultar la ficha del cliente.';

  const displayName = data?.customer.name ?? customer.name;
  const displayCode = data?.customer.code ?? customer.externalCode;
  const displayMeta = [data?.customer.customerType ?? customer.customerType, data?.customer.vendor ?? customer.vendor]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  const volumeValue = (value: string) => (data?.available ? value : '—');
  const billingValue = (value: string) => (data?.billingAvailable ? value : '—');

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
        aria-labelledby="customer-insights-title"
        className="animate-rise flex max-h-[calc(100dvh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:max-h-[94vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <BarChart3 aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Clientes · Ficha 360
              </p>
              <h2 id="customer-insights-title" className="truncate text-title-md text-primary">
                {displayName}
              </h2>
              <p className="truncate text-label-md normal-case text-on-surface-variant">
                {displayCode}
                {displayMeta ? ` · ${displayMeta}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-space-xs">
            <span className="hidden sm:inline-flex">
              <Badge
                tone={data?.source === 'fixtures' ? 'warning' : data ? 'success' : error ? 'danger' : 'muted'}
                dot
              >
                {data?.source === 'fixtures'
                  ? 'Datos de desarrollo'
                  : data
                    ? 'Profit en vivo'
                    : error
                      ? 'Sin conexión'
                      : 'Consultando'}
              </Badge>
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Actualizar ficha"
              title="Actualizar ficha"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <RefreshCw aria-hidden className={cx('size-4', isFetching && 'animate-spin')} />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar ficha"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-lowest/95 px-space-md py-space-sm backdrop-blur sm:px-space-lg">
            <div className="max-w-full overflow-x-auto">
              <Segmented<InsightTab>
                value={tab}
                onChange={setTab}
                ariaLabel="Secciones de la ficha"
                options={[
                  { value: 'resumen', label: 'Resumen' },
                  { value: 'productos', label: 'Productos' },
                  { value: 'oportunidades', label: 'Oportunidades' },
                  { value: 'pedidos', label: 'Pedidos' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-space-sm">
              <Select
                value={months}
                onChange={(value) => setMonths(value as '12' | '24' | '36')}
                ariaLabel="Ventana de meses del informe"
                options={[
                  { value: '12', label: '12 meses' },
                  { value: '24', label: '24 meses' },
                  { value: '36', label: '36 meses' },
                ]}
                className="w-32"
              />
              <Select
                value={currency}
                onChange={(value) => setCurrency(value as CustomerStatementCurrency)}
                ariaLabel="Moneda del informe"
                options={[
                  { value: 'USD', label: 'USD' },
                  { value: 'BS', label: 'Bs' },
                ]}
                className="w-24"
              />
            </div>
          </div>

          <div className="flex flex-col gap-space-md p-space-md sm:p-space-lg">
            {error && !data && (
              <div className="flex flex-col items-center gap-space-sm rounded-xl border border-critical/40 bg-critical-container/30 p-space-lg text-center">
                <AlertTriangle aria-hidden className="size-6 text-error" />
                <p className="font-semibold text-title-md text-on-surface">No se pudo consultar la ficha</p>
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
              <InsightSkeleton />
            ) : data ? (
              <>
                <div className="grid gap-space-sm sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label="Sacos"
                    value={volumeValue(fmtQty(data.totals.sacks, 0))}
                    hint="Renglones SAC de los últimos 12 meses"
                    tone="primary"
                    icon={Package}
                  />
                  <MetricCard
                    label="Toneladas"
                    value={volumeValue(fmtQty(data.totals.tonnes, 1))}
                    hint={`${periodLabel(data.currentPeriod.from, data.currentPeriod.to)}`}
                    tone="primary"
                    icon={BarChart3}
                  />
                  <MetricCard
                    label="Facturado"
                    value={billingValue(formatInsightMoney(data.totals.billed, data.currency))}
                    hint={data.billingPartial ? 'Facturación parcial: faltan tasas' : 'Facturación neta del periodo'}
                    tone="success"
                    icon={CircleDollarSign}
                  />
                  <MetricCard
                    label="Notas de entrega"
                    value={volumeValue(String(data.totals.notes))}
                    hint={
                      data.totals.notes > 0 && data.totals.billed !== null
                        ? `${formatInsightMoney(data.totals.billed / data.totals.notes, data.currency)} por nota`
                        : 'Sin notas en el periodo'
                    }
                    tone="primary"
                    icon={Receipt}
                  />
                  <MetricCard
                    label="Facturado por tonelada"
                    value={
                      billingValue(
                        data.totals.billed !== null && data.totals.tonnes > 0
                          ? formatInsightMoney(data.totals.billed / data.totals.tonnes, data.currency)
                          : '—',
                      )
                    }
                    hint="Ingreso medio por tonelada"
                    tone="success"
                    icon={Wallet}
                  />
                  <MetricCard
                    label="Última compra"
                    value={fmtDate(data.totals.lastSaleDate ?? data.previousTotals?.lastSaleDate ?? null)}
                    hint={
                      data.cadence.daysSinceLastSale === null
                        ? 'Sin compras registradas'
                        : `Hace ${data.cadence.daysSinceLastSale} día(s)`
                    }
                    tone="primary"
                    icon={CalendarClock}
                  />
                  <MetricCard
                    label="Vs. 12m anteriores"
                    value={volumeValue(formatSignedPct(data.trend.volumePct))}
                    hint="Variación de toneladas"
                    tone={
                      data.trend.volumePct === null
                        ? 'muted'
                        : data.trend.volumePct > 0
                          ? 'success'
                          : data.trend.volumePct < 0
                            ? 'danger'
                            : 'primary'
                    }
                    icon={
                      data.trend.volumePct !== null && data.trend.volumePct < 0 ? TrendingDown : TrendingUp
                    }
                  />
                  <MetricCard
                    label="Productos activos"
                    value={volumeValue(String(data.totals.products))}
                    hint={`${data.lostProducts.length} perdido(s) en el año anterior`}
                    tone={data.lostProducts.length > 0 ? 'warning' : 'primary'}
                    icon={Package}
                  />
                </div>

                <AlertsBlock alerts={data.alerts} currency={data.currency} />

                <div role="tabpanel" aria-label="Contenido de la ficha">
                  {tab === 'resumen' && (
                    <ResumenTab
                      data={data}
                      customer={customer}
                      onOpenStatement={onOpenStatement}
                      onSeeProducts={() => setTab('productos')}
                      onSeeOrders={() => setTab('pedidos')}
                    />
                  )}
                  {tab === 'productos' && (
                    <ProductsTab
                      data={data}
                      filter={productFilter}
                      onFilter={setProductFilter}
                      currency={data.currency}
                    />
                  )}
                  {tab === 'oportunidades' && <OpportunitiesTab data={data} currency={data.currency} />}
                  {tab === 'pedidos' && (
                    <div className="flex flex-col gap-space-sm">
                      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-space-md">
                        <p className="text-title-md font-semibold text-primary">Cartera pendiente</p>
                        <p className="text-label-md normal-case text-on-surface-variant">
                          {data.orders.activeCount} pedido(s) activo(s) · {fmtQty(data.orders.pendingQty, 0)} unidades
                          pendientes · {formatTonnesFromKg(data.orders.pendingKg)} · próxima entrega{' '}
                          {fmtDate(data.orders.nextDeliveryDate)}
                        </p>
                      </div>
                      <CustomerOrdersPanel customer={customer} />
                    </div>
                  )}
                </div>

                {data.truncated && (
                  <p className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
                    <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    La consulta devolvió el máximo de filas permitido. Acota la ventana a 12 meses para ver el detalle
                    completo.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <span className="text-label-sm normal-case text-on-surface-variant">
            {data
              ? `${periodLabel(data.currentPeriod.from, data.currentPeriod.to)} · ${statementUpdatedAt(data.asOf)}`
              : error
                ? 'No se pudo consultar'
                : 'Consultando ficha…'}
          </span>
          <div className="flex items-center gap-space-sm">
            <span className="text-label-sm normal-case text-on-surface-variant">
              {data?.productBillingEstimated ? 'Facturado por producto estimado' : 'Solo lectura desde Profit'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              Cerrar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

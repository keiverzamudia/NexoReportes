'use client';

// ============================================================
// Reporte «Tiempos» del despacho.
//
// Responde: ¿cuánto tarda el almacén en cargar y cuánto se demora la
// facturación, por cliente, por día o por mes? Usa el endpoint
// /dispatch-sheets/metrics y el mismo lenguaje visual de los reportes.
// ============================================================

import type {
  DispatchMetricGranularity,
  DispatchMetricsCustomer,
  DispatchMetricsOrder,
  DispatchMetricsResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  Clock,
  Download,
  Loader2,
  Receipt,
  Timer,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import { formatDateTime, formatMinutes, formatNumber, lineStatusMeta, minutesBetween } from '../lib/dispatch-sheet';
import { Badge, Card, DataTable, EmptyState, Segmented, Select, Skeleton, cx, type Column } from './ui';
import { EChart } from './EChart';

type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | '3m' | '6m' | '12m' | 'custom';

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes anterior' },
  { value: '3m', label: '3 meses' },
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
  { value: 'custom', label: 'Personalizado' },
];

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeFor(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  switch (preset) {
    case 'today':
      break;
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case 'month':
      start.setDate(1);
      break;
    case 'lastMonth':
      start.setMonth(start.getMonth() - 1, 1);
      end.setDate(0);
      break;
    case '3m':
      start.setMonth(start.getMonth() - 2, 1);
      break;
    case '6m':
      start.setMonth(start.getMonth() - 5, 1);
      break;
    case '12m':
      start.setMonth(start.getMonth() - 11, 1);
      break;
    default:
      start.setDate(start.getDate() - 29);
  }
  return { from: isoDate(start), to: isoDate(end) };
}

export function DispatchTimesReport({
  initialFrom,
  initialTo,
  onlyClosed = false,
}: {
  /** Rango inicial cuando el reporte se abre desde Historial. */
  initialFrom?: string;
  initialTo?: string;
  /** Solo despachos cerrados (historial), sin hojas abiertas. */
  onlyClosed?: boolean;
} = {}) {
  const initialRange = initialFrom && initialTo ? { from: initialFrom, to: initialTo } : rangeFor('30d');
  const [preset, setPreset] = useState<Preset>(initialFrom && initialTo ? 'custom' : '30d');
  const [range, setRange] = useState(initialRange);
  const [granularity, setGranularity] = useState<DispatchMetricGranularity>('day');
  const [customerCode, setCustomerCode] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState<'all' | 'pending' | 'delivered'>('all');

  function applyPreset(next: Preset) {
    setPreset(next);
    if (next !== 'custom') setRange(rangeFor(next));
  }

  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    granularity,
    invoiceStatus,
  });
  if (customerCode) params.set('customerCode', customerCode);
  if (onlyClosed) params.set('onlyClosed', 'true');

  const { data, isLoading, error, isFetching } = useQuery<DispatchMetricsResponse>({
    queryKey: ['dispatch-metrics', range.from, range.to, granularity, customerCode, invoiceStatus, onlyClosed],
    queryFn: () => apiFetch<DispatchMetricsResponse>(`/dispatch-sheets/metrics?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const customerOptions = useMemo(() => {
    const options = [{ value: '', label: 'Todos los clientes' }];
    for (const customer of data?.customers ?? []) {
      options.push({
        value: customer.customerCode ?? customer.customerName,
        label: `${customer.customerCode ? `${customer.customerCode} · ` : ''}${customer.customerName}`,
      });
    }
    if (customerCode && !options.some((option) => option.value === customerCode)) {
      options.push({ value: customerCode, label: customerCode });
    }
    return options;
  }, [data, customerCode]);

  const chartOption = useMemo(() => {
    const series = data?.series ?? [];
    return {
      grid: { left: 48, right: 18, top: 28, bottom: 36 },
      tooltip: {
        trigger: 'axis',
        formatter: (items: Array<{ seriesName: string; value: number | null; axisValue: string }>) => {
          const lines = items.map(
            (item) => `${item.seriesName}: ${item.value === null ? 'sin datos' : formatMinutes(item.value)}`,
          );
          return [items[0]?.axisValue ?? '', ...lines].join('<br/>');
        },
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: series.map((point) => point.label),
        axisLabel: { fontSize: 10, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: 'min',
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: '#e6e9ee' } },
      },
      series: [
        {
          name: 'Carga',
          type: 'line',
          smooth: true,
          symbolSize: 5,
          connectNulls: false,
          data: series.map((point) => point.loadAvgMinutes),
          lineStyle: { width: 2.5, color: '#5c7c2f' },
          itemStyle: { color: '#5c7c2f' },
        },
        {
          name: 'Total (envío → factura)',
          type: 'line',
          smooth: true,
          symbolSize: 5,
          connectNulls: false,
          data: series.map((point) => point.invoiceAvgMinutes),
          lineStyle: { width: 2.5, color: '#c47a00' },
          itemStyle: { color: '#c47a00' },
        },
      ],
    };
  }, [data]);

  const customerColumns: Column<DispatchMetricsCustomer>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      kind: 'id',
      sortValue: (row) => row.customerName,
      render: (row) => (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold text-on-surface">{row.customerName}</span>
          <span className="text-label-sm tabular-nums text-outline">{row.customerCode ?? 'sin código'}</span>
        </span>
      ),
    },
    {
      key: 'dispatches',
      header: 'Despachos',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.dispatches,
      render: (row) => <span className="tabular-nums">{row.dispatches}</span>,
    },
    {
      key: 'orders',
      header: 'Pedidos',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.orders,
      render: (row) => <span className="tabular-nums">{row.orders}</span>,
    },
    {
      key: 'lines',
      header: 'Renglones',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.lines,
      render: (row) => <span className="tabular-nums">{row.lines}</span>,
    },
    {
      key: 'kg',
      header: 'Kg',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.kg,
      render: (row) => <span className="tabular-nums">{formatNumber(row.kg)}</span>,
    },
    {
      key: 'load',
      header: 'Carga (envío → último producto)',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.loadAvgMinutes ?? -1,
      render: (row) => <MetricCell value={row.loadAvgMinutes} hint={row.loadP90Minutes !== null ? `P90 ${formatMinutes(row.loadP90Minutes)}` : undefined} />,
    },
    {
      key: 'invoice',
      header: 'Total (envío → factura)',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.invoiceAvgMinutes ?? -1,
      render: (row) => <MetricCell value={row.invoiceAvgMinutes} hint={row.invoiceP90Minutes !== null ? `P90 ${formatMinutes(row.invoiceP90Minutes)}` : undefined} />,
    },
    {
      key: 'pending',
      header: 'Pendientes',
      kind: 'status',
      align: 'right',
      sortValue: (row) => row.pendingInvoices,
      render: (row) =>
        row.pendingInvoices > 0 ? (
          <Badge tone="warning" dot>
            {row.pendingInvoices}
          </Badge>
        ) : (
          <Badge tone="success" dot>
            al día
          </Badge>
        ),
    },
    {
      key: 'onTime',
      header: 'A tiempo (carga)',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.onTimePct ?? -1,
      render: (row) => (
        <span className={cx('font-semibold tabular-nums', row.onTimePct === null ? 'text-outline' : row.onTimePct >= 90 ? 'text-secondary' : 'text-error')}>
          {row.onTimePct === null ? '—' : `${row.onTimePct}%`}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Última factura',
      kind: 'field',
      align: 'right',
      sortValue: (row) => row.lastInvoiceAt ?? '',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{formatDateTime(row.lastInvoiceAt)}</span>,
    },
  ];

  const orderColumns: Column<DispatchMetricsOrder>[] = [
    {
      key: 'order',
      header: 'Pedido',
      kind: 'id',
      sortValue: (row) => row.orderNumber,
      render: (row) => (
        <span className="flex flex-col leading-tight">
          <span className="font-bold tabular-nums text-primary">{row.orderNumber}</span>
          <span className="text-label-sm text-outline">{row.customerName}</span>
        </span>
      ),
    },
    {
      key: 'dispatch',
      header: 'Despacho',
      kind: 'field',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{row.dispatchNumber}</span>,
    },
    {
      key: 'product',
      header: 'Producto',
      kind: 'field',
      render: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-semibold text-on-surface">{row.productCode}</span>
          <span className="max-w-[18rem] truncate text-label-sm text-outline">{row.description ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'load',
      header: 'Carga (envío → cierre)',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.loadMinutes ?? -1,
      render: (row) => <MetricCell value={row.loadMinutes} hint={formatDateTime(row.loadClosedAt)} />,
    },
    {
      key: 'invoiceWait',
      header: 'Espera factura',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => minutesBetween(row.loadClosedAt, row.invoiceDeliveredAt) ?? -1,
      render: (row) => (
        <MetricCell
          value={minutesBetween(row.loadClosedAt, row.invoiceDeliveredAt)}
          hint={formatDateTime(row.invoiceDeliveredAt)}
        />
      ),
    },
    {
      key: 'invoice',
      header: 'Total (envío → factura)',
      kind: 'metric',
      align: 'right',
      sortValue: (row) => row.invoiceMinutes ?? -1,
      render: (row) => <MetricCell value={row.invoiceMinutes} hint={formatDateTime(row.invoiceDeliveredAt)} />,
    },
    {
      key: 'effective',
      header: 'Entrega plan',
      kind: 'field',
      align: 'right',
      render: (row) => <span className="tabular-nums text-on-surface-variant">{row.effectiveDate ?? '—'}</span>,
    },
    {
      key: 'ontime',
      header: 'A tiempo',
      kind: 'status',
      align: 'right',
      sortValue: (row) => (row.onTime === null ? -1 : row.onTime ? 1 : 0),
      render: (row) =>
        row.onTime === null ? (
          <Badge tone="muted">—</Badge>
        ) : row.onTime ? (
          <Badge tone="success" dot>
            sí
          </Badge>
        ) : (
          <Badge tone="danger" dot>
            tarde
          </Badge>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      kind: 'status',
      render: (row) => {
        const meta = lineStatusMeta(row.status);
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
  ];

  async function exportReport() {
    if (!data) return;
    const XLSX = await import('xlsx');
    const summary = [
      ['Reporte de tiempos de despacho'],
      [`Periodo ${data.range.from} a ${data.range.to} · agrupación ${granularity === 'day' ? 'día' : 'mes'}`],
      [],
      ['Despachos', data.summary.dispatches],
      ['Clientes', data.summary.customers],
      ['Pedidos', data.summary.orders],
      ['Renglones', data.summary.lines],
      ['Kg', data.summary.kg],
      ['Carga media: envío → último producto (min)', data.summary.load.avgMinutes ?? '—'],
      ['Carga mediana (min)', data.summary.load.medianMinutes ?? '—'],
      ['Carga P90 (min)', data.summary.load.p90Minutes ?? '—'],
      ['Total medio: envío → factura (min)', data.summary.invoice.avgMinutes ?? '—'],
      ['Total mediano (min)', data.summary.invoice.medianMinutes ?? '—'],
      ['Total P90 (min)', data.summary.invoice.p90Minutes ?? '—'],
      ['Tiempo total: envío → última factura (min)', data.summary.totalCycle.avgMinutes ?? '—'],
      ['Solo despacho: primer inicio → último cierre (min)', data.summary.loadWindow.avgMinutes ?? '—'],
      ['Respuesta del almacén: envío → primer inicio (min)', data.summary.response.avgMinutes ?? '—'],
      ['Espera de factura: cierre → factura (min)', data.summary.invoiceWait.avgMinutes ?? '—'],
      ['Envío → último cierre (min)', data.summary.dispatchCycle.avgMinutes ?? '—'],
      ['Facturas pendientes', data.summary.invoice.pending],
      ['% a tiempo (carga)', data.summary.onTime.pct ?? '—'],
    ];
    const customers = [
      ['Cliente', 'Código', 'Despachos', 'Pedidos', 'Renglones', 'Kg', 'Carga media (envío → último producto)', 'Carga P90', 'Total medio (envío → factura)', 'Total P90', 'Pendientes', '% a tiempo', 'Última factura'],
      ...data.customers.map((row) => [
        row.customerName,
        row.customerCode ?? '',
        row.dispatches,
        row.orders,
        row.lines,
        row.kg,
        row.loadAvgMinutes ?? '',
        row.loadP90Minutes ?? '',
        row.invoiceAvgMinutes ?? '',
        row.invoiceP90Minutes ?? '',
        row.pendingInvoices,
        row.onTimePct ?? '',
        row.lastInvoiceAt ?? '',
      ]),
    ];
    const orders = [
      [
        'Pedido',
        'Cliente',
        'Despacho',
        'Producto',
        'Enviado',
        'Último producto',
        'Min envío → cierre',
        'Espera factura (min)',
        'Factura entregada',
        'Min total envío → factura',
        'Entrega plan',
        'A tiempo',
        'Estado',
        'Kg',
      ],
      ...data.orders.map((row) => [
        row.orderNumber,
        row.customerName,
        row.dispatchNumber,
        row.productCode,
        row.loadStartedAt ?? '',
        row.loadClosedAt ?? '',
        row.loadMinutes ?? '',
        minutesBetween(row.loadClosedAt, row.invoiceDeliveredAt) ?? '',
        row.invoiceDeliveredAt ?? '',
        row.invoiceMinutes ?? '',
        row.effectiveDate ?? '',
        row.onTime === null ? '' : row.onTime ? 'SÍ' : 'TARDE',
        row.status,
        row.kg,
      ]),
    ];
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of [
      ['Resumen', summary],
      ['Por cliente', customers],
      ['Por renglón', orders],
    ] as const) {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = rows[0]?.map(() => ({ wch: 18 })) ?? [];
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    XLSX.writeFile(workbook, `tiempos-despacho-${data.range.from}-${data.range.to}.xlsx`, { compression: true });
  }

  if (error instanceof AuthRequiredError) {
    return <p className="text-body-md text-error">Tu sesión expiró. Vuelve a iniciar sesión.</p>;
  }

  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="p-space-md">
        <div className="flex flex-wrap items-end justify-between gap-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            <Select
              className="w-40"
              value={preset}
              onChange={(value) => applyPreset(value as Preset)}
              options={PRESETS}
              ariaLabel="Periodo del reporte"
            />
            <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
              Desde
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(event) => {
                  setPreset('custom');
                  setRange((current) => ({ ...current, from: event.target.value }));
                }}
                className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
              />
            </label>
            <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
              Hasta
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(event) => {
                  setPreset('custom');
                  setRange((current) => ({ ...current, to: event.target.value }));
                }}
                className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md"
              />
            </label>
            <Segmented
              ariaLabel="Agrupación"
              value={granularity}
              onChange={(value) => setGranularity(value as DispatchMetricGranularity)}
              options={[
                { value: 'day', label: 'Día' },
                { value: 'month', label: 'Mes' },
              ]}
            />
            <Select
              className="w-64"
              value={customerCode}
              onChange={setCustomerCode}
              options={customerOptions}
              ariaLabel="Cliente"
            />
            <Select
              className="w-44"
              value={invoiceStatus}
              onChange={(value) => setInvoiceStatus(value as 'all' | 'pending' | 'delivered')}
              options={[
                { value: 'all', label: 'Factura: todas' },
                { value: 'pending', label: 'Pendientes' },
                { value: 'delivered', label: 'Entregadas' },
              ]}
              ariaLabel="Estado de factura"
            />
          </div>
          <div className="flex items-center gap-space-sm">
            {isFetching && <Loader2 aria-hidden className="size-4 animate-spin text-outline" />}
            <button
              type="button"
              onClick={() => void exportReport()}
              disabled={!data || isLoading}
              className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            >
              <Download aria-hidden className="size-4" /> Excel
            </button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-card" />
          ))}
        </div>
      ) : !data ? (
        <Card>
          <EmptyState
            icon={CalendarRange}
            title="Sin datos de tiempos"
            description="No hay despachos con cierres de carga o facturas entregadas en este periodo."
          />
        </Card>
      ) : (
        <>
          <Card className="p-space-md">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-space-sm marker:content-none">
                <span className="flex items-center gap-space-sm">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary-fixed text-primary">
                    <Clock aria-hidden className="size-4" />
                  </span>
                  <span>
                    <span className="block font-bold text-primary">Cómo se miden los tiempos</span>
                    <span className="block text-label-sm normal-case text-on-surface-variant">
                      Envío, primer producto, carga, factura y total, sin ambigüedad.
                    </span>
                  </span>
                </span>
                <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-space-sm grid gap-space-sm md:grid-cols-2 xl:grid-cols-3">
                <Definition title="Envío (T0)" text="Instante en que planificación publica la simulación como despacho. Es el punto de partida de todos los tiempos: no depende de «Iniciar carga»." />
                <Definition title="Respuesta del almacén" text="Desde el envío hasta el primer producto marcado. Mide cuánto tarda el piso en registrar el primer movimiento." />
                <Definition title="Carga por cliente" text="Desde el envío del despacho hasta el último producto cerrado del cliente. Es lo que tardó el pedido en quedar cargado desde que salió de la simulación." />
                <Definition title="Solo despacho (ventana)" text="Del primer producto marcado al último cierre del despacho. No es suma ni promedio: es la ventana de marcado." />
                <Definition title="Espera de factura" text="Desde el cierre de carga del cliente hasta que se marca su factura entregada. Es tiempo administrativo, no de almacén." />
                <Definition title="Tiempo total" text="Desde el envío hasta que se entrega la factura del cliente. Ahí culmina el tiempo total del pedido. Si falta la factura no se inventa: se muestra en curso." />
              </div>
            </details>
          </Card>

          <div className="grid grid-cols-2 gap-space-sm lg:grid-cols-4">
            <Kpi
              icon={Timer}
              label="Tiempo total"
              value={formatMinutes(data.summary.totalCycle.avgMinutes)}
              hint={`Envío → última factura · ${data.summary.totalCycle.groups} despacho(s)`}
            />
            <Kpi
              icon={Truck}
              label="Solo despacho"
              value={formatMinutes(data.summary.loadWindow.avgMinutes)}
              hint={`Primer producto → último cierre · ${data.summary.loadWindow.groups} despacho(s)`}
            />
            <Kpi
              icon={Clock}
              label="Respuesta almacén"
              value={formatMinutes(data.summary.response.avgMinutes)}
              hint={`Envío → primer producto · ${data.summary.response.groups} despacho(s)`}
            />
            <Kpi
              icon={Clock}
              label="Carga media"
              value={formatMinutes(data.summary.load.avgMinutes)}
              hint={`P90 ${formatMinutes(data.summary.load.p90Minutes)} · ${data.summary.load.groups} cliente(s)`}
            />
            <Kpi
              icon={Receipt}
              label="Espera de factura"
              value={formatMinutes(data.summary.invoiceWait.avgMinutes)}
              hint={`Cierre → factura · ${data.summary.invoiceWait.groups} cliente(s)`}
            />
            <Kpi
              icon={Timer}
              label="Envío → cierre"
              value={formatMinutes(data.summary.dispatchCycle.avgMinutes)}
              hint={`Hasta cerrar la carga · ${data.summary.dispatchCycle.groups} despacho(s)`}
            />
            <Kpi
              icon={Receipt}
              label="Facturas pendientes"
              value={`${data.summary.invoice.pending}`}
              hint={`${data.summary.invoice.groups} entregada(s)`}
              tone={data.summary.invoice.pending > 0 ? 'warning' : 'success'}
            />
            <Kpi
              icon={TrendingUp}
              label="A tiempo (carga)"
              value={data.summary.onTime.pct === null ? '—' : `${data.summary.onTime.pct}%`}
              hint={`${data.summary.onTime.orders} pedido(s) con fecha plan`}
              tone={data.summary.onTime.pct !== null && data.summary.onTime.pct < 90 ? 'warning' : 'success'}
            />
          </div>

          <Card className="p-space-md">
            <div className="mb-space-sm flex flex-wrap items-center justify-between gap-space-sm">
              <div>
                <p className="font-bold text-primary">Evolución de tiempos</p>
                <p className="text-label-sm normal-case text-on-surface-variant">
                  Promedio por {granularity === 'day' ? 'día' : 'mes'} de cierre de carga. «Carga» va del envío del despacho al último producto; «Total», del envío a la entrega de la factura de la misma cohorte.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-space-xs text-label-sm text-on-surface-variant">
                <Badge tone="muted">{data.summary.dispatches} despacho(s)</Badge>
                <Badge tone="muted">{data.summary.customers} cliente(s)</Badge>
                <Badge tone="muted">{data.summary.orders} pedido(s)</Badge>
                <Badge tone="muted">{data.summary.lines} renglón(es)</Badge>
                <Badge tone="muted">{formatNumber(data.summary.kg)} kg</Badge>
              </div>
            </div>
            <EChart option={chartOption} height={300} ariaLabel="Tiempos de carga y factura por periodo" />
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
              <p className="font-bold text-primary">Por cliente</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Tiempos medios y P90. «Pendientes» son clientes con carga cerrada y factura sin entregar.
              </p>
            </div>
            <DataTable
              columns={customerColumns}
              rows={data.customers}
              rowKey={(row) => row.customerCode ?? row.customerName}
              defaultSortKey="load"
              mobileSummary={<span>{data.customers.length} cliente(s) con actividad</span>}
              empty={
                <EmptyState
                  icon={Users}
                  title="Sin clientes en el periodo"
                  description="Cambia el rango o quita el filtro de factura."
                />
              }
            />
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
              <p className="font-bold text-primary">Detalle por renglón</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Hasta 3.000 renglones. La fecha plan es la entrega esperada del renglón; «tarde» significa que la carga se cerró después.
              </p>
            </div>
            <DataTable
              columns={orderColumns}
              rows={data.orders}
              rowKey={(row) => `${row.dispatchId}-${row.orderNumber}-${row.productCode}`}
              defaultSortKey="load"
              maxHeightClass="md:max-h-[min(70vh,900px)]"
              mobileSummary={<span>{data.orders.length} renglón(es) en el detalle</span>}
              empty={<EmptyState icon={CalendarRange} title="Sin renglones en el periodo" description="Prueba con otro rango o cliente." />}
            />
          </Card>

          <p className="text-label-sm normal-case text-on-surface-variant">
            <AlertTriangle aria-hidden className="mr-1 inline size-3.5" />
            Tiempo total = envío → última factura. Solo despacho = primer inicio → último cierre. Los renglones anulados no entran en ningún cálculo.
          </p>
        </>
      )}

      {error && !(error instanceof AuthRequiredError) && (
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'No se pudo consultar el reporte'}
        </p>
      )}
    </div>
  );
}

function Definition({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-space-sm py-space-xs">
      <p className="text-label-md font-bold text-primary">{title}</p>
      <p className="text-label-sm normal-case text-on-surface-variant">{text}</p>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'primary',
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint: string;
  tone?: 'primary' | 'success' | 'warning';
}) {  return (
    <Card className="flex flex-col gap-1 p-space-md">
      <span className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline">
        <Icon aria-hidden className="size-3.5" /> {label}
      </span>
      <span
        className={cx(
          'text-data-tabular-lg font-bold tabular-nums',
          tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-secondary' : 'text-primary',
        )}
      >
        {value}
      </span>
      <span className="text-label-sm text-on-surface-variant">{hint}</span>
    </Card>
  );
}

function MetricCell({ value, hint }: { value: number | null; hint?: string }) {
  return (
    <span className="flex flex-col items-end leading-tight tabular-nums">
      <span className={cx('font-semibold', value === null ? 'text-outline' : 'text-primary')}>{formatMinutes(value)}</span>
      {hint && <span className="text-label-sm text-outline">{hint}</span>}
    </span>
  );
}



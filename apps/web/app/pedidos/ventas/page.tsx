'use client';

// ============================================================
// Pedidos → Ventas (analítica comercial).
//
// Responde: qué se vendió, a quién, cómo va el año contra el año anterior,
// cuánto está pendiente y cuánto ya se procesó. La venta se mide por nota de
// entrega (Profit); el facturado por CxC. Son fuentes distintas y se dicen.
// ============================================================

import type {
  Customer,
  SalesAnalyticsCustomer,
  SalesAnalyticsCustomersResponse,
  SalesAnalyticsResponse,
  SalesAnalyticsSort,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Info,
  Package,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CustomerInsightsModal } from '../../../components/CustomerInsightsModal';
import { CustomerStatementDialog } from '../../../components/CustomerStatementDialog';
import { EChart } from '../../../components/EChart';
import { PedidosDenied, PedidosTabs } from '../../../components/PedidosTabs';
import { AppNav, LoginScreen } from '../../../components/shell';
import {
  Badge,
  Card,
  CoverageBar,
  DataTable,
  EmptyState,
  HeroCard,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Td,
  TextInput,
  Th,
  TrendPill,
  fmtDate,
  fmtQty,
  useGreeting,
  type Column,
} from '../../../components/ui';
import { apiFetch, currentUser } from '../../../lib/api';
import { hasPermission } from '../../../lib/permissions';
import {
  ANALYTICS_COLORS as C,
  ANALYTICS_TOOLTIP,
  buildCustomersCsv,
  downloadCsv,
  fmtMoney,
  fmtPct,
  fmtTonnes,
  pctTone,
  statusLabel,
  statusTone,
} from '../../../lib/sales-analytics';

const PAGE_SIZE = 25;

const SORT_OPTIONS: Array<{ value: SalesAnalyticsSort; label: string }> = [
  { value: 'kg_desc', label: 'Vendido: mayor a menor' },
  { value: 'kg_asc', label: 'Vendido: menor a mayor' },
  { value: 'yoy_desc', label: 'Crecimiento: mayor primero' },
  { value: 'yoy_asc', label: 'Caída: mayor primero' },
  { value: 'pending_desc', label: 'Cartera pendiente: mayor primero' },
  { value: 'recent_desc', label: 'Última compra: más reciente' },
  { value: 'name_asc', label: 'Cliente: A → Z' },
];

const UNIT_OPTIONS = [
  { value: 'kg', label: 'Toneladas' },
  { value: 'USD', label: 'USD' },
  { value: 'VES', label: 'Bs' },
] as const;

const ALERT_ICON = {
  DROP: TrendingDown,
  NEW: TrendingUp,
  LOST: AlertTriangle,
  CONCENTRATION: Trophy,
  PENDING: Package,
} as const;

function toCustomer(row: SalesAnalyticsCustomer): Customer {
  return {
    id: row.code,
    externalCode: row.code,
    name: row.name,
    customerType: row.customerType,
    vendor: row.vendor,
    isActive: true,
    ordersCount: row.pendingOrders,
    sales: null,
  };
}

function truncate(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function PedidosVentasPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [unit, setUnit] = useState<'kg' | 'USD' | 'VES'>('kg');
  const [vendor, setVendor] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SalesAnalyticsSort>('kg_desc');
  const [q, setQ] = useState('');
  const [insightsCustomer, setInsightsCustomer] = useState<Customer | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [exporting, setExporting] = useState(false);
  const greeting = useGreeting();

  const currency = unit === 'VES' ? 'VES' : 'USD';

  const session = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const sessionUser = session.data;
  const canView = hasPermission(sessionUser?.permissions, 'pedidos', 'view_summary');
  // La ficha 360 y la cuenta viven en el módulo Clientes: si el rol no lo ve,
  // la tabla sigue mostrando datos pero sin botones que terminen en 403.
  const canViewCustomer = hasPermission(sessionUser?.permissions, 'clientes', 'read');
  const canViewHistory = hasPermission(sessionUser?.permissions, 'pedidos', 'view_history');
  const signedIn = Boolean(sessionUser);

  const baseParams = new URLSearchParams();
  baseParams.set('year', String(year));
  baseParams.set('currency', currency);
  if (vendor) baseParams.set('vendor', vendor);

  const reportQuery = useQuery<SalesAnalyticsResponse>({
    queryKey: ['sales-analytics', year, currency, vendor],
    queryFn: () => apiFetch<SalesAnalyticsResponse>(`/sales/analytics?${baseParams.toString()}`),
    enabled: signedIn && canView,
    staleTime: 60_000,
    retry: 1,
  });
  const report = reportQuery.data;

  const customerParams = new URLSearchParams(baseParams);
  customerParams.set('page', String(page));
  customerParams.set('pageSize', String(PAGE_SIZE));
  customerParams.set('sort', sort);
  if (q.trim()) customerParams.set('q', q.trim());

  const customersQuery = useQuery<SalesAnalyticsCustomersResponse>({
    queryKey: ['sales-analytics-customers', year, currency, vendor, page, sort, q],
    queryFn: () =>
      apiFetch<SalesAnalyticsCustomersResponse>(`/sales/analytics/customers?${customerParams.toString()}`),
    enabled: signedIn && canView,
    staleTime: 60_000,
    retry: 1,
  });

  const vendorOptions = useMemo(() => {
    const names = (report?.vendors ?? []).map((entry) => entry.name).filter(Boolean);
    return [
      { value: '', label: 'Todos los vendedores' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [report?.vendors]);

  const currentIndex = report?.monthly.findIndex((entry) => entry.isCurrent) ?? -1;

  const monthlyOption = useMemo(() => {
    if (!report) return {};
    const money = unit !== 'kg';
    const values = report.monthly.map((entry) => (money ? entry.billed ?? 0 : entry.kg));
    const previous = report.monthly.map((entry) => (money ? entry.prevYearBilled ?? 0 : entry.prevYearKg ?? 0));
    const formatter = (raw: unknown) => {
      const params = raw as Array<{ axisValue: string; seriesName: string; value: number; marker: string }>;
      const first = params[0];
      if (!first) return '';
      const lines = params.map(
        (entry) =>
          `${entry.marker}${entry.seriesName}: <b>${money ? fmtMoney(entry.value, currency) : fmtTonnes(entry.value)}</b>`,
      );
      return `<div style="font-weight:700;margin-bottom:4px">${first.axisValue}</div>${lines.join('<br/>')}`;
    };
    return {
      animationDuration: 420,
      tooltip: { trigger: 'axis', ...ANALYTICS_TOOLTIP, formatter },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: C.ink, fontSize: 11 },
        data: [String(report.year), String(report.year - 1)],
      },
      grid: { left: 8, right: 8, top: 38, bottom: 6, containLabel: true },
      xAxis: {
        type: 'category',
        data: report.monthly.map((entry) => entry.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.outline, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: C.outline,
          fontSize: 10,
          formatter: (value: number) => (money ? `$${Math.round(value / 1000)}k` : `${Math.round(value / 1000)}t`),
        },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        {
          name: String(report.year),
          type: 'bar',
          barMaxWidth: 26,
          data: values.map((value, index) => ({
            value,
            itemStyle: {
              color: index === currentIndex ? C.lime : C.navy,
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
        {
          name: String(report.year - 1),
          type: 'line',
          data: previous,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: C.lime, type: 'dashed' },
          itemStyle: { color: C.lime },
        },
      ],
    };
  }, [report, unit, currency, currentIndex]);

  const topCustomersOption = useMemo(() => {
    const rows = report?.topCustomers ?? [];
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...ANALYTICS_TOOLTIP,
        formatter: (raw: unknown) => {
          const params = raw as Array<{ dataIndex: number }>;
          const row = rows[params[0]?.dataIndex ?? 0];
          if (!row) return '';
          return `<b>${row.name}</b><br/>${fmtTonnes(row.kg)} · ${row.sharePct ?? '—'} % del año<br/>${
            row.yoyPct === null ? 'Sin base el año anterior' : `${fmtPct(row.yoyPct)} vs ${report?.year ? report.year - 1 : ''}`
          }`;
        },
      },
      grid: { left: 4, right: 34, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((row) => truncate(row.name, 26)),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: C.ink, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => row.kg),
          barMaxWidth: 18,
          itemStyle: { color: C.navy, borderRadius: [0, 6, 6, 0] },
          label: {
            show: true,
            position: 'right',
            color: C.outline,
            fontSize: 10,
            formatter: (raw: unknown) => {
              const params = raw as { dataIndex: number };
              return `${rows[params.dataIndex]?.sharePct ?? 0} %`;
            },
          },
        },
      ],
    };
  }, [report]);

  const topProductsOption = useMemo(() => {
    const rows = report?.topProducts ?? [];
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...ANALYTICS_TOOLTIP,
        formatter: (raw: unknown) => {
          const params = raw as Array<{ dataIndex: number }>;
          const row = rows[params[0]?.dataIndex ?? 0];
          if (!row) return '';
          return `<b>${row.description ?? row.code}</b><br/>${fmtTonnes(row.kg)} · ${row.sharePct ?? '—'} % del año<br/>${
            row.yoyPct === null ? 'Sin base el año anterior' : `${fmtPct(row.yoyPct)} vs ${report?.year ? report.year - 1 : ''}`
          }`;
        },
      },
      grid: { left: 4, right: 34, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((row) => truncate(row.description ?? row.code, 26)),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: C.ink, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => row.kg),
          barMaxWidth: 18,
          itemStyle: { color: C.lime, borderRadius: [0, 6, 6, 0] },
          label: {
            show: true,
            position: 'right',
            color: C.outline,
            fontSize: 10,
            formatter: (raw: unknown) => {
              const params = raw as { dataIndex: number };
              return `${rows[params.dataIndex]?.sharePct ?? 0} %`;
            },
          },
        },
      ],
    };
  }, [report]);

  const statusOption = useMemo(() => {
    if (!report) return {};
    const buckets = [
      { name: 'Abiertos (cartera)', value: report.statusMix.open.kg, color: C.navy },
      { name: 'Procesados', value: report.statusMix.closed.kg, color: C.lime },
      { name: 'Cancelados', value: report.statusMix.canceled.kg, color: C.red },
    ];
    const statusKg = buckets.reduce((acc, entry) => acc + entry.value, 0);
    return {
      tooltip: {
        trigger: 'item',
        ...ANALYTICS_TOOLTIP,
        formatter: (raw: unknown) => {
          const params = raw as { name: string; value: number; percent: number; marker: string };
          return `${params.marker}${params.name}<br/><b>${fmtTonnes(params.value)}</b> · ${params.percent} %`;
        },
      },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: C.ink, fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '82%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: '#ffffff', borderWidth: 3 },
          data: buckets.map((entry) => ({
            name: entry.name,
            value: entry.value,
            itemStyle: { color: entry.color },
          })),
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '38%',
          style: {
            text: fmtTonnes(statusKg, 0),
            fill: C.navy,
            fontSize: 20,
            fontWeight: 800,
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '47%',
          style: { text: 'kg por estado', fill: C.outline, fontSize: 10 },
        },
      ],
    };
  }, [report]);

  const columns = useMemo<Column<SalesAnalyticsCustomer>[]>(
    () => [
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'id',
        render: (row) =>
          canViewCustomer ? (
            <button
              type="button"
              onClick={() => setInsightsCustomer(toCustomer(row))}
              className="max-w-[24rem] text-left"
              title={`Abrir ficha 360 de ${row.name}`}
            >
              <span className="block truncate font-bold text-primary underline decoration-dotted underline-offset-2">
                {row.name}
              </span>
              <span className="block text-label-sm text-on-surface-variant">{row.code}</span>
            </button>
          ) : (
            <span className="block max-w-[24rem]">
              <span className="block truncate font-bold text-primary">{row.name}</span>
              <span className="block text-label-sm text-on-surface-variant">{row.code}</span>
            </span>
          ),
      },
      {
        key: 'vendedor',
        header: 'Vendedor',
        kind: 'field',
        render: (row) => <span className="text-on-surface-variant">{row.vendor ?? '—'}</span>,
      },
      {
        key: 'tipo',
        header: 'Tipo',
        kind: 'field',
        render: (row) => <span className="text-on-surface-variant">{row.customerType ?? '—'}</span>,
      },
      {
        key: 'kg',
        header: 'Vendido YTD',
        align: 'right',
        kind: 'metric',
        render: (row) => (
          <span className="font-bold tabular-nums text-primary">{fmtTonnes(row.kg)}</span>
        ),
      },
      {
        key: 'yoy',
        header: 'vs año ant.',
        align: 'right',
        kind: 'metric',
        render: (row) =>
          row.yoyPct === null ? (
            <span className="text-outline" title="Sin ventas el año anterior">
              —
            </span>
          ) : (
            <TrendPill value={fmtPct(row.yoyPct)} tone={pctTone(row.yoyPct)} />
          ),
      },
      {
        key: 'notas',
        header: 'Notas',
        align: 'right',
        kind: 'metric',
        render: (row) => <span className="tabular-nums text-on-surface-variant">{row.notes}</span>,
      },
      {
        key: 'billed',
        header: 'Facturado',
        align: 'right',
        kind: 'metric',
        render: (row) => (
          <span className="tabular-nums text-on-surface">{fmtMoney(row.billed, currency)}</span>
        ),
      },
      {
        key: 'pending',
        header: 'Pendiente',
        align: 'right',
        kind: 'metric',
        render: (row) => (
          <span className="flex flex-col items-end">
            <span className={`font-bold tabular-nums ${row.pendingKg > 0 ? 'text-warning' : 'text-outline'}`}>
              {fmtTonnes(row.pendingKg)}
            </span>
            <span className="text-label-sm text-on-surface-variant">
              {row.pendingOrders} pedido{row.pendingOrders === 1 ? '' : 's'}
            </span>
          </span>
        ),
      },
      {
        key: 'ultima',
        header: 'Última compra',
        kind: 'field',
        render: (row) => <span className="tabular-nums text-on-surface-variant">{fmtDate(row.lastSaleDate)}</span>,
      },
      {
        key: 'estado',
        header: 'Estado',
        kind: 'status',
        render: (row) => <Badge tone={statusTone(row.status)} dot>{statusLabel(row.status)}</Badge>,
      },
    ],
    [currency, canViewCustomer],
  );

  async function exportAll() {
    if (!report) return;
    setExporting(true);
    try {
      const collected: SalesAnalyticsCustomer[] = [];
      let current = 1;
      let total = Infinity;
      while (collected.length < total && current <= 40) {
        const params = new URLSearchParams(baseParams);
        params.set('page', String(current));
        params.set('pageSize', '200');
        params.set('sort', sort);
        if (q.trim()) params.set('q', q.trim());
        const chunk = await apiFetch<SalesAnalyticsCustomersResponse>(
          `/sales/analytics/customers?${params.toString()}`,
        );
        collected.push(...chunk.items);
        total = chunk.total;
        if (chunk.items.length === 0) break;
        current += 1;
      }
      downloadCsv(
        `pedidos-ventas-${report.year}-${report.currency}.csv`,
        buildCustomersCsv(report, collected),
      );
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

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2].map((value) => ({
    value: String(value),
    label: String(value),
  }));

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Analítica comercial"
          icon={BarChart3}
          greeting={greeting}
          title="Pedidos y ventas"
          subtitle="Qué se vendió, a quién y cómo va el año contra el mismo tramo del año anterior. La venta se mide por nota de entrega; la facturación por CxC. Los pedidos pendientes y procesados vienen de la capa local."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Badge tone={report?.available ? 'success' : 'warning'} dot>
                {report?.available ? 'Profit en línea' : 'Sin datos de ventas'}
              </Badge>
              <button
                type="button"
                onClick={() => void reportQuery.refetch()}
                disabled={reportQuery.isFetching}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                <RefreshCw aria-hidden className={`size-4 ${reportQuery.isFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          }
        />

        <PedidosTabs active="ventas" permissions={sessionUser.permissions} />

        {!canView ? (
          <PedidosDenied title="No tienes acceso a Ventas" allowedHref="/pedidos" />
        ) : (
          <>
            <Card className="p-space-md">
              <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12 lg:items-end">
                <div className="lg:col-span-2">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Año
                  </label>
                  <Select
                    ariaLabel="Año de la analítica"
                    value={String(year)}
                    options={yearOptions}
                    onChange={(value) => {
                      setYear(Number(value));
                      setPage(1);
                    }}
                  />
                </div>
                <div className="lg:col-span-5">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Medida de la gráfica
                  </label>
                  <Segmented
                    ariaLabel="Medida de la gráfica"
                    value={unit}
                    onChange={(value) => setUnit(value)}
                    options={[...UNIT_OPTIONS]}
                  />
                </div>
                <div className="lg:col-span-5">
                  <label className="mb-space-2xs block font-semibold uppercase tracking-wider text-label-sm text-outline">
                    Vendedor
                  </label>
                  <Select
                    ariaLabel="Filtrar por vendedor"
                    value={vendor}
                    options={vendorOptions}
                    onChange={(value) => {
                      setVendor(value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
              <div className="mt-space-sm flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                <span className="inline-flex items-center gap-space-2xs">
                  <CalendarRange aria-hidden className="size-3.5" />
                  {report?.period.label ?? `Año ${year}`}
                </span>
                {report && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {report.totals.notes} notas · {report.totals.customers} clientes con compra
                    </span>
                    <span aria-hidden>·</span>
                    <span>datos al {fmtDate(report.asOf)}</span>
                  </>
                )}
                <span className="ml-auto inline-flex items-center gap-space-2xs">
                  <Info aria-hidden className="size-3.5" />
                  {report?.available
                    ? 'Notas de entrega de Profit (solo lectura)'
                    : 'Profit no respondió: no se pintan ceros como ventas'}
                </span>
              </div>
            </Card>

            {reportQuery.error && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" />
                {reportQuery.error instanceof Error
                  ? reportQuery.error.message
                  : 'No se pudo cargar la analítica'}
              </p>
            )}

            {report && !report.available && (
              <p role="status" className="flex items-center gap-space-sm rounded-xl border border-warning/30 bg-warning-container/40 px-space-md py-space-sm text-body-md text-on-warning-container">
                <AlertTriangle aria-hidden className="size-4" />
                No se pudieron leer las ventas de Profit. Se muestran los pedidos locales (pendientes y procesados), pero las ventas están incompletas.
              </p>
            )}

            {report && !report.billingAvailable && (
              <p role="status" className="flex items-center gap-space-sm rounded-xl border border-warning/30 bg-warning-container/40 px-space-md py-space-sm text-body-md text-on-warning-container">
                <AlertTriangle aria-hidden className="size-4" />
                No se pudo leer la facturación de CxC. Los montos se muestran como «—».
              </p>
            )}

            {report && (
              <>
                <section className="grid gap-space-md xl:grid-cols-12">
                  <div className="xl:col-span-4">
                    <HeroCard
                      label="Vendido en el año"
                      value={report.available ? fmtTonnes(report.totals.kg, 0) : '—'}
                      hint={
                        report.available
                          ? `${fmtPct(report.comparison.ytdPct)} vs mismo tramo ${report.year - 1} · ${fmtQty(report.totals.sacks, 0)} sacos`
                          : 'Profit no respondió: no hay ventas que mostrar'
                      }
                      icon={TrendingUp}
                      footer={
                        report.available ? (
                          <div className="flex flex-wrap items-center gap-space-xs text-label-sm text-white/70">
                            <span>{report.comparison.monthLabel}</span>
                            <span aria-hidden>·</span>
                            <span>{fmtTonnes(report.comparison.monthKg)}</span>
                            <span aria-hidden>·</span>
                            <span>{fmtPct(report.comparison.sameMonthYoyPct)} vs mismo mes {report.year - 1}</span>
                          </div>
                        ) : undefined
                      }
                    />
                    <div className="mt-space-sm grid grid-cols-2 gap-space-sm">
                      <Kpi
                        label={`Año ${report.year - 1}`}
                        value={report.available ? fmtTonnes(report.comparison.prevYtdKg, 1) : '—'}
                        hint="mismo tramo comparable"
                        tone="muted"
                        icon={CalendarRange}
                      />
                      <Kpi
                        label="Mes anterior"
                        value={report.available ? fmtTonnes(report.comparison.prevMonthKg, 1) : '—'}
                        hint={report.available ? `${fmtPct(report.comparison.momPct)} mes a mes` : 'sin datos'}
                        tone="muted"
                        icon={ArrowDownRight}
                      />
                    </div>
                  </div>

                  <div className="grid gap-space-sm sm:grid-cols-2 xl:col-span-8 xl:grid-cols-3">
                    <Kpi
                      label={`Vs ${report.year - 1}`}
                      value={report.available ? fmtPct(report.comparison.ytdPct) : '—'}
                      hint={
                        report.available
                          ? `${fmtTonnes(report.comparison.ytdKg)} este año vs ${fmtTonnes(report.comparison.prevYtdKg)}`
                          : 'sin ventas de Profit'
                      }
                      tone={report.comparison.ytdPct !== null && report.comparison.ytdPct < 0 ? 'danger' : 'success'}
                      icon={report.comparison.ytdPct !== null && report.comparison.ytdPct < 0 ? ArrowDownRight : TrendingUp}
                    />
                    <Kpi
                      label="Facturado del año"
                      labelTitle="Facturado del año a la fecha (YTD): documentos de CxC en Profit —facturas y notas de débito menos notas de crédito— emitidos del 1 de enero a hoy, en la moneda seleccionada. Es facturación emitida, no caja cobrada: puede diferir 1–2 % del despacho."
                      value={report.billingAvailable ? fmtMoney(report.comparison.ytdBilled, currency) : '—'}
                      hint={
                        !report.billingAvailable
                          ? 'CxC no respondió'
                          : report.comparison.ytdBilledPct === null
                            ? 'sin base comparable'
                            : `${fmtPct(report.comparison.ytdBilledPct)} vs ${report.year - 1}`
                      }
                      tone="primary"
                      icon={Receipt}
                    />
                    <Kpi
                      label="Pedidos procesados"
                      value={String(report.statusMix.closed.orders)}
                      hint={`${fmtTonnes(report.statusMix.closed.kg)} · ${report.statusMix.canceled.orders} cancelados`}
                      tone="success"
                      icon={ShoppingCart}
                    />
                    <Kpi
                      label="Cartera pendiente"
                      value={fmtTonnes(report.pending.kg)}
                      hint={`${report.pending.orders} pedidos · ${report.pending.customers} clientes${
                        report.pending.nextDeliveryDate
                          ? ` · próxima ${fmtDate(report.pending.nextDeliveryDate)}`
                          : ''
                      }`}
                      tone="warning"
                      icon={Package}
                    />
                    <Kpi
                      label="Clientes con compra"
                      value={report.available ? String(report.totals.customers) : '—'}
                      hint={
                        report.available
                          ? `${report.totals.newCustomers} nuevos · ${report.totals.lostCustomers} sin compra`
                          : 'sin ventas de Profit'
                      }
                      tone="primary"
                      icon={Users}
                    />
                    <Kpi
                      label="Ticket promedio"
                      value={report.available ? fmtTonnes(report.totals.avgKgPerNote ?? 0) : '—'}
                      hint={
                        report.available
                          ? `${report.totals.notes} notas · ${fmtMoney(report.totals.avgBilledPerNote, currency)} por nota`
                          : 'sin notas'
                      }
                      tone="muted"
                      icon={Trophy}
                    />
                  </div>
                </section>

                <section className="grid gap-space-md xl:grid-cols-12">
                  <Card className="flex flex-col p-space-md xl:col-span-8">
                    <div className="mb-space-sm flex flex-wrap items-start justify-between gap-space-sm">
                      <div>
                        <p className="text-title-md font-semibold text-primary">Ventas por mes</p>
                        <p className="text-label-sm text-on-surface-variant">
                          Barras del año {report.year} y línea del mismo mes de {report.year - 1}. El mes en curso va marcado en verde.
                        </p>
                      </div>
                      <Badge tone="muted" dot>
                        {report.comparison.elapsedDays} días transcurridos
                      </Badge>
                    </div>
                    {report.available ? (
                      <EChart
                        option={monthlyOption}
                        height={300}
                        ariaLabel={`Ventas mensuales de ${report.year} contra ${report.year - 1}`}
                      />
                    ) : (
                      <EmptyState
                        icon={BarChart3}
                        title="Sin ventas para graficar"
                        description="Profit no respondió. La cartera y los pedidos procesados siguen disponibles."
                      />
                    )}
                    <div className="mt-space-sm flex flex-wrap items-center gap-space-sm border-t border-outline-variant/25 pt-space-sm text-label-sm text-on-surface-variant">
                      <Badge tone="success" dot>
                        {report.comparison.monthLabel}: {fmtTonnes(report.comparison.monthKg)}
                      </Badge>
                      <span>
                        Mismo tramo {report.year - 1}: {fmtTonnes(report.comparison.sameMonthPrevYearKg)} ·{' '}
                        <strong className={report.comparison.sameMonthYoyPct !== null && report.comparison.sameMonthYoyPct < 0 ? 'text-error' : 'text-secondary'}>
                          {fmtPct(report.comparison.sameMonthYoyPct)}
                        </strong>
                      </span>
                      {report.comparison.projectedKg !== null && (
                        <span className="ml-auto">
                          Proyección al ritmo actual: <strong>{fmtTonnes(report.comparison.projectedKg, 0)}</strong>
                        </span>
                      )}
                    </div>
                  </Card>

                  <Card className="flex flex-col p-space-md xl:col-span-4">
                    <div className="mb-space-sm">
                      <p className="text-title-md font-semibold text-primary">Pedidos por estado</p>
                      <p className="text-label-sm text-on-surface-variant">
                        Cartera viva, procesados y cancelados del año. Los kg de procesados son los del cierre local.
                      </p>
                    </div>
                    <EChart option={statusOption} height={250} ariaLabel="Pedidos por estado en kilogramos" />
                    <div className="mt-space-sm grid grid-cols-3 gap-space-xs border-t border-outline-variant/25 pt-space-sm text-center">
                      <div>
                        <p className="text-label-sm text-outline">Abiertos</p>
                        <p className="font-bold tabular-nums text-primary">{report.statusMix.open.orders}</p>
                      </div>
                      <div>
                        <p className="text-label-sm text-outline">Procesados</p>
                        <p className="font-bold tabular-nums text-secondary">{report.statusMix.closed.orders}</p>
                      </div>
                      <div>
                        <p className="text-label-sm text-outline">Cancelados</p>
                        <p className="font-bold tabular-nums text-error">{report.statusMix.canceled.orders}</p>
                      </div>
                    </div>
                    {canViewHistory && (
                      <a
                        href="/pedidos/historial"
                        className="mt-space-sm inline-flex items-center justify-center rounded-pill border border-outline-variant/50 px-space-md py-1.5 font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
                      >
                        Ver historial de procesados
                      </a>
                    )}
                  </Card>
                </section>

                <section className="grid gap-space-md xl:grid-cols-2">
                  <Card className="flex flex-col p-space-md">
                    <div className="mb-space-sm flex items-start justify-between gap-space-sm">
                      <div>
                        <p className="text-title-md font-semibold text-primary">Top clientes</p>
                        <p className="text-label-sm text-on-surface-variant">
                          Pulsa una barra para abrir la ficha 360 del cliente.
                        </p>
                      </div>
                      <Badge tone="primary" dot>
                        {(report.topCustomers[0]?.sharePct ?? 0)} % líder
                      </Badge>
                    </div>
                    {report.topCustomers.length > 0 ? (
                      <EChart
                        option={topCustomersOption}
                        height={Math.max(220, report.topCustomers.length * 28)}
                        ariaLabel="Clientes con mayor venta del año"
                        onCategoryClick={
                          canViewCustomer
                            ? (index) => {
                                const row = report.topCustomers[index];
                                if (row) setInsightsCustomer(toCustomer(row));
                              }
                            : undefined
                        }
                        pointerCategories={
                          canViewCustomer ? report.topCustomers.map((_, index) => index) : undefined
                        }
                      />
                    ) : (
                      <EmptyState icon={Users} title="Sin ventas por cliente" description="Profit no devolvió clientes para el periodo." />
                    )}
                  </Card>

                  <Card className="flex flex-col p-space-md">
                    <div className="mb-space-sm flex items-start justify-between gap-space-sm">
                      <div>
                        <p className="text-title-md font-semibold text-primary">Top productos</p>
                        <p className="text-label-sm text-on-surface-variant">
                          Qué se vendió, en toneladas y participación sobre el año.
                        </p>
                      </div>
                      <Badge tone="muted" dot>
                        {report.topProducts.length} productos
                      </Badge>
                    </div>
                    {report.topProducts.length > 0 ? (
                      <EChart
                        option={topProductsOption}
                        height={Math.max(220, report.topProducts.length * 28)}
                        ariaLabel="Productos más vendidos del año"
                      />
                    ) : (
                      <EmptyState icon={Package} title="Sin productos vendidos" description="No hay renglones ABA en el periodo." />
                    )}
                  </Card>
                </section>

                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                    <div>
                      <p className="text-title-md font-semibold text-primary">Clientes · ventas y pedidos</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {customersQuery.data
                          ? `${customersQuery.data.total} clientes con actividad o cartera · ordenados por ${SORT_OPTIONS.find((option) => option.value === sort)?.label.toLowerCase()}`
                          : 'Cargando clientes…'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-space-sm">
                      <TextInput
                        icon={Search}
                        value={q}
                        onChange={(value) => {
                          setQ(value);
                          setPage(1);
                        }}
                        placeholder="Buscar cliente, código o vendedor…"
                        ariaLabel="Buscar cliente en la analítica"
                        className="w-64"
                      />
                      <Select
                        ariaLabel="Ordenar clientes"
                        value={sort}
                        options={SORT_OPTIONS}
                        onChange={(value) => {
                          setSort(value as SalesAnalyticsSort);
                          setPage(1);
                        }}
                        className="w-56"
                      />
                      <button
                        type="button"
                        onClick={() => void exportAll()}
                        disabled={exporting || !customersQuery.data}
                        className="flex h-10 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low disabled:opacity-40"
                      >
                        <FileSpreadsheet aria-hidden className="size-4" />
                        {exporting ? 'Exportando…' : 'Exportar'}
                      </button>
                    </div>
                  </div>
                  <DataTable
                    columns={columns}
                    rows={customersQuery.data?.items ?? []}
                    rowKey={(row) => row.code}
                    sortable={false}
                    loading={customersQuery.isLoading}
                    empty={
                      <EmptyState
                        icon={Users}
                        title={q ? `Sin clientes para “${q}”` : 'Sin clientes con actividad'}
                        description={q ? 'Prueba con otro código o nombre.' : 'Ajusta el año o el vendedor.'}
                      />
                    }
                  />
                  {customersQuery.data && customersQuery.data.total > PAGE_SIZE && (
                    <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 px-space-md py-space-sm text-body-md text-on-surface-variant">
                      <span>
                        {customersQuery.data.total} clientes · página {customersQuery.data.page} de{' '}
                        {Math.max(1, Math.ceil(customersQuery.data.total / PAGE_SIZE))}
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
                          onClick={() =>
                            setPage((value) =>
                              Math.min(
                                Math.max(1, Math.ceil((customersQuery.data?.total ?? 0) / PAGE_SIZE)),
                                value + 1,
                              ),
                            )
                          }
                          disabled={page >= Math.ceil((customersQuery.data.total ?? 0) / PAGE_SIZE)}
                          className="flex h-9 items-center gap-space-2xs rounded-pill border border-outline-variant/50 px-space-md font-semibold transition-colors hover:bg-surface-container-low disabled:opacity-40"
                        >
                          Siguiente <ChevronRight aria-hidden className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </Card>

                <section className="grid gap-space-md xl:grid-cols-12">
                  <Card className="overflow-hidden xl:col-span-7">
                    <div className="border-b border-outline-variant/30 px-space-md py-space-sm">
                      <p className="text-title-md font-semibold text-primary">Ventas por vendedor</p>
                      <p className="text-label-sm text-on-surface-variant">
                        Participación del año y variación contra el mismo tramo anterior.
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-label-md">
                        <thead>
                          <tr className="border-b border-outline-variant/30 bg-surface-container-low/70">
                            <Th>Vendedor</Th>
                            <Th align="right">Vendido</Th>
                            <Th align="right">Participación</Th>
                            <Th align="right">vs año ant.</Th>
                            <Th align="right">Clientes</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/20">
                          {report.vendors.slice(0, 10).map((entry) => (
                            <tr key={entry.name} className="transition-colors hover:bg-surface-container-low/60">
                              <Td className="max-w-[18rem] truncate font-semibold text-primary" title={entry.name}>
                                {entry.name}
                              </Td>
                              <Td align="right" className="tabular-nums font-bold text-primary">
                                {fmtTonnes(entry.kg)}
                              </Td>
                              <Td align="right" className="w-36">
                                <span className="flex items-center justify-end gap-space-xs">
                                  <CoverageBar ratio={(entry.sharePct ?? 0) / 100} className="w-20" />
                                  <span className="w-10 text-right tabular-nums text-on-surface-variant">
                                    {entry.sharePct ?? 0} %
                                  </span>
                                </span>
                              </Td>
                              <Td align="right">
                                {entry.yoyPct === null ? (
                                  <span className="text-outline">—</span>
                                ) : (
                                  <TrendPill value={fmtPct(entry.yoyPct)} tone={pctTone(entry.yoyPct)} />
                                )}
                              </Td>
                              <Td align="right" className="tabular-nums text-on-surface-variant">
                                {entry.customers}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t border-outline-variant/30 px-space-md py-space-xs text-label-sm text-on-surface-variant">
                      Facturado del vendedor: {fmtMoney(report.vendors.reduce((acc, entry) => acc + (entry.billed ?? 0), 0), currency)}
                    </div>
                  </Card>

                  <Card className="flex flex-col p-space-md xl:col-span-5">
                    <div className="mb-space-sm flex items-start justify-between gap-space-sm">
                      <div>
                        <p className="text-title-md font-semibold text-primary">Lo que hay que mirar</p>
                        <p className="text-label-sm text-on-surface-variant">
                          Señales del periodo, no alarmas automáticas.
                        </p>
                      </div>
                      <Badge tone={report.alerts.length > 0 ? 'warning' : 'success'} dot>
                        {report.alerts.length} señal{report.alerts.length === 1 ? '' : 'es'}
                      </Badge>
                    </div>
                    {report.alerts.length === 0 ? (
                      <EmptyState
                        icon={TrendingUp}
                        title="Sin señales fuertes"
                        description="No hay caídas ni concentraciones que ameriten revisión con los umbrales actuales."
                      />
                    ) : (
                      <ul className="flex flex-col gap-space-sm">
                        {report.alerts.map((alert, index) => {
                          const Icon = ALERT_ICON[alert.kind];
                          return (
                            <li
                              key={`${alert.kind}-${index}`}
                              className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-sm"
                            >
                              <div className="flex items-start gap-space-sm">
                                <span
                                  className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
                                    alert.severity === 'danger'
                                      ? 'bg-critical-container text-on-critical-container'
                                      : alert.severity === 'warning'
                                        ? 'bg-warning-container text-on-warning-container'
                                        : 'bg-surface-container text-primary'
                                  }`}
                                >
                                  <Icon aria-hidden className="size-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-primary" title={alert.title}>
                                    {alert.title}
                                  </p>
                                  <p className="text-label-sm text-on-surface-variant">{alert.detail}</p>
                                </div>
                                {alert.customerCode && canViewCustomer && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setInsightsCustomer({
                                        id: alert.customerCode!,
                                        externalCode: alert.customerCode!,
                                        name: alert.customerName ?? alert.customerCode!,
                                        customerType: null,
                                        vendor: null,
                                        isActive: true,
                                        ordersCount: 0,
                                        sales: null,
                                      })
                                    }
                                    className="shrink-0 rounded-pill border border-outline-variant/50 px-2 py-1 font-semibold text-label-sm text-primary transition-colors hover:bg-surface-container-low"
                                  >
                                    Ficha
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="mt-auto border-t border-outline-variant/25 pt-space-sm">
                      <p className="flex items-start gap-space-xs text-label-sm text-on-surface-variant">
                        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        {report.pending.monthsOfCover !== null
                          ? `${report.pending.monthsOfCover} meses de venta promedio están comprometidos en cartera.`
                          : 'Sin promedio mensual suficiente para calcular la cobertura de cartera.'}
                      </p>
                    </div>
                  </Card>
                </section>

                <Card className="p-space-md">
                  <div className="flex flex-wrap items-start gap-space-md">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-container text-primary">
                      <Download aria-hidden className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-primary">Cómo leer esta pantalla</p>
                      <ul className="mt-space-xs grid gap-space-xs text-label-md text-on-surface-variant md:grid-cols-2">
                        {report.dataNotes.map((note, index) => (
                          <li key={index} className="flex items-start gap-space-xs">
                            <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-secondary" />
                            {note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </main>

      <CustomerInsightsModal
        open={insightsCustomer !== null}
        customer={insightsCustomer}
        onClose={() => setInsightsCustomer(null)}
        onOpenStatement={(customer) => {
          setInsightsCustomer(null);
          setStatementCustomer(customer);
        }}
      />

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

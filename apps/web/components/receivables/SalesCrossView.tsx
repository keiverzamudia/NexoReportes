'use client';

// ============================================================
// Modo «Ventas + cartera» de CxC.
//
// Reemplaza todo el tablero de cartera por un cruce comercial:
//   · venta del año (notas de entrega) + facturación CxC,
//   · cartera abierta de hoy con su antigüedad,
//   · join por código de cliente.
//
// La cartera es de hoy y la venta es del año elegido. La vista lo dice en el
// encabezado, en las tarjetas y en la ayuda para no mezclar periodos.
// ============================================================

import type {
  ReceivablesCurrency,
  ReceivablesDocumentRow,
  ReceivablesResponse,
  SalesAnalyticsCustomersResponse,
  SalesAnalyticsResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  Download,
  ExternalLink,
  HandCoins,
  Landmark,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { CustomerStatementDialog } from '../CustomerStatementDialog';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { AppNav, LoginScreen } from '../shell';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  HeroCard,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  TextInput,
  TrendPill,
  cx,
  fmtDate,
  useGreeting,
  type Column,
} from '../ui';
import {
  AuthRequiredError,
  apiFetch,
  currentUser,
} from '../../lib/api';
import {
  buildCxcSalesCsv,
  buildCxcSalesKpis,
  buildCxcSalesRows,
  cxcRowToCustomer,
  cxcSalesStatusLabel,
  cxcSalesStatusTone,
  mergeSalesCustomers,
  salesCurrencyFor,
  type CxcSalesRow,
} from '../../lib/cxc-sales';
import {
  BUCKET_COLORS,
  bucketMeta,
  formatCompactMoney,
  formatPct,
  formatPctCompact,
  formatReceivablesMoney,
  formatStatementDate,
  paymentLabel,
  segmentsFromBuckets,
  segmentsFromPaymentBuckets,
  vendorRows,
} from '../../lib/receivables';
import {
  buildMonthlySalesOption,
  downloadCsv,
  fmtMoney,
  fmtPct as fmtSalesPct,
  fmtTonnes,
  pctTone,
} from '../../lib/sales-analytics';
import { statementUpdatedAt } from '../../lib/statement';
import {
  CXC_SALES_HELP_RULES,
  CXC_SALES_HELP_TERMS,
  CXC_SALES_HELP_TITLE,
} from '../../content/help/cxc-sales';
import { hasPermission } from '../../lib/permissions';
import { AgingBar, AgingLegend, AgingMixRow } from './AgingBars';
import { CxcModeSwitch, type CxcMode } from './CxcModeSwitch';
import { MethodCard } from './MethodCard';

type Scope = 'deuda' | 'todos';

const CURRENCY_OPTIONS: Array<{ value: ReceivablesCurrency; label: string }> = [
  { value: 'USD', label: 'USD' },
  { value: 'BS', label: 'Bs' },
];

const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
  { value: 'deuda', label: 'Con deuda' },
  { value: 'todos', label: 'Todos' },
];

const MEASURE_OPTIONS: Array<{ value: 'kg' | 'money'; label: string }> = [
  { value: 'kg', label: 'kg' },
  { value: 'money', label: '$' },
];

export function SalesCrossView({
  mode,
  onModeChange,
}: {
  mode: CxcMode;
  onModeChange: (mode: CxcMode) => void;
}) {
  const greeting = useGreeting();
  const currentYear = new Date().getFullYear();
  const [currency, setCurrency] = useState<ReceivablesCurrency>('USD');
  const [year, setYear] = useState(currentYear);
  const [scope, setScope] = useState<Scope>('deuda');
  const [measure, setMeasure] = useState<'kg' | 'money'>('kg');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statementRow, setStatementRow] = useState<CxcSalesRow | null>(null);
  const manualRefresh = useRef(false);

  const includeWithoutDebt = scope === 'todos';
  const salesCurrency = salesCurrencyFor(currency);

  const session = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const sessionUser = session.data;
  const canCxc = hasPermission(sessionUser?.permissions, 'cxc', 'read');
  const canFullSales = hasPermission(sessionUser?.permissions, 'pedidos', 'view_summary');
  const canCustomer = hasPermission(sessionUser?.permissions, 'clientes', 'read');

  const receivables = useQuery<ReceivablesResponse>({
    queryKey: ['receivables', 'cross', currency],
    queryFn: () =>
      apiFetch<ReceivablesResponse>(
        `/receivables?moneda=${currency}${manualRefresh.current ? '&refresh=true' : ''}`,
      ),
    enabled: Boolean(sessionUser) && canCxc,
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });
  const report = receivables.data;

  const salesReport = useQuery<SalesAnalyticsResponse>({
    queryKey: ['sales-analytics', year, salesCurrency, ''],
    queryFn: () =>
      apiFetch<SalesAnalyticsResponse>(
        `/sales/analytics?year=${year}&currency=${salesCurrency}`,
      ),
    enabled: Boolean(sessionUser) && canCxc,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const sales = salesReport.data;
  const salesKnown = Boolean(sales?.available) && !salesReport.error;

  const debtCodes = useMemo(() => {
    if (!report) return '';
    return report.clientes
      .filter((row) => row.cartera > 0)
      .slice(0, 200)
      .map((row) => row.codigo)
      .join(',');
  }, [report]);

  const debtCustomers = useQuery<SalesAnalyticsCustomersResponse>({
    queryKey: ['sales-analytics-customers', 'cross-debt', year, salesCurrency, debtCodes],
    queryFn: () =>
      apiFetch<SalesAnalyticsCustomersResponse>(
        `/sales/analytics/customers?year=${year}&currency=${salesCurrency}&page=1&pageSize=200&sort=kg_desc&codes=${encodeURIComponent(
          debtCodes,
        )}`,
      ),
    enabled: Boolean(sessionUser) && canCxc && debtCodes.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const allCustomers = useQuery<SalesAnalyticsCustomersResponse>({
    queryKey: ['sales-analytics-customers', 'cross-all', year, salesCurrency],
    queryFn: () =>
      apiFetch<SalesAnalyticsCustomersResponse>(
        `/sales/analytics/customers?year=${year}&currency=${salesCurrency}&page=1&pageSize=200&sort=kg_desc`,
      ),
    enabled: Boolean(sessionUser) && canCxc && includeWithoutDebt,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Si falla solo la consulta por cliente, no se marca «Sin compra»: sería
  // una conclusión falsa. Se conserva la cartera y se avisa.
  const customerSalesAvailable =
    debtCustomers.data?.available !== false &&
    (!includeWithoutDebt || allCustomers.data?.available !== false);
  const rowSalesKnown =
    salesKnown &&
    customerSalesAvailable &&
    !debtCustomers.error &&
    (!includeWithoutDebt || !allCustomers.error);

  const crossRows = useMemo(() => {
    if (!report) return [];
    if (!includeWithoutDebt) {
      return buildCxcSalesRows(report.clientes, debtCustomers.data?.items ?? [], {
        salesKnown: rowSalesKnown,
      });
    }
    const salesItems = mergeSalesCustomers(
      debtCustomers.data?.items ?? [],
      allCustomers.data?.items ?? [],
    );
    return buildCxcSalesRows(report.clientes, salesItems, {
      includeWithoutDebt: true,
      salesKnown: rowSalesKnown,
    });
  }, [report, debtCustomers.data, allCustomers.data, includeWithoutDebt, rowSalesKnown]);

  const vendorOptions = useMemo(() => {
    const names = [...new Set(crossRows.map((row) => row.vendor).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
    return [
      { value: '', label: 'Vendedor: todos' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [crossRows]);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crossRows.filter((row) => {
      if (vendor && row.vendor !== vendor) return false;
      if (onlyOverdue && row.vencido <= 0) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.code.toLowerCase().includes(needle) ||
        row.vendor.toLowerCase().includes(needle)
      );
    });
  }, [crossRows, q, vendor, onlyOverdue]);

  const kpis = useMemo(() => buildCxcSalesKpis(filteredRows), [filteredRows]);
  const aging = useMemo(
    () => (report ? segmentsFromBuckets(report.buckets) : []),
    [report],
  );
  const cobranzaBuckets = report?.cobranzaBuckets ?? [];
  const cobranzaDisponible = Boolean(report?.cobranzaBuckets);
  const cobranzaSegments = segmentsFromPaymentBuckets(cobranzaBuckets);
  const cobranzaTotal = cobranzaBuckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const cobranzaPagos = cobranzaBuckets.reduce((sum, bucket) => sum + bucket.documentos, 0);
  const cobranzaPctATiempo =
    cobranzaBuckets.find((bucket) => bucket.key === 'POR_VENCER')?.pct ?? 0;
  const vendors = useMemo(
    () =>
      report
        ? vendorRows(report.clientes)
            .filter((row) => row.cartera > 0)
            .slice(0, 6)
        : [],
    [report],
  );
  const maxVendor = vendors[0]?.cartera ?? 0;
  const salesVendors = sales?.vendors.slice(0, 6) ?? [];

  const monthlyOption = useMemo(
    () =>
      sales
        ? buildMonthlySalesOption(
            sales,
            measure === 'kg' ? 'kg' : salesCurrency,
            salesCurrency,
          )
        : {},
    [sales, measure, salesCurrency],
  );

  // La tabla se pinta cuando ya llegó la venta de los códigos consultados.
  // Mientras tanto, los KPIs de venta muestran «—» para no convertir un
  // "todavía no llegó" en un "no vendió".
  const salesRowsReady =
    (debtCodes.length === 0 || Boolean(debtCustomers.data)) &&
    (!includeWithoutDebt || Boolean(allCustomers.data));
  const salesMetricKnown = rowSalesKnown && salesRowsReady;
  const salesLoading = salesReport.isLoading && !sales;
  const customerSalesLoading =
    debtCustomers.isLoading || (includeWithoutDebt && allCustomers.isLoading);
  const salesBlocked = !rowSalesKnown && !salesLoading && !customerSalesLoading;

  const anyFetching =
    receivables.isFetching ||
    salesReport.isFetching ||
    debtCustomers.isFetching ||
    allCustomers.isFetching;

  const hasFilters = Boolean(q.trim() || vendor || onlyOverdue || scope === 'todos');
  const billingKnown = salesKnown && sales?.billingAvailable !== false;
  const sourceFixtures =
    report?.source === 'fixtures' || sales?.source === 'fixtures';
  const sourceTone: 'success' | 'warning' | 'danger' | 'muted' = salesLoading
    ? 'muted'
    : !rowSalesKnown
      ? 'warning'
      : sourceFixtures
        ? 'warning'
        : 'success';
  const sourceLabel = salesLoading
    ? 'Leyendo ventas…'
    : !rowSalesKnown
      ? 'Ventas sin datos'
      : sourceFixtures
        ? 'Datos de prueba'
        : 'Profit en vivo';
  const statementCustomer = statementRow ? cxcRowToCustomer(statementRow) : null;

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2].map((value) => ({
    value: String(value),
    label: String(value),
  }));

  function refresh() {
    manualRefresh.current = true;
    void Promise.all([
      receivables.refetch(),
      salesReport.refetch(),
      debtCustomers.refetch(),
      includeWithoutDebt ? allCustomers.refetch() : Promise.resolve(null),
    ]).finally(() => {
      manualRefresh.current = false;
    });
  }

  function clearFilters() {
    setQ('');
    setVendor('');
    setOnlyOverdue(false);
    setScope('deuda');
    setExpanded(null);
  }

  function exportCsv() {
    downloadCsv(
      `cxc-ventas-cartera-${year}-${currency.toLowerCase()}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      buildCxcSalesCsv(filteredRows, currency, year),
    );
  }

  const columns = useMemo<Column<CxcSalesRow>[]>(
    () => [
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'id',
        sortValue: (row) => row.name,
        title: (row) => `${row.code} · ${row.name} · ${row.vendor}`,
        render: (row) => (
          <span className="flex min-w-[220px] max-w-[340px] flex-col gap-0.5">
            <span className="truncate font-semibold text-on-surface">{row.name}</span>
            <span className="truncate text-label-sm normal-case text-on-surface-variant">
              {row.code} · {row.vendor}
            </span>
          </span>
        ),
      },
      {
        key: 'ventas',
        header: `Ventas ${year}`,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.sales?.kg ?? 0,
        render: (row) => (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-bold tabular-nums text-on-surface">
              {rowSalesKnown && row.sales && row.sales.kg > 0 ? (
                fmtTonnes(row.sales.kg)
              ) : (
                <span className="text-outline">—</span>
              )}
            </span>
            <span className="text-label-sm tabular-nums text-on-surface-variant">
              {billingKnown && row.sales?.billed != null
                ? fmtMoney(row.sales.billed, salesCurrency)
                : '—'}
            </span>
            {rowSalesKnown && row.sales?.yoyPct != null && (
              <TrendPill value={fmtSalesPct(row.sales.yoyPct)} tone={pctTone(row.sales.yoyPct)} />
            )}
          </span>
        ),
      },
      {
        key: 'cartera',
        header: 'Cartera actual',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.cartera,
        render: (row) => (
          <span className="flex flex-col items-end">
            <span
              className={cx(
                'font-bold tabular-nums',
                row.vencido > 0
                  ? 'text-error'
                  : row.cartera > 0
                    ? 'text-primary'
                    : 'text-outline',
              )}
            >
              {row.cartera > 0 ? formatReceivablesMoney(row.cartera, currency) : '—'}
            </span>
            <span className="text-label-sm text-on-surface-variant">
              {row.cartera > 0
                ? `${row.documentos} doc${row.documentos === 1 ? '' : 's'}${
                    row.vencidos > 0 ? ` · ${row.vencidos} venc.` : ''
                  }`
                : 'Sin deuda'}
            </span>
          </span>
        ),
      },
      {
        key: 'pctVencido',
        header: '% vencido',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.pctVencido,
        render: (row) =>
          row.cartera > 0 ? (
            <span className="flex flex-col items-end gap-1">
              <span
                className={cx(
                  'font-semibold tabular-nums',
                  row.pctVencido > 0 ? 'text-error' : 'text-success',
                )}
              >
                {formatPct(row.pctVencido)}
              </span>
              <span className="h-1 w-16 overflow-hidden rounded-pill bg-surface-container-high">
                <span
                  className="block h-full rounded-pill bg-error"
                  style={{ width: `${Math.min(100, row.pctVencido)}%` }}
                />
              </span>
            </span>
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      {
        key: 'antiguedad',
        header: 'Antigüedad',
        kind: 'field',
        render: (row) =>
          row.aging.length > 0 ? (
            <div className="min-w-[160px]">
              <AgingBar
                segments={row.aging}
                total={row.cartera}
                max={row.cartera}
                currency={currency}
                height={14}
                showInside={false}
                ariaLabel={`Antigüedad de ${row.name}`}
              />
            </div>
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      {
        key: 'ultimoPago',
        header: 'Último pago',
        kind: 'detail',
        sortValue: (row) => row.client?.ultimoPago ?? '',
        render: (row) =>
          row.client?.ultimoPago ? (
            <span
              className={cx(
                'block max-w-[130px] truncate text-label-md',
                (row.client.diasSinPago ?? 0) > 30
                  ? 'font-semibold text-warning'
                  : 'text-on-surface-variant',
              )}
              title={paymentLabel(row.client)}
            >
              {paymentLabel(row.client)}
            </span>
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      {
        key: 'estado',
        header: 'Estado',
        kind: 'status',
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={cxcSalesStatusTone(row.status)} dot>
            {cxcSalesStatusLabel(row.status)}
          </Badge>
        ),
      },
    ],
    [year, currency, salesCurrency, rowSalesKnown, billingKnown],
  );

  if (session.isLoading) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
        </main>
      </>
    );
  }

  if (!sessionUser) {
    return <LoginScreen onSuccess={() => void session.refetch()} />;
  }

  if (!canCxc) {
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
          <Card className="flex flex-col items-start gap-space-sm p-space-lg">
            <ShieldAlert aria-hidden className="size-6 text-warning" />
            <h1 className="text-title-lg font-bold text-primary">Sin acceso a Cuentas por cobrar</h1>
            <p className="text-body-md text-on-surface-variant">
              Tu rol no tiene la vista de CXC. Un administrador puede concederla desde Usuarios → Roles.
            </p>
          </Card>
        </main>
      </>
    );
  }

  if (
    receivables.error instanceof AuthRequiredError ||
    salesReport.error instanceof AuthRequiredError ||
    debtCustomers.error instanceof AuthRequiredError ||
    allCustomers.error instanceof AuthRequiredError
  ) {
    return <LoginScreen onSuccess={() => void session.refetch()} />;
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · CxC · Ventas + cartera"
          icon={BarChart3}
          title="Ventas y cartera"
          subtitle="La venta del año cruzada con la cartera de hoy: quién compra, cuánto factura y cuánto debe, con la antigüedad de esa deuda. El cruce es por código de cliente."
          greeting={greeting}
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              {report && (
                <Badge tone={sourceTone} dot>
                  {sourceLabel}
                </Badge>
              )}
              <button
                type="button"
                onClick={refresh}
                disabled={anyFetching}
                className="inline-flex h-10 items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md font-semibold text-primary shadow-soft transition-colors hover:bg-surface-container-low disabled:opacity-60"
              >
                <RefreshCw aria-hidden className={`size-4 ${anyFetching ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={filteredRows.length === 0}
                className="inline-flex h-10 items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
              >
                <Download aria-hidden className="size-4" />
                CSV
              </button>
              {canFullSales && (
                <Link
                  href="/pedidos/ventas"
                  className="inline-flex h-10 items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  Analítica completa
                </Link>
              )}
              <ModuleHelp
                title={CXC_SALES_HELP_TITLE}
                narrative="La venta se mide por nota de entrega del año elegido; la cartera es el saldo abierto de hoy. El cruce es por código de cliente y usa los mismos tramos de antigüedad de la pestaña Cartera."
                rules={CXC_SALES_HELP_RULES}
                terms={CXC_SALES_HELP_TERMS}
              />
            </div>
          }
        />

        <CxcModeSwitch mode={mode} onChange={onModeChange} />

        <Card className="flex flex-col gap-space-sm px-space-md py-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            <label className="flex items-center gap-space-xs">
              <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">Año</span>
              <Select
                className="w-28"
                value={String(year)}
                onChange={(value) => {
                  setYear(Number(value));
                  setVendor('');
                  setExpanded(null);
                }}
                options={yearOptions}
                ariaLabel="Año de la venta"
              />
            </label>
            <Segmented
              ariaLabel="Moneda del cruce"
              value={currency}
              onChange={(value) => {
                setCurrency(value);
                setVendor('');
                setExpanded(null);
              }}
              options={CURRENCY_OPTIONS}
            />
            <Segmented
              ariaLabel="Alcance del cruce"
              value={scope}
              onChange={(value) => {
                setScope(value);
                setVendor('');
                setExpanded(null);
              }}
              options={SCOPE_OPTIONS}
            />
            <TextInput
              className="w-60"
              icon={Search}
              value={q}
              onChange={setQ}
              placeholder="Buscar cliente, código o vendedor…"
              ariaLabel="Buscar en el cruce"
            />
            <Select
              className="w-56"
              value={vendor}
              onChange={setVendor}
              options={vendorOptions}
              ariaLabel="Filtrar por vendedor"
            />
            <label className="flex h-10 cursor-pointer items-center gap-space-xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-label-md font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={onlyOverdue}
                onChange={(event) => setOnlyOverdue(event.target.checked)}
                className="size-4 accent-primary"
              />
              Solo vencido
            </label>
            {anyFetching && <Loader2 aria-hidden className="size-3.5 animate-spin text-outline" />}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center gap-space-2xs rounded-xl px-space-sm text-label-md font-semibold text-primary-container transition-colors hover:bg-surface-container-low"
              >
                <X aria-hidden className="size-3.5" /> Limpiar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
            <span>
              {report?.totals.clientesConDeuda ?? 0} deudores · {filteredRows.length} en la vista
            </span>
            <span aria-hidden>·</span>
            <span>{formatCompactMoney(kpis.cartera, currency)} cartera</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-error">
              {formatCompactMoney(kpis.vencido, currency)} vencido
            </span>
            <span aria-hidden>·</span>
            <span>
              {salesLoading
                ? 'Leyendo ventas…'
                : rowSalesKnown
                  ? `${sales?.totals.notes ?? 0} notas en ${year}`
                  : 'Ventas no disponibles'}
            </span>
            <span aria-hidden>·</span>
            <span>Corte {statementUpdatedAt(report?.asOf)}</span>
            {hasFilters && <Badge tone="primary">Filtros activos</Badge>}
            {salesBlocked && <Badge tone="warning">Ventas sin datos</Badge>}
            {!billingKnown && rowSalesKnown && <Badge tone="warning">Facturación sin datos</Badge>}
            {report?.quality.truncado && <Badge tone="warning">Cifras recortadas</Badge>}
          </div>
        </Card>

        {!report ? (
          receivables.isLoading ? (
            <Card className="flex items-center justify-center gap-space-sm p-space-2xl text-on-surface-variant">
              <Loader2 aria-hidden className="size-5 animate-spin text-primary" />
              <span className="text-body-md">Leyendo cartera y ventas de Profit…</span>
            </Card>
          ) : (
            <Card className="flex flex-col items-start gap-space-sm p-space-lg">
              <span className="flex items-center gap-space-xs font-semibold text-error">
                <AlertTriangle aria-hidden className="size-4" />
                {receivables.error instanceof Error
                  ? receivables.error.message
                  : 'No se pudo consultar la cartera en Profit.'}
              </span>
              <p className="text-body-md text-on-surface-variant">
                El cruce necesita la cartera actual. Revisa la conexión y vuelve a intentar.
              </p>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <RefreshCw aria-hidden className="size-4" /> Reintentar
              </button>
            </Card>
          )
        ) : (
          <>
            {salesBlocked && (
              <p className="flex items-center gap-space-sm rounded-xl border border-warning/30 bg-warning-container/40 px-space-md py-space-sm text-body-md text-on-warning-container">
                <AlertTriangle aria-hidden className="size-4" />
                No se pudieron leer las ventas de Profit para el cruce. Se muestra la cartera y los campos de venta quedan en «—»; «Sin compra» no se marca como conclusión.
              </p>
            )}
            {rowSalesKnown && !billingKnown && (
              <p className="flex items-center gap-space-sm rounded-xl border border-warning/30 bg-warning-container/40 px-space-md py-space-sm text-body-md text-on-warning-container">
                <AlertTriangle aria-hidden className="size-4" />
                No se pudo leer la facturación de CxC. La venta en kilos sigue disponible; los montos facturados quedan en «—».
              </p>
            )}

            <section className="grid gap-space-md xl:grid-cols-12">
              <div className="xl:col-span-4">
                <HeroCard
                  label={`Cartera actual · ${currency === 'USD' ? 'USD' : 'Bs'}`}
                  value={formatCompactMoney(kpis.cartera, currency)}
                  hint={`${formatPct(kpis.pctVencido)} vencido · ${kpis.deudores} deudor${
                    kpis.deudores === 1 ? '' : 'es'
                  }`}
                  progress={kpis.pctVencido}
                  icon={Wallet}
                  footer={
                    salesMetricKnown ? (
                      <span>
                        {kpis.deudoresSinVenta} deudores sin compra en {year} ·{' '}
                        {formatCompactMoney(kpis.carteraSinVenta, currency)}
                      </span>
                    ) : undefined
                  }
                />
              </div>
              <div className="grid gap-space-sm sm:grid-cols-2 xl:col-span-8 xl:grid-cols-4">
                <Kpi
                  label="Vencido"
                  value={formatCompactMoney(kpis.vencido, currency)}
                  hint={`${report.totals.documentosVencidos} documentos vencidos`}
                  tone="danger"
                  icon={AlertTriangle}
                />
                <Kpi
                  label={`Facturado ${year}`}
                  value={
                    salesMetricKnown && billingKnown
                      ? fmtMoney(kpis.billed, salesCurrency)
                      : '—'
                  }
                  hint={`${kpis.notas} notas · clientes visibles`}
                  tone="primary"
                  icon={Receipt}
                />
                <Kpi
                  label={`Vendido ${year}`}
                  value={salesMetricKnown ? fmtTonnes(kpis.kg) : '—'}
                  hint={`${kpis.clientes} clientes en la vista`}
                  tone="primary"
                  icon={TrendingUp}
                />
                <Kpi
                  label="Deudores con venta"
                  value={salesMetricKnown ? String(kpis.deudoresConVenta) : '—'}
                  suffix={salesMetricKnown ? `/ ${kpis.deudores}` : undefined}
                  hint={
                    salesMetricKnown
                      ? `${formatPct(kpis.pctCarteraConVenta)} de la cartera`
                      : salesLoading || customerSalesLoading
                        ? 'Leyendo ventas…'
                        : 'Ventas no disponibles'
                  }
                  tone={
                    !salesMetricKnown
                      ? 'muted'
                      : kpis.pctCarteraConVenta >= 50
                        ? 'success'
                        : 'warning'
                  }
                  icon={Users}
                />
              </div>
            </section>

            <section className="grid gap-space-md">
              <Card className="p-space-md">
                <div className="mb-space-sm flex flex-wrap items-start justify-between gap-space-sm">
                  <div>
                    <p className="text-title-md font-semibold text-primary">Cartera por antigüedad</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Deuda de hoy y pagos de los últimos 12 meses.
                    </p>
                  </div>
                  <Landmark aria-hidden className="size-4 text-primary" />
                </div>

                <div className="grid gap-space-md lg:grid-cols-2">
                  <div className="flex flex-col">
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-space-sm">
                      <div>
                        <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">
                          Cartera de hoy
                        </p>
                        <p className="text-label-sm text-on-surface-variant">
                          Saldo abierto por tramo de vencimiento
                        </p>
                      </div>
                      <span className="text-label-sm font-bold tabular-nums text-primary">
                        {formatCompactMoney(report.totals.cartera, currency)}
                      </span>
                    </div>
                    <AgingBar
                      segments={aging}
                      total={report.totals.cartera}
                      max={report.totals.cartera}
                      currency={currency}
                      height={32}
                      ariaLabel="Distribución de la cartera actual por antigüedad"
                    />
                    <AgingLegend buckets={report.buckets} className="mt-space-sm" showPct />
                    <div className="mt-auto flex flex-wrap items-center gap-x-space-md gap-y-1 border-t border-outline-variant/25 pt-space-sm text-label-sm text-on-surface-variant">
                      <span>
                        Vencido{' '}
                        <strong className="tabular-nums text-error">
                          {formatCompactMoney(report.totals.vencido, currency)}
                        </strong>
                      </span>
                      <span>
                        Días máx.{' '}
                        <strong className="tabular-nums text-on-surface">
                          {report.totals.diasMaxVencido ?? '—'}
                        </strong>
                      </span>
                      <span>
                        {report.totals.documentosVencidos} docs vencidos
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col border-t border-outline-variant/25 pt-space-sm lg:border-l lg:border-t-0 lg:pl-space-md lg:pt-0">
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-space-sm">
                      <div>
                        <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">
                          Cobranza · 12 meses
                        </p>
                        <p className="text-label-sm text-on-surface-variant">
                          Cómo se pagó lo cobrado
                        </p>
                      </div>
                      <span className="text-label-sm font-bold tabular-nums text-primary">
                        {cobranzaDisponible
                          ? formatCompactMoney(cobranzaTotal, currency)
                          : '—'}
                      </span>
                    </div>
                    {!cobranzaDisponible ? (
                      <p className="rounded-md border border-dashed border-outline-variant/50 px-space-sm py-space-sm text-label-sm text-outline">
                        No se pudo leer la cobranza en Profit.
                      </p>
                    ) : (
                      <>
                        <AgingBar
                          segments={cobranzaSegments}
                          total={cobranzaTotal}
                          max={cobranzaTotal}
                          currency={currency}
                          height={32}
                          emptyLabel="Sin pagos en 12 meses"
                          ariaLabel="Distribución de la cobranza de 12 meses por atraso al pagar"
                        />
                        {cobranzaSegments.length > 0 && (
                          <AgingLegend
                            buckets={cobranzaBuckets}
                            caption="Atraso"
                            pctLabel="de lo cobrado"
                            className="mt-space-sm"
                            showPct
                          />
                        )}
                        {cobranzaTotal > 0 && (
                          <div className="mt-auto flex flex-wrap items-center gap-x-space-md gap-y-1 border-t border-outline-variant/25 pt-space-sm text-label-sm text-on-surface-variant">
                            <span>
                              <strong className="tabular-nums text-success">
                                {formatPct(cobranzaPctATiempo)}
                              </strong>{' '}
                              a tiempo
                            </span>
                            <span>
                              {cobranzaPagos} pago{cobranzaPagos === 1 ? '' : 's'} aplicado{cobranzaPagos === 1 ? '' : 's'}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="flex flex-col p-space-md">
                <div className="mb-space-sm flex flex-wrap items-start justify-between gap-space-sm">
                  <div>
                    <p className="text-title-md font-semibold text-primary">Ventas por mes</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Empresa · {year} contra {year - 1}. La línea es el mismo mes del año anterior.
                    </p>
                  </div>
                  <Segmented
                    ariaLabel="Medida del gráfico de ventas"
                    value={measure}
                    onChange={setMeasure}
                    options={MEASURE_OPTIONS}
                  />
                </div>
                {salesLoading ? (
                  <Skeleton className="h-[380px] w-full" />
                ) : salesKnown ? (
                  <EChart
                    option={monthlyOption}
                    height={380}
                    ariaLabel={`Ventas mensuales de ${year} contra ${year - 1}`}
                  />
                ) : (
                  <EmptyState
                    icon={BarChart3}
                    title="Sin ventas para graficar"
                    description="Profit no respondió. La cartera y su antigüedad siguen disponibles."
                  />
                )}
              </Card>
            </section>

            <section className="grid gap-space-md xl:grid-cols-2">
              <Card className="p-space-md">
                <div className="mb-space-sm flex items-start justify-between gap-space-sm">
                  <div>
                    <p className="text-title-md font-semibold text-primary">Ventas por vendedor</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Empresa · top 6 por venta del año.
                    </p>
                  </div>
                  <Badge tone="muted">{measure === 'kg' ? 'kg' : 'moneda'}</Badge>
                </div>
                {salesLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : salesKnown && salesVendors.length > 0 ? (
                  <ul className="flex flex-col divide-y divide-outline-variant/20">
                    {salesVendors.map((vendorRow) => {
                      const value =
                        measure === 'kg'
                          ? vendorRow.kg
                          : vendorRow.billed ?? 0;
                      const total =
                        measure === 'kg'
                          ? sales?.totals.kg ?? 0
                          : sales?.totals.billed ?? 0;
                      const width =
                        value > 0 && total > 0 ? Math.max(2, (value / total) * 100) : 0;
                      const sharePct = total > 0 ? (value / total) * 100 : 0;
                      return (
                        <li key={vendorRow.name} className="py-space-sm">
                          <span className="flex items-baseline justify-between gap-space-sm">
                            <span className="truncate text-label-md font-semibold text-on-surface">
                              {vendorRow.name}
                            </span>
                            <span className="shrink-0 tabular-nums text-label-md font-bold text-primary">
                              {measure === 'kg'
                                ? fmtTonnes(vendorRow.kg)
                                : fmtMoney(vendorRow.billed, salesCurrency)}
                            </span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-container-high">
                            <span
                              className="block h-full rounded-pill bg-primary-container"
                              style={{ width: `${Math.min(100, width)}%` }}
                            />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-space-sm text-label-sm text-on-surface-variant">
                            <span>{vendorRow.customers} clientes</span>
                            <span aria-hidden>·</span>
                            <span>{formatPct(sharePct)} del total</span>
                            {measure === 'kg' && (
                              <>
                                <span aria-hidden>·</span>
                                <span
                                  className={
                                    (vendorRow.yoyPct ?? 0) < 0 ? 'text-error' : 'text-success'
                                  }
                                >
                                  {fmtSalesPct(vendorRow.yoyPct)} vs año ant.
                                </span>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState
                    icon={Users}
                    title="Sin vendedores para mostrar"
                    description="Profit no devolvió ventas para el año seleccionado."
                  />
                )}
              </Card>

              <Card className="p-space-md">
                <div className="mb-space-sm flex items-start justify-between gap-space-sm">
                  <div>
                    <p className="text-title-md font-semibold text-primary">Cartera por vendedor</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Deuda de hoy con la mezcla de antigüedad. Haz clic para filtrar el cruce.
                    </p>
                  </div>
                  <Landmark aria-hidden className="size-4 text-primary" />
                </div>
                <ul className="flex flex-col divide-y divide-outline-variant/20">
                  {vendors.map((vendorRow) => (
                    <li key={`${vendorRow.codigo}-${vendorRow.vendedor}`}>
                      <AgingMixRow
                        title={vendorRow.vendedor}
                        subtitle={`${vendorRow.clientes} clientes · ${formatPct(
                          vendorRow.pctVencido,
                        )} vencido`}
                        amount={vendorRow.cartera}
                        segments={vendorRow.aging}
                        max={maxVendor}
                        currency={currency}
                        selected={vendor === vendorRow.vendedor}
                        onClick={() =>
                          setVendor((current) =>
                            current === vendorRow.vendedor ? '' : vendorRow.vendedor,
                          )
                        }
                      />
                    </li>
                  ))}
                  {vendors.length === 0 && (
                    <li className="py-space-md text-body-md text-on-surface-variant">
                      Sin vendedores con cartera.
                    </li>
                  )}
                </ul>
              </Card>
            </section>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
                <div>
                  <h2 className="text-title-md font-bold text-on-surface">Clientes: venta y deuda</h2>
                  <p className="text-label-md text-on-surface-variant">
                    Cruce por código de cliente. La venta es de {year}; la cartera es la de hoy.
                    Haz clic en una fila para ver antigüedad y documentos.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-space-xs">
                  <Badge tone="muted">
                    {filteredRows.length} cliente{filteredRows.length === 1 ? '' : 's'}
                  </Badge>
                  <Badge tone="primary">{includeWithoutDebt ? 'Todos' : 'Con deuda'}</Badge>
                </div>
              </div>
              <DataTable<CxcSalesRow>
                columns={columns}
                rows={filteredRows}
                rowKey={(row) => row.code}
                defaultSortKey={includeWithoutDebt ? 'ventas' : 'cartera'}
                defaultSortDir="desc"
                expandedKey={expanded}
                onRowClick={(row) =>
                  setExpanded((current) => (current === row.code ? null : row.code))
                }
                renderExpanded={(row) => (
                  <CrossRowDetail
                    row={row}
                    year={year}
                    documents={report.documentos}
                    currency={currency}
                    canCustomer={canCustomer}
                    onStatement={() => setStatementRow(row)}
                    salesCurrency={salesCurrency}
                    salesKnown={rowSalesKnown}
                    billingKnown={billingKnown}
                  />
                )}
                loading={
                  receivables.isLoading ||
                  debtCustomers.isLoading ||
                  (includeWithoutDebt && allCustomers.isLoading)
                }
                empty={
                  <EmptyState
                    icon={HandCoins}
                    title="Sin clientes para los filtros"
                    description={
                      includeWithoutDebt
                        ? 'No hay ventas ni deuda para el año y los filtros actuales.'
                        : 'No hay deudores que coincidan con la búsqueda o el vendedor seleccionado.'
                    }
                  />
                }
              />
            </Card>

            <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-4">
              <MethodCard
                icon={CalendarRange}
                title="La venta es del año; la cartera es de hoy"
                text="La venta y la facturación pertenecen al año seleccionado. La cartera es el saldo abierto al momento de la consulta."
              />
              <MethodCard
                icon={HandCoins}
                title="El cruce es por código de cliente"
                text="Cada fila une la venta de Profit con la deuda de CxC usando el código del cliente. Los que no compraron en el año quedan como «Sin compra»."
              />
              <MethodCard
                icon={BarChart3}
                title="La antigüedad usa los mismos colores"
                text="Los tramos de la barra son los mismos de la pestaña Cartera: por vencer, 1–30, 31–60, 61–90, 91–120, 121–150 y más de 150 días. La barra de cobranza usa esos colores para el atraso al pagar de los últimos 12 meses."
              />
              <MethodCard
                icon={Wallet}
                title="La tasa es la del documento"
                text="En USD cada documento se convierte con su tasa; en Bs se muestra el saldo nativo. La venta y la cartera pueden diferir por notas de crédito o documentos sin tasa."
              />
            </div>
          </>
        )}
      </main>

      <CustomerStatementDialog
        open={Boolean(statementRow)}
        customer={statementCustomer}
        onClose={() => setStatementRow(null)}
      />
    </>
  );
}

function CrossRowDetail({
  row,
  year,
  documents,
  currency,
  canCustomer,
  onStatement,
  salesCurrency,
  salesKnown,
  billingKnown,
}: {
  row: CxcSalesRow;
  year: number;
  documents: ReceivablesDocumentRow[];
  currency: ReceivablesCurrency;
  canCustomer: boolean;
  onStatement: () => void;
  salesCurrency: 'USD' | 'VES';
  salesKnown: boolean;
  billingKnown: boolean;
}) {
  const docs = documents
    .filter((doc) => doc.clienteCodigo === row.code && !doc.esCredito)
    .sort((a, b) => b.diasVencimiento - a.diasVencimiento)
    .slice(0, 6);

  return (
    <div className="grid gap-space-md lg:grid-cols-12">
      <div className="lg:col-span-7">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">
          Antigüedad de la deuda
        </p>
        {row.aging.length > 0 ? (
          <>
            <div className="mt-1">
              <AgingBar
                segments={row.aging}
                total={row.cartera}
                max={row.cartera}
                currency={currency}
                height={18}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.aging.map((segment) => (
                <span
                  key={segment.key}
                  className="inline-flex items-center gap-1 rounded-pill border border-outline-variant/40 bg-surface-container-lowest px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant"
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: BUCKET_COLORS[segment.key] }}
                  />
                  {segment.label} · {formatReceivablesMoney(segment.amount, currency)} ·{' '}
                  {formatPctCompact(segment.pct)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-body-md text-on-surface-variant">Sin deuda abierta.</p>
        )}

        <p className="mt-space-md text-label-sm font-semibold uppercase tracking-wide text-outline">
          Documentos abiertos
        </p>
        {docs.length > 0 ? (
          <ul className="mt-1 flex flex-col divide-y divide-outline-variant/20">
            {docs.map((doc) => (
              <li
                key={`${doc.tipoDoc}-${doc.nroDoc}`}
                className="flex flex-wrap items-center justify-between gap-space-sm py-1.5 text-label-md"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: doc.tramo
                        ? BUCKET_COLORS[doc.tramo]
                        : 'var(--color-outline)',
                    }}
                  />
                  <span className="font-semibold text-on-surface">
                    {doc.tipoDoc} {doc.nroDoc}
                  </span>
                  <span className="text-on-surface-variant">
                    vence {formatStatementDate(doc.fechaVencimiento)}
                  </span>
                  <Badge tone="muted">
                    {doc.tramo ? bucketMeta(doc.tramo).short : 'Sin tramo'}
                  </Badge>
                </span>
                <span className="flex items-center gap-space-sm">
                  <span
                    className={cx(
                      'tabular-nums',
                      doc.diasVencimiento > 0 ? 'font-semibold text-error' : 'text-on-surface-variant',
                    )}
                  >
                    {doc.diasVencimiento > 0 ? `${doc.diasVencimiento} d` : 'Por vencer'}
                  </span>
                  <span className="font-semibold tabular-nums text-on-surface">
                    {formatReceivablesMoney(doc.saldo, currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-body-md text-on-surface-variant">
            Sin documentos débito abiertos para este cliente.
          </p>
        )}
      </div>

      <div className="lg:col-span-5">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">
          Venta {year}
        </p>
        {salesKnown && row.sales ? (
          <div className="mt-1 flex flex-col gap-1 text-label-md text-on-surface-variant">
            <span>
              Vendido{' '}
              <strong className="tabular-nums text-on-surface">{fmtTonnes(row.sales.kg)}</strong>
              {billingKnown && row.sales.billed != null && (
                <>
                  {' · '}facturado{' '}
                  <strong className="tabular-nums text-on-surface">
                    {fmtMoney(row.sales.billed, salesCurrency)}
                  </strong>
                </>
              )}
            </span>
            <span>
              {row.sales.notes} nota{row.sales.notes === 1 ? '' : 's'} · última compra{' '}
              {fmtDate(row.sales.lastSaleDate)}
            </span>
            <span>
              Pendiente {fmtTonnes(row.sales.pendingKg)} en {row.sales.pendingOrders} pedido
              {row.sales.pendingOrders === 1 ? '' : 's'}
            </span>
            {row.sales.yoyPct != null && (
              <span>
                Variación {fmtSalesPct(row.sales.yoyPct)} vs {year - 1}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-body-md text-on-surface-variant">
            {salesKnown ? `Sin compra registrada en ${year}.` : 'Ventas no disponibles.'}
          </p>
        )}

        <div className="mt-space-md flex flex-wrap items-center gap-space-sm">
          {canCustomer && (
            <button
              type="button"
              onClick={onStatement}
              className="inline-flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
            >
              <Receipt aria-hidden className="size-4" />
              Ver estado de cuenta
            </button>
          )}
          <span className="text-label-sm text-on-surface-variant">
            Cartera {formatReceivablesMoney(row.cartera, currency)} · {row.documentos} documento
            {row.documentos === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}

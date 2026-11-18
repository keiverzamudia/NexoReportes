'use client';

// ============================================================
// Expediente de un vendedor: cierre, histórico y dos vistas de su venta.
//
//  · Cartera: clientes asignados en Profit, aunque no hayan comprado.
//  · Nota: solo los clientes a los que les firmó una nota.
//  · Productos: el mismo cruce por artículo (cartera / firmado / otros).
//
// El histórico arranca en 3 meses y se cambia aquí; el cambio recalcula el
// informe completo porque la cuota depende de esa ventana.
// ============================================================

import type {
  Customer,
  ForecastSellerActivation,
  ForecastSellerClientRow,
  ForecastSellerCollection,
  ForecastSellerProductRow,
  ForecastSellerProductsResponse,
  ForecastSellerQuota,
  ForecastSellerQuotasResponse,
  ForecastSellerRow,
  ForecastSellersResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CircleDollarSign,
  Download,
  Package,
  Pencil,
  RefreshCcw,
  Search,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Select,
  Skeleton,
  TextInput,
  cx,
  fmtDate,
} from '../ui';
import { EChart } from '../EChart';
import { ModuleHelp } from '../help/ColumnHelp';
import { CustomerInsightsModal } from '../CustomerInsightsModal';
import { CustomerStatementDialog } from '../CustomerStatementDialog';
import {
  SELLERS_HELP_RULES,
  SELLERS_HELP_TITLE,
  SELLERS_HELP_TERMS,
} from '../../content/help/sellers';
import { useHelpRow } from '../../lib/use-help-row';
import { apiFetch } from '../../lib/api';
import { fmtKg, fmtPct, fmtTonnes, monthLabel, salesTone } from '../../lib/sales-report';
import {
  allocationLabel,
  buildClientQuotaRisk,
  buildSellerCarteraCsv,
  buildSellerNotaCsv,
  buildSellerProductsCsv,
  clientGapContributionPct,
  clientQuotaSharePct,
  fmtAttainmentPct,
  tabRunRate,
  topQuotaSeller,
} from '../../lib/sellers-report';
import {
  AttainmentRing,
  MiniStat,
  PerformanceList,
  SellerAvatar,
  SellerFicha,
  SplitMeter,
  cumulativeOption,
  monthlyHistoryDualOption,
  type PerformanceItem,
} from './seller-ui';
import { SellerQuotaDialog } from './SellerQuotaDialog';

type Tab = 'cartera' | 'nota' | 'productos';

const HISTORY_OPTIONS = [3, 6, 12, 24].map((months) => ({
  value: String(months),
  label: `${months} meses`,
}));

// Respaldo para una respuesta cacheada de una versión anterior del API, que
// todavía no traía estas fichas. Evita romper el expediente durante un deploy.
const EMPTY_COLLECTION: ForecastSellerCollection = {
  available: false,
  onTimePct: null,
  onTimeAmountUsd: 0,
  lateAmountUsd: 0,
  collectedAmountUsd: 0,
  averageDays: null,
  averageLateDays: null,
  paymentCount: 0,
  onTimePaymentCount: 0,
  latePaymentCount: 0,
  overdueUsd: null,
};

const EMPTY_ACTIVATION: ForecastSellerActivation = {
  available: false,
  assignedClients: 0,
  activeClients: 0,
  inertClients: 0,
  activationPct: null,
  reactivatedClients: 0,
  newClients: 0,
};

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvFileName(prefix: string, seller: ForecastSellerRow, report: ForecastSellersResponse) {
  const code = seller.sellerCode || 'sin-codigo';
  return `${prefix}-${code}-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
}

export function SellerDetailDrawer({
  seller,
  report,
  onClose,
  historyMonths,
  onHistoryMonthsChange,
  includeToday,
  canManageQuotas = false,
  initialTab = 'cartera',
  initialSalesFilter = 'all',
}: {
  seller: ForecastSellerRow;
  report: ForecastSellersResponse;
  onClose: () => void;
  historyMonths: number;
  onHistoryMonthsChange: (months: number) => void;
  includeToday: boolean;
  /** Permiso `vendedor_cuotas:update`: habilita el lápiz de cuotas. */
  canManageQuotas?: boolean;
  /** Pestaña con la que abre el expediente (por defecto, Cartera). */
  initialTab?: Tab;
  /** Filtro de venta inicial de la pestaña Cartera. */
  initialSalesFilter?: 'all' | 'with' | 'without';
}) {
  const detailRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const modalOpenRef = useRef(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState('');
  const [salesFilter, setSalesFilter] = useState<'all' | 'with' | 'without'>(initialSalesFilter);
  const [onlyWithoutBase, setOnlyWithoutBase] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  const [insightsCustomer, setInsightsCustomer] = useState<Customer | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [helpRow, setHelpRow] = useHelpRow();

  const isOpen = report.status === 'OPEN';
  const leader = topQuotaSeller(report);
  const isLeader = leader?.sellerCode === seller.sellerCode && seller.sellerCode !== '';
  const tone = salesTone(seller.projectedAttainmentPct ?? seller.attainmentPct);
  const quotaPct = seller.quotaPct;

  const carteraMetrics = tabRunRate(seller.carteraCurrentKg, seller.carteraTargetKg, report);
  const noteMetrics = tabRunRate(seller.noteCurrentKg, seller.noteTargetKg, report);

  const noteClients = useMemo(
    () => seller.clients.filter((client) => client.noteCurrentKg > 0 || client.noteHistoricalKg > 0),
    [seller.clients],
  );

  // ---------- Cuota como un todo: clientes = 100 % del vendedor ----------
  const quotaRisk = useMemo(() => buildClientQuotaRisk(seller, report), [seller, report]);

  const atRiskCartera = useMemo(() => new Set(quotaRisk.atRisk), [quotaRisk]);

  const atRiskNota = useMemo(() => {
    const rows = seller.clients.filter((client) => {
      if (client.noteTargetKg <= 0) return false;
      const metrics = tabRunRate(client.noteCurrentKg, client.noteTargetKg, report);
      return (metrics.projectedAttainmentPct ?? metrics.attainmentPct ?? 0) < 100;
    });
    return new Set(rows);
  }, [seller.clients, report]);

  const noteGapKg = useMemo(() => {
    if (seller.noteTargetKg <= 0) return null;
    return seller.clients.reduce(
      (acc, client) => acc + (tabRunRate(client.noteCurrentKg, client.noteTargetKg, report).gapKg ?? 0),
      0,
    );
  }, [seller, report]);

  const openCustomer = (client: ForecastSellerClientRow) => {
    if (!client.clientCode) return;
    setInsightsCustomer({
      id: client.clientCode,
      externalCode: client.clientCode,
      name: client.clientName,
      customerType: client.customerType,
      vendor: seller.sellerName,
      isActive: true,
      ordersCount: 0,
      sales: null,
    });
  };

  const filteredCartera = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return seller.clients.filter((client) => {
      if (onlyWithoutBase && client.carteraTargetKg > 0) return false;
      if (onlyAtRisk && !atRiskCartera.has(client)) return false;
      if (salesFilter === 'with' && client.carteraCurrentKg <= 0) return false;
      if (salesFilter === 'without' && client.carteraCurrentKg > 0) return false;
      if (!needle) return true;
      return (
        client.clientName.toLowerCase().includes(needle) ||
        client.clientCode.toLowerCase().includes(needle)
      );
    });
  }, [seller.clients, search, salesFilter, onlyWithoutBase, onlyAtRisk, atRiskCartera]);

  const filteredNota = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return noteClients.filter((client) => {
      if (onlyAtRisk && !atRiskNota.has(client)) return false;
      if (salesFilter === 'with' && client.noteCurrentKg <= 0) return false;
      if (onlyNew && client.noteHistoricalKg > 0) return false;
      if (!needle) return true;
      return (
        client.clientName.toLowerCase().includes(needle) ||
        client.clientCode.toLowerCase().includes(needle)
      );
    });
  }, [noteClients, search, onlyNew, onlyAtRisk, atRiskNota]);

  // ---------- Filas de la lista de clientes (mismo formato que vendedores) ----------
  const carteraItems: PerformanceItem[] = filteredCartera.map((row, index) => {
    const metrics = tabRunRate(row.carteraCurrentKg, row.carteraTargetKg, report);
    const share = clientQuotaSharePct(row.carteraTargetKg, seller.carteraTargetKg);
    const gapPct = clientGapContributionPct(metrics.gapKg, quotaRisk.gapKg);
    const notes = fmtKg(row.invoiceCount, 0);
    return {
      key: row.clientCode || row.clientName,
      name: row.clientName,
      rank: index + 1,
      badge: (
        <>
          {row.clientCode && (
            <span className="shrink-0 tabular-nums text-label-sm text-outline">{row.clientCode}</span>
          )}
          {row.carteraTargetKg <= 0 ? (
            <span className="shrink-0 text-label-sm text-warning">sin base</span>
          ) : row.isNew ? (
            <Badge tone="primary">Nuevo</Badge>
          ) : null}
        </>
      ),
      metaLine: [
        `Cuota ${share === null ? '—' : fmtPct(share)}`,
        `${notes} ${row.invoiceCount === 1 ? 'nota' : 'notas'}`,
        `${metrics.attainmentPct === null ? '—' : fmtPct(metrics.attainmentPct)} de su parte`,
        ...(row.pendingKg > 0 ? [`pendiente ${fmtKg(row.pendingKg)} kg`] : []),
      ].join(' · '),
      targetKg: row.carteraTargetKg,
      actualKg: row.carteraCurrentKg,
      noteKg: row.noteCurrentKg,
      projectedKg: metrics.projectedKg,
      gapKg: metrics.gapKg,
      pct: metrics.projectedAttainmentPct ?? metrics.attainmentPct,
      planKg: row.closingPlanKg,
      gapNote:
        gapPct === null
          ? undefined
          : gapPct >= 0
            ? `${fmtPct(gapPct)} de la brecha`
            : `compensa ${fmtPct(-gapPct)}`,
      overLabel: 'sobre su parte',
      onSelect: row.clientCode ? () => openCustomer(row) : undefined,
      selectTitle: row.clientCode ? `Abrir la ficha de ${row.clientName}` : undefined,
    };
  });

  const notaItems: PerformanceItem[] = filteredNota.map((row, index) => {
    const metrics = tabRunRate(row.noteCurrentKg, row.noteTargetKg, report);
    const share = clientQuotaSharePct(row.noteTargetKg, seller.noteTargetKg);
    const gapPct = clientGapContributionPct(metrics.gapKg, noteGapKg);
    const notes = fmtKg(row.invoiceCount, 0);
    const elsewhere =
      row.assignedSellerCode && row.assignedSellerCode !== seller.sellerCode
        ? `Cartera de ${row.assignedSellerName || row.assignedSellerCode} · `
        : '';
    return {
      key: row.clientCode || row.clientName,
      name: row.clientName,
      rank: index + 1,
      badge: (
        <>
          {row.clientCode && (
            <span className="shrink-0 tabular-nums text-label-sm text-outline">{row.clientCode}</span>
          )}
          {row.isNew && <Badge tone="primary">Nuevo</Badge>}
        </>
      ),
      metaLine: `${elsewhere}Cuota ${share === null ? '—' : fmtPct(share)} · ${notes} ${
        row.invoiceCount === 1 ? 'nota' : 'notas'
      } · ${metrics.attainmentPct === null ? '—' : fmtPct(metrics.attainmentPct)} de su parte${
        row.pendingKg > 0 ? ` · pendiente ${fmtKg(row.pendingKg)} kg` : ''
      }`,
      targetKg: row.noteTargetKg,
      actualKg: row.noteCurrentKg,
      noteKg: row.carteraCurrentKg,
      noteLabel: 'Cartera',
      projectedKg: metrics.projectedKg,
      gapKg: metrics.gapKg,
      pct: metrics.projectedAttainmentPct ?? metrics.attainmentPct,
      planKg: row.closingPlanKg,
      gapNote:
        gapPct === null
          ? undefined
          : gapPct >= 0
            ? `${fmtPct(gapPct)} de la brecha`
            : `compensa ${fmtPct(-gapPct)}`,
      overLabel: 'sobre su parte',
      onSelect: row.clientCode ? () => openCustomer(row) : undefined,
      selectTitle: row.clientCode ? `Abrir la ficha de ${row.clientName}` : undefined,
    };
  });




  const productQuery = useQuery<ForecastSellerProductsResponse>({
    queryKey: [
      'seller-products',
      seller.sellerCode,
      report.year,
      report.month,
      report.basis,
      historyMonths,
      includeToday,
      report.attribution,
      report.generatedAt,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        year: String(report.year),
        month: String(report.month),
        months: String(historyMonths),
        basis: report.basis,
        includeToday: includeToday ? 'true' : 'false',
        attribution: report.attribution,
      });
      return apiFetch<ForecastSellerProductsResponse>(
        `/forecast/sellers/${encodeURIComponent(seller.sellerCode)}/products?${params.toString()}`,
      );
    },
    enabled: tab === 'productos' && Boolean(seller.sellerCode),
    staleTime: 60_000,
    retry: 1,
  });

  // Las cuotas viven en la BD local y son independientes del informe pesado:
  // se leen aparte para que editarlas no obligue a recalcular Profit.
  const quotasQuery = useQuery<ForecastSellerQuotasResponse>({
    queryKey: ['seller-quotas', report.year, report.month],
    queryFn: () =>
      apiFetch<ForecastSellerQuotasResponse>(
        `/forecast/sellers/quotas?year=${report.year}&month=${report.month}`,
      ),
    staleTime: 30_000,
    retry: 1,
  });
  const quota: ForecastSellerQuota | null =
    quotasQuery.data?.quotas.find((entry) => entry.sellerCode === seller.sellerCode) ?? null;

  // Fichas de cobranza, activación y cuotas.
  const collection = seller.collection ?? EMPTY_COLLECTION;
  const activation = seller.activation ?? EMPTY_ACTIVATION;
  const quotaApplicable = !seller.isInternal && Boolean(seller.sellerCode);
  const quotaReadOnly = report.status === 'CLOSED';
  const quotaUnavailable = quotasQuery.isError;
  const canEditQuota =
    canManageQuotas &&
    quotaApplicable &&
    activation.available &&
    !quotaReadOnly &&
    !quotasQuery.isLoading &&
    !quotasQuery.isError;
  const reactivationQuota = quota?.reactivationQuota ?? null;
  const newClientsQuota = quota?.newClientsQuota ?? null;
  const reactivationPct =
    reactivationQuota !== null && reactivationQuota > 0
      ? (activation.reactivatedClients / reactivationQuota) * 100
      : null;
  const newClientsPct =
    newClientsQuota !== null && newClientsQuota > 0
      ? (activation.newClients / newClientsQuota) * 100
      : null;
  const collectionOnTimeShare =
    collection.collectedAmountUsd > 0
      ? (collection.onTimeAmountUsd / collection.collectedAmountUsd) * 100
      : 0;

  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    const rows = productQuery.data?.products ?? [];
    if (!needle) return rows;
    return rows.filter(
      (product) =>
        product.description.toLowerCase().includes(needle) ||
        product.productCode.toLowerCase().includes(needle),
    );
  }, [productQuery.data, productSearch]);

  const chart = useMemo(
    () =>
      cumulativeOption({
        daily: seller.daily,
        forecastKg: seller.targetKg,
        asOf: report.asOf,
        today: report.days.today,
      }),
    [seller, report.asOf, report.days.today],
  );
  const historyChart = useMemo(() => monthlyHistoryDualOption(seller), [seller]);

  useEffect(() => {
    modalOpenRef.current = Boolean(insightsCustomer || statementCustomer || quotaDialogOpen);
  }, [insightsCustomer, statementCustomer, quotaDialogOpen]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalOpenRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => detailRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const productColumns: Column<ForecastSellerProductRow>[] = [
    {
      key: 'producto',
      header: 'Producto',
      kind: 'id',
      sortValue: (row) => row.description,
      className: 'w-[17rem] max-w-[17rem]',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-on-surface" title={row.description}>
            {row.description}
          </p>
          <p className="text-label-sm text-outline">
            <span className="tabular-nums">{row.productCode}</span> · {row.uom}
            {row.kgPerUom !== null ? ` · ${row.kgPerUom} kg/${row.uom}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'mes',
      header: 'Cartera mes',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraCurrentKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-semibold text-on-surface">{fmtKg(row.carteraCurrentKg)}</p>
          <p className="text-label-sm text-outline">
            él {fmtKg(row.noteCurrentKg)} · otros {fmtKg(row.otherCurrentKg)}
          </p>
        </div>
      ),
    },
    {
      key: 'historico',
      header: `Histórico ${historyMonths}m`,
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraHistoricalKg,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.carteraHistoricalKg)}</p>
          <p className="text-label-sm text-outline">nota {fmtKg(row.noteHistoricalKg)}</p>
        </div>
      ),
    },
    {
      key: 'clientes',
      header: 'Clientes',
      align: 'right',
      kind: 'detail',
      sortValue: (row) => row.clientCount,
      render: (row) => (
        <div className="text-right">
          <p className="tabular-nums text-on-surface">{fmtKg(row.clientCount, 0)}</p>
          <p className="text-label-sm text-outline">nota {fmtKg(row.noteClientCount, 0)}</p>
        </div>
      ),
    },
    {
      key: 'share',
      header: '% cartera',
      align: 'right',
      kind: 'metric',
      sortValue: (row) => row.carteraShareOfSellerPct ?? -1,
      render: (row) => (
        <span className="tabular-nums text-primary">
          {row.carteraShareOfSellerPct === null ? '—' : fmtPct(row.carteraShareOfSellerPct)}
        </span>
      ),
    },
    {
      key: 'ultima',
      header: 'Última nota',
      kind: 'detail',
      sortValue: (row) => row.lastInvoiceDate ?? '',
      render: (row) => <span className="text-label-md text-on-surface-variant">{fmtDate(row.lastInvoiceDate)}</span>,
    },
  ];

  const tabTitle =
    tab === 'cartera' ? 'Clientes de' : tab === 'nota' ? 'Notas firmadas por' : 'Productos de';
  const tabCount =
    tab === 'cartera'
      ? `${fmtKg(filteredCartera.length, 0)} de ${fmtKg(seller.clientCount, 0)} clientes`
      : tab === 'nota'
        ? `${fmtKg(filteredNota.length, 0)} de ${fmtKg(noteClients.length, 0)} clientes`
        : `${fmtKg(filteredProducts.length, 0)} de ${fmtKg(productQuery.data?.products.length ?? 0, 0)} productos`;
  const tabSummary =
    tab === 'cartera'
      ? `Cuota cartera ${formatQuotaPct(seller.carteraQuotaPct)} · Meta ${fmtKg(seller.carteraTargetKg)} kg · Proyección ${
          carteraMetrics.projectedKg === null ? '—' : `${fmtKg(carteraMetrics.projectedKg)} kg`
        }`
      : tab === 'nota'
        ? `Cuota nota ${formatQuotaPct(seller.noteQuotaPct)} · Meta ${fmtKg(seller.noteTargetKg)} kg · Proyección ${
            noteMetrics.projectedKg === null ? '—' : `${fmtKg(noteMetrics.projectedKg)} kg`
          }`
        : `Cartera ${fmtKg(seller.carteraCurrentKg)} kg · firmado ${fmtKg(seller.noteCurrentKg)} kg`;

  const showNotaWarning = report.attribution === 'NOTE' && seller.noteHistoricalKg <= 0;

  // Ficha de cuota (reactivación / nuevos). No es un componente aparte para no
  // perder la identidad del vendedor ni el estado del diálogo en cada render.
  const renderQuotaFicha = ({
    icon,
    label,
    actual,
    goal,
    pct,
    noun,
    description,
  }: {
    icon: LucideIcon;
    label: string;
    actual: number;
    goal: number | null;
    pct: number | null;
    noun: string;
    description: string;
  }) => {
    const hasGoal = goal !== null && goal > 0;
    const quotaTone = hasGoal ? salesTone(pct) : 'none';
    const remaining = hasGoal ? Math.max(0, (goal ?? 0) - actual) : 0;
    const value = !quotaApplicable
      ? '—'
      : !activation.available
        ? '—'
        : hasGoal
          ? fmtPct(pct)
          : fmtKg(actual, 0);
    const hint = !quotaApplicable
      ? seller.isInternal
        ? 'No aplica a cuentas internas.'
        : 'Sin código de vendedor.'
      : !activation.available
        ? 'Cartera de Profit no disponible.'
        : quotaUnavailable
          ? `${fmtKg(actual, 0)} ${noun} · cuota no disponible`
          : hasGoal
            ? `${fmtKg(actual, 0)} de ${fmtKg(goal ?? 0, 0)} · ${
                actual > (goal ?? 0) ? 'cuota superada' : `faltan ${fmtKg(remaining, 0)}`
              }`
            : `${fmtKg(actual, 0)} ${noun} · sin cuota asignada`;
    const barClass =
      quotaTone === 'good'
        ? 'bg-secondary-container'
        : quotaTone === 'warn'
          ? 'bg-warning'
          : quotaTone === 'bad'
            ? 'bg-critical'
            : 'bg-primary-container';

    return (
      <SellerFicha
        icon={icon}
        label={label}
        value={value}
        hint={hint}
        tone={quotaTone}
        title={description}
        action={
          canEditQuota ? (
            <button
              type="button"
              onClick={() => setQuotaDialogOpen(true)}
              aria-label={`Fijar ${label.toLowerCase()}`}
              title={`Fijar ${label.toLowerCase()}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-label-sm font-semibold text-primary transition-colors hover:bg-primary-container/10"
            >
              <Pencil aria-hidden className="size-3" />
              Fijar
            </button>
          ) : undefined
        }
      >
        {hasGoal && activation.available && quotaApplicable ? (
          <SplitMeter
            label={`${label}: ${fmtPct(pct)}`}
            normalize={false}
            segments={[{ pct: Math.min(100, Math.max(0, pct ?? 0)), className: barClass, label }]}
          />
        ) : null}
      </SellerFicha>
    );
  };

  return (
    <>
      <div
        aria-hidden
        className="animate-fade fixed inset-0 z-40 bg-[#081d2c]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        ref={detailRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-detail-title"
        tabIndex={-1}
        className="animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col overflow-y-auto overscroll-contain bg-surface-container-lowest shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-space-md border-b border-surface-container bg-surface-container-lowest/95 px-space-md py-space-sm backdrop-blur">
          <div className="flex min-w-0 items-center gap-space-sm">
            <SellerAvatar name={seller.sellerName} rank={isLeader ? 1 : 2} />
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Expediente de vendedor
              </p>
              <h2 id="seller-detail-title" className="truncate text-title-md font-bold text-on-surface">
                {seller.sellerName}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-label-md text-on-surface-variant">
                <span className="tabular-nums">{seller.sellerCode || 'sin código'}</span>
                <span aria-hidden>·</span>
                <span>{allocationLabel(report)}</span>
                {isLeader && <Badge tone="primary">Mayor cuota</Badge>}
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  Histórico
                  <Select
                    ariaLabel="Ventana histórica del vendedor"
                    value={String(historyMonths)}
                    onChange={(value) => onHistoryMonthsChange(Number(value))}
                    options={HISTORY_OPTIONS}
                    className="h-7 w-24"
                  />
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Cerrar expediente del vendedor"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex flex-col gap-space-md p-space-md">
          {/* Cabecera de cumplimiento */}
          <section className="relative isolate flex flex-col gap-space-md overflow-hidden rounded-card bg-hero p-space-md text-white shadow-hero sm:flex-row sm:items-center sm:justify-between">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.055]"
              style={{
                backgroundImage:
                  'linear-gradient(rgb(255 255 255 / 0.9) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.9) 1px, transparent 1px)',
                backgroundSize: '34px 34px',
              }}
            />
            <div className="relative min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.16em] text-white/55">
                Cuota sobre la meta de la empresa
              </p>
              <div className="flex flex-wrap items-end gap-space-sm">
                <span className="font-display tabular-nums text-[2.6rem] font-black leading-none text-secondary-container">
                  {quotaPct === null ? '—' : fmtPct(quotaPct)}
                </span>
                <span className="pb-1 text-body-md text-white/60">
                  meta {fmtKg(seller.targetKg)} kg ({fmtTonnes(seller.targetKg)} t)
                </span>
              </div>
              <p className="mt-space-2xs max-w-lg text-body-md text-white/65">
                Lleva {fmtKg(seller.actualKg)} kg{' '}
                {seller.targetKg > 0 ? `(${fmtAttainmentPct(seller.attainmentPct)} de su cuota)` : '(sin cuota)'} y
                representa el {seller.currentSharePct === null ? '—' : fmtPct(seller.currentSharePct)} de la venta del
                mes.
              </p>
            </div>
            <div className="relative flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-space-sm">
              <AttainmentRing pct={seller.projectedAttainmentPct} tone={tone} />
            </div>
          </section>

          {showNotaWarning && (
            <p
              role="status"
              className="flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-md py-space-sm text-body-md text-on-warning-container"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              Sin notas firmadas en los últimos {historyMonths} meses. La cuota por nota es 0 %. Su cartera sí tiene{' '}
              {fmtKg(seller.carteraHistoricalKg)} kg históricos; revisa la pestaña Cartera.
            </p>
          )}

          {/* Pulso comercial: volumen, cobranza, activación y cuotas. Va entre
              el hero y la rejilla histórica de KPIs, sin tocar esa rejilla. */}
          <section
            aria-label="Pulso comercial del vendedor"
            className="grid grid-cols-1 gap-space-sm sm:grid-cols-6"
          >
            <div className="sm:col-span-2">
              <SellerFicha
                icon={TrendingUp}
                label="Volumen de venta"
                value={`${fmtKg(seller.actualKg)} kg`}
                hint={`${fmtKg(seller.invoiceCount, 0)} notas · ${fmtKg(
                  seller.activeClientCount,
                  0,
                )} clientes · ${
                  seller.currentSharePct === null ? '—' : fmtPct(seller.currentSharePct)
                } de la venta de la red`}
              >
                <p className="text-label-sm text-outline">
                  {isOpen && seller.projectedKg !== null
                    ? `Proyección ${fmtKg(seller.projectedKg)} kg`
                    : report.status === 'CLOSED'
                      ? `${fmtAttainmentPct(seller.attainmentPct)} de su cuota`
                      : 'Mes futuro: sin entregas'}
                </p>
              </SellerFicha>
            </div>

            <div className="sm:col-span-2">
              <SellerFicha
                icon={CircleDollarSign}
                label="Cobranza a tiempo"
                value={collection.available && collection.onTimePct !== null ? fmtPct(collection.onTimePct) : '—'}
                hint={
                  !collection.available ? (
                    'No se pudo leer la cobranza en Profit.'
                  ) : collection.paymentCount === 0 ? (
                    'Sin cobros registrados en el mes.'
                  ) : (
                    <>
                      <span className="block">
                        {fmtUsd(collection.onTimeAmountUsd)} a tiempo · {fmtUsd(collection.lateAmountUsd)} fuera
                        de fecha
                      </span>
                      <span className="block">
                        Prom. cobro {fmtDays(collection.averageDays)} ·{' '}
                        {collection.averageLateDays === null
                          ? 'sin atrasos'
                          : `atraso ${fmtDays(collection.averageLateDays)}`}
                      </span>
                      {collection.overdueUsd !== null && collection.overdueUsd > 0 && (
                        <span className="block text-warning">
                          Vencido hoy {fmtUsd(collection.overdueUsd)}
                        </span>
                      )}
                    </>
                  )
                }
                title={
                  collection.available
                    ? `${collection.onTimePaymentCount} pago(s) a tiempo · ${collection.latePaymentCount} fuera de fecha. Montos en USD.`
                    : undefined
                }
              >
                {collection.available && collection.paymentCount > 0 ? (
                  <SplitMeter
                    label={`A tiempo ${fmtPct(collectionOnTimeShare)} · fuera de fecha ${fmtPct(
                      100 - collectionOnTimeShare,
                    )}`}
                    segments={[
                      {
                        pct: collectionOnTimeShare,
                        className: 'bg-secondary-container',
                        label: 'A tiempo',
                      },
                      {
                        pct: 100 - collectionOnTimeShare,
                        className: 'bg-critical',
                        label: 'Fuera',
                      },
                    ]}
                  />
                ) : null}
              </SellerFicha>
            </div>

            <div className="sm:col-span-2">
              <SellerFicha
                icon={UserCheck}
                label="Activación de clientes"
                value={activation.available && activation.activationPct !== null ? fmtPct(activation.activationPct) : '—'}
                hint={
                  !activation.available
                    ? 'Cartera de Profit no disponible.'
                    : activation.assignedClients === 0
                      ? 'Sin clientes en cartera.'
                      : `${fmtKg(activation.activeClients, 0)} activos · ${fmtKg(
                          activation.inertClients,
                          0,
                        )} inertes de ${fmtKg(activation.assignedClients, 0)}`
                }
                title="Inerte = cliente de su cartera sin compra este mes."
              >
                {activation.available && activation.assignedClients > 0 ? (
                  <SplitMeter
                    label={`${activation.activeClients} activos · ${activation.inertClients} inertes`}
                    segments={[
                      {
                        pct: activation.activeClients,
                        className: 'bg-secondary-container',
                        label: 'Activos',
                      },
                      {
                        pct: activation.inertClients,
                        className: 'bg-surface-container-high',
                        label: 'Inertes',
                      },
                    ]}
                  />
                ) : null}
              </SellerFicha>
            </div>

            <div className="sm:col-span-3">
              {renderQuotaFicha({
                icon: RefreshCcw,
                label: 'Cuota de reactivación',
                actual: activation.reactivatedClients,
                goal: reactivationQuota,
                pct: reactivationPct,
                noun: 'reactivados',
                description:
                  'Reactivado = cliente de su cartera sin compras en los 3 meses previos que vuelve a comprar este mes.',
              })}
            </div>

            <div className="sm:col-span-3">
              {renderQuotaFicha({
                icon: UserPlus,
                label: 'Cuota de clientes nuevos',
                actual: activation.newClients,
                goal: newClientsQuota,
                pct: newClientsPct,
                noun: 'nuevos',
                description:
                  'Nuevo = cliente de su cartera sin compras en los 12 meses previos que compra este mes.',
              })}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <MiniStat
              label="Meta asignada"
              value={`${fmtKg(seller.targetKg)} kg`}
              hint={quotaPct === null ? 'sin cuota' : `${fmtPct(quotaPct)} del forecast`}
            />
            <MiniStat
              label="Venta del mes"
              value={`${fmtKg(seller.actualKg)} kg`}
              hint={`${fmtKg(seller.invoiceCount, 0)} notas · ${fmtKg(seller.activeClientCount, 0)} clientes`}
            />
            <MiniStat
              label={isOpen ? 'Proyección' : 'Cierre real'}
              value={seller.projectedKg === null ? '—' : `${fmtKg(seller.projectedKg)} kg`}
              hint={seller.projectedAttainmentPct === null ? 'sin meta' : `${fmtAttainmentPct(seller.projectedAttainmentPct)} de su cuota`}
              tone={tone}
            />
            <MiniStat
              label="Brecha"
              value={seller.gapKg === null ? '—' : `${seller.gapKg > 0 ? '+' : ''}${fmtKg(seller.gapKg)} kg`}
              hint={seller.gapKg === null ? 'depende de la meta' : seller.gapKg < 0 ? 'por debajo de su cuota' : 'por encima de su cuota'}
              tone={tone}
            />
          </div>

          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <MiniStat
              label="Clientes en cartera"
              value={fmtKg(seller.assignedClientCount, 0)}
              hint={`${fmtKg(seller.activeClientCount, 0)} con venta este mes`}
            />
            <MiniStat
              label="Venta de cartera"
              value={`${fmtKg(seller.carteraCurrentKg)} kg`}
              hint={`histórico ${fmtKg(seller.carteraHistoricalKg)} kg`}
            />
            <MiniStat
              label="Venta firmada"
              value={`${fmtKg(seller.noteCurrentKg)} kg`}
              hint="nota de entrega"
            />
            <MiniStat
              label="Facturado por otro"
              value={`${fmtKg(seller.otherSellerKg)} kg`}
              hint={seller.otherSellerKg > 0 ? 'su cartera, otra nota' : 'sin diferencias'}
              tone={seller.otherSellerKg > 0 ? 'warn' : 'none'}
            />
          </div>

          <div className="grid gap-space-md lg:grid-cols-2">
            <Card className="overflow-hidden p-space-sm">
              <header className="mb-space-xs flex items-center justify-between gap-space-sm px-space-xs">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">Acumulado del mes</h3>
                  <p className="text-label-md text-on-surface-variant">Real vs proyección vs ritmo de su cuota</p>
                </div>
                <span className="text-label-sm text-on-surface-variant">{monthLabel(report.year, report.month)}</span>
              </header>
              {seller.daily.length > 0 && seller.actualKg > 0 ? (
                <EChart
                  option={chart}
                  height={230}
                  ariaLabel={`Acumulado de ${seller.sellerName}: venta real, proyección y ritmo de su cuota`}
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title="Sin entregas en el mes"
                  description="Cuando Profit registre la primera nota de este vendedor verás aquí su acumulado."
                />
              )}
            </Card>

            <Card className="overflow-hidden p-space-sm">
              <header className="mb-space-xs flex items-center justify-between gap-space-sm px-space-xs">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface">Últimos {historyMonths} meses</h3>
                  <p className="text-label-md text-on-surface-variant">Cartera asignada vs notas firmadas</p>
                </div>
                <Badge tone="muted">
                  {fmtKg(seller.carteraHistoricalKg / Math.max(1, historyMonths))} kg prom. cartera
                </Badge>
              </header>
              {seller.carteraHistory.length > 0 || seller.noteHistory.length > 0 ? (
                <EChart
                  option={historyChart}
                  height={230}
                  ariaLabel={`Histórico de ${seller.sellerName}: cartera y notas firmadas`}
                />
              ) : (
                <EmptyState icon={Users} title="Sin histórico" description="La ventana elegida no tiene meses cerrados." />
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
              <div>
                <div className="flex flex-wrap items-center gap-space-sm">
                  <h3 className="flex items-center gap-1.5 text-title-md font-bold text-on-surface">
                    {tab === 'productos' ? (
                      <Package aria-hidden className="size-4 text-primary" />
                    ) : (
                      <Users aria-hidden className="size-4 text-primary" />
                    )}
                    {tabTitle} {seller.sellerName.split(' ')[0]}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-container p-1">
                    <TabButton active={tab === 'cartera'} onClick={() => setTab('cartera')}>
                      Cartera · {fmtKg(seller.clientCount, 0)}
                    </TabButton>
                    <TabButton active={tab === 'nota'} onClick={() => setTab('nota')}>
                      Nota · {fmtKg(noteClients.length, 0)}
                    </TabButton>
                    <TabButton active={tab === 'productos'} onClick={() => setTab('productos')}>
                      Productos · {fmtKg(productQuery.data?.products.length ?? 0, 0)}
                    </TabButton>
                  </div>
                </div>
                <p className="mt-1 text-label-md text-on-surface-variant">
                  {tabCount} · {tabSummary}
                </p>
                {tab === 'cartera' && quotaRisk.top3SharePct !== null && (
                  <p className="text-label-sm text-outline">
                    Sus 3 mayores clientes cargan el {fmtPct(quotaRisk.top3SharePct)} de su cuota ·{' '}
                    {fmtKg(quotaRisk.atRisk.length, 0)} en riesgo.
                  </p>
                )}
                {tab === 'cartera' && (
                  <p className="text-label-sm text-outline">
                    La cuota del vendedor es el 100 %: su meta de cliente es su peso en el histórico de la cartera.
                  </p>
                )}
                {tab === 'nota' && (
                  <p className="text-label-sm text-outline">
                    La cuota por nota del vendedor es el 100 %: su meta de cliente es su peso en el histórico de las notas firmadas.
                  </p>
                )}
                {tab === 'productos' && (
                  <p className="text-label-sm text-outline">
                    Cartera = venta de sus clientes asignados. Firmado = notas del vendedor. Otros = cartera facturada por otros.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-space-2xs">
                <TextInput
                  icon={Search}
                  value={tab === 'productos' ? productSearch : search}
                  onChange={tab === 'productos' ? setProductSearch : setSearch}
                  placeholder={tab === 'productos' ? 'Buscar producto…' : 'Buscar cliente…'}
                  ariaLabel={tab === 'productos' ? 'Buscar producto en el expediente' : 'Buscar cliente en el expediente'}
                  className="min-w-[10rem]"
                />
                {tab === 'cartera' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSalesFilter((value) => (value === 'with' ? 'all' : 'with'))}
                      aria-pressed={salesFilter === 'with'}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        salesFilter === 'with'
                          ? 'bg-primary-container text-on-primary'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Con venta
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalesFilter((value) => (value === 'without' ? 'all' : 'without'))}
                      aria-pressed={salesFilter === 'without'}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        salesFilter === 'without'
                          ? 'bg-surface-container-high text-on-surface'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Sin venta
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyWithoutBase((value) => !value)}
                      aria-pressed={onlyWithoutBase}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        onlyWithoutBase
                          ? 'bg-warning-container text-on-warning-container'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Sin base
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyAtRisk((value) => !value)}
                      aria-pressed={onlyAtRisk}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        onlyAtRisk
                          ? 'bg-critical-container text-on-critical-container'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Riesgo · {fmtKg(quotaRisk.atRisk.length, 0)}
                    </button>
                  </>
                )}
                {tab === 'nota' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOnlyNew((value) => !value)}
                      aria-pressed={onlyNew}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        onlyNew
                          ? 'bg-primary-container text-on-primary'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Nuevos
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyAtRisk((value) => !value)}
                      aria-pressed={onlyAtRisk}
                      className={cx(
                        'inline-flex h-9 items-center rounded-xl px-space-sm text-label-md font-semibold transition-colors',
                        onlyAtRisk
                          ? 'bg-critical-container text-on-critical-container'
                          : 'border border-outline-variant/50 text-on-surface-variant hover:text-primary',
                      )}
                    >
                      Riesgo · {fmtKg(atRiskNota.size, 0)}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (tab === 'cartera') {
                      downloadCsv(buildSellerCarteraCsv(seller, report), csvFileName('clientes-cartera', seller, report));
                    } else if (tab === 'nota') {
                      downloadCsv(buildSellerNotaCsv(seller, report), csvFileName('clientes-nota', seller, report));
                    } else if (productQuery.data) {
                      downloadCsv(
                        buildSellerProductsCsv(productQuery.data.products),
                        csvFileName('productos', seller, report),
                      );
                    }
                  }}
                  disabled={tab === 'productos' && !productQuery.data}
                  className="inline-flex h-9 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-sm text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
                >
                  <Download aria-hidden className="size-4" /> CSV
                </button>
              </div>
            </div>

            {tab === 'cartera' && (
              <div className="px-space-md pb-space-md">
                <PerformanceList
                  items={carteraItems}
                  showProjection={isOpen}
                  maxHeightClass="max-h-[52vh]"
                  markerLabel="su cuota 100 %"
                  legendLabel="Marcador verde = 100 % de su parte"
                  empty={
                    <EmptyState
                      icon={Users}
                      title="Sin clientes para el filtro"
                      description="Prueba con otro texto o cambia los filtros."
                    />
                  }
                />
              </div>
            )}

            {tab === 'nota' && (
              <div className="px-space-md pb-space-md">
                <PerformanceList
                  items={notaItems}
                  showProjection={isOpen}
                  maxHeightClass="max-h-[52vh]"
                  markerLabel="su cuota 100 %"
                  legendLabel="Marcador verde = 100 % de su parte"
                  empty={
                    <EmptyState
                      icon={Users}
                      title="Sin notas en la ventana"
                      description={
                        seller.noteHistoricalKg <= 0
                          ? 'El vendedor no firmó notas en el histórico. Cambia a la pestaña Cartera para ver sus clientes asignados.'
                          : 'Prueba con otro texto o desactiva el filtro de nuevos.'
                      }
                    />
                  }
                />
              </div>
            )}

            {tab === 'productos' && (
              <>
                {productQuery.isLoading && (
                  <div className="flex flex-col gap-space-sm p-space-md">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                )}
                {productQuery.error && (
                  <p role="alert" className="flex items-center gap-space-sm p-space-md text-body-md text-error">
                    <AlertTriangle aria-hidden className="size-4" />
                    {productQuery.error instanceof Error ? productQuery.error.message : 'No se pudieron cargar los productos'}
                  </p>
                )}
                {!productQuery.isLoading && !productQuery.error && (
                  <DataTable
                    columns={productColumns}
                    rows={filteredProducts}
                    rowKey={(row) => row.productCode || row.description}
                    maxHeightClass="max-h-[46vh]"
                    showHelpRow={helpRow}
                    empty={
                      <EmptyState
                        icon={Package}
                        title="Sin productos para el filtro"
                        description="Prueba con otro texto o cambia la ventana histórica."
                      />
                    }
                  />
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-xs text-label-sm text-on-surface-variant">
              <span>
                {tab === 'cartera'
                  ? 'Σ metas de clientes = 100 % de su cuota. El plan de cierre se reparte por capacidad real (mejor mes de 12). Clic en un cliente para abrir su ficha 360; los «sin base» no entran al reparto.'
                  : tab === 'nota'
                    ? 'Σ metas de clientes = 100 % de su cuota por nota. Clic en un cliente para abrir su ficha 360.'
                    : 'Cartera mes = venta de sus clientes; firmado = notas del vendedor; otros = cartera facturada por otros.'}
              </span>
              {tab === 'productos' && (
                <button
                  type="button"
                  onClick={() => setHelpRow(!helpRow)}
                  aria-pressed={helpRow}
                  className="font-semibold text-primary hover:underline"
                >
                  {helpRow ? 'Ocultar explicaciones' : 'Explicar columnas'}
                </button>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-space-sm px-space-xs pb-space-sm text-label-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle aria-hidden className="size-3.5 text-warning" />
              La cuota es una asignación calculada; la meta oficial de la empresa sigue siendo la del informe de ventas.
            </span>
            <ModuleHelp
              title={SELLERS_HELP_TITLE}
              narrative="La cuota del vendedor es el 100 %; cada cliente es una porción calculada con su peso histórico y su cumplimiento se mide contra esa porción."
              rules={SELLERS_HELP_RULES}
              terms={SELLERS_HELP_TERMS}
            />
          </div>
        </div>
      </aside>

      <SellerQuotaDialog
        open={quotaDialogOpen}
        seller={seller}
        year={report.year}
        month={report.month}
        quota={quota}
        onClose={() => setQuotaDialogOpen(false)}
      />

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

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$ ${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 }).format(value)}`;
}

function fmtDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} d`;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'h-7 rounded-lg px-2.5 text-label-md font-semibold transition-colors',
        active ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

function formatQuotaPct(value: number | null): string {
  return value === null ? '—' : fmtPct(value);
}

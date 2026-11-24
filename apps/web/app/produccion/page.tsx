'use client';

// ============================================================
// Producción — plan, explosión de materiales, fórmulas y nutrición.
//
// Profit aporta las cédulas, componentes, costos y stock. Nexo agrega la
// demanda (forecast + pedidos + vendido), el stock de seguridad, la explosión
// y la comparación de recetas. NUNCA escribe en Profit.
// ============================================================

import 'driver.js/dist/driver.css';

import type {
  ProductionExplosionResponse,
  ProductionFormulaDetailResponse,
  ProductionFormulaListResponse,
  ProductionFormulaSummary,
  ProductionMaterialRow,
  ProductionNutritionCatalogResponse,
  ProductionOrderGroup,
  ProductionOrderLine,
  ProductionOrderRisk,
  ProductionOrdersResponse,
  ProductionPlanResponse,
  ProductionPlanRow,
  ProductionPolicy,
  ProductionScenario,
  ProductionSimulationOverride,
  ProductionSimulationResponse,
  ProductionCurrency,
} from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Factory,
  FlaskConical,
  ListChecks,
  PackageSearch,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ModuleHelp } from '../../components/help/ColumnHelp';
import { ProductionTour } from '../../components/help/ProductionTour';
import { FormulaDetailModal } from '../../components/production/FormulaDetailModal';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Card,
  Column,
  CoverageBar,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Select,
  Segmented,
  TextInput,
  cx,
  fmtQty,
} from '../../components/ui';
import type { ProductionTab } from '../../content/help/production';
import {
  PROD_FORMULA_HELP,
  PROD_MATERIAL_HELP,
  PROD_PLAN_HELP,
  PROD_SELECTION_HELP,
  PROD_TAB_HELP,
} from '../../content/help/production';
import { AuthRequiredError, apiFetch } from '../../lib/api';

type Tab = ProductionTab;

const POLICY_OPTIONS: { value: ProductionPolicy; label: string }[] = [
  { value: 'MAX', label: 'Máximo (forecast vs pedidos)' },
  { value: 'FORECAST', label: 'Solo forecast restante' },
  { value: 'ORDERS', label: 'Solo pedidos pendientes' },
  { value: 'SUM', label: 'Forecast + pedidos' },
];

const WEEK_OPTIONS = [
  { value: '0', label: 'Mes completo' },
  { value: '1', label: 'Semana 1 (1-7)' },
  { value: '2', label: 'Semana 2 (8-14)' },
  { value: '3', label: 'Semana 3 (15-21)' },
  { value: '4', label: 'Semana 4 (22-fin)' },
];

const CURRENCY_OPTIONS: { value: ProductionCurrency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'BS', label: 'Bs' },
];

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: 'summary', label: 'Resumen' },
  { value: 'plan', label: 'Plan' },
  { value: 'selection', label: 'Selección' },
  { value: 'explosion', label: 'Explosión' },
  { value: 'formulas', label: 'Fórmulas' },
  { value: 'nutrition', label: 'Nutrición' },
  { value: 'scenarios', label: 'Escenarios' },
];

const RISK_LABEL: Record<ProductionOrderRisk, string> = {
  CUBIERTO: 'Cubierto',
  BAJO: 'Riesgo bajo',
  MEDIO: 'Riesgo medio',
  ALTO: 'Riesgo alto',
  SIN_DEMANDA: 'Sin demanda',
};

const RISK_TONE: Record<ProductionOrderRisk, 'success' | 'warning' | 'danger' | 'muted'> = {
  CUBIERTO: 'success',
  BAJO: 'success',
  MEDIO: 'warning',
  ALTO: 'danger',
  SIN_DEMANDA: 'muted',
};

const STATUS_BAR: Record<ProductionPlanRow['status'], string> = {
  CUBIERTO: 'bg-secondary',
  PRODUCIR: 'bg-critical',
  SIN_FORMULA: 'bg-outline',
  SIN_COSTO: 'bg-warning',
};

const STATUS_LABEL: Record<ProductionPlanRow['status'], string> = {
  CUBIERTO: 'Cubierto',
  PRODUCIR: 'Producir',
  SIN_FORMULA: 'Sin cédula',
  SIN_COSTO: 'Sin costo',
};

const STATUS_TONE: Record<ProductionPlanRow['status'], 'success' | 'warning' | 'danger' | 'muted'> = {
  CUBIERTO: 'success',
  PRODUCIR: 'danger',
  SIN_FORMULA: 'danger',
  SIN_COSTO: 'warning',
};

const KIND_LABEL: Record<string, string> = {
  MASTER: 'Maestra',
  BASE: 'Base',
  BATCH: 'Lote',
};

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseYm(value: string): { year: number; month: number } {
  const parts = value.split('-');
  const year = Number(parts[0] ?? '');
  const month = Number(parts[1] ?? '');
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : new Date().getMonth() + 1,
  };
}

function queryString(
  ym: string,
  week: number,
  policy: ProductionPolicy,
  currency: ProductionCurrency,
): string {
  const { year, month } = parseYm(ym);
  return new URLSearchParams({
    year: String(year),
    month: String(month),
    week: String(week),
    policy,
    costBasis: 'LAST',
    currency,
  }).toString();
}

function money(value: number | null, currency: ProductionCurrency): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + (currency === 'USD' ? ' USD' : ' Bs');
}

function moneyCompact(value: number | null, currency: ProductionCurrency): string {
  if (value === null) return '—';
  if (Math.abs(value) >= 1_000_000) return `${fmtQty(value / 1_000_000, 2)} M ${currency}`;
  if (Math.abs(value) >= 1_000) return `${fmtQty(value / 1_000, 1)} k ${currency}`;
  return money(value, currency);
}

function statusAlertTone(count: number): 'success' | 'warning' | 'danger' | 'muted' {
  if (count <= 0) return 'success';
  if (count < 5) return 'warning';
  return 'danger';
}

function formulaLabel(row: ProductionPlanRow): string {
  if (!row.formulaName) return '—';
  return `${row.formulaId} · ${KIND_LABEL[row.formulaKind ?? ''] ?? row.formulaKind}`;
}

const PLAN_COLUMNS: Column<ProductionPlanRow>[] = [
  {
    key: 'code',
    header: 'Código',
    kind: 'id',
    sortValue: (row) => row.productCode,
    render: (row) => <span className="font-bold tabular-nums text-primary">{row.productCode}</span>,
  },
  {
    key: 'description',
    header: 'Producto',
    title: (row) => row.description,
    sortValue: (row) => row.description,
    render: (row) => <span className="block max-w-[16rem] truncate">{row.description}</span>,
  },
  {
    key: 'uom',
    header: 'UND',
    render: (row) => <span className="text-on-surface-variant">{row.uom}</span>,
  },
  {
    key: 'forecast',
    header: 'Forecast período',
    align: 'right',
    help: PROD_PLAN_HELP.forecast,
    sortValue: (row) => row.forecastKg,
    render: (row) => fmtQty(row.forecastKg, 0),
  },
  {
    key: 'sold',
    header: 'Despachado',
    align: 'right',
    help: PROD_PLAN_HELP.sold,
    sortValue: (row) => row.soldKg,
    render: (row) => fmtQty(row.soldKg, 0),
  },
  {
    key: 'orders',
    header: 'Cartera',
    align: 'right',
    help: PROD_PLAN_HELP.orders,
    sortValue: (row) => row.ordersKg,
    render: (row) => fmtQty(row.ordersKg, 0),
  },
  {
    key: 'remaining',
    header: 'Forecast x cumplir',
    align: 'right',
    help: PROD_PLAN_HELP.remaining,
    sortValue: (row) => row.forecastRemainingKg,
    render: (row) => <span className="font-semibold">{fmtQty(row.forecastRemainingKg, 0)}</span>,
  },
  {
    key: 'stock',
    header: 'Stock PT',
    align: 'right',
    help: PROD_PLAN_HELP.stock,
    sortValue: (row) => row.stockKg,
    render: (row) => fmtQty(row.stockKg, 0),
  },
  {
    key: 'safety',
    header: 'Seg. mínima',
    align: 'right',
    help: PROD_PLAN_HELP.safety,
    sortValue: (row) => row.safetyKg,
    render: (row) => fmtQty(row.safetyKg, 0),
  },
  {
    key: 'demand',
    header: 'Demanda a cubrir',
    align: 'right',
    kind: 'metric',
    help: PROD_PLAN_HELP.demand,
    sortValue: (row) => row.demandKg,
    render: (row) => <span className="font-bold">{fmtQty(row.demandKg, 0)}</span>,
  },
  {
    key: 'required',
    header: 'Faltante',
    align: 'right',
    kind: 'metric',
    help: PROD_PLAN_HELP.required,
    sortValue: (row) => row.toProduceKg,
    render: (row) => (
      <span className={row.toProduceKg > 0 ? 'font-bold text-error' : 'text-on-surface-variant'}>
        {fmtQty(row.toProduceKg, 0)}
      </span>
    ),
  },
  {
    key: 'sacks',
    header: 'Sacos x producir',
    align: 'right',
    help: PROD_PLAN_HELP.sacks,
    sortValue: (row) => row.toProduceSacks ?? 0,
    render: (row) => (row.toProduceSacks === null ? '—' : fmtQty(row.toProduceSacks, 0)),
  },
  {
    key: 'batches',
    header: 'Lotes',
    align: 'right',
    help: PROD_PLAN_HELP.batches,
    sortValue: (row) => row.batches,
    render: (row) => `${row.batches}${row.batchKg ? ` × ${fmtQty(row.batchKg, 0)}` : ''}`,
  },
  {
    key: 'formula',
    header: 'Cédula',
    title: (row) => row.formulaName ?? undefined,
    help: PROD_PLAN_HELP.formula,
    sortValue: (row) => row.formulaName ?? '',
    render: (row) => (
      <span className={cx('block max-w-[12rem] truncate text-label-sm', row.formulaName ? 'text-on-surface' : 'text-error')}>
        {formulaLabel(row)}
      </span>
    ),
  },
  {
    key: 'cost',
    header: 'Costo/kg',
    align: 'right',
    help: PROD_PLAN_HELP.cost,
    sortValue: (row) => row.costPerKg ?? Number.POSITIVE_INFINITY,
    render: (row) => (row.costPerKg === null ? '—' : fmtQty(row.costPerKg, 2)),
  },
  {
    key: 'totalCost',
    header: 'Costo plan',
    align: 'right',
    kind: 'metric',
    help: PROD_PLAN_HELP.totalCost,
    sortValue: (row) => row.totalCost ?? Number.POSITIVE_INFINITY,
    render: (row) => (row.totalCost === null ? '—' : fmtQty(row.totalCost, 0)),
  },
  {
    key: 'status',
    header: 'Estado',
    align: 'center',
    kind: 'status',
    help: PROD_PLAN_HELP.status,
    sortValue: (row) => STATUS_LABEL[row.status],
    render: (row) => (
      <div className="flex flex-col items-center gap-1">
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
        {row.closed && <span className="text-label-sm text-outline">Cerrada</span>}
      </div>
    ),
  },
];

const MATERIAL_COLUMNS: Column<ProductionMaterialRow>[] = [
  {
    key: 'code',
    header: 'Código',
    kind: 'id',
    sortValue: (row) => row.code,
    render: (row) => <span className="font-bold tabular-nums text-primary">{row.code}</span>,
  },
  {
    key: 'description',
    header: 'Material',
    title: (row) => row.description,
    sortValue: (row) => row.description,
    render: (row) => <span className="block max-w-[18rem] truncate">{row.description}</span>,
  },
  {
    key: 'type',
    header: 'Tipo',
    help: PROD_MATERIAL_HELP.type,
    sortValue: (row) => row.type,
    render: (row) => <Badge tone={row.type === 'EMPAQ' ? 'primary' : 'muted'}>{row.type || 'MAT'}</Badge>,
  },
  {
    key: 'uom',
    header: 'UND',
    render: (row) => <span className="text-on-surface-variant">{row.uom}</span>,
  },
  {
    key: 'required',
    header: 'Requerido',
    align: 'right',
    kind: 'metric',
    help: PROD_MATERIAL_HELP.required,
    sortValue: (row) => row.requiredQty,
    render: (row) => <span className="font-bold">{fmtQty(row.requiredQty, 2)}</span>,
  },
  {
    key: 'stock',
    header: 'Stock MP',
    align: 'right',
    help: PROD_MATERIAL_HELP.stock,
    sortValue: (row) => row.stockQty,
    render: (row) => fmtQty(row.stockQty, 2),
  },
  {
    key: 'incoming',
    header: 'Por llegar',
    align: 'right',
    help: PROD_MATERIAL_HELP.incoming,
    sortValue: (row) => row.incomingQty,
    render: (row) => fmtQty(row.incomingQty, 2),
  },
  {
    key: 'purchase',
    header: 'Por comprar',
    align: 'right',
    kind: 'metric',
    help: PROD_MATERIAL_HELP.purchase,
    sortValue: (row) => row.purchaseQty,
    render: (row) => (
      <span className={row.purchaseQty > 0 ? 'font-bold text-error' : 'text-on-surface-variant'}>
        {fmtQty(row.purchaseQty, 2)}
      </span>
    ),
  },
  {
    key: 'unitCost',
    header: 'Costo unit.',
    align: 'right',
    help: PROD_MATERIAL_HELP.unitCost,
    sortValue: (row) => row.unitCost ?? Number.POSITIVE_INFINITY,
    render: (row) => (row.unitCost === null ? '—' : fmtQty(row.unitCost, 2)),
  },
  {
    key: 'purchaseCost',
    header: 'Costo compra',
    align: 'right',
    help: PROD_MATERIAL_HELP.purchaseCost,
    sortValue: (row) => row.purchaseCost ?? Number.POSITIVE_INFINITY,
    render: (row) => (row.purchaseCost === null ? '—' : fmtQty(row.purchaseCost, 0)),
  },
  {
    key: 'coverage',
    header: 'Cobertura',
    align: 'right',
    help: PROD_MATERIAL_HELP.coverage,
    sortValue: (row) => row.coverageDays ?? Number.POSITIVE_INFINITY,
    render: (row) => (row.coverageDays === null ? '—' : `${fmtQty(row.coverageDays, 1)} d`),
  },
  {
    key: 'supplier',
    header: 'Proveedor / llegada',
    help: PROD_MATERIAL_HELP.supplier,
    sortValue: (row) => row.supplier ?? '',
    render: (row) => (
      <span className="block max-w-[12rem] truncate text-label-sm text-on-surface-variant">
        {row.supplier ?? '—'}
        {row.expectedDate ? ` · ${row.expectedDate.slice(0, 10)}` : ''}
      </span>
    ),
  },
];

function formulaColumns(expandedProduct: string | null): Column<ProductionFormulaSummary>[] {
  return [
    {
      key: 'code',
      header: 'Código',
      kind: 'id',
      sortValue: (row) => row.productCode,
      render: (row) => <span className="font-bold tabular-nums text-primary">{row.productCode}</span>,
    },
    {
      key: 'description',
      header: 'Producto',
      title: (row) => row.description,
      sortValue: (row) => row.description,
      render: (row) => <span className="block max-w-[18rem] truncate">{row.description}</span>,
    },
    {
      key: 'formula',
      header: 'Cédula principal',
      help: PROD_FORMULA_HELP.formula,
      sortValue: (row) => row.mainFormulaName ?? '',
      render: (row) => (
        <span className="block max-w-[14rem] truncate text-label-sm">
          {row.mainFormulaId ? `${row.mainFormulaId} · ${KIND_LABEL[row.formulaKind ?? ''] ?? row.formulaKind}` : '—'}
          {row.mainFormulaName ? ` · ${row.mainFormulaName}` : ''}
        </span>
      ),
    },
    {
      key: 'batch',
      header: 'Lote kg',
      align: 'right',
      help: PROD_FORMULA_HELP.batch,
      sortValue: (row) => row.batchKg ?? 0,
      render: (row) => (row.batchKg === null ? '—' : fmtQty(row.batchKg, 0)),
    },
    {
      key: 'costKg',
      header: 'Costo/kg',
      align: 'right',
      help: PROD_FORMULA_HELP.costKg,
      sortValue: (row) => row.costPerKg ?? Number.POSITIVE_INFINITY,
      render: (row) => (row.costPerKg === null ? '—' : fmtQty(row.costPerKg, 2)),
    },
    {
      key: 'costSack',
      header: 'Costo/saco',
      align: 'right',
      help: PROD_FORMULA_HELP.costSack,
      sortValue: (row) => row.costPerSack ?? Number.POSITIVE_INFINITY,
      render: (row) => (row.isBulk || row.costPerSack === null ? '—' : fmtQty(row.costPerSack, 2)),
    },
    {
      key: 'replacement',
      header: 'P/reposición',
      align: 'right',
      help: PROD_FORMULA_HELP.replacement,
      sortValue: (row) => row.replacementCostPerKg ?? Number.POSITIVE_INFINITY,
      render: (row) => (
        <span className={cx('font-semibold', row.replacementCostPerKg === null ? 'text-on-surface-variant' : 'text-secondary')}>
          {row.replacementCostPerKg === null ? '—' : fmtQty(row.replacementCostPerKg, 2)}
        </span>
      ),
    },
    {
      key: 'count',
      header: 'Cédulas',
      align: 'right',
      help: PROD_FORMULA_HELP.count,
      sortValue: (row) => row.formulaCount,
      render: (row) => (
        <span className="inline-flex items-center justify-end gap-1">
          <span className="font-semibold tabular-nums">{row.formulaCount}</span>
          <ChevronDown
            aria-hidden
            className={cx(
              'size-4 text-outline transition-transform',
              expandedProduct === row.productCode && 'rotate-180 text-primary',
            )}
          />
        </span>
      ),
    },
    {
      key: 'packaging',
      header: 'Empaque',
      help: PROD_FORMULA_HELP.packaging,
      render: (row) => <span className="text-label-sm text-on-surface-variant">{row.packagingCode ?? '—'}</span>,
    },
    {
      key: 'alerts',
      header: 'Alertas',
      help: PROD_FORMULA_HELP.alerts,
      render: (row) =>
        row.alerts.length === 0 ? (
          <Badge tone="success">OK</Badge>
        ) : (
          <span title={row.alerts.join(' · ')}>
            <Badge tone="warning">{row.alerts.length}</Badge>
          </span>
        ),
    },
  ];
}

export default function ProduccionPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('plan');
  const [ym, setYm] = useState(currentMonthValue);
  const [week, setWeek] = useState(0);
  const [policy, setPolicy] = useState<ProductionPolicy>('MAX');
  const [currency, setCurrency] = useState<ProductionCurrency>('USD');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [onlyShortage, setOnlyShortage] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<number | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  // Cédula que alimenta la matriz de Nutrición. `null` = la principal del producto.
  const [nutritionFormulaId, setNutritionFormulaId] = useState<number | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'producto' | 'cliente'>('producto');
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [selectionProduct, setSelectionProduct] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [simulation, setSimulation] = useState<ProductionSimulationResponse | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { productionKg?: string; batchKg?: string }>>({});
  const [scenarioName, setScenarioName] = useState('');

  // Al cambiar de periodo o política, la simulación anterior deja de aplicar.
  useEffect(() => {
    setSimulation(null);
  }, [ym, week, policy, currency]);

  // La selección de pedidos es de un periodo concreto: al cambiarlo se limpia.
  useEffect(() => {
    setSelectedKeys(new Set());
    setExpandedGroup(null);
    setOverrides({});
  }, [ym, week]);

  // El modal de la ficha de fórmulas solo vive en la pestaña Fórmulas.
  useEffect(() => {
    if (tab !== 'formulas') setFormulaModalOpen(false);
  }, [tab]);
  const params = queryString(ym, week, policy, currency);

  const planQuery = useQuery<ProductionPlanResponse>({
    queryKey: ['production-plan', params],
    queryFn: () => apiFetch<ProductionPlanResponse>(`/production/plan?${params}`),
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const explosionQuery = useQuery<ProductionExplosionResponse>({
    queryKey: ['production-explosion', params],
    queryFn: () => apiFetch<ProductionExplosionResponse>(`/production/explosion?${params}`),
    enabled: tab === 'explosion' || tab === 'summary',
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const ordersParams = useMemo(() => {
    const { year, month } = parseYm(ym);
    const query = new URLSearchParams({
      year: String(year),
      month: String(month),
      week: String(week),
      by: tab === 'summary' ? 'cliente' : groupBy,
    });
    if (onlyRisk) query.set('onlyRisk', 'true');
    if (selectionProduct && tab === 'selection') query.set('productCode', selectionProduct);
    return query.toString();
  }, [ym, week, groupBy, onlyRisk, tab, selectionProduct]);

  const ordersQuery = useQuery<ProductionOrdersResponse>({
    queryKey: ['production-orders', ordersParams],
    queryFn: () => apiFetch<ProductionOrdersResponse>(`/production/orders?${ordersParams}`),
    enabled: tab === 'selection' || tab === 'summary',
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const simulationMutation = useMutation({
    mutationFn: (input: {
      keys: string[];
      overrides: ProductionSimulationOverride[];
      navigate?: boolean;
    }) =>
      apiFetch<ProductionSimulationResponse>('/production/simulate', {
        method: 'POST',
        body: JSON.stringify({
          year: parseYm(ym).year,
          month: parseYm(ym).month,
          week,
          policy,
          costBasis: 'LAST',
          currency,
          selectedKeys: input.keys,
          overrides: input.overrides,
        }),
      }),
    onSuccess: (data, variables) => {
      setSimulation(data);
      if (variables.navigate !== false) setTab('explosion');
    },
  });

  const formulasQuery = useQuery<ProductionFormulaListResponse>({
    queryKey: ['production-formulas', currency],
    queryFn: () => apiFetch<ProductionFormulaListResponse>(`/production/formulas?currency=${currency}`),
    enabled: tab === 'formulas' || tab === 'nutrition',
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const formulaDetailQuery = useQuery<ProductionFormulaDetailResponse>({
    queryKey: ['production-formula', selectedProduct, currency],
    queryFn: () =>
      apiFetch<ProductionFormulaDetailResponse>(
        `/production/formulas/${encodeURIComponent(selectedProduct!)}?currency=${currency}`,
      ),
    enabled: Boolean(selectedProduct) && (tab === 'formulas' || tab === 'nutrition'),
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const nutritionQuery = useQuery<ProductionNutritionCatalogResponse>({
    queryKey: ['production-nutrition', selectedProduct, nutritionFormulaId, currency],
    queryFn: () =>
      apiFetch<ProductionNutritionCatalogResponse>(
        `/production/formulas/${encodeURIComponent(selectedProduct!)}/nutrition?currency=${currency}${
          nutritionFormulaId ? `&formulaId=${nutritionFormulaId}` : ''
        }`,
      ),
    enabled: Boolean(selectedProduct) && tab === 'nutrition',
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const scenariosQuery = useQuery<ProductionScenario[]>({
    queryKey: ['production-scenarios'],
    queryFn: () => apiFetch<ProductionScenario[]>('/production/scenarios'),
    enabled: tab === 'scenarios',
    retry: (count, error) => !(error instanceof AuthRequiredError) && count < 2,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: true }>('/production/refresh', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production-'] }),
  });

  const preferenceMutation = useMutation({
    mutationFn: (vars: { code: string; formulaId: number }) =>
      apiFetch<{ ok: true }>(`/production/formulas/${encodeURIComponent(vars.code)}/preference`, {
        method: 'PUT',
        body: JSON.stringify({ formulaId: vars.formulaId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-formula'] });
      queryClient.invalidateQueries({ queryKey: ['production-formulas'] });
      queryClient.invalidateQueries({ queryKey: ['production-plan'] });
    },
  });

  const scenarioCreateMutation = useMutation({
    mutationFn: (input: { name: string; payload: unknown }) =>
      apiFetch<ProductionScenario>('/production/scenarios', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          year: parseYm(ym).year,
          month: parseYm(ym).month,
          week,
          policy,
          currency,
          payload: input.payload,
        }),
      }),
    onSuccess: () => {
      setScenarioName('');
      queryClient.invalidateQueries({ queryKey: ['production-scenarios'] });
    },
  });

  const scenarioDeleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/production/scenarios/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production-scenarios'] }),
  });

  const error = planQuery.error;
  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => queryClient.invalidateQueries()} />;
  }

  const plan = simulation?.plan ?? planQuery.data;
  const explosionData = simulation?.explosion ?? explosionQuery.data;
  const totals = plan?.totals;
  const planRows = useMemo(() => {
    const rows = plan?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (row) => !needle || row.productCode.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle),
    );
  }, [plan, search]);

  const materialRows = useMemo(() => {
    const rows = explosionData?.materials ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!typeFilter || row.type === typeFilter) &&
        (!onlyShortage || row.purchaseQty > 0) &&
        (!needle || row.code.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)),
    );
  }, [explosionData, search, typeFilter, onlyShortage]);

  const formulaRows = useMemo(() => {
    const rows = formulasQuery.data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (row) => !needle || row.productCode.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle),
    );
  }, [formulasQuery.data, search]);

  const formulaColumnsMemo = useMemo(() => formulaColumns(expandedProduct), [expandedProduct]);

  const formulaStats = useMemo(() => {
    const rows = formulasQuery.data?.rows ?? [];
    return {
      products: rows.length,
      formulas: rows.reduce((acc, row) => acc + row.formulas.length, 0),
      missingReplacement: formulasQuery.data?.missingReplacement?.length ?? 0,
      alerts: rows.filter((row) => row.alerts.length > 0).length,
    };
  }, [formulasQuery.data]);

  const orderLines = useMemo(
    () => ordersQuery.data?.groups.flatMap((group) => group.lines) ?? [],
    [ordersQuery.data],
  );
  const selectedLines = useMemo(
    () => orderLines.filter((line) => selectedKeys.has(line.selectionKey)),
    [orderLines, selectedKeys],
  );
  const selectionSummary = useMemo(
    () => ({
      lines: selectedLines.length,
      orders: new Set(selectedLines.map((line) => line.orderNumber)).size,
      customers: new Set(selectedLines.map((line) => line.customerCode ?? '__sin_cliente__')).size,
      products: new Set(selectedLines.map((line) => line.productCode)).size,
      pendingKg: selectedLines.reduce((acc, line) => acc + line.pendingKg, 0),
    }),
    [selectedLines],
  );

  const topMaterials = useMemo(
    () =>
      [...(explosionData?.materials ?? [])]
        .sort((a, b) => (b.purchaseCost ?? 0) - (a.purchaseCost ?? 0))
        .slice(0, 5),
    [explosionData],
  );

  const topCustomers = useMemo(
    () =>
      [...(ordersQuery.data?.groups ?? [])]
        .sort((a, b) => b.totalPendingKg - a.totalPendingKg)
        .slice(0, 5),
    [ordersQuery.data],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<ProductionPlanRow['status'], number> = {
      CUBIERTO: 0,
      PRODUCIR: 0,
      SIN_FORMULA: 0,
      SIN_COSTO: 0,
    };
    for (const row of plan?.rows ?? []) counts[row.status] += 1;
    return counts;
  }, [plan]);
  const statusTotal = plan?.rows.length ?? 0;
  const forecastPct = totals && totals.forecastKg > 0 ? totals.soldKg / totals.forecastKg : 0;
  const productionPct = totals && totals.demandKg > 0 ? totals.productionKg / totals.demandKg : 0;
  const overproductionKg = totals ? Math.max(0, totals.productionKg - totals.toProduceKg) : 0;
  const shortageCount = explosionData?.totals.shortages ?? totals?.shortages ?? 0;

  function toggleKeys(keys: string[], selected: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (selected) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function selectAllOrders() {
    toggleKeys(
      orderLines.map((line) => line.selectionKey),
      true,
    );
  }

  function selectRiskOrders() {
    toggleKeys(
      orderLines
        .filter((line) => line.risk === 'ALTO' || line.risk === 'MEDIO')
        .map((line) => line.selectionKey),
      true,
    );
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  const detail = formulaDetailQuery.data;

  useEffect(() => {
    if (!detail || detail.formulas.length === 0) return;
    const exists = detail.formulas.some((formula) => formula.id === selectedFormulaId);
    if (!exists) setSelectedFormulaId(detail.selectedFormulaId ?? detail.formulas[0]?.id ?? null);
  }, [detail, selectedFormulaId]);

  // Nutrición arranca en la cédula principal de cada producto; si la cédula
  // elegida desaparece (cambio de producto o de Profit), vuelve a la principal.
  useEffect(() => {
    setNutritionFormulaId(null);
  }, [selectedProduct]);

  useEffect(() => {
    if (!detail || nutritionFormulaId === null) return;
    if (!detail.formulas.some((formula) => formula.id === nutritionFormulaId)) setNutritionFormulaId(null);
  }, [detail, nutritionFormulaId]);

  function openProduct(code: string, nextTab: Tab = 'formulas') {
    setSelectedProduct(code);
    setSelectedFormulaId(null);
    setTab(nextTab);
  }

  function openFormulaModal(code: string, formulaId: number | null = null) {
    setSelectedProduct(code);
    setSelectedFormulaId(formulaId);
    setFormulaModalOpen(true);
    setExpandedProduct(code);
  }

  function openOrders(code: string) {
    setSelectionProduct(code);
    setGroupBy('producto');
    setTab('selection');
  }

  function setOverride(productCode: string, field: 'productionKg' | 'batchKg', value: string) {
    // Al editar, la simulación anterior deja de representar lo que está en pantalla.
    setSimulation(null);
    setOverrides((current) => {
      const next = { ...current };
      const draft = { ...(next[productCode] ?? {}), [field]: value };
      if (!draft.productionKg?.trim() && !draft.batchKg?.trim()) delete next[productCode];
      else next[productCode] = draft;
      return next;
    });
  }

  function resetOverride(productCode: string) {
    setSimulation(null);
    setOverrides((current) => {
      const next = { ...current };
      delete next[productCode];
      return next;
    });
  }

  function clearOverrides() {
    setOverrides({});
    setSimulation(null);
  }

  function parsedOverrides(): ProductionSimulationOverride[] {
    return Object.entries(overrides).flatMap(([productCode, draft]) => {
      const production = draft.productionKg?.trim()
        ? Number(draft.productionKg.replace(',', '.'))
        : undefined;
      const batch = draft.batchKg?.trim() ? Number(draft.batchKg.replace(',', '.')) : undefined;
      const productionKg =
        production !== undefined && Number.isFinite(production) && production >= 0
          ? production
          : undefined;
      const batchKg = batch !== undefined && Number.isFinite(batch) && batch > 0 ? batch : undefined;
      if (productionKg === undefined && batchKg === undefined) return [];
      return [
        {
          productCode,
          ...(productionKg !== undefined ? { productionKg } : {}),
          ...(batchKg !== undefined ? { batchKg } : {}),
        },
      ];
    });
  }

  function simulateAdjustments() {
    const list = parsedOverrides();
    if (list.length === 0) return;
    simulationMutation.mutate({
      keys: Array.from(selectedKeys),
      overrides: list,
      navigate: false,
    });
  }

  const adjustmentColumn: Column<ProductionPlanRow> = {
    key: 'adjust',
    header: 'Ajuste local (kg)',
    render: (row) => {
      const draft = overrides[row.productCode] ?? {};
      const productionNumber = draft.productionKg?.trim()
        ? Number(draft.productionKg.replace(',', '.'))
        : null;
      const below =
        productionNumber !== null &&
        Number.isFinite(productionNumber) &&
        productionNumber < row.toProduceKg;
      return (
        <div className="flex min-w-[220px] items-end gap-space-xs">
          <label className="flex flex-col gap-1">
            <span className="text-label-sm font-semibold text-outline">A producir</span>
            <input
              value={draft.productionKg ?? ''}
              onChange={(event) => setOverride(row.productCode, 'productionKg', event.target.value)}
              placeholder={fmtQty(row.productionKg, 0)}
              inputMode="decimal"
              aria-label={`A producir ${row.productCode} en kg`}
              title={
                below
                  ? `Por debajo del faltante (${fmtQty(row.toProduceKg, 0)} kg): riesgo de stockout`
                  : 'Ajuste local de producción en kg'
              }
              className={cx(
                'h-8 w-24 rounded-lg border bg-surface-container-lowest px-space-xs text-right tabular-nums',
                below ? 'border-error text-error' : 'border-outline-variant/50 text-on-surface',
              )}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-sm font-semibold text-outline">Cant. x batch</span>
            <input
              value={draft.batchKg ?? ''}
              onChange={(event) => setOverride(row.productCode, 'batchKg', event.target.value)}
              placeholder={row.batchKg ? fmtQty(row.batchKg, 0) : '—'}
              inputMode="decimal"
              aria-label={`Cantidad por batch ${row.productCode} en kg`}
              title="Ajuste local del tamaño de lote en kg"
              className="h-8 w-24 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-xs text-right tabular-nums text-on-surface"
            />
          </label>
          {(draft.productionKg || draft.batchKg) && (
            <button
              type="button"
              onClick={() => resetOverride(row.productCode)}
              className="mb-0.5 rounded-lg border border-outline-variant/50 px-2 py-1 text-label-sm text-on-surface-variant hover:border-primary-container/40 hover:text-primary"
              title="Quitar el ajuste de este producto"
            >
              ↺
            </button>
          )}
        </div>
      );
    },
  };

  const tabHelp = PROD_TAB_HELP[tab];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Módulo de Producción"
          icon={Factory}
          title="Plan y explosión de materiales"
          subtitle="Forecast + pedidos − vendido − stock, con la cédula principal de Profit y el costo real de cada receta. Sin escribir en Profit."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <div data-tour="prod-kpis" className="flex flex-wrap items-center gap-space-sm">
                {tab === 'formulas' ? (
                  <>
                    <Kpi label="Productos" value={String(formulaStats.products)} icon={Factory} />
                    <Kpi
                      label="Cédulas"
                      value={String(formulaStats.formulas)}
                      tone="primary"
                      hint="recetas maestras y bases"
                    />
                    <Kpi
                      label="Sin reposición"
                      value={String(formulaStats.missingReplacement)}
                      tone={formulaStats.missingReplacement > 0 ? 'warning' : 'success'}
                      hint="materias primas sin valor en Profit"
                    />
                    <Kpi
                      label="Con alertas"
                      value={String(formulaStats.alerts)}
                      tone={statusAlertTone(formulaStats.alerts)}
                      hint="cédulas incompletas"
                    />
                  </>
                ) : (
                  <>
                    <Kpi label="Productos" value={String(totals?.products ?? 0)} icon={Factory} />
                    <Kpi
                      label="A producir"
                      value={fmtQty((totals?.productionKg ?? 0) / 1000, 1)}
                      suffix="t"
                      tone="primary"
                      hint={`${fmtQty(totals?.toProduceKg ?? 0, 0)} kg requeridos`}
                    />
                    <Kpi
                      label="Faltantes"
                      value={String(shortageCount)}
                      tone={statusAlertTone(shortageCount)}
                      hint="materiales o productos"
                    />
                    <Kpi
                      label="Costo plan"
                      value={moneyCompact(totals?.totalCost ?? null, currency)}
                      tone="primary"
                      hint={plan?.exchangeRate ? `Tasa ${fmtQty(plan.exchangeRate, 2)} Bs/USD` : undefined}
                    />
                  </>
                )}
              </div>
              <ProductionTour activeTab={tab} onTabChange={setTab} />
              <div data-tour="prod-help">
                <ModuleHelp
                  title={tabHelp.title}
                  narrative={tabHelp.narrative}
                  rules={tabHelp.rules}
                  terms={tabHelp.terms}
                  triggerLabel={tabHelp.triggerLabel}
                  termsLabel={tabHelp.termsLabel}
                />
              </div>
              <button
                type="button"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-60"
              >
                <RefreshCw aria-hidden className={cx('size-4', refreshMutation.isPending && 'animate-spin')} />
                Actualizar
              </button>
            </div>
          }
        />

        <Card className="p-space-md">
          <div
            data-tour="prod-controls"
            className={cx(
              'grid grid-cols-1 gap-space-md',
              tab === 'formulas' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'lg:grid-cols-12',
            )}
          >
            {tab !== 'formulas' && (
              <>
                <div className="lg:col-span-3">
                  <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
                    Mes
                  </label>
                  <TextInput value={ym} onChange={setYm} placeholder="YYYY-MM" ariaLabel="Mes de producción" />
                </div>
                <div className="lg:col-span-3">
                  <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
                    Periodo
                  </label>
                  <Select
                    value={String(week)}
                    onChange={(value) => setWeek(Number(value))}
                    options={WEEK_OPTIONS}
                    ariaLabel="Semana"
                  />
                </div>
                <div className="lg:col-span-3">
                  <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
                    Política de demanda
                  </label>
                  <Select
                    value={policy}
                    onChange={(value) => setPolicy(value as ProductionPolicy)}
                    options={POLICY_OPTIONS}
                    ariaLabel="Política de demanda"
                  />
                </div>
              </>
            )}
            <div className={tab === 'formulas' ? '' : 'lg:col-span-3'}>
              <label className="mb-space-2xs block text-label-sm font-semibold uppercase tracking-wider text-outline">
                Moneda de costos
              </label>
              <Segmented value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} ariaLabel="Moneda" />
            </div>
          </div>
          <div className="mt-space-md flex flex-wrap items-center gap-space-sm">
            <div data-tour="prod-tabs" className="max-w-full overflow-x-auto">
              <Segmented value={tab} onChange={setTab} options={TAB_OPTIONS} ariaLabel="Sección de producción" />
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-space-sm">
              <TextInput
                icon={Search}
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setExpandedProduct(null);
                }}
                placeholder="Buscar código o descripción…"
                ariaLabel="Buscar"
                className="w-64"
              />
              {tab === 'explosion' && (
                <>
                  <Select
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={[
                      { value: '', label: 'Tipo: Todos' },
                      { value: 'MACROS', label: 'Macros' },
                      { value: 'MICROS', label: 'Micros' },
                      { value: 'EMPAQ', label: 'Empaques' },
                    ]}
                    ariaLabel="Filtrar por tipo"
                    className="w-40"
                  />
                  <label className="flex cursor-pointer items-center gap-space-2xs text-label-sm font-semibold text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={onlyShortage}
                      onChange={(event) => setOnlyShortage(event.target.checked)}
                      className="size-4 accent-[var(--color-primary-container)]"
                    />
                    Solo comprar
                  </label>
                </>
              )}
            </div>
          </div>
        </Card>

        {plan && tab !== 'formulas' && (
          <div className="flex flex-col gap-space-sm">
            {plan.alerts.map((alert) => (
              <p key={alert} role="alert" className="flex items-center gap-space-sm rounded-xl bg-warning-container/40 px-space-md py-space-sm text-body-md text-on-surface">
                <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
                {alert}
              </p>
            ))}
          </div>
        )}

        {tab === 'summary' && (
          <div className="flex flex-col gap-space-lg">
            <div className="grid gap-space-md md:grid-cols-2 xl:grid-cols-5">
              <Kpi
                label="Demanda a cubrir"
                value={fmtQty(totals?.demandKg ?? 0, 0)}
                suffix="kg"
                icon={BarChart3}
                hint="Forecast por cumplir o cartera pendiente, según la política"
              />
              <Kpi
                label="Producción real"
                value={fmtQty(totals?.productionKg ?? 0, 0)}
                suffix="kg"
                icon={Factory}
                hint={`${fmtQty(totals?.toProduceKg ?? 0, 0)} kg de faltante redondeado a lotes`}
              />
              <Kpi
                label="Costo del plan"
                value={moneyCompact(totals?.totalCost ?? null, currency)}
                icon={Sparkles}
                hint="Receta principal × producción real"
              />
              <Kpi
                label="Materiales por comprar"
                value={String(explosionData?.totals.shortages ?? 0)}
                tone="danger"
                icon={PackageSearch}
                hint={money(explosionData?.totals.purchaseCost ?? null, currency)}
              />
              <Kpi
                label="Pedidos en riesgo"
                value={String(ordersQuery.data?.totals.riskLines ?? 0)}
                tone={statusAlertTone(ordersQuery.data?.totals.riskLines ?? 0)}
                icon={ListChecks}
                hint="Líneas con riesgo alto o medio frente al stock"
              />
            </div>

            <div data-tour="prod-summary" className="grid gap-space-md xl:grid-cols-3">
              <Card className="p-space-md">
                <div className="flex flex-wrap items-start justify-between gap-space-sm">
                  <div>
                    <p className="font-semibold text-on-surface">Estado del plan</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Cómo se reparten los {statusTotal} productos del plan actual.
                    </p>
                  </div>
                  <Badge tone={statusCounts.SIN_FORMULA > 0 ? 'danger' : 'success'}>
                    {statusCounts.SIN_FORMULA} sin cédula
                  </Badge>
                </div>
                <div className="mt-space-sm flex h-2 overflow-hidden rounded-pill bg-surface-container" aria-hidden>
                  {(['CUBIERTO', 'PRODUCIR', 'SIN_FORMULA', 'SIN_COSTO'] as const).map((status) =>
                    statusCounts[status] > 0 ? (
                      <span
                        key={status}
                        className={STATUS_BAR[status]}
                        style={{ width: `${(statusCounts[status] / Math.max(1, statusTotal)) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="mt-space-sm grid grid-cols-2 gap-space-sm">
                  {(['CUBIERTO', 'PRODUCIR', 'SIN_FORMULA', 'SIN_COSTO'] as const).map((status) => (
                    <div
                      key={status}
                      className="flex items-center justify-between gap-space-sm rounded-lg bg-surface-container/50 px-space-sm py-1.5"
                    >
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                      <span className="font-semibold tabular-nums text-on-surface">{statusCounts[status]}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-space-md">
                <p className="font-semibold text-on-surface">Cumplimiento del periodo</p>
                <p className="text-label-sm text-on-surface-variant">
                  Vendido contra la meta y producción contra la demanda.
                </p>
                <div className="mt-space-sm flex flex-col gap-space-sm">
                  <div>
                    <div className="flex items-center justify-between gap-space-sm text-label-sm">
                      <span className="text-on-surface-variant">Vendido vs forecast</span>
                      <span className="font-semibold tabular-nums text-on-surface">
                        {totals && totals.forecastKg > 0 ? `${fmtQty(forecastPct * 100, 0)}%` : '—'}
                      </span>
                    </div>
                    {totals && totals.forecastKg > 0 ? (
                      <CoverageBar ratio={forecastPct} className="mt-1" />
                    ) : (
                      <div className="mt-1 h-2 rounded-pill bg-surface-container" aria-hidden />
                    )}
                    <p className="mt-space-2xs text-label-sm text-on-surface-variant">
                      {fmtQty(totals?.soldKg ?? 0, 0)} de {fmtQty(totals?.forecastKg ?? 0, 0)} kg
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-space-sm text-label-sm">
                      <span className="text-on-surface-variant">Producción vs demanda</span>
                      <span className="font-semibold tabular-nums text-on-surface">
                        {totals && totals.demandKg > 0 ? `${fmtQty(productionPct * 100, 0)}%` : '—'}
                      </span>
                    </div>
                    {totals && totals.demandKg > 0 ? (
                      <CoverageBar ratio={productionPct} className="mt-1" />
                    ) : (
                      <div className="mt-1 h-2 rounded-pill bg-surface-container" aria-hidden />
                    )}
                    <p className="mt-space-2xs text-label-sm text-on-surface-variant">
                      {fmtQty(totals?.productionKg ?? 0, 0)} kg reales · sobreproducción{' '}
                      {fmtQty(overproductionKg, 0)} kg
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-space-md">
                <p className="font-semibold text-on-surface">Para seguir</p>
                <p className="text-label-sm text-on-surface-variant">El flujo recomendado del periodo.</p>
                <div className="mt-space-sm flex flex-col gap-space-xs">
                  {[
                    { tab: 'plan' as const, label: 'Revisar el plan', hint: 'Ajusta cantidades y simula lotes', icon: BarChart3 },
                    { tab: 'selection' as const, label: 'Priorizar pedidos', hint: 'Selecciona cartera y recalcula', icon: ListChecks },
                    { tab: 'explosion' as const, label: 'Comprar materiales', hint: 'Revisa faltantes y cobertura', icon: PackageSearch },
                  ].map((item) => (
                    <button
                      key={item.tab}
                      type="button"
                      onClick={() => setTab(item.tab)}
                      className="flex items-center gap-space-sm rounded-xl border border-outline-variant/35 px-space-sm py-space-xs text-left transition-colors hover:border-primary-container/40 hover:bg-primary-container/5"
                    >
                      <item.icon aria-hidden className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block text-label-md font-semibold text-on-surface">{item.label}</span>
                        <span className="block text-label-sm text-on-surface-variant">{item.hint}</span>
                      </span>
                      <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-outline" />
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-space-md xl:grid-cols-2">
              <Card className="overflow-hidden">
                <div className="border-b border-surface-container px-space-md py-space-sm">
                  <p className="font-semibold text-on-surface">Top materiales por compra</p>
                  <p className="text-label-sm text-on-surface-variant">
                    Dinero necesario para cubrir el faltante del plan.
                  </p>
                </div>
                <table className="w-full text-left text-body-md">
                  <thead>
                    <tr className="border-b border-surface-container text-label-sm uppercase tracking-wider text-outline">
                      <th className="px-space-sm py-2">Material</th>
                      <th className="px-space-sm py-2 text-right">Por comprar</th>
                      <th className="px-space-sm py-2 text-right">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMaterials.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-space-sm py-space-md text-on-surface-variant">
                          Sin compras sugeridas para el plan.
                        </td>
                      </tr>
                    )}
                    {topMaterials.map((material) => (
                      <tr key={material.code} className="border-b border-surface-container/60">
                        <td className="px-space-sm py-space-xs">
                          <span className="font-semibold text-primary">{material.code}</span>
                          <span className="block max-w-[16rem] truncate text-label-sm text-on-surface-variant">
                            {material.description}
                          </span>
                        </td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">
                          {fmtQty(material.purchaseQty, 2)} {material.uom}
                        </td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">
                          {money(material.purchaseCost, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-surface-container px-space-md py-space-sm">
                  <p className="font-semibold text-on-surface">Top clientes por cartera</p>
                  <p className="text-label-sm text-on-surface-variant">
                    Clientes con más kg pendientes en el periodo.
                  </p>
                </div>
                <table className="w-full text-left text-body-md">
                  <thead>
                    <tr className="border-b border-surface-container text-label-sm uppercase tracking-wider text-outline">
                      <th className="px-space-sm py-2">Cliente</th>
                      <th className="px-space-sm py-2 text-right">Pedidos</th>
                      <th className="px-space-sm py-2 text-right">Kg</th>
                      <th className="px-space-sm py-2 text-center">Riesgo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-space-sm py-space-md text-on-surface-variant">
                          Sin cartera en el periodo.
                        </td>
                      </tr>
                    )}
                    {topCustomers.map((group) => (
                      <tr key={group.key} className="border-b border-surface-container/60">
                        <td className="px-space-sm py-space-xs">
                          <span className="font-semibold text-primary">{group.code ?? group.key}</span>
                          <span className="block max-w-[16rem] truncate text-label-sm text-on-surface-variant">
                            {group.label}
                          </span>
                        </td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">{group.ordersCount}</td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(group.totalPendingKg, 0)}</td>
                        <td className="px-space-sm py-space-xs text-center">
                          <Badge tone={RISK_TONE[group.risk]}>{RISK_LABEL[group.risk]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

          </div>
        )}

        {tab === 'selection' && (
          <div className="flex flex-col gap-space-md">
            <Card data-tour="prod-selection" className="p-space-md">
              <div className="flex flex-wrap items-end justify-between gap-space-sm">
                <div>
                  <p className="font-display text-title-lg text-primary">Selección de pedidos</p>
                  <p className="text-body-md text-on-surface-variant">
                    Elige pedidos o líneas; la simulación recalcula el plan y la explosión sin escribir en Profit.
                  </p>
                  {selectionProduct && (
                    <div className="mt-space-xs flex items-center gap-space-sm text-label-sm">
                      <Badge tone="primary">Filtrado: {selectionProduct}</Badge>
                      <button
                        type="button"
                        onClick={() => setSelectionProduct(null)}
                        className="font-semibold text-primary underline decoration-dotted underline-offset-4"
                      >
                        Quitar filtro
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-space-sm">
                  <Segmented
                    value={groupBy}
                    onChange={setGroupBy}
                    options={[
                      { value: 'producto', label: 'Por producto' },
                      { value: 'cliente', label: 'Por cliente' },
                    ]}
                    ariaLabel="Agrupar pedidos"
                  />
                  <label className="flex cursor-pointer items-center gap-space-2xs text-label-sm font-semibold text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={onlyRisk}
                      onChange={(event) => setOnlyRisk(event.target.checked)}
                      className="size-4 accent-[var(--color-primary-container)]"
                    />
                    Solo riesgo alto/medio
                  </label>
                </div>
              </div>

              <div className="mt-space-md flex flex-wrap items-center gap-space-sm">
                <button
                  type="button"
                  onClick={selectAllOrders}
                  className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant hover:border-primary-container/40 hover:text-primary"
                >
                  <ListChecks aria-hidden className="size-4" />
                  Seleccionar todo
                </button>
                <button
                  type="button"
                  onClick={selectRiskOrders}
                  className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant hover:border-primary-container/40 hover:text-primary"
                >
                  <AlertTriangle aria-hidden className="size-4" />
                  Solo riesgo
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedKeys.size === 0}
                  className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant disabled:opacity-50"
                >
                  Limpiar
                </button>
                <span className="text-label-sm text-on-surface-variant">
                  {selectionSummary.lines} líneas · {selectionSummary.orders} pedidos ·{' '}
                  {selectionSummary.customers} clientes · {fmtQty(selectionSummary.pendingKg, 0)} kg
                </span>
                <button
                  type="button"
                  onClick={() =>
                    simulationMutation.mutate({
                      keys: Array.from(selectedKeys),
                      overrides: [],
                      navigate: true,
                    })
                  }
                  disabled={selectedKeys.size === 0 || simulationMutation.isPending}
                  className="ml-auto inline-flex h-10 items-center gap-space-2xs rounded-xl bg-primary px-space-md text-label-md font-semibold text-white disabled:opacity-50"
                >
                  <Factory aria-hidden className="size-4" />
                  {simulationMutation.isPending ? 'Simulando…' : 'Simular selección'}
                </button>
              </div>
              <p className="mt-space-sm text-label-sm text-on-surface-variant">
                La simulación usa la política <strong>{POLICY_OPTIONS.find((option) => option.value === policy)?.label}</strong>.
                Para ver solo los pedidos seleccionados, elige «Solo pedidos pendientes» arriba.
              </p>
              {simulationMutation.isError && (
                <p role="alert" className="mt-space-sm text-body-md text-error">
                  {simulationMutation.error instanceof Error
                    ? simulationMutation.error.message
                    : 'No se pudo simular la selección'}
                </p>
              )}
            </Card>

            {ordersQuery.isLoading && (
              <p className="text-body-md text-on-surface-variant">Cargando pedidos…</p>
            )}
            {ordersQuery.error && !(ordersQuery.error instanceof AuthRequiredError) && (
              <p role="alert" className="text-body-md text-error">
                {ordersQuery.error instanceof Error ? ordersQuery.error.message : 'Error al cargar pedidos'}
              </p>
            )}
            {ordersQuery.data && (
              <SelectionTable
                data={ordersQuery.data}
                groupBy={groupBy}
                selectedKeys={selectedKeys}
                onToggleKeys={toggleKeys}
                expandedKey={expandedGroup}
                onExpand={setExpandedGroup}
              />
            )}
          </div>
        )}

        {tab === 'plan' && (
          <div className="flex flex-col gap-space-sm">
            {simulation && (
              <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-xl border border-primary-container/40 bg-primary-container/5 px-space-md py-space-sm">
                <p className="text-body-md text-on-surface">
                  <strong>{simulation.selection.lines > 0 ? 'Plan simulado' : 'Plan ajustado'}</strong>
                  {simulation.selection.lines > 0
                    ? ` · ${simulation.selection.lines} líneas · ${simulation.selection.orders} pedidos · ${fmtQty(
                        simulation.selection.pendingKg,
                        0,
                      )} kg seleccionados`
                    : ' · sin pedidos seleccionados; se aplicaron ajustes locales de producción/lote'}
                </p>
                <button
                  type="button"
                  onClick={() => setSimulation(null)}
                  className="rounded-lg border border-outline-variant/50 px-space-sm py-1 text-label-sm font-semibold text-on-surface-variant hover:border-primary-container/40 hover:text-primary"
                >
                  Ver plan completo
                </button>
              </div>
            )}
          <Card data-tour="prod-plan" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container px-space-md py-space-sm">
              <div className="max-w-3xl">
                <p className="text-label-sm text-on-surface-variant">
                  {editMode
                    ? 'Edita “A producir” y “Cant. x batch” en kg. Al simular, la explosión y los costos se recalculan sin escribir en Profit.'
                    : 'El plan sugiere faltante y lote. Activa el ajuste para probar otra cantidad de producción o otro tamaño de lote.'}
                </p>
                {selectedKeys.size > 0 && (
                  <p className="mt-space-2xs text-label-sm text-primary">
                    Se aplicará sobre {selectedKeys.size} pedidos seleccionados en la pestaña Selección.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-space-sm">
                <button
                  type="button"
                  onClick={() => setEditMode((current) => !current)}
                  className={cx(
                    'inline-flex h-9 items-center gap-space-2xs rounded-lg border px-space-sm text-label-sm font-semibold',
                    editMode
                      ? 'border-primary-container/50 bg-primary-container/10 text-primary'
                      : 'border-outline-variant/50 text-on-surface-variant hover:border-primary-container/40 hover:text-primary',
                  )}
                >
                  {editMode ? 'Cerrar ajuste' : 'Ajustar cantidades'}
                </button>
                {editMode && (
                  <>
                    <button
                      type="button"
                      onClick={simulateAdjustments}
                      disabled={Object.keys(overrides).length === 0 || simulationMutation.isPending}
                      className="inline-flex h-9 items-center gap-space-2xs rounded-lg bg-primary px-space-sm text-label-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Factory aria-hidden className="size-3.5" />
                      {simulationMutation.isPending ? 'Simulando…' : 'Simular ajustes'}
                    </button>
                    <button
                      type="button"
                      onClick={clearOverrides}
                      disabled={Object.keys(overrides).length === 0}
                      className="inline-flex h-9 items-center rounded-lg border border-outline-variant/50 px-space-sm text-label-sm font-semibold text-on-surface-variant disabled:opacity-50"
                    >
                      Limpiar ajustes
                    </button>
                  </>
                )}
              </div>
            </div>
            {editMode && simulationMutation.isError && (
              <p role="alert" className="border-b border-surface-container px-space-md py-space-sm text-body-md text-error">
                {simulationMutation.error instanceof Error
                  ? simulationMutation.error.message
                  : 'No se pudieron simular los ajustes'}
              </p>
            )}
            {planQuery.isLoading && !simulation && <p className="p-space-md text-body-md text-on-surface-variant">Calculando plan…</p>}
            {planQuery.error && !(planQuery.error instanceof AuthRequiredError) && (
              <p role="alert" className="p-space-md text-body-md text-error">
                {planQuery.error instanceof Error ? planQuery.error.message : 'Error al calcular el plan'}
              </p>
            )}
            {plan && (
              <DataTable
                columns={editMode ? [...PLAN_COLUMNS, adjustmentColumn] : PLAN_COLUMNS}
                rows={planRows}
                rowKey={(row) => row.productCode}
                defaultSortKey="required"
                defaultSortDir="desc"
                expandedKey={expandedPlan}
                onRowClick={(row) => setExpandedPlan((current) => (current === row.productCode ? null : row.productCode))}
                onRowDoubleClick={(row) => openProduct(row.productCode)}
                empty={<EmptyState icon={PackageSearch} title="Sin productos para el filtro" />}
                renderExpanded={(row) => (
                  <div className="grid gap-space-md rounded-xl bg-surface-container/60 p-space-md md:grid-cols-2">
                    <div>
                      <p className="font-semibold text-on-surface">Stock por almacén</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {row.stockByWarehouse.map((item) => `${item.warehouseCode}: ${fmtQty(item.qty, 0)}`).join(' · ')}
                      </p>
                      <p className="mt-space-xs text-label-sm text-on-surface-variant">
                        Forecast {fmtQty(row.forecastKg, 0)} kg · vendido {fmtQty(row.soldKg, 0)} kg · pedidos{' '}
                        {fmtQty(row.ordersKg, 0)} kg · restante {fmtQty(row.forecastRemainingKg, 0)} kg
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">Producción sugerida</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {fmtQty(row.toProduceKg, 0)} kg requeridos · {row.batches} lote(s)
                        {row.batchKg ? ` de ${fmtQty(row.batchKg, 0)} kg` : ''} · {fmtQty(row.productionKg, 0)} kg reales
                      </p>
                      <p className="mt-space-xs text-label-sm text-on-surface-variant">
                        {row.alerts.length > 0 ? row.alerts.join(' · ') : 'Sin alertas de fórmula.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => openOrders(row.productCode)}
                        className="mt-space-sm inline-flex items-center gap-space-2xs rounded-lg border border-primary-container/40 px-space-sm py-1 text-label-sm font-semibold text-primary hover:bg-primary-container/5"
                      >
                        <ListChecks aria-hidden className="size-3.5" />
                        Ver pedidos de {row.productCode}
                      </button>
                    </div>
                  </div>
                )}
              />
            )}
            {plan && (
              <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
                {planRows.length} de {plan.rows.length} productos · el doble clic abre la ficha de fórmulas. La demanda se calcula
                como <strong>{POLICY_OPTIONS.find((option) => option.value === plan.policy)?.label}</strong>.
              </div>
            )}
          </Card>
          </div>
        )}

        {tab === 'explosion' && (
          <div className="flex flex-col gap-space-sm">
            {simulation && (
              <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-xl border border-primary-container/40 bg-primary-container/5 px-space-md py-space-sm">
                <p className="text-body-md text-on-surface">
                  <strong>{simulation.selection.lines > 0 ? 'Simulación activa' : 'Plan ajustado'}</strong>
                  {simulation.selection.lines > 0
                    ? ` · ${simulation.selection.lines} líneas · ${simulation.selection.orders} pedidos · ${simulation.selection.customers} clientes · ${fmtQty(
                        simulation.selection.pendingKg,
                        0,
                      )} kg seleccionados`
                    : ' · sin pedidos seleccionados; explosión recalculada con los ajustes locales'}
                </p>
                <button
                  type="button"
                  onClick={() => setSimulation(null)}
                  className="rounded-lg border border-outline-variant/50 px-space-sm py-1 text-label-sm font-semibold text-on-surface-variant hover:border-primary-container/40 hover:text-primary"
                >
                  Ver plan completo
                </button>
              </div>
            )}
          <Card data-tour="prod-explosion" className="overflow-hidden">
            <div className="border-b border-surface-container px-space-md py-space-sm">
              <p className="font-semibold text-on-surface">Explosión de materiales</p>
              <p className="text-label-sm text-on-surface-variant">
                Requerido por la producción real, después de descontar stock y compras en tránsito.
              </p>
            </div>
            {!simulation && explosionQuery.isLoading && <p className="p-space-md text-body-md text-on-surface-variant">Explotando materiales…</p>}
            {!simulation && explosionQuery.error && !(explosionQuery.error instanceof AuthRequiredError) && (
              <p role="alert" className="p-space-md text-body-md text-error">
                {explosionQuery.error instanceof Error ? explosionQuery.error.message : 'Error al explotar materiales'}
              </p>
            )}
            {explosionData && (
              <DataTable
                columns={MATERIAL_COLUMNS}
                rows={materialRows}
                rowKey={(row) => row.code}
                defaultSortKey="purchase"
                defaultSortDir="desc"
                expandedKey={expandedMaterial}
                onRowClick={(row) => setExpandedMaterial((current) => (current === row.code ? null : row.code))}
                empty={<EmptyState icon={PackageSearch} title="Sin materiales para el filtro" />}
                renderExpanded={(row) => (
                  <div className="grid gap-space-md rounded-xl bg-surface-container/60 p-space-md md:grid-cols-2">
                    <div>
                      <p className="font-semibold text-on-surface">Productos que lo consumen</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {row.products.length === 0
                          ? '—'
                          : row.products.map((product) => `${product.productCode}: ${fmtQty(product.qty, 2)}`).join(' · ')}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">Riesgo</p>
                      <p className="text-label-sm text-on-surface-variant">
                        {row.alerts.length > 0 ? row.alerts.join(' · ') : 'Cubierto con stock y órdenes pendientes.'}
                      </p>
                    </div>
                  </div>
                )}
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm">
                    <span className="text-on-surface-variant">
                      {materialRows.length} materiales · {explosionData.totals.shortages} por comprar
                    </span>
                    <span className="font-semibold text-on-surface">
                      Costo requerido: {money(explosionData.totals.requiredCost, currency)} · compra:{' '}
                      {money(explosionData.totals.purchaseCost, currency)}
                    </span>
                  </div>
                }
              />
            )}
          </Card>
          </div>
        )}

        {tab === 'formulas' && (
          <div className="flex flex-col gap-space-lg">
            <Card data-tour="prod-formulas" className="overflow-hidden">
              <div className="border-b border-surface-container px-space-md py-space-sm">
                <div className="flex flex-wrap items-start justify-between gap-space-sm">
                  <div>
                    <p className="font-semibold text-on-surface">Cédulas por producto</p>
                    <p className="text-label-sm text-on-surface-variant">
                      Todas las recetas de cada producto, costo por kg, por saco y reposición. Doble clic para abrir el desglose.
                    </p>
                  </div>
                  <Badge tone="muted">{formulaRows.length} productos</Badge>
                </div>
              </div>
              {formulasQuery.data && (formulasQuery.data.missingReplacement?.length ?? 0) > 0 && (
                <details className="border-b border-warning/30 bg-warning-container/25 px-space-md py-space-sm">
                  <summary className="cursor-pointer list-none text-label-md font-semibold text-warning">
                    <AlertTriangle aria-hidden className="mr-1 inline size-4" />
                    {formulasQuery.data.missingReplacement.length} materias primas sin costo de reposición en Profit — se
                    calculó con el último costo
                  </summary>
                  <div className="mt-space-xs flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                    {formulasQuery.data.missingReplacement.map((item) => (
                      <span
                        key={item.code}
                        className="rounded-md border border-outline-variant/30 bg-surface-container-lowest px-2 py-0.5 text-label-sm text-on-surface-variant"
                        title={item.fallback === 'NONE' ? 'Tampoco tiene último costo en Profit' : 'Se usó el último costo'}
                      >
                        <span className="font-semibold text-on-surface">{item.code}</span> · {item.description}
                        {item.fallback === 'NONE' && <span className="text-error"> · sin costo</span>}
                      </span>
                    ))}
                  </div>
                </details>
              )}
              {formulasQuery.isLoading && <p className="p-space-md text-body-md text-on-surface-variant">Cargando cédulas…</p>}
              {formulasQuery.error && !(formulasQuery.error instanceof AuthRequiredError) && (
                <p role="alert" className="p-space-md text-body-md text-error">
                  {formulasQuery.error instanceof Error ? formulasQuery.error.message : 'Error al cargar cédulas'}
                </p>
              )}
              {formulasQuery.data && (
                <DataTable
                  columns={formulaColumnsMemo}
                  rows={formulaRows}
                  rowKey={(row) => row.productCode}
                  defaultSortKey="code"
                  expandedKey={expandedProduct}
                  renderExpanded={(row) => (
                    <FormulaCedulasTable
                      row={row}
                      currency={currency}
                      onOpen={(formulaId) => openFormulaModal(row.productCode, formulaId)}
                    />
                  )}
                  onRowClick={(row) =>
                    setExpandedProduct((current) => (current === row.productCode ? null : row.productCode))
                  }
                  onRowDoubleClick={(row) => openFormulaModal(row.productCode)}
                  maxHeightClass="md:max-h-[min(66vh,860px)]"
                  empty={<EmptyState icon={FlaskConical} title="Sin cédulas para el filtro" />}
                />
              )}
            </Card>

            <FormulaDetailModal
              open={formulaModalOpen}
              detail={detail}
              loading={formulaDetailQuery.isLoading}
              error={
                formulaDetailQuery.error && !(formulaDetailQuery.error instanceof AuthRequiredError)
                  ? formulaDetailQuery.error instanceof Error
                    ? formulaDetailQuery.error.message
                    : 'Error al abrir la ficha'
                  : null
              }
              currency={currency}
              onCurrencyChange={setCurrency}
              selectedFormulaId={selectedFormulaId}
              onSelectFormula={setSelectedFormulaId}
              onClose={() => setFormulaModalOpen(false)}
              onMakePrincipal={(formulaId) => detail && preferenceMutation.mutate({ code: detail.productCode, formulaId })}
              principalPending={preferenceMutation.isPending}
            />
          </div>
        )}

        {tab === 'nutrition' && (
          <NutritionPanel
            selectedProduct={selectedProduct}
            onSelectProduct={setSelectedProduct}
            products={formulasQuery.data?.rows ?? []}
            detail={detail}
            nutrition={nutritionQuery.data}
            loading={nutritionQuery.isLoading}
            currency={currency}
            formulaId={nutritionFormulaId}
            onSelectFormula={setNutritionFormulaId}
          />
        )}

        {tab === 'scenarios' && (
          <Card data-tour="prod-scenarios" className="p-space-md">
            <div className="flex flex-wrap items-end justify-between gap-space-sm">
              <div>
                <p className="font-display text-title-lg text-primary">Escenarios guardados</p>
                <p className="text-body-md text-on-surface-variant">
                  Guarda la foto del plan actual para comparar contra otro periodo o política.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-space-sm">
                <TextInput
                  value={scenarioName}
                  onChange={setScenarioName}
                  placeholder="Nombre del escenario"
                  ariaLabel="Nombre del escenario"
                  className="w-64"
                />
                <button
                  type="button"
                  onClick={() =>
                    scenarioName.trim() &&
                    scenarioCreateMutation.mutate({
                      name: scenarioName.trim(),
                      payload: {
                        plan: plan ?? null,
                        explosion: explosionData ?? null,
                        selection: simulation?.selection ?? null,
                        overrides,
                        totals: plan?.totals ?? {},
                        query: {
                          year: parseYm(ym).year,
                          month: parseYm(ym).month,
                          week,
                          policy,
                          currency,
                        },
                      },
                    })
                  }
                  disabled={!scenarioName.trim() || scenarioCreateMutation.isPending || !plan}
                  className="inline-flex h-10 items-center gap-space-2xs rounded-xl bg-primary px-space-md text-label-md font-semibold text-white disabled:opacity-60"
                >
                  <Save aria-hidden className="size-4" />
                  Guardar plan
                </button>
              </div>
            </div>
            <div className="mt-space-md flex flex-col gap-space-sm">
              {(scenariosQuery.data ?? []).length === 0 && (
                <EmptyState icon={Sparkles} title="Sin escenarios guardados" description="Guarda el plan actual para conservar una foto." />
              )}
              {(scenariosQuery.data ?? []).map((scenario) => (
                <div key={scenario.id} className="flex flex-wrap items-center justify-between gap-space-sm rounded-xl border border-surface-container p-space-sm">
                  <div>
                    <p className="font-semibold text-on-surface">{scenario.name}</p>
                    <p className="text-label-sm text-on-surface-variant">
                      {scenario.year}-{String(scenario.month).padStart(2, '0')} · semana {scenario.week || 'mes'} ·{' '}
                      {scenario.policy} · {scenario.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-space-md text-label-sm text-on-surface-variant">
                    <span>Prod: {fmtQty(scenario.totals.productionKg ?? 0, 0)} kg</span>
                    <span>Costo: {money(scenario.totals.totalCost ?? null, scenario.currency)}</span>
                    <button
                      type="button"
                      onClick={() => scenarioDeleteMutation.mutate(scenario.id)}
                      className="rounded-lg border border-error/30 p-2 text-error hover:bg-error/5"
                      aria-label={`Eliminar ${scenario.name}`}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

function SelectionTable({
  data,
  groupBy,
  selectedKeys,
  onToggleKeys,
  expandedKey,
  onExpand,
}: {
  data: ProductionOrdersResponse;
  groupBy: 'producto' | 'cliente';
  selectedKeys: Set<string>;
  onToggleKeys: (keys: string[], selected: boolean) => void;
  expandedKey: string | null;
  onExpand: (key: string | null) => void;
}) {
  const columns: Column<ProductionOrderGroup>[] = [
    {
      key: 'select',
      header: '',
      render: (group) => {
        const all =
          group.lines.length > 0 &&
          group.lines.every((line) => selectedKeys.has(line.selectionKey));
        const some = group.lines.some((line) => selectedKeys.has(line.selectionKey));
        return (
          <div className="flex items-center gap-space-xs">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) =>
                onToggleKeys(group.lines.map((line) => line.selectionKey), event.target.checked)
              }
              aria-label={`Seleccionar ${group.label}`}
              className="size-4 cursor-pointer accent-[var(--color-primary-container)]"
            />
            {some && !all && <span className="text-label-sm text-outline">parcial</span>}
          </div>
        );
      },
    },
    {
      key: 'label',
      header: groupBy === 'producto' ? 'Producto' : 'Cliente',
      title: (group) => group.label,
      sortValue: (group) => group.label,
      render: (group) => (
        <div className="min-w-0">
          <p className="font-bold tabular-nums text-primary">{group.code ?? group.label}</p>
          <p className="max-w-[22rem] truncate text-label-sm text-on-surface-variant">{group.label}</p>
          {groupBy === 'cliente' && group.lines[0]?.customerType && (
            <span className="mt-space-2xs inline-block text-label-sm text-outline">
              {group.lines[0].customerType}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'orders',
      header: 'Pedidos',
      align: 'right',
      sortValue: (group) => group.ordersCount,
      render: (group) => group.ordersCount,
    },
    {
      key: 'items',
      header: groupBy === 'producto' ? 'Clientes' : 'Productos',
      align: 'right',
      sortValue: (group) => (groupBy === 'producto' ? group.customersCount : group.productsCount),
      render: (group) => (groupBy === 'producto' ? group.customersCount : group.productsCount),
    },
    {
      key: 'pending',
      header: 'Cartera kg',
      align: 'right',
      kind: 'metric',
      help: PROD_SELECTION_HELP.pending,
      sortValue: (group) => group.totalPendingKg,
      render: (group) => <span className="font-bold">{fmtQty(group.totalPendingKg, 0)}</span>,
    },
    {
      key: 'stock',
      header: 'Stock kg',
      align: 'right',
      help: PROD_SELECTION_HELP.stock,
      sortValue: (group) => group.stockKg ?? Number.POSITIVE_INFINITY,
      render: (group) => (group.stockKg === null ? '—' : fmtQty(group.stockKg, 0)),
    },
    {
      key: 'coverage',
      header: 'Cobertura',
      align: 'right',
      help: PROD_SELECTION_HELP.coverage,
      sortValue: (group) => group.coverageDays ?? Number.POSITIVE_INFINITY,
      render: (group) => (group.coverageDays === null ? '—' : `${fmtQty(group.coverageDays, 1)} d`),
    },
    {
      key: 'dispatch',
      header: 'En despacho',
      align: 'center',
      help: PROD_SELECTION_HELP.dispatch,
      sortValue: (group) => group.lines.filter((line) => line.dispatchSheetNumber).length,
      render: (group) => {
        const count = group.lines.filter((line) => line.dispatchSheetNumber).length;
        return count > 0 ? (
          <Badge tone="primary">
            <Truck aria-hidden className="size-3" /> {count}
          </Badge>
        ) : (
          <span className="text-on-surface-variant">—</span>
        );
      },
    },
    {
      key: 'risk',
      header: 'Riesgo',
      align: 'center',
      kind: 'status',
      help: PROD_SELECTION_HELP.risk,
      sortValue: (group) => RISK_LABEL[group.risk],
      render: (group) => <Badge tone={RISK_TONE[group.risk]}>{RISK_LABEL[group.risk]}</Badge>,
    },
  ];

  return (
    <Card className="overflow-hidden">
      <DataTable
        columns={columns}
        rows={data.groups}
        rowKey={(group) => group.key}
        defaultSortKey="pending"
        defaultSortDir="desc"
        expandedKey={expandedKey}
        onRowClick={(group) => onExpand(expandedKey === group.key ? null : group.key)}
        empty={<EmptyState icon={ListChecks} title="Sin pedidos para el periodo" />}
        renderExpanded={(group) => (
          <div className="rounded-xl bg-surface-container/60 p-space-md">
            <p className="mb-space-sm text-label-sm text-on-surface-variant">
              {group.linesCount} línea(s) · selecciona las que quieras simular
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-body-md">
                <thead>
                  <tr className="border-b border-surface-container text-label-sm uppercase tracking-wider text-outline">
                    <th className="px-space-sm py-2" />
                    <th className="px-space-sm py-2">Pedido</th>
                    <th className="px-space-sm py-2">{groupBy === 'producto' ? 'Cliente' : 'Producto'}</th>
                    <th className="px-space-sm py-2">Entrega</th>
                    <th className="px-space-sm py-2">Almacén</th>
                    <th className="px-space-sm py-2 text-right">Cantidad</th>
                    <th className="px-space-sm py-2 text-right">Kg</th>
                    <th className="px-space-sm py-2 text-center">Despacho</th>
                    <th className="px-space-sm py-2 text-center">Riesgo</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line: ProductionOrderLine) => {
                    const checked = selectedKeys.has(line.selectionKey);
                    return (
                      <tr key={line.selectionKey} className="border-b border-surface-container/60">
                        <td className="px-space-sm py-space-xs">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => onToggleKeys([line.selectionKey], event.target.checked)}
                            aria-label={`Seleccionar pedido ${line.orderNumber}`}
                            className="size-4 cursor-pointer accent-[var(--color-primary-container)]"
                          />
                        </td>
                        <td className="px-space-sm py-space-xs">
                          <p className="font-semibold tabular-nums text-primary">{line.orderNumber}</p>
                          <p className="text-label-sm text-on-surface-variant">
                            {line.orderDate?.slice(0, 10) ?? '—'}
                          </p>
                          {line.authorized === false && <Badge tone="warning">No autorizado</Badge>}
                        </td>
                        <td className="px-space-sm py-space-xs">
                          <p className="max-w-[18rem] truncate">
                            {groupBy === 'producto' ? line.customerName ?? 'Sin cliente' : line.description}
                          </p>
                          <p className="text-label-sm text-on-surface-variant">
                            {groupBy === 'producto' ? line.customerType ?? '—' : line.productCode}
                          </p>
                        </td>
                        <td
                          className="px-space-sm py-space-xs text-label-sm"
                          title={`Solicitada: ${line.requestedDate?.slice(0, 10) ?? '—'}`}
                        >
                          {line.effectiveDate?.slice(0, 10) ?? '—'}
                        </td>
                        <td className="px-space-sm py-space-xs text-label-sm text-on-surface-variant">
                          {line.warehouseCode ?? '—'}
                        </td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">
                          {fmtQty(line.pendingQty, 0)} {line.uom}
                        </td>
                        <td className="px-space-sm py-space-xs text-right tabular-nums">
                          {fmtQty(line.pendingKg, 0)}
                        </td>
                        <td className="px-space-sm py-space-xs text-center">
                          {line.dispatchSheetNumber ? (
                            <Badge tone="primary">
                              <Truck aria-hidden className="size-3" /> {line.dispatchSheetNumber}
                            </Badge>
                          ) : (
                            <span className="text-on-surface-variant">—</span>
                          )}
                        </td>
                        <td className="px-space-sm py-space-xs text-center">
                          <Badge tone={RISK_TONE[line.risk]}>{RISK_LABEL[line.risk]}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      />
      <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
        {data.totals.orders} pedidos · {data.totals.lines} líneas · {data.totals.products} productos ·{' '}
        {data.totals.customers} clientes · {fmtQty(data.totals.pendingKg, 0)} kg de cartera.
      </div>
    </Card>
  );
}

function FormulaCedulasTable({
  row,
  currency,
  onOpen,
}: {
  row: ProductionFormulaSummary;
  currency: ProductionCurrency;
  onOpen: (formulaId: number) => void;
}) {
  return (
    <div className="flex flex-col gap-space-xs">
      <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">
        Todas las cédulas de {row.productCode} · valores en {currency}
      </p>
      <div className="overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
        <table className="w-full min-w-[900px] text-left text-body-md">
          <thead>
            <tr className="border-b border-outline-variant/30 text-label-sm uppercase tracking-wider text-outline">
              <th className="px-space-sm py-2">Cédula</th>
              <th className="px-space-sm py-2">Tipo</th>
              <th className="px-space-sm py-2 text-right">Lote kg</th>
              <th className="px-space-sm py-2 text-right">Presentación</th>
              <th className="px-space-sm py-2 text-right">Costo/kg</th>
              <th className="px-space-sm py-2 text-right">Costo/saco</th>
              <th className="px-space-sm py-2 text-right">P/reposición</th>
              <th className="px-space-sm py-2 text-right">Actualizada</th>
              <th className="px-space-sm py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {row.formulas.map((line) => (
              <tr key={`${line.kind}-${line.id}`} className="hover:bg-surface-container-low/60">
                <td className="px-space-sm py-space-xs">
                  <span className="inline-flex flex-wrap items-center gap-1 font-semibold text-primary">
                    {line.id}
                    {line.isStandard && <Badge tone="success">Principal</Badge>}
                  </span>
                  <p className="max-w-[16rem] truncate text-label-sm text-on-surface-variant" title={line.name}>
                    {line.name || 'sin nombre'}
                  </p>
                </td>
                <td className="px-space-sm py-space-xs">{KIND_LABEL[line.kind] ?? line.kind}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">
                  {line.batchKg === null ? '—' : fmtQty(line.batchKg, 0)}
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">
                  {line.isBulk || line.presentationKg === null
                    ? 'Granel'
                    : `${fmtQty(line.presentationKg, 0)} kg`}
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">
                  {line.costPerKg === null ? '—' : fmtQty(line.costPerKg, 2)}
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">
                  {line.costPerSack === null ? '—' : fmtQty(line.costPerSack, 2)}
                </td>
                <td className="px-space-sm py-space-xs text-right font-semibold tabular-nums text-secondary">
                  <span className="inline-flex items-center justify-end gap-1">
                    {line.replacementCostPerKg === null ? '—' : fmtQty(line.replacementCostPerKg, 2)}
                    {line.missingReplacement > 0 && (
                      <span
                        className="rounded bg-warning-container/60 px-1 text-[10px] font-bold text-warning"
                        title={`${line.missingReplacement} materia(s) prima(s) sin reposición en Profit: se usó el último costo`}
                      >
                        {line.missingReplacement}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-space-sm py-space-xs text-right text-label-sm text-on-surface-variant">
                  {line.updatedAt ? line.updatedAt.slice(0, 10) : '—'}
                </td>
                <td className="px-space-sm py-space-xs text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(line.id)}
                    className="rounded-lg border border-primary-container/40 px-space-sm py-1 text-label-sm font-semibold text-primary hover:bg-primary-container/5"
                  >
                    Ver desglose
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row.formulas.length > 1 && (
        <p className="text-label-sm text-on-surface-variant">
          La cédula marcada como principal es la que usa el plan de producción. Doble clic en el producto abre el
          desglose completo de cualquier receta.
        </p>
      )}
    </div>
  );
}


function NutritionPanel({
  selectedProduct,
  onSelectProduct,
  products,
  detail,
  nutrition,
  loading,
  currency,
  formulaId,
  onSelectFormula,
}: {
  selectedProduct: string | null;
  onSelectProduct: (code: string) => void;
  products: ProductionFormulaSummary[];
  detail: ProductionFormulaDetailResponse | undefined;
  nutrition: ProductionNutritionCatalogResponse | undefined;
  loading: boolean;
  currency: ProductionCurrency;
  formulaId: number | null;
  onSelectFormula: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [ingredientCode, setIngredientCode] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [specEdits, setSpecEdits] = useState<Record<string, { min: string; max: string; target: string }>>({});

  useEffect(() => {
    if (!nutrition) return;
    if (!ingredientCode || !nutrition.ingredients.some((ingredient) => ingredient.code === ingredientCode)) {
      setIngredientCode(nutrition.ingredients[0]?.code ?? null);
    }
    const specs: Record<string, { min: string; max: string; target: string }> = {};
    for (const spec of nutrition.specs) {
      specs[spec.nutrientCode] = {
        min: spec.min === null ? '' : String(spec.min),
        max: spec.max === null ? '' : String(spec.max),
        target: spec.target === null ? '' : String(spec.target),
      };
    }
    setSpecEdits(specs);
  }, [nutrition, ingredientCode]);

  useEffect(() => {
    if (!nutrition || !ingredientCode) return;
    const ingredient = nutrition.ingredients.find((item) => item.code === ingredientCode);
    if (!ingredient) return;
    const next: Record<string, string> = {};
    for (const value of ingredient.values) {
      next[value.nutrientCode] = value.value === null ? '' : String(value.value);
    }
    setEdits(next);
  }, [nutrition, ingredientCode]);

  const ingredientMutation = useMutation({
    mutationFn: (vars: { code: string; values: Array<{ nutrientCode: string; value: number | null; basis: 'AS_FED' | 'DRY_MATTER' }> }) =>
      apiFetch<{ ok: true; updated: number }>(`/production/nutrition/ingredients/${encodeURIComponent(vars.code)}`, {
        method: 'PUT',
        body: JSON.stringify({ values: vars.values }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production-nutrition'] }),
  });

  const specMutation = useMutation({
    mutationFn: (vars: { product: string; values: Array<{ nutrientCode: string; min: number | null; max: number | null; target: number | null }> }) =>
      apiFetch<{ ok: true; updated: number }>(`/production/nutrition/specs/${encodeURIComponent(vars.product)}`, {
        method: 'PUT',
        body: JSON.stringify({ values: vars.values }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production-nutrition'] }),
  });

  const selectedIngredient = nutrition?.ingredients.find((ingredient) => ingredient.code === ingredientCode) ?? null;

  // Cédulas del producto sin duplicados (MASTER y BASE pueden compartir id).
  const formulas = useMemo(() => {
    const seen = new Map<number, ProductionFormulaDetailResponse['formulas'][number]>();
    for (const formula of detail?.formulas ?? []) if (!seen.has(formula.id)) seen.set(formula.id, formula);
    return Array.from(seen.values());
  }, [detail]);

  const activeFormulaId =
    formulaId !== null && formulas.some((formula) => formula.id === formulaId)
      ? formulaId
      : detail?.selectedFormulaId ?? formulas[0]?.id ?? null;

  const productOptions = products.map((product) => ({
    value: product.productCode,
    label: `${product.productCode} · ${product.description}`,
  }));
  if (selectedProduct && !products.some((product) => product.productCode === selectedProduct)) {
    productOptions.unshift({ value: selectedProduct, label: selectedProduct });
  }

  if (!selectedProduct) {
    return (
      <Card className="p-space-md">
        <p className="font-display text-title-lg text-primary">Nutrición</p>
        <p className="text-body-md text-on-surface-variant">
          Elige un producto para cargar la matriz de nutrientes. La cobertura indica qué parte de la fórmula tiene análisis.
        </p>
        <div className="mt-space-md max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-body-md">
            <thead className="sticky top-0 bg-surface-container-lowest">
              <tr className="border-b border-surface-container text-label-sm uppercase tracking-wider text-outline">
                <th className="px-space-sm py-2">Código</th>
                <th className="px-space-sm py-2">Producto</th>
                <th className="px-space-sm py-2">Cédula</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.productCode}
                  className="cursor-pointer border-b border-surface-container/60 hover:bg-primary-container/5"
                  onClick={() => onSelectProduct(product.productCode)}
                >
                  <td className="px-space-sm py-space-xs font-semibold text-primary">{product.productCode}</td>
                  <td className="px-space-sm py-space-xs">{product.description}</td>
                  <td className="px-space-sm py-space-xs text-on-surface-variant">{product.mainFormulaId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-space-md">
      <div className="mb-space-md grid gap-space-sm sm:grid-cols-2">
        <label className="flex flex-col gap-space-2xs">
          <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">Producto</span>
          <Select
            value={selectedProduct ?? ''}
            onChange={onSelectProduct}
            options={productOptions}
            ariaLabel="Producto de la matriz de nutrición"
          />
        </label>
        {formulas.length > 0 && (
          <label className="flex flex-col gap-space-2xs">
            <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">Cédula</span>
            <Select
              value={activeFormulaId === null ? '' : String(activeFormulaId)}
              onChange={(value) => onSelectFormula(Number(value))}
              options={formulas.map((formula) => ({
                value: String(formula.id),
                label: `${formula.id} · ${formula.name || KIND_LABEL[formula.kind] || formula.kind}${
                  formula.isStandard ? ' · Principal' : ''
                }`,
              }))}
              ariaLabel="Cédula de la matriz de nutrición"
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-space-sm">
        <div>
          <p className="font-display text-title-lg text-primary">Nutrición · {selectedProduct}</p>
          <p className="text-body-md text-on-surface-variant">
            {detail?.description ?? ''} · cédula {nutrition?.formulaId ?? '—'} · {nutrition?.formulaName ?? ''}
          </p>
          <p className="text-label-sm text-on-surface-variant">
            Aporte calculado por composición; la cobertura indica qué parte de la fórmula tiene análisis cargados.
          </p>
        </div>
        <Badge tone="primary">{currency}</Badge>
      </div>

      {loading && <p className="mt-space-md text-body-md text-on-surface-variant">Cargando matriz…</p>}

      {nutrition && (
        <div className="mt-space-md grid gap-space-md xl:grid-cols-2">
          <div className="flex flex-col gap-space-sm">
            <p className="font-semibold text-on-surface">Ingredientes de la fórmula</p>
            <Select
              value={ingredientCode ?? ''}
              onChange={setIngredientCode}
              options={nutrition.ingredients.map((ingredient) => ({
                value: ingredient.code,
                label: `${ingredient.code} · ${ingredient.description}`,
              }))}
              ariaLabel="Ingrediente"
            />
            {selectedIngredient && (
              <div className="flex flex-col gap-space-xs">
                <p className="text-label-sm text-on-surface-variant">
                  {selectedIngredient.qty} {selectedIngredient.uom} · {selectedIngredient.kg === null ? 'sin kg' : `${fmtQty(selectedIngredient.kg, 3)} kg`}
                </p>
                {nutrition.nutrients.map((nutrient) => (
                  <label key={nutrient.code} className="grid grid-cols-[1fr_7rem] items-center gap-space-sm text-label-sm">
                    <span className="text-on-surface-variant">
                      {nutrient.name} <span className="text-outline">({nutrient.unit})</span>
                    </span>
                    <input
                      value={edits[nutrient.code] ?? ''}
                      onChange={(event) => setEdits((current) => ({ ...current, [nutrient.code]: event.target.value }))}
                      inputMode="decimal"
                      className="h-9 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-right tabular-nums text-on-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70"
                      aria-label={`${nutrient.name} de ${selectedIngredient.code}`}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedIngredient) return;
                    const values = nutrition.nutrients.map((nutrient) => {
                      const raw = (edits[nutrient.code] ?? '').trim();
                      const parsed = raw === '' ? null : Number(raw.replace(',', '.'));
                      return {
                        nutrientCode: nutrient.code,
                        value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                        basis: 'AS_FED' as const,
                      };
                    });
                    ingredientMutation.mutate({ code: selectedIngredient.code, values });
                  }}
                  disabled={ingredientMutation.isPending}
                  className="mt-space-xs inline-flex h-10 items-center justify-center gap-space-2xs rounded-xl bg-primary px-space-md text-label-md font-semibold text-white disabled:opacity-60"
                >
                  <Save aria-hidden className="size-4" />
                  Guardar ingrediente
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-space-sm">
            <p className="font-semibold text-on-surface">Resultado de la fórmula</p>
            <div className="overflow-hidden rounded-xl border border-surface-container">
              <table className="w-full text-left text-body-md">
                <thead className="bg-surface-container-lowest">
                  <tr className="border-b border-surface-container text-label-sm uppercase tracking-wider text-outline">
                    <th className="px-space-sm py-2">Nutriente</th>
                    <th className="px-space-sm py-2 text-right">Valor</th>
                    <th className="px-space-sm py-2 text-right">Mín</th>
                    <th className="px-space-sm py-2 text-right">Máx</th>
                    <th className="px-space-sm py-2 text-right">Objetivo</th>
                    <th className="px-space-sm py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {nutrition.nutrition.nutrients.map((nutrient) => {
                    const spec = nutrition.specs.find((item) => item.nutrientCode === nutrient.code);
                    return (
                      <tr key={nutrient.code} className="border-b border-surface-container/60">
                        <td className="px-space-sm py-space-xs">
                          {nutrient.name} <span className="text-outline">({nutrient.unit})</span>
                        </td>
                        <td className="px-space-sm py-space-xs text-right font-semibold tabular-nums">
                          {nutrient.value === null ? '—' : fmtQty(nutrient.value, 2)}
                        </td>
                        <td className="px-space-sm py-space-xs text-right">
                          <input
                            value={specEdits[nutrient.code]?.min ?? ''}
                            onChange={(event) =>
                              setSpecEdits((current) => ({
                                ...current,
                                [nutrient.code]: {
                                  min: event.target.value,
                                  max: current[nutrient.code]?.max ?? '',
                                  target: current[nutrient.code]?.target ?? '',
                                },
                              }))
                            }
                            className="h-8 w-20 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-xs text-right tabular-nums"
                            aria-label={`Mínimo de ${nutrient.name}`}
                          />
                        </td>
                        <td className="px-space-sm py-space-xs text-right">
                          <input
                            value={specEdits[nutrient.code]?.max ?? ''}
                            onChange={(event) =>
                              setSpecEdits((current) => ({
                                ...current,
                                [nutrient.code]: {
                                  min: current[nutrient.code]?.min ?? '',
                                  max: event.target.value,
                                  target: current[nutrient.code]?.target ?? '',
                                },
                              }))
                            }
                            className="h-8 w-20 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-xs text-right tabular-nums"
                            aria-label={`Máximo de ${nutrient.name}`}
                          />
                        </td>
                        <td className="px-space-sm py-space-xs text-right">
                          <input
                            value={specEdits[nutrient.code]?.target ?? ''}
                            onChange={(event) =>
                              setSpecEdits((current) => ({
                                ...current,
                                [nutrient.code]: {
                                  min: current[nutrient.code]?.min ?? '',
                                  max: current[nutrient.code]?.max ?? '',
                                  target: event.target.value,
                                },
                              }))
                            }
                            className="h-8 w-20 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-xs text-right tabular-nums"
                            aria-label={`Objetivo de ${nutrient.name}`}
                          />
                        </td>
                        <td className="px-space-sm py-space-xs text-center">
                          <Badge tone={nutrient.status === 'OK' ? 'success' : nutrient.status === 'NO_DATA' ? 'muted' : nutrient.status === 'LOW' ? 'warning' : 'danger'}>
                            {nutrient.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => {
                const values = nutrition.nutrients
                  .map((nutrient) => {
                    const entry = specEdits[nutrient.code];
                    const parse = (value: string | undefined) => {
                      if (!value || !value.trim()) return null;
                      const n = Number(value.replace(',', '.'));
                      return Number.isFinite(n) ? n : null;
                    };
                    return {
                      nutrientCode: nutrient.code,
                      min: parse(entry?.min),
                      max: parse(entry?.max),
                      target: parse(entry?.target),
                    };
                  })
                  .filter((entry) => entry.min !== null || entry.max !== null || entry.target !== null);
                specMutation.mutate({ product: selectedProduct, values });
              }}
              disabled={specMutation.isPending}
              className="inline-flex h-10 items-center justify-center gap-space-2xs self-start rounded-xl border border-primary-container/40 px-space-md text-label-md font-semibold text-primary disabled:opacity-60"
            >
              <Save aria-hidden className="size-4" />
              Guardar especificación
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

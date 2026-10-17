'use client';

// ============================================================
// Pedidos — Simulador de despacho (modo "Operate").
//
//  · Jerarquía: PageHeader → KPIs de la simulación → panel de modo/orden.
//  · Plan de despacho: turnos (una fila por renglón marcado), con el
//    asignado, el faltante y «Liberar».
//  · Cola de pedidos: grupos por cliente o producto, un desplegable abierto
//    a la vez, los marcados arriba, tinte azul y contador de marcados.
//  · Tablas y tarjetas las resuelve `DataTable`: tabla densa en ≥md,
//    tarjeta por fila en teléfono. Contrato: docs/design/DESIGN_SYSTEM.md
//
//  Reglas del motor (lib/dispatch.ts, NO se tocan desde esta vista):
//   · «Solo disponible» asigna únicamente la existencia; el resto es faltante.
//   · «Demanda total» descuenta todo lo pedido (puede sobregirar).
//   · Los marcados consumen la existencia en el orden en que se marcan.
//   · Parcial permitido; para reasignar hay que liberar primero.
//   · Marcados fijos arriba en la cola; pendiente tachado + asignado.
//   · La selección vive en el navegador (localStorage `nexo.seleccion.v1`)
//     y NUNCA escribe en Profit.
// ============================================================

import type { OrderGroup, OrderGroupBy, OrderGroupLine, OrderGroupedResponse, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Gauge,
  PackageCheck,
  PackageX,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CoverageBar,
  DataTable,
  DateInput,
  EmptyState,
  ErrorNote,
  FilterBar,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  TextInput,
  Toolbar,
  cx,
  fmtDate,
  fmtInt,
  fmtQty,
  type Column,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import {
  buildDispatchQueue,
  summarizeQueue,
  type DispatchInput,
  type DispatchMode,
  type DispatchSort,
  type QueueEntry,
} from '../../lib/dispatch';

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'ABIERTO', label: 'Abierto' },
  { value: 'CERRADO', label: 'Cerrado' },
  { value: 'CANCELADO', label: 'Cancelado' },
];

const BY_OPTIONS = [
  { value: 'cliente', label: 'Por cliente' },
  { value: 'producto', label: 'Por producto' },
];

const AUTH_OPTIONS = [
  { value: '', label: 'Autorizado: Todos' },
  { value: 'SI', label: 'Autorizado: SÍ' },
  { value: 'NO', label: 'Autorizado: NO' },
];

const MODE_OPTIONS: { value: DispatchMode; label: string }[] = [
  { value: 'disponible', label: 'Solo disponible' },
  { value: 'total', label: 'Demanda total' },
];

const SORT_OPTIONS: { value: DispatchSort; label: string }[] = [
  { value: 'prioridad', label: 'Prioridad: entrega + existencia' },
  { value: 'disponibilidad', label: 'Mayor existencia primero' },
  { value: 'pendiente', label: 'Mayor pendiente primero' },
];

// Paleta de las gráficas (identidad Nexo).
const C = { navy: '#003366', lime: '#95C800', dark: '#001e40', red: '#dc2626', amber: '#b45309', outline: '#737780', grid: '#e1f0ff' };

// Números compactos para los ejes (evita que se encimen): 12500 → "13k".
function compactKg(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

const SEL_KEY = 'nexo.seleccion.v1';

function lineKey(line: OrderGroupLine): string {
  return `${line.orderId}#${line.productCode}`;
}

function timeOf(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function loadSelection(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEL_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// Semáforo de cobertura: cubre → success · parcial → warning · falta → danger.
function coverageTone(ratio: number): 'success' | 'warning' | 'danger' {
  return ratio >= 0.999 ? 'success' : ratio > 0 ? 'warning' : 'danger';
}

// Cantidades: enteras sin decimales; con decimales reales, dos cifras.
function fmtUnits(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? fmtInt(value) : fmtQty(value, 2);
}

// Grupo del plan de despacho: la misma agrupación de la cola, con sus turnos.
interface PlanGroup {
  key: string;
  label: string;
  code: string | null;
  entries: QueueEntry[];
  pendingQty: number;
  assignedQty: number;
  missingQty: number;
  missingKg: number;
}

export default function PedidosPage() {
  const [tick, setTick] = useState(0);
  const [by, setBy] = useState<OrderGroupBy>('cliente');
  const [mode, setMode] = useState<DispatchMode>('disponible');
  const [sort, setSort] = useState<DispatchSort>('prioridad');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [planExpanded, setPlanExpanded] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Filtros
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [customerType, setCustomerType] = useState('');
  const [vendor, setVendor] = useState('');
  const [authorized, setAuthorized] = useState('');
  const [emisionDesde, setEmisionDesde] = useState('');
  const [emisionHasta, setEmisionHasta] = useState('');
  const [entregaDesde, setEntregaDesde] = useState('');
  const [entregaHasta, setEntregaHasta] = useState('');
  const [customerCode, setCustomerCode] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('cliente') ?? ''),
  );

  useEffect(() => {
    setSelection(loadSelection());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) window.localStorage.setItem(SEL_KEY, JSON.stringify(selection));
  }, [selection, hydrated]);

  const params = new URLSearchParams();
  params.set('by', by);
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (customerType.trim()) params.set('customerType', customerType.trim());
  if (vendor.trim()) params.set('vendor', vendor.trim());
  if (authorized) params.set('authorized', authorized);
  if (customerCode) params.set('customerCode', customerCode);
  if (emisionDesde) params.set('emisionDesde', emisionDesde);
  if (emisionHasta) params.set('emisionHasta', emisionHasta);
  if (entregaDesde) params.set('entregaDesde', entregaDesde);
  if (entregaHasta) params.set('entregaHasta', entregaHasta);

  const { data, isLoading, error } = useQuery<OrderGroupedResponse>({
    queryKey: ['orders-grouped', tick, by, q, status, customerType, vendor, authorized, customerCode, emisionDesde, emisionHasta, entregaDesde, entregaHasta],
    queryFn: () => apiFetch<OrderGroupedResponse>(`/orders/grouped?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const groups = useMemo(() => data?.groups ?? [], [data]);

  // --- Modelo de datos para la simulación ---
  const dispatchInputs: DispatchInput[] = useMemo(
    () =>
      groups.flatMap((g) =>
        g.lines.map((l) => ({
          key: lineKey(l),
          productCode: l.productCode,
          pendingQty: l.pendingQty,
          pendingKg: l.pendingKg,
          requestedDate: l.requestedDate,
          orderNumber: l.orderNumber,
          customerName: l.customerName,
          stockTotal: (l.stock03 ?? 0) + (l.stock68 ?? 0),
        })),
      ),
    [groups],
  );

  const lineByKey = useMemo(() => {
    const map = new Map<string, { line: OrderGroupLine; group: OrderGroup }>();
    for (const g of groups) for (const l of g.lines) map.set(lineKey(l), { line: l, group: g });
    return map;
  }, [groups]);

  // Información agregada por producto (existencia, demanda, kg por unidad).
  const productInfo = useMemo(() => {
    const map = new Map<string, { units: number; demandUnits: number; demandKg: number; kgPerUnit: number | null; description: string }>();
    for (const g of groups) {
      for (const l of g.lines) {
        let e = map.get(l.productCode);
        if (!e) {
          e = { units: (l.stock03 ?? 0) + (l.stock68 ?? 0), demandUnits: 0, demandKg: 0, kgPerUnit: null, description: l.description ?? l.productCode };
          map.set(l.productCode, e);
        }
        e.demandUnits += l.pendingQty;
        e.demandKg += l.pendingKg ?? 0;
      }
    }
    for (const e of map.values()) e.kgPerUnit = e.demandUnits !== 0 ? e.demandKg / e.demandUnits : null;
    return map;
  }, [groups]);

  // Cola de despacho: stock vivo, marcados fijos y el resto en turno.
  const queue = useMemo(() => buildDispatchQueue(dispatchInputs, selection, mode, sort), [dispatchInputs, selection, mode, sort]);
  const queueByKey = useMemo(() => new Map(queue.map((e) => [e.key, e])), [queue]);
  const queueIndex = useMemo(() => new Map(queue.map((e) => [e.key, e.sortIndex])), [queue]);
  const liveSummary = useMemo(() => summarizeQueue(queue), [queue]);
  const planEntries = useMemo(() => queue.filter((e) => e.selected).sort((a, b) => a.priority - b.priority), [queue]);
  const planSummary = useMemo(() => summarizeQueue(planEntries), [planEntries]);

  // Orden de grupos por la posición de su mejor renglón en la cola
  // (los grupos con renglones marcados suben al principio).
  const orderedGroups = useMemo(() => {
    const rank = (g: OrderGroup) => Math.min(...g.lines.map((l) => queueIndex.get(lineKey(l)) ?? Number.MAX_SAFE_INTEGER));
    return [...groups].sort((a, b) => rank(a) - rank(b));
  }, [groups, queueIndex]);

  // Plan de despacho agrupado igual que la cola: por producto (y dentro, los
  // clientes) o por cliente (y dentro, los artículos). Un grupo abierto a la vez.
  const planGroups = useMemo<PlanGroup[]>(() => {
    const map = new Map<string, PlanGroup>();
    for (const entry of planEntries) {
      const ref = lineByKey.get(entry.key);
      if (!ref) continue;
      const bucket =
        map.get(ref.group.key) ??
        ({
          key: ref.group.key,
          label: ref.group.label,
          code: ref.group.code,
          entries: [],
          pendingQty: 0,
          assignedQty: 0,
          missingQty: 0,
          missingKg: 0,
        } satisfies PlanGroup);
      bucket.entries.push(entry);
      bucket.pendingQty += ref.line.pendingQty;
      bucket.assignedQty += entry.assignedQty;
      bucket.missingQty += entry.missingQty;
      bucket.missingKg += entry.missingKg;
      map.set(ref.group.key, bucket);
    }
    return [...map.values()]
      .map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => a.priority - b.priority) }))
      .sort((a, b) => (a.entries[0]?.priority ?? 0) - (b.entries[0]?.priority ?? 0));
  }, [planEntries, lineByKey]);

  // --- Gráficas ---
  const coverageChart = useMemo(() => {
    const rows = [...productInfo.entries()]
      .map(([code, e]) => {
        const kpu = e.kgPerUnit ?? 0;
        const covered = e.demandUnits <= 0 ? 0 : Math.min(e.units, e.demandUnits);
        const missing = e.demandUnits <= 0 ? 0 : Math.max(0, e.demandUnits - e.units);
        return { code, description: e.description, coveredKg: Math.round(covered * kpu), missingKg: Math.round(missing * kpu) };
      })
      .filter((r) => r.coveredKg + r.missingKg > 0)
      .sort((a, b) => b.coveredKg + b.missingKg - (a.coveredKg + a.missingKg))
      .slice(0, 12)
      .reverse();
    return {
      grid: { left: 4, right: 20, top: 8, bottom: 44, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => `${fmtQty(v, 0)} kg`,
      },
      legend: { bottom: 2, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: C.outline, fontSize: 11 } },
      xAxis: {
        type: 'value',
        axisLabel: { color: C.outline, fontSize: 10, formatter: (v: number) => compactKg(v) },
        splitLine: { lineStyle: { color: C.grid } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.code),
        axisLabel: { color: C.dark, fontSize: 11, fontFamily: 'monospace' },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        { name: 'Despachable', type: 'bar', stack: 't', data: rows.map((r) => r.coveredKg), color: C.navy, barMaxWidth: 10, itemStyle: { borderRadius: [3, 0, 0, 3] } },
        { name: 'Faltante', type: 'bar', stack: 't', data: rows.map((r) => r.missingKg), color: C.red, barMaxWidth: 10, itemStyle: { borderRadius: [0, 3, 3, 0] } },
      ],
    };
  }, [productInfo]);

  const donutChart = useMemo(() => {
    const covered = Math.round(liveSummary.assignedKg);
    const missing = Math.round(liveSummary.missingKg);
    return {
      tooltip: { trigger: 'item', valueFormatter: (v: number) => `${fmtQty(v, 0)} kg` },
      legend: { bottom: 0, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: C.outline, fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['60%', '82%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          data: [
            { name: 'Despachable', value: covered, itemStyle: { color: C.navy } },
            { name: 'Faltante', value: missing, itemStyle: { color: C.red } },
          ],
        },
      ],
    };
  }, [liveSummary]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const hasFilters = Boolean(q || status || customerType || vendor || authorized || emisionDesde || emisionHasta || entregaDesde || entregaHasta || customerCode);
  const filtersActive = [status, authorized, customerType.trim(), vendor.trim(), emisionDesde, emisionHasta, entregaDesde, entregaHasta, customerCode].filter(
    Boolean,
  ).length;
  const coveragePct = Math.round(liveSummary.coverage * 100);

  function resetFilters() {
    setQ('');
    setStatus('');
    setCustomerType('');
    setVendor('');
    setAuthorized('');
    setEmisionDesde('');
    setEmisionHasta('');
    setEntregaDesde('');
    setEntregaHasta('');
    setCustomerCode('');
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '/pedidos');
  }

  function toggleLine(line: OrderGroupLine) {
    const key = lineKey(line);
    setSelection((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleGroup(group: OrderGroup) {
    const keys = group.lines.map(lineKey);
    const all = keys.every((k) => selection.includes(k));
    setSelection((prev) => (all ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]));
  }

  function exportPlan() {
    const rows: string[][] = [['Turno', 'Pedido', 'Cliente', 'Producto', 'Descripcion', 'Pendiente', 'Asignado', 'Faltante', 'Kg asignado', 'Kg faltante', 'Entrega']];
    for (const r of planEntries) {
      const ref = lineByKey.get(r.key);
      if (!ref) continue;
      rows.push([
        String(r.priority),
        ref.line.orderNumber,
        ref.line.customerName ?? '',
        ref.line.productCode,
        ref.line.description ?? '',
        String(ref.line.pendingQty),
        String(r.assignedQty),
        String(r.missingQty),
        String(r.assignedKg),
        String(r.missingKg),
        (ref.line.requestedDate ?? '').slice(0, 10),
      ]);
    }
    const csv = rows.map((line) => line.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plan-despacho-nexo.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Columnas: cola de pedidos (una fila por grupo) ---
  const markedOf = (g: OrderGroup) => g.lines.reduce((a, l) => a + (selection.includes(lineKey(l)) ? 1 : 0), 0);
  const assignedOf = (g: OrderGroup) => g.lines.reduce((a, l) => a + (queueByKey.get(lineKey(l))?.assignedQty ?? 0), 0);
  const pendingOf = (g: OrderGroup) => g.lines.reduce((a, l) => a + l.pendingQty, 0);
  const coverageOf = (g: OrderGroup) => (pendingOf(g) > 0 ? assignedOf(g) / pendingOf(g) : 1);

  const groupColumns: Column<OrderGroup>[] = [
    {
      key: 'label',
      header: by === 'producto' ? 'Producto' : 'Cliente',
      kind: 'id',
      sortValue: (g) => g.label,
      render: (g) => {
        const marked = markedOf(g);
        const earliest = g.lines.reduce((min, l) => Math.min(min, timeOf(l.requestedDate)), Number.POSITIVE_INFINITY);
        const open = expanded === g.key;
        return (
          <span
            aria-current={open ? 'true' : undefined}
            className={cx('flex min-w-0 flex-col gap-space-2xs rounded-md px-space-xs py-space-2xs', marked > 0 && 'bg-primary-fixed/60')}
          >
            <span className="flex min-w-0 items-center gap-space-xs">
              <span className="truncate">{g.label}</span>
              {marked > 0 && (
                <span
                  title={`${marked} ${marked === 1 ? 'renglón marcado' : 'renglones marcados'} para despacho en este grupo`}
                  className="shrink-0 rounded bg-primary-container px-space-xs py-space-2xs font-bold tabular-nums text-label-sm text-on-primary"
                >
                  {marked}
                </span>
              )}
            </span>
            <span className="truncate text-label-sm font-medium tracking-normal text-outline">
              {g.code ?? '—'}
              {Number.isFinite(earliest) ? ` · entrega ${fmtDate(new Date(earliest).toISOString())}` : ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'items',
      header: by === 'producto' ? 'Clientes' : 'Productos',
      kind: 'field',
      align: 'right',
      render: (g) => <span className="tabular-nums">{fmtInt(g.itemsCount)}</span>,
      sortValue: (g) => g.itemsCount,
    },
    {
      key: 'orders',
      header: 'Pedidos',
      kind: 'field',
      align: 'right',
      render: (g) => <span className="tabular-nums">{fmtInt(g.ordersCount)}</span>,
      sortValue: (g) => g.ordersCount,
    },
    {
      key: 'pending',
      header: 'Pendiente',
      kind: 'metric',
      align: 'right',
      render: (g) => (
        <span className={cx('font-bold tabular-nums', g.totalPendingQty < 0 ? 'text-critical' : 'text-on-surface')}>{fmtUnits(g.totalPendingQty)}</span>
      ),
      sortValue: (g) => g.totalPendingQty,
    },
    {
      key: 'pendingKg',
      header: 'Pendiente kg',
      kind: 'metric',
      align: 'right',
      render: (g) => <span className="tabular-nums text-on-surface-variant">{fmtInt(g.totalPendingKg)}</span>,
      sortValue: (g) => g.totalPendingKg,
    },
    {
      key: 'assigned',
      header: 'Asignado',
      kind: 'metric',
      align: 'right',
      render: (g) => <span className="font-bold tabular-nums text-secondary">{fmtUnits(assignedOf(g))}</span>,
      sortValue: (g) => assignedOf(g),
    },
    {
      key: 'coverage',
      header: 'Cobertura',
      kind: 'status',
      sortValue: (g) => coverageOf(g),
      render: (g) => {
        const ratio = coverageOf(g);
        return (
          <span className="flex items-center gap-space-sm">
            <CoverageBar ratio={ratio} className="w-16" />
            <Badge tone={coverageTone(ratio)}>{Math.round(ratio * 100)}%</Badge>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Acciones',
      kind: 'action',
      align: 'right',
      render: (g) => {
        const allSelected = g.lines.length > 0 && g.lines.every((l) => selection.includes(lineKey(l)));
        const open = expanded === g.key;
        return (
          <div className="flex flex-wrap items-center justify-end gap-space-sm">
            <Button
              variant={allSelected ? 'outline' : 'primary'}
              icon={allSelected ? X : Check}
              onClick={() => toggleGroup(g)}
              ariaLabel={allSelected ? `Quitar la marca de todos los renglones de ${g.label}` : `Marcar todos los renglones de ${g.label}`}
              className="md:h-8"
            >
              {allSelected ? 'Quitar marca' : 'Marcar todo'}
            </Button>
            <Button
              variant="ghost"
              icon={open ? ChevronUp : ChevronDown}
              onClick={() => setExpanded(open ? null : g.key)}
              title={open ? 'Cerrar los renglones de este grupo' : 'Ver los renglones de este grupo'}
              ariaLabel={open ? `Cerrar los renglones de ${g.label}` : `Ver los renglones de ${g.label}`}
              className="md:h-8"
            >
              {open ? 'Cerrar' : 'Renglones'}
            </Button>
          </div>
        );
      },
    },
  ];

  // --- Columnas: plan de despacho (una fila por grupo; se despliega a turnos) ---
  const planGroupColumns: Column<PlanGroup>[] = [
    {
      key: 'label',
      header: by === 'producto' ? 'Producto' : 'Cliente',
      kind: 'id',
      sortValue: (g) => g.entries[0]?.priority ?? 0,
      render: (g) => {
        const open = planExpanded === g.key;
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <span className="flex min-w-0 items-start gap-space-sm">
            <Chevron aria-hidden className={cx('mt-0.5 size-4 shrink-0', open ? 'text-primary' : 'text-outline')} />
            <span className="flex min-w-0 flex-col gap-space-2xs">
              <span className="truncate font-semibold">{g.label}</span>
              {g.code && <span className="text-label-sm font-medium tabular-nums tracking-normal text-outline">{g.code}</span>}
            </span>
          </span>
        );
      },
    },
    {
      key: 'entries',
      header: 'Turnos',
      kind: 'metric',
      align: 'right',
      render: (g) => <span className="font-bold tabular-nums">{fmtInt(g.entries.length)}</span>,
      sortValue: (g) => g.entries.length,
    },
    {
      key: 'pending',
      header: 'Pendiente',
      kind: 'metric',
      align: 'right',
      render: (g) => <span className="tabular-nums text-on-surface-variant">{fmtUnits(g.pendingQty)}</span>,
      sortValue: (g) => g.pendingQty,
    },
    {
      key: 'assigned',
      header: 'Asignado',
      kind: 'metric',
      align: 'right',
      render: (g) => <span className="font-bold tabular-nums text-secondary">{fmtUnits(g.assignedQty)}</span>,
      sortValue: (g) => g.assignedQty,
    },
    {
      key: 'missingKg',
      header: 'Faltante kg',
      kind: 'metric',
      align: 'right',
      render: (g) => (
        <span className={cx('tabular-nums', g.missingKg > 0 ? 'font-bold text-critical' : 'text-outline')}>{fmtInt(g.missingKg)}</span>
      ),
      sortValue: (g) => g.missingKg,
    },
    {
      key: 'toggle',
      header: 'Acciones',
      kind: 'action',
      align: 'right',
      render: (g) => {
        const open = planExpanded === g.key;
        return (
          <Button
            variant="ghost"
            icon={open ? ChevronUp : ChevronDown}
            onClick={() => setPlanExpanded(open ? null : g.key)}
            title={open ? 'Cerrar los turnos de este grupo' : 'Ver los turnos de este grupo'}
            ariaLabel={open ? `Cerrar los turnos de ${g.label}` : `Ver los turnos de ${g.label}`}
            className="md:h-8"
          >
            {open ? 'Cerrar' : 'Ver turnos'}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-xl">
        <PageHeader
          icon={ShoppingCart}
          title="Simulador de despacho"
          subtitle={`Pedidos de Profit agrupados por cliente o producto y comparados contra la existencia real de los almacenes Stock 03 y Stock 68. Marca renglones para armar el plan; la simulación se ordena por prioridad y nunca escribe en Profit.`}
        />

        {error && !(error instanceof AuthRequiredError) && (
          <ErrorNote>{error instanceof Error ? error.message : 'No se pudo consultar los pedidos. Revisa la conexión con el API e inténtalo de nuevo.'}</ErrorNote>
        )}

        {!data && isLoading && (
          <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
            <Kpi
              label="Cobertura"
              value={`${coveragePct}%`}
              tone={coverageTone(liveSummary.coverage)}
              icon={Gauge}
              hint={`${fmtUnits(liveSummary.assignedQty)} de ${fmtUnits(liveSummary.pendingQty)} unid.`}
            />
            <Kpi label="Despachable" value={fmtInt(liveSummary.assignedKg)} suffix="kg" tone="primary" icon={PackageCheck} hint="Según la existencia del momento" />
            <Kpi
              label="Faltante"
              value={fmtInt(liveSummary.missingKg)}
              suffix="kg"
              tone="danger"
              icon={PackageX}
              hint={`${fmtUnits(liveSummary.missingQty)} unid.`}
            />
            <Kpi label="Pendiente" value={fmtUnits(liveSummary.pendingQty)} suffix="unid." tone="muted" icon={Truck} hint={`${fmtInt(liveSummary.pendingKg)} kg`} />
          </div>
        )}

        {/* Panel de decisión: modo de simulación y orden de la cola */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Modo de simulación"
            description={
              mode === 'disponible'
                ? 'Asigna únicamente lo que hay en existencia; el resto queda como faltante.'
                : 'Descuenta todo lo pedido aunque sobregire la existencia.'
            }
          />
          <div className="flex flex-col gap-space-md px-space-lg py-space-md xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-wrap items-end gap-space-lg">
              <div className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Simulación</span>
                <Segmented ariaLabel="Modo de simulación" value={mode} onChange={setMode} options={MODE_OPTIONS} />
              </div>
              <div className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Agrupar la cola</span>
                <Select
                  className="w-full md:w-44"
                  ariaLabel="Agrupar la cola por"
                  value={by}
                  onChange={(v) => {
                    setBy(v as OrderGroupBy);
                    setExpanded(null);
                    setPlanExpanded(null);
                  }}
                  options={BY_OPTIONS}
                />
              </div>
              <div className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Orden de la cola</span>
                <Select
                  className="w-full md:w-72"
                  ariaLabel="Orden de la cola"
                  value={sort}
                  onChange={(v) => setSort(v as DispatchSort)}
                  options={SORT_OPTIONS}
                />
              </div>
            </div>
            <p className="text-label-sm text-on-surface-variant xl:max-w-sm">
              Los renglones marcados consumen la existencia en el orden en que se marcan; el resto compite por lo que quede.
            </p>
          </div>
        </Card>

        <div className="grid gap-space-lg xl:grid-cols-12">
          <div className="flex flex-col gap-space-lg xl:col-span-12">
            {/* Plan de despacho: turnos por entrega */}
            <Card className="overflow-hidden">
              <CardHeader
                title={`Plan de despacho · ${mode === 'disponible' ? 'solo disponible' : 'demanda total'}`}
                description={`Turnos por fecha de entrega, agrupados por ${by === 'producto' ? 'producto (y dentro, sus clientes)' : 'cliente (y dentro, sus artículos)'}. A igual fecha, el orden en que se marcaron.`}
              />
              {planEntries.length > 0 && (
                <Toolbar className="justify-between">
                  <p aria-live="polite" className="text-body-md text-on-surface-variant">
                    <strong className="tabular-nums text-on-surface">{fmtInt(planEntries.length)}</strong> {planEntries.length === 1 ? 'renglón' : 'renglones'} en
                    turno · <strong className="tabular-nums text-secondary">{fmtInt(planSummary.assignedKg)} kg</strong> asignados ·{' '}
                    <strong className={planSummary.missingKg > 0 ? 'tabular-nums text-critical' : 'tabular-nums text-outline'}>
                      {fmtInt(planSummary.missingKg)} kg
                    </strong>{' '}
                    faltantes
                  </p>
                  <div className="flex flex-wrap items-center gap-space-sm">
                    <Button variant="outline" icon={Download} onClick={exportPlan} title="Descargar el plan en CSV" ariaLabel="Exportar el plan de despacho en CSV">
                      Exportar plan
                    </Button>
                    <Button variant="ghost" icon={Trash2} onClick={() => { setSelection([]); setPlanExpanded(null); }} ariaLabel="Limpiar el plan de despacho">
                      Limpiar plan
                    </Button>
                  </div>
                </Toolbar>
              )}
              <DataTable
                columns={planGroupColumns}
                rows={planGroups}
                rowKey={(g) => g.key}
                defaultSortKey="label"
                expandedKey={planExpanded}
                renderExpanded={(g) => (
                  <PlanDespacho entries={g.entries} lineByKey={lineByKey} onToggleLine={toggleLine} by={by} />
                )}
                empty={
                  <EmptyState
                    icon={PackageCheck}
                    title="Aún no hay plan de despacho"
                    description="Abre un grupo de la cola de pedidos y marca los renglones que puedes despachar hoy: aquí aparecerán agrupados igual que la cola, y dentro de cada grupo, sus turnos."
                  />
                }
              />
              {planEntries.length > 0 && (
                <div className="border-t border-surface-container px-space-lg py-space-sm text-label-sm text-on-surface-variant">
                  Abre un grupo para ver sus turnos. «Liberar» devuelve la existencia de ese renglón a la cola; el plan es solo
                  analítico: no reserva stock en Profit.
                </div>
              )}
            </Card>

            {/* Cola de pedidos */}
            <Card className="overflow-hidden">
              <CardHeader
                title={`Cola de pedidos · ${by === 'producto' ? 'por producto' : 'por cliente'}`}
                description="Los grupos con renglones marcados suben al principio y llevan el contador azul. Se abre un grupo a la vez."
                action={<Badge tone="muted">{fmtInt(orderedGroups.length)} grupos</Badge>}
              />
              <FilterBar
                activeCount={filtersActive}
                search={
                  <TextInput
                    icon={Search}
                    value={q}
                    onChange={setQ}
                    placeholder="Buscar N° de pedido o cliente…"
                    ariaLabel="Buscar por número de pedido o cliente"
                  />
                }
                filters={
                  <>
                    <Select
                      className="md:w-40"
                      value={status}
                      onChange={(v) => setStatus(v as OrderStatus | '')}
                      options={STATUS_OPTIONS}
                      ariaLabel="Estado del pedido"
                    />
                    <Select
                      className="md:w-40"
                      value={authorized}
                      onChange={setAuthorized}
                      options={AUTH_OPTIONS}
                      ariaLabel="Autorizado"
                    />
                    <TextInput className="md:w-40" value={customerType} onChange={setCustomerType} placeholder="Tipo (ej. L1)" ariaLabel="Tipo de cliente" />
                    <TextInput className="md:w-44" value={vendor} onChange={setVendor} placeholder="Vendedor…" ariaLabel="Vendedor" />
                    <div className="flex items-center gap-space-xs">
                      <span className="whitespace-nowrap font-semibold uppercase tracking-wider text-label-sm text-outline">Entrega</span>
                      <DateInput ariaLabel="Entrega desde" value={entregaDesde} onChange={setEntregaDesde} className="w-full md:w-36" />
                      <span aria-hidden className="text-outline">
                        –
                      </span>
                      <DateInput ariaLabel="Entrega hasta" value={entregaHasta} onChange={setEntregaHasta} className="w-full md:w-36" />
                    </div>
                    <div className="flex items-center gap-space-xs">
                      <span className="whitespace-nowrap font-semibold uppercase tracking-wider text-label-sm text-outline">Emisión</span>
                      <DateInput ariaLabel="Emisión desde" value={emisionDesde} onChange={setEmisionDesde} className="w-full md:w-36" />
                      <span aria-hidden className="text-outline">
                        –
                      </span>
                      <DateInput ariaLabel="Emisión hasta" value={emisionHasta} onChange={setEmisionHasta} className="w-full md:w-36" />
                    </div>
                    {customerCode && <Badge tone="primary">Cliente {customerCode}</Badge>}
                    <Button variant="outline" icon={X} onClick={resetFilters} disabled={!hasFilters} ariaLabel="Limpiar todos los filtros">
                      Limpiar filtros
                    </Button>
                  </>
                }
              />
              <DataTable
                columns={groupColumns}
                rows={orderedGroups}
                rowKey={(g) => g.key}
                loading={isLoading}
                loadingRows={6}
                expandedKey={expanded}
                renderExpanded={(g) => (
                  <RenglonesDeGrupo
                    group={g}
                    by={by}
                    selection={selection}
                    mode={mode}
                    queueByKey={queueByKey}
                    onToggleLine={toggleLine}
                  />
                )}
                empty={
                  error ? (
                    <EmptyState
                      icon={Search}
                      title="No se pudo mostrar la cola de pedidos"
                      description="Revisa el aviso de error de arriba y vuelve a intentarlo."
                      action={
                        hasFilters ? (
                          <Button variant="outline" icon={X} onClick={resetFilters}>
                            Limpiar filtros
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={Search}
                      title={hasFilters ? 'Sin pedidos para los filtros aplicados' : 'No hay pedidos sincronizados'}
                      description={
                        hasFilters
                          ? 'Quita los filtros o cambia el rango de fechas para ver la cola completa.'
                          : 'Ejecuta «Sincronizar» en la barra superior para traer los pedidos desde Profit.'
                      }
                      action={
                        hasFilters ? (
                          <Button variant="outline" icon={X} onClick={resetFilters}>
                            Limpiar filtros
                          </Button>
                        ) : undefined
                      }
                    />
                  )
                }
              />

              <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-lg py-space-sm text-label-sm text-on-surface-variant">
                <span>
                  {fmtInt(orderedGroups.length)} grupo{orderedGroups.length === 1 ? '' : 's'} · pendiente {fmtInt(liveSummary.pendingQty)} unid. /{' '}
                  {fmtInt(liveSummary.pendingKg)} kg
                </span>
                <span>«Asignado» y «faltante» se calculan con la existencia del momento · {fmtInt(queue.length)} renglones</span>
              </div>
            </Card>
          </div>

          {/* Análisis de cobertura */}
          <div className="xl:col-span-12">
            <Card className="overflow-hidden">
              <CardHeader
                title="Cobertura de la demanda"
                description="Kilogramos despachables y faltantes con la existencia viva (ya descontado lo marcado)."
              />
              <div className="grid gap-space-lg p-space-lg md:grid-cols-2">
                <div>
                  <h3 className="mb-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">Por producto (kg)</h3>
                  <EChart option={coverageChart} height={240} ariaLabel="Cobertura por producto en kilogramos" />
                </div>
                <div className="md:border-l md:border-surface-container md:pl-space-lg">
                  <h3 className="mb-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">Global (kg)</h3>
                  <EChart option={donutChart} height={240} ariaLabel="Cobertura global en kilogramos" />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

// ============================================================
// Plan de despacho: una fila por renglón marcado, en turnos.
// ============================================================
function PlanDespacho({
  entries,
  lineByKey,
  onToggleLine,
  by,
}: {
  entries: QueueEntry[];
  lineByKey: Map<string, { line: OrderGroupLine; group: OrderGroup }>;
  onToggleLine: (line: OrderGroupLine) => void;
  by: OrderGroupBy;
}) {
  const columns: Column<QueueEntry>[] = [
    {
      key: 'order',
      header: 'Pedido',
      kind: 'id',
      sortValue: (e) => lineByKey.get(e.key)?.line.orderNumber ?? '',
      render: (e) => {
        const ref = lineByKey.get(e.key);
        return (
          <span className="flex min-w-0 flex-col gap-space-2xs">
            <span className="truncate tabular-nums">{ref?.line.orderNumber ?? '—'}</span>
            <span className="text-label-sm font-medium tracking-normal text-outline">
              Turno {e.priority}
              {ref ? ` · entrega ${fmtDate(ref.line.requestedDate)}` : ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'other',
      header: by === 'producto' ? 'Cliente' : 'Artículo',
      kind: 'field',
      sortValue: (e) => (by === 'producto' ? (lineByKey.get(e.key)?.line.customerName ?? '') : (lineByKey.get(e.key)?.line.productCode ?? '')),
      render: (e) => {
        const line = lineByKey.get(e.key)?.line;
        if (!line) return <span className="text-outline">—</span>;
        return by === 'producto' ? (
          <span className="block max-w-[18rem] truncate">{line.customerName ?? '—'}</span>
        ) : (
          <span className="block max-w-[22rem] truncate" title={line.description ?? undefined}>
            <span className="font-bold text-primary">{line.productCode}</span>
            <span className="text-on-surface-variant"> · {line.description ?? '—'}</span>
          </span>
        );
      },
    },
    {
      key: 'pending',
      header: 'Pendiente',
      kind: 'metric',
      align: 'right',
      render: (e) => <span className={cx('font-bold tabular-nums', e.pendingQty < 0 ? 'text-critical' : 'text-on-surface')}>{fmtUnits(e.pendingQty)}</span>,
      sortValue: (e) => e.pendingQty,
    },
    {
      key: 'assigned',
      header: 'Asignado',
      kind: 'metric',
      align: 'right',
      render: (e) => <span className="font-bold tabular-nums text-secondary">{fmtUnits(e.assignedQty)}</span>,
      sortValue: (e) => e.assignedQty,
    },
    {
      key: 'missing',
      header: 'Faltante',
      kind: 'metric',
      align: 'right',
      render: (e) => (
        <span className={cx('tabular-nums', e.missingQty > 0 ? 'font-bold text-critical' : 'text-outline')}>{fmtUnits(e.missingQty)}</span>
      ),
      sortValue: (e) => e.missingQty,
    },
    {
      key: 'assignedKg',
      header: 'Kg asignado',
      kind: 'detail',
      align: 'right',
      render: (e) => <span className="tabular-nums">{fmtInt(e.assignedKg)}</span>,
      sortValue: (e) => e.assignedKg,
    },
    {
      key: 'missingKg',
      header: 'Kg faltante',
      kind: 'detail',
      align: 'right',
      render: (e) => (
        <span className={cx('tabular-nums', e.missingKg > 0 ? 'text-critical' : 'text-outline')}>{fmtInt(e.missingKg)}</span>
      ),
      sortValue: (e) => e.missingKg,
    },
    {
      key: 'warehouse',
      header: 'Almacén',
      kind: 'detail',
      render: (e) => <span className="tabular-nums text-on-surface-variant">{lineByKey.get(e.key)?.line.warehouseCode ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: 'Acciones',
      kind: 'action',
      align: 'right',
      render: (e) => {
        const ref = lineByKey.get(e.key);
        if (!ref) return null;
        return (
          <Button
            variant="outline"
            icon={X}
            onClick={() => onToggleLine(ref.line)}
            ariaLabel={`Liberar el renglón ${ref.line.orderNumber} de ${ref.line.productCode}`}
            className="md:h-8"
          >
            Liberar
          </Button>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entries}
      rowKey={(e) => e.key}
      maxHeightClass=""
      sticky={false}
      empty={
        <EmptyState
          icon={PackageCheck}
          title="Aún no hay plan de despacho"
          description="Abre un grupo de la cola de pedidos y marca los renglones que puedes despachar hoy: aquí aparecerán en turnos."
        />
      }
    />
  );
}

// ============================================================
// Renglones del grupo abierto: marcar / liberar con el stock vivo.
// ============================================================
function RenglonesDeGrupo({
  group,
  by,
  selection,
  mode,
  queueByKey,
  onToggleLine,
}: {
  group: OrderGroup;
  by: OrderGroupBy;
  selection: string[];
  mode: DispatchMode;
  queueByKey: Map<string, QueueEntry>;
  onToggleLine: (line: OrderGroupLine) => void;
}) {
  const lines = useMemo(
    () => [...group.lines].sort((a, b) => (queueByKey.get(lineKey(a))?.sortIndex ?? 0) - (queueByKey.get(lineKey(b))?.sortIndex ?? 0)),
    [group, queueByKey],
  );

  const columns: Column<OrderGroupLine>[] = [
    {
      key: 'order',
      header: 'Pedido',
      kind: 'id',
      sortValue: (l) => l.orderNumber,
      render: (l) => (
        <span className="flex min-w-0 flex-col gap-space-2xs">
          <span className="truncate tabular-nums">{l.orderNumber}</span>
          <span className="text-label-sm font-medium tracking-normal text-outline">entrega {fmtDate(l.requestedDate)}</span>
        </span>
      ),
    },
    {
      key: 'other',
      header: by === 'producto' ? 'Cliente' : 'Artículo',
      kind: 'field',
      sortValue: (l) => (by === 'producto' ? l.customerName ?? '' : l.productCode),
      render: (l) =>
        by === 'producto' ? (
          <span className="block max-w-[18rem] truncate">{l.customerName ?? '—'}</span>
        ) : (
          <span className="block max-w-[22rem] truncate" title={l.description ?? undefined}>
            <span className="font-bold text-primary">{l.productCode}</span>
            <span className="text-on-surface-variant"> · {l.description ?? '—'}</span>
          </span>
        ),
    },
    {
      key: 'pending',
      header: 'Pendiente',
      kind: 'metric',
      align: 'right',
      sortValue: (l) => l.pendingQty,
      render: (l) => {
        const entry = queueByKey.get(lineKey(l));
        const selected = selection.includes(lineKey(l));
        if (selected && (entry?.assignedQty ?? 0) < l.pendingQty) {
          return (
            <span className="tabular-nums">
              <span className="text-outline line-through">{fmtUnits(l.pendingQty)}</span>{' '}
              <span className="font-bold text-secondary">{fmtUnits(entry?.assignedQty ?? 0)}</span>
            </span>
          );
        }
        return <span className={cx('font-bold tabular-nums', l.pendingQty < 0 ? 'text-critical' : 'text-on-surface')}>{fmtUnits(l.pendingQty)}</span>;
      },
    },
    {
      key: 'assigned',
      header: 'Asignado',
      kind: 'metric',
      align: 'right',
      sortValue: (l) => queueByKey.get(lineKey(l))?.assignedQty ?? 0,
      render: (l) => <span className="font-bold tabular-nums text-secondary">{fmtUnits(queueByKey.get(lineKey(l))?.assignedQty ?? 0)}</span>,
    },
    {
      key: 'missing',
      header: 'Faltante',
      kind: 'metric',
      align: 'right',
      sortValue: (l) => queueByKey.get(lineKey(l))?.missingQty ?? 0,
      render: (l) => {
        const missing = queueByKey.get(lineKey(l))?.missingQty ?? 0;
        return <span className={cx('tabular-nums', missing > 0 ? 'font-bold text-critical' : 'text-outline')}>{fmtUnits(missing)}</span>;
      },
    },
    {
      key: 'stock',
      header: 'Existencia',
      kind: 'metric',
      align: 'right',
      sortValue: (l) => (l.stock03 ?? 0) + (l.stock68 ?? 0),
      render: (l) => <span className="font-bold tabular-nums">{fmtInt((l.stock03 ?? 0) + (l.stock68 ?? 0))}</span>,
    },
    {
      key: 'kg',
      header: 'Kg pendiente',
      kind: 'detail',
      align: 'right',
      render: (l) => <span className="tabular-nums text-on-surface-variant">{fmtInt(l.pendingKg)}</span>,
      sortValue: (l) => l.pendingKg ?? 0,
    },
    {
      key: 'stock03',
      header: 'Stock 03',
      kind: 'detail',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.stock03)}</span>,
    },
    {
      key: 'stock68',
      header: 'Stock 68',
      kind: 'detail',
      align: 'right',
      render: (l) => <span className="tabular-nums">{fmtInt(l.stock68)}</span>,
    },
    {
      key: 'warehouse',
      header: 'Almacén',
      kind: 'detail',
      render: (l) => <span className="tabular-nums text-on-surface-variant">{l.warehouseCode ?? '—'}</span>,
    },
    {
      key: 'authorized',
      header: 'Autorizado',
      kind: 'field',
      render: (l) => (l.authorized === null ? <span className="text-outline">—</span> : <Badge tone={l.authorized ? 'success' : 'muted'}>{l.authorized ? 'SÍ' : 'NO'}</Badge>),
    },
    {
      key: 'state',
      header: 'Estado',
      kind: 'status',
      sortValue: (l) => (selection.includes(lineKey(l)) ? 0 : queueByKey.get(lineKey(l))?.dispatchable ? 1 : 2),
      render: (l) => {
        const entry = queueByKey.get(lineKey(l));
        const selected = selection.includes(lineKey(l));
        const blocked = mode === 'disponible' && !selected && !(entry?.dispatchable ?? false);
        if (selected) {
          return (entry?.missingQty ?? 0) > 0 ? <Badge tone="warning" dot>Parcial</Badge> : <Badge tone="success" dot>Marcado</Badge>;
        }
        if (blocked) return <Badge tone="danger" dot>Sin existencia</Badge>;
        return <Badge tone="muted" dot>Disponible</Badge>;
      },
    },
    {
      key: 'actions',
      header: 'Acciones',
      kind: 'action',
      align: 'right',
      render: (l) => {
        const key = lineKey(l);
        const selected = selection.includes(key);
        const entry = queueByKey.get(key);
        const blocked = mode === 'disponible' && !selected && !(entry?.dispatchable ?? false);
        return (
          <div className="flex flex-wrap items-center justify-end gap-space-sm">
            {selected ? (
              <Button
                variant="outline"
                icon={X}
                onClick={() => onToggleLine(l)}
                ariaLabel={`Liberar el renglón de ${l.productCode} del pedido ${l.orderNumber}`}
                className="md:h-8"
              >
                Liberar
              </Button>
            ) : blocked ? (
              <Button variant="ghost" icon={PackageX} disabled ariaLabel={`Sin existencia para el renglón de ${l.productCode} del pedido ${l.orderNumber}`} className="md:h-8">
                Sin existencia
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={Check}
                onClick={() => onToggleLine(l)}
                ariaLabel={`Marcar el renglón de ${l.productCode} del pedido ${l.orderNumber}`}
                className="md:h-8"
              >
                Marcar
              </Button>
            )}
            <Link
              href={`/pedidos/${l.orderId}`}
              title={`Abrir el detalle del pedido ${l.orderNumber}`}
              className="inline-flex h-11 items-center gap-space-xs rounded-lg px-space-sm font-semibold text-primary-container hover:bg-surface-container-low md:h-8"
            >
              Ver pedido <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </div>
        );
      },
    },
  ];

  return <DataTable columns={columns} rows={lines} rowKey={(l) => lineKey(l)} maxHeightClass="" sticky={false} />;
}

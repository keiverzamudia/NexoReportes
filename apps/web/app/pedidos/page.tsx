'use client';

// ============================================================
// Pedidos — Simulador de despacho (estilo Stitch, modo "Operate").
//
//  · Conmutador Por cliente / Por producto (acordeón de 1 abierto).
//  · SWITCH de simulación:
//      - "Solo despachable": despacho tipo real; asigna únicamente lo que
//        hay en existencia y lo demás queda como faltante.
//      - "Solicitado total": descuenta todo lo pedido (puede quedar negativo).
//  · Orden por PRIORIDAD (fecha de entrega más próxima y existencia).
//  · Plan de despacho: lista priorizada de lo seleccionado (asignado/faltante).
//  · Gráficas de decisión: cobertura por producto y cobertura global (kg).
//
//  La selección y la simulación son SOLO visuales/analíticas: se guardan en
//  el navegador y NUNCA escriben en Profit.
// ============================================================

import type { OrderGroup, OrderGroupBy, OrderGroupLine, OrderGroupedResponse, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Search, ShoppingCart, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, CoverageBar, DateInput, Kpi, PageHeader, Select, Segmented, Td, TextInput, Th, fmtDate, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import { DispatchInput, DispatchMode, DispatchSort, QueueEntry, buildDispatchQueue, summarizeQueue } from '../../lib/dispatch';

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
  { value: 'disponible', label: 'Solo despachable' },
  { value: 'total', label: 'Solicitado total' },
];

const SORT_OPTIONS: { value: DispatchSort; label: string }[] = [
  { value: 'prioridad', label: 'Prioridad: entrega + existencia' },
  { value: 'disponibilidad', label: 'Mayor existencia primero' },
  { value: 'pendiente', label: 'Mayor pendiente primero' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  ABIERTO: 'Abierto',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
};

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

  // Información agregada por producto (existencia, solicitado, kg por unidad).
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
  // Existencia viva por producto: lo que queda después de descontar lo ya
  // marcado. Es la disponibilidad que la cola va gastando cliente a cliente.
  const liveStock = useMemo(() => {
    const map = new Map<string, number>();
    for (const [code, info] of productInfo) map.set(code, info.units);
    for (const e of queue) {
      if (!e.selected) continue;
      const ref = lineByKey.get(e.key);
      if (!ref) continue;
      const code = ref.line.productCode;
      map.set(code, (map.get(code) ?? 0) - e.assignedQty);
    }
    return map;
  }, [productInfo, queue, lineByKey]);

  const planEntries = useMemo(() => queue.filter((e) => e.selected).sort((a, b) => a.priority - b.priority), [queue]);
  const planSummary = useMemo(() => summarizeQueue(planEntries), [planEntries]);

  // Plan agrupado igual que la tabla (por cliente o por producto), 1 abierto.
  const planGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; code: string | null; entries: QueueEntry[]; pendingQty: number; assignedQty: number; assignedKg: number; missingKg: number }
    >();
    for (const e of planEntries) {
      const ref = lineByKey.get(e.key);
      if (!ref) continue;
      let g = map.get(ref.group.key);
      if (!g) {
        g = { key: ref.group.key, label: ref.group.label, code: ref.group.code, entries: [], pendingQty: 0, assignedQty: 0, assignedKg: 0, missingKg: 0 };
        map.set(ref.group.key, g);
      }
      g.entries.push(e);
      g.pendingQty += e.pendingQty;
      g.assignedQty += e.assignedQty;
      g.assignedKg += e.assignedKg;
      g.missingKg += e.missingKg;
    }
    return [...map.values()].map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => a.priority - b.priority) }));
  }, [planEntries, lineByKey]);

  // Orden de grupos por la posición de su mejor renglón en la cola.
  const orderedGroups = useMemo(() => {
    const rank = (g: OrderGroup) => Math.min(...g.lines.map((l) => queueIndex.get(lineKey(l)) ?? Number.MAX_SAFE_INTEGER));
    return [...groups].sort((a, b) => rank(a) - rank(b));
  }, [groups, queueIndex]);

  // --- Gráficas ---
  // Cobertura por producto EN VIVO: lo marcado se «compromete» y descuenta la
  // existencia de ese artículo; el resto de sus pedidos pasa a faltante / «sin
  // existencia». Los KPIs de arriba siguen siendo globales (todo lo pedido).
  const coverageChart = useMemo(() => {
    // Comprometido por producto: únicamente renglones marcados.
    const committed = new Map<string, { units: number; pending: number }>();
    for (const e of queue) {
      if (!e.selected) continue;
      const ref = lineByKey.get(e.key);
      if (!ref) continue;
      const acc = committed.get(ref.line.productCode) ?? { units: 0, pending: 0 };
      acc.units += e.assignedQty;
      acc.pending += e.pendingQty;
      committed.set(ref.line.productCode, acc);
    }

    const rows = [...productInfo.entries()]
      .map(([code, e]) => {
        const kpu = e.kgPerUnit ?? 0;
        const c = committed.get(code) ?? { units: 0, pending: 0 };
        // Existencia libre = existencia − comprometido. Con ella se cubre lo
        // que todavía no se ha marcado.
        const freeStock = Math.max(0, e.units - c.units);
        const unmarkedDemand = Math.max(0, e.demandUnits - c.pending);
        const available = Math.min(freeStock, unmarkedDemand);
        // Faltante = solicitado que no está comprometido ni se puede cubrir.
        const missing = Math.max(0, e.demandUnits - c.units - available);
        return {
          code,
          description: e.description,
          committedKg: Math.round(c.units * kpu),
          availableKg: Math.round(available * kpu),
          missingKg: Math.round(missing * kpu),
        };
      })
      .filter((r) => r.committedKg + r.availableKg + r.missingKg > 0)
      .sort((a, b) => b.committedKg + b.availableKg + b.missingKg - (a.committedKg + a.availableKg + a.missingKg))
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
        { name: 'Comprometido', type: 'bar', stack: 't', data: rows.map((r) => r.committedKg), color: C.navy, barMaxWidth: 10, itemStyle: { borderRadius: [3, 0, 0, 3] } },
        { name: 'Despachable', type: 'bar', stack: 't', data: rows.map((r) => r.availableKg), color: '#6f93b8', barMaxWidth: 10 },
        { name: 'Faltante', type: 'bar', stack: 't', data: rows.map((r) => r.missingKg), color: C.red, barMaxWidth: 10, itemStyle: { borderRadius: [0, 3, 3, 0] } },
      ],
    };
  }, [productInfo, queue, lineByKey]);

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
  // El % acompaña a los kg de las tarjetas (mismo universo global).
  const totalDemandKg = liveSummary.assignedKg + liveSummary.missingKg;
  const coveragePct = totalDemandKg > 0 ? Math.round((liveSummary.assignedKg / totalDemandKg) * 100) : 100;

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

  // Renglones seleccionables de un grupo: en «Solo despachable», únicamente los
  // que tienen existencia para despachar (completo o parcial). En «Solicitado
  // total» no se restringe: esa simulación sobregira el stock a propósito.
  function dispatchableKeys(group: OrderGroup): string[] {
    return group.lines.map(lineKey).filter((k) => mode === 'total' || (queueByKey.get(k)?.dispatchable ?? false));
  }

  function toggleLine(line: OrderGroupLine) {
    const key = lineKey(line);
    setSelection((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleGroup(group: OrderGroup) {
    // Solo se marca o se suelta lo despachable. Cambiar de modo NO reinicia la
    // selección: lo ya marcado se queda como está.
    const keys = dispatchableKeys(group);
    if (keys.length === 0) return;
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

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Simulador de despacho"
          icon={ShoppingCart}
          title="Pedidos"
          subtitle="Simula qué puedes despachar hoy con tu existencia real. Marca renglones para armar el plan de despacho; se ordena por prioridad y nunca escribe en Profit."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Despachable" value={fmtQty(liveSummary.assignedKg, 0)} suffix="kg" tone="primary" hint={`${coveragePct}% del solicitado`} />
              <Kpi label="Faltante" value={fmtQty(liveSummary.missingKg, 0)} suffix="kg" tone="danger" />
              <Kpi label="Pendiente" value={fmtQty(liveSummary.pendingQty, 0)} suffix="unid." tone="muted" />
            </div>
          }
        />

        {/* Panel de decisión: modo + orden + gráficas */}
        <Card className="p-space-md">
          <div className="flex flex-col gap-space-md xl:flex-row xl:items-start xl:justify-between">
            <div className="flex flex-col gap-space-md">
              <div>
                <span className="font-semibold uppercase text-label-sm text-outline">Modo de simulación</span>
                <div className="mt-space-xs flex flex-wrap items-center gap-space-sm">
                  <Segmented ariaLabel="Modo de simulación" value={mode} onChange={setMode} options={MODE_OPTIONS} />
                  <span className="text-label-sm text-on-surface-variant">
                    {mode === 'disponible' ? 'Asigna solo lo que hay; el resto queda como faltante.' : 'Descuenta todo lo pedido (puede sobregirar).'}
                  </span>
                </div>
              </div>
              <div>
                <span className="font-semibold uppercase text-label-sm text-outline">Agrupar y ordenar</span>
                <div className="mt-space-xs flex flex-wrap items-center gap-space-sm">
                  <Select className="w-40" ariaLabel="Agrupar por" value={by} onChange={(v) => { setBy(v as OrderGroupBy); setExpanded(null); }} options={BY_OPTIONS} />
                  <Select className="w-64" ariaLabel="Orden" value={sort} onChange={(v) => setSort(v as DispatchSort)} options={SORT_OPTIONS} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:w-[58%]">
              <div className="rounded-lg bg-surface p-space-sm">
                <div className="mb-space-xs font-semibold uppercase text-label-sm text-outline">Cobertura por producto (kg) · en vivo</div>
                <EChart option={coverageChart} height={220} ariaLabel="Cobertura por producto en kilogramos" />
              </div>
              <div className="rounded-lg bg-surface p-space-sm">
                <div className="mb-space-xs font-semibold uppercase text-label-sm text-outline">Cobertura global (kg)</div>
                <EChart option={donutChart} height={220} ariaLabel="Cobertura global en kilogramos" />
              </div>
            </div>
          </div>
        </Card>

        {/* Filtros */}
        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-12">
            <TextInput className="lg:col-span-3" icon={Search} value={q} onChange={setQ} placeholder="Buscar N° de pedido o cliente…" ariaLabel="Buscar" />
            <Select className="lg:col-span-2" value={status} onChange={(v) => setStatus(v as OrderStatus | '')} options={STATUS_OPTIONS} ariaLabel="Estado" />
            <Select className="lg:col-span-2" value={authorized} onChange={setAuthorized} options={AUTH_OPTIONS} ariaLabel="Autorizado" />
            <TextInput className="lg:col-span-2" value={customerType} onChange={setCustomerType} placeholder="Tipo (ej. L1)" ariaLabel="Tipo de cliente" />
            <TextInput className="lg:col-span-3" value={vendor} onChange={setVendor} placeholder="Vendedor…" ariaLabel="Vendedor" />
            <div className="flex items-center gap-space-xs lg:col-span-4">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Entrega</span>
              <DateInput ariaLabel="Entrega desde" value={entregaDesde} onChange={setEntregaDesde} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Entrega hasta" value={entregaHasta} onChange={setEntregaHasta} className="w-full" />
            </div>
            <div className="flex items-center gap-space-xs lg:col-span-4">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Emisión</span>
              <DateInput ariaLabel="Emisión desde" value={emisionDesde} onChange={setEmisionDesde} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Emisión hasta" value={emisionHasta} onChange={setEmisionHasta} className="w-full" />
            </div>
            <div className="flex items-center lg:col-span-4">
              <button
                onClick={resetFilters}
                disabled={!hasFilters}
                className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                Limpiar filtros
              </button>
            </div>
          </div>
          {customerCode && (
            <p className="mt-space-sm text-body-md text-on-surface-variant">
              Filtrando por cliente <strong className="text-primary">{customerCode}</strong>
            </p>
          )}
        </Card>

        {/* Plan de despacho (agrupado como la tabla; solo si hay selección) */}
        {planEntries.length > 0 && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container bg-surface-container-low px-space-md py-space-sm">
              <div className="flex flex-wrap items-center gap-space-md">
                <span className="font-bold uppercase text-label-md text-primary">Plan de despacho · {mode === 'disponible' ? 'solo despachable' : 'solicitado total'}</span>
                <span className="text-label-sm text-on-surface-variant">
                  {planEntries.length} renglón(es) · turnos por entrega
                </span>
              </div>
              <div className="flex items-center gap-space-sm">
                <span className="tabular-nums font-bold text-secondary">{fmtQty(planSummary.assignedKg, 0)} kg asignados</span>
                <span className={`tabular-nums font-bold ${planSummary.missingKg > 0 ? 'text-error' : 'text-outline'}`}>
                  {fmtQty(planSummary.missingKg, 0)} kg faltantes
                </span>
                <button onClick={exportPlan} className="flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary transition-colors hover:bg-primary">
                  <Download aria-hidden className="size-4" /> Exportar
                </button>
                <button
                  onClick={() => {
                    setSelection([]);
                    setPlanExpanded(null);
                  }}
                  className="flex h-9 items-center gap-space-xs rounded-lg border border-outline-variant px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  <Trash2 aria-hidden className="size-4" /> Limpiar
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-surface-container bg-surface-container">
                    <Th className="w-8" />
                    <Th>{by === 'producto' ? 'Producto' : 'Cliente'}</Th>
                    <Th align="right">Renglones</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="right">Asignado</Th>
                    <Th align="right">Faltante kg</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {planGroups.map((g) => {
                    const open = planExpanded === g.key;
                    return (
                      <Fragment key={g.key}>
                        <tr className="transition-colors hover:bg-surface-container-low">
                          <Td />
                          <Td>
                            <button onClick={() => setPlanExpanded(open ? null : g.key)} className="flex items-start gap-space-sm text-left">
                              {open ? (
                                <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                              ) : (
                                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />
                              )}
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate font-semibold text-on-surface">{g.label}</span>
                                {g.code && <span className="text-label-sm tabular-nums text-outline">{g.code}</span>}
                              </span>
                            </button>
                          </Td>
                          <Td align="right" className="tabular-nums">{g.entries.length}</Td>
                          <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(g.pendingQty, 0)}</Td>
                          <Td align="right" className="tabular-nums font-bold text-secondary">{fmtQty(g.assignedQty, 0)}</Td>
                          <Td align="right" className={`tabular-nums font-bold ${g.missingKg > 0 ? 'text-error' : 'text-outline'}`}>{fmtQty(g.missingKg, 0)}</Td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={6} className="bg-surface-container-low px-space-md py-space-sm">
                              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest">
                                <table className="w-full border-collapse text-label-md">
                                  <thead>
                                    <tr className="border-b border-surface-container">
                                      <Th align="right" className="w-14">Turno</Th>
                                      <Th>Pedido</Th>
                                      <Th>{by === 'producto' ? 'Cliente' : 'Artículo'}</Th>
                                      <Th align="right">Pend.</Th>
                                      <Th align="right">Asignado</Th>
                                      <Th align="right">Faltante</Th>
                                      <Th />
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-surface-container">
                                    {g.entries.map((e) => {
                                      const ref = lineByKey.get(e.key);
                                      if (!ref) return null;
                                      return (
                                        <tr key={e.key} className="transition-colors hover:bg-surface-container-low">
                                          <Td align="right" className="tabular-nums font-bold text-primary">{e.priority}</Td>
                                          <Td className="tabular-nums text-on-surface-variant">{ref.line.orderNumber}</Td>
                                          <Td>
                                            {by === 'producto' ? (
                                              <span className="block max-w-[18rem] truncate">{ref.line.customerName ?? '—'}</span>
                                            ) : (
                                              <span className="block max-w-[22rem] truncate" title={ref.line.description ?? ''}>
                                                <span className="font-bold text-primary">{ref.line.productCode}</span>
                                                <span className="text-on-surface-variant"> · {ref.line.description ?? '—'}</span>
                                              </span>
                                            )}
                                          </Td>
                                          <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(e.pendingQty, 0)}</Td>
                                          <Td align="right" className="tabular-nums font-bold text-secondary">{fmtQty(e.assignedQty, 0)}</Td>
                                          <Td align="right" className={`tabular-nums ${e.missingQty > 0 ? 'font-bold text-error' : 'text-outline'}`}>{fmtQty(e.missingQty, 0)}</Td>
                                          <Td align="right">
                                            <button onClick={() => toggleLine(ref.line)} className="font-semibold text-primary-container hover:underline">
                                              Liberar
                                            </button>
                                          </Td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando pedidos…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-surface-container bg-surface-container">
                    <Th className="w-8" />
                    <Th>{by === 'producto' ? 'Producto' : 'Cliente'}</Th>
                    <Th>Cobertura</Th>
                    <Th align="right">{by === 'producto' ? 'Clientes' : 'Productos'}</Th>
                    <Th align="right">Pedidos</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="right">Pendiente kg</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {orderedGroups.length === 0 && (
                    <tr>
                      <Td align="center" className="py-space-xl text-on-surface-variant">
                        {hasFilters ? 'Sin pedidos para los filtros aplicados.' : 'No hay pedidos sincronizados.'}
                      </Td>
                    </tr>
                  )}
                  {orderedGroups.map((group) => {
                    const candidates = dispatchableKeys(group);
                    const allSelected = candidates.length > 0 && candidates.every((k) => selection.includes(k));
                    const pendingQty = group.lines.reduce((a, l) => a + l.pendingQty, 0);
                    const assignedQty = group.lines.reduce((a, l) => a + (queueByKey.get(lineKey(l))?.assignedQty ?? 0), 0);
                    const coverage = pendingQty > 0 ? assignedQty / pendingQty : 1;
                    const earliest = group.lines.reduce((min, l) => Math.min(min, timeOf(l.requestedDate)), Number.POSITIVE_INFINITY);
                    const isOpen = expanded === group.key;
                    return (
                      <GroupRow
                        key={group.key}
                        group={group}
                        by={by}
                        isOpen={isOpen}
                        allSelected={allSelected}
                        selectable={candidates.length > 0}
                        selectedCount={group.lines.filter((l) => selection.includes(lineKey(l))).length}
                        coverage={coverage}
                        earliest={Number.isFinite(earliest) ? new Date(earliest).toISOString() : null}
                        selection={selection}
                        mode={mode}
                        queueByKey={queueByKey}
                        liveStock={liveStock}
                        onToggleGroup={() => toggleGroup(group)}
                        onToggleLine={toggleLine}
                        onToggleOpen={() => setExpanded(isOpen ? null : group.key)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
              <span>
                {orderedGroups.length} grupo{orderedGroups.length === 1 ? '' : 's'} · pendiente {fmtQty(liveSummary.pendingQty, 0)} unid. / {fmtQty(liveSummary.pendingKg, 0)} kg
              </span>
              <span>«Asignado» y «faltante» reflejan tu existencia actual · {queue.length} renglones</span>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

// ---------- Fila de grupo + panel desplegable ----------
function GroupRow({
  group,
  by,
  isOpen,
  allSelected,
  selectable,
  selectedCount,
  coverage,
  earliest,
  selection,
  mode,
  queueByKey,
  liveStock,
  onToggleGroup,
  onToggleLine,
  onToggleOpen,
}: {
  group: OrderGroup;
  by: OrderGroupBy;
  isOpen: boolean;
  allSelected: boolean;
  /** Hay al menos un renglón despachable (y el modo lo permite). */
  selectable: boolean;
  selectedCount: number;
  coverage: number;
  earliest: string | null;
  selection: string[];
  mode: DispatchMode;
  queueByKey: Map<string, QueueEntry>;
  /** Existencia viva por producto (ya descontado lo marcado). */
  liveStock: Map<string, number>;
  onToggleGroup: () => void;
  onToggleLine: (line: OrderGroupLine) => void;
  onToggleOpen: () => void;
}) {
  const coveragePct = Math.round(coverage * 100);
  const tone = coveragePct >= 100 ? 'success' : coveragePct > 0 ? 'warning' : 'danger';
  return (
    <>
      <tr className={`transition-colors ${selectedCount > 0 ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low'}`}>
        <Td>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!selectable}
            onChange={onToggleGroup}
            aria-label={selectable ? 'Seleccionar los renglones con existencia' : 'Sin existencia para despachar en este grupo'}
            title={selectable ? undefined : 'No hay existencia para despachar en este grupo'}
            className="size-4 accent-[var(--color-primary-container)] disabled:cursor-not-allowed"
          />
        </Td>
        <Td>
          <button onClick={onToggleOpen} className="flex items-start gap-space-sm text-left">
            {isOpen ? <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" /> : <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />}
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-space-xs">
                <span className="truncate font-semibold text-on-surface">{group.label}</span>
                {selectedCount > 0 && (
                  <span
                    className="shrink-0 rounded bg-primary-container px-space-xs text-label-sm font-bold text-on-primary"
                    title="Renglones marcados para despacho en este grupo"
                  >
                    {selectedCount}
                  </span>
                )}
              </span>
              <span className="text-label-sm tabular-nums text-outline">
                {group.code ?? ''}
                {earliest ? ` · entrega ${fmtDate(earliest)}` : ''}
                {!selectable && <span className="ml-space-xs font-bold uppercase text-critical">sin existencia</span>}
              </span>
            </span>
          </button>
        </Td>
        <Td>
          <div className="flex min-w-[7rem] items-center gap-space-sm">
            <CoverageBar ratio={coverage} className="w-16" />
            <Badge tone={tone}>{coveragePct}%</Badge>
          </div>
        </Td>
        <Td align="right" className="tabular-nums">{group.itemsCount}</Td>
        <Td align="right" className="tabular-nums">{group.ordersCount}</Td>
        <Td align="right" className={`tabular-nums font-bold ${group.totalPendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>{fmtQty(group.totalPendingQty, 0)}</Td>
        <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(group.totalPendingKg, 0)}</Td>
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={7} className="bg-surface-container-low px-space-md py-space-sm">
            <div className="overflow-x-auto rounded-lg bg-surface-container-lowest">
              <table className="w-full border-collapse text-label-md">
                <thead>
                  <tr className="border-b border-surface-container">
                    <Th className="w-8" />
                    <Th>Pedido</Th>
                    <Th>{by === 'producto' ? 'Cliente' : 'Entrega'}</Th>
                    {by === 'cliente' && <Th>Artículo</Th>}
                    <Th align="right">Pend.</Th>
                    <Th align="right">Kg</Th>
                    <Th>Alm.</Th>
                    <Th align="right">Stock</Th>
                    <Th align="right">Asignado</Th>
                    <Th align="right">Faltante</Th>
                    <Th align="center">Aut.</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {[...group.lines]
                    .sort((a, b) => (queueByKey.get(lineKey(a))?.sortIndex ?? 0) - (queueByKey.get(lineKey(b))?.sortIndex ?? 0))
                    .map((line) => {
                    const key = lineKey(line);
                    const selected = selection.includes(key);
                    const r = queueByKey.get(key);
                    const dispatchable = r?.dispatchable ?? false;
                    const blocked = mode === 'disponible' && !selected && !dispatchable;
                    return (
                      <tr key={key} className={`transition-colors ${selected ? 'bg-success-container' : blocked ? 'opacity-55' : 'hover:bg-surface-container-low'}`}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={blocked}
                            onChange={() => onToggleLine(line)}
                            aria-label="Seleccionar renglón para despacho"
                            title={blocked ? 'Sin existencia para despachar' : undefined}
                            className="size-4 accent-[var(--color-primary-container)] disabled:cursor-not-allowed"
                          />
                        </Td>
                        <Td className="font-bold tabular-nums text-primary">{line.orderNumber}</Td>
                        <Td className="tabular-nums text-on-surface-variant">
                          {by === 'producto' ? <span className="block max-w-[16rem] truncate">{line.customerName ?? '—'}</span> : fmtDate(line.requestedDate)}
                        </Td>
                        {by === 'cliente' && (
                          <Td>
                            <span className="block max-w-[22rem] truncate" title={line.description ?? ''}>
                              <span className="font-bold text-primary">{line.productCode}</span>
                              <span className="text-on-surface-variant"> · {line.description ?? '—'}</span>
                            </span>
                          </Td>
                        )}
                        <Td align="right" className="tabular-nums font-bold">
                          {selected && (r?.assignedQty ?? 0) < line.pendingQty ? (
                            <>
                              <span className="text-outline line-through">{fmtQty(line.pendingQty, 0)}</span>{' '}
                              <span className="text-secondary">{fmtQty(r?.assignedQty ?? 0, 0)}</span>
                            </>
                          ) : (
                            <span className={line.pendingQty < 0 ? 'text-error' : 'text-on-surface'}>{fmtQty(line.pendingQty, 0)}</span>
                          )}
                        </Td>
                        <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.pendingKg, 0)}</Td>
                        <Td className="tabular-nums text-on-surface-variant">{line.warehouseCode ?? '—'}</Td>
                        <Td align="right" className="tabular-nums">
                          {fmtQty((line.stock03 ?? 0) + (line.stock68 ?? 0), 0)}
                          <span className="ml-space-xs text-label-sm text-outline">({fmtQty(line.stock03, 0)}/{fmtQty(line.stock68, 0)})</span>
                          {(() => {
                            const total = (line.stock03 ?? 0) + (line.stock68 ?? 0);
                            const live = liveStock.get(line.productCode);
                            if (live === undefined || live === total) return null;
                            return <span className="ml-space-xs text-label-sm font-semibold text-primary">· quedan {fmtQty(live, 0)}</span>;
                          })()}
                          {blocked && <span className="ml-space-xs font-bold uppercase text-label-sm text-critical">sin existencia</span>}
                        </Td>
                        <Td align="right" className="tabular-nums font-bold text-secondary">{fmtQty(r?.assignedQty ?? 0, 0)}</Td>
                        <Td align="right" className={`tabular-nums ${(r?.missingQty ?? 0) > 0 ? 'font-bold text-error' : 'text-outline'}`}>{fmtQty(r?.missingQty ?? 0, 0)}</Td>
                        <Td align="center">
                          {line.authorized === null ? <span className="text-outline">—</span> : <Badge tone={line.authorized ? 'success' : 'muted'}>{line.authorized ? 'SÍ' : 'NO'}</Badge>}
                        </Td>
                        <Td align="right">
                          <Link href={`/pedidos/${line.orderId}`} className="font-semibold text-primary-container hover:underline">Ver</Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

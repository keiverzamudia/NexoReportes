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

import type { OrderDetail, OrderGroup, OrderGroupBy, OrderGroupLine, OrderGroupedResponse, OrderStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileText, PackageCheck, Pin, PinOff, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { EChart } from '../../components/EChart';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, CoverageBar, DateInput, HeroCard, Kpi, PageHeader, Select, Segmented, Skeleton, Td, TextInput, Th, fmtDate, fmtQty, useGreeting } from '../../components/ui';
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

const STATUS_TONE: Record<OrderStatus, 'success' | 'muted' | 'danger' | 'default'> = {
  ABIERTO: 'success',
  CERRADO: 'muted',
  CANCELADO: 'danger',
  DESCONOCIDO: 'default',
};

// Paleta de las gráficas (identidad Nexo + acento del rediseño).
const C = {
  navy: '#003366',
  lime: '#7cae00',
  accent: '#ff7a5c',
  outline: '#737780',
  grid: '#e6eff9',
  ink: '#081d2c',
};

const CHART_TOOLTIP = {
  backgroundColor: '#001a33',
  borderWidth: 0,
  padding: [8, 12] as [number, number],
  textStyle: { color: '#ffffff', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 16px 40px -20px rgba(0,30,64,.6);',
};

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
  const greeting = useGreeting();
  const [by, setBy] = useState<OrderGroupBy>('cliente');
  const [mode, setMode] = useState<DispatchMode>('disponible');
  const [sort, setSort] = useState<DispatchSort>('prioridad');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [planExpanded, setPlanExpanded] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // El plan de despacho puede quedar fijo arriba o desplazarse con la página.
  const [planPinned, setPlanPinned] = useState(true);
  // Detalle de pedido en modal: la fila no abandona el simulador.
  const [selectedOrder, setSelectedOrder] = useState<{ id: string; number: string } | null>(null);
  const closeOrderRef = useRef<HTMLButtonElement>(null);

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

  // Modal de detalle: Escape, bloqueo del scroll de fondo y foco inicial.
  useEffect(() => {
    if (!selectedOrder) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedOrder(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeOrderRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedOrder]);

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

  // Detalle del pedido abierto en el modal (misma fuente que /pedidos/[id]).
  const {
    data: orderDetail,
    isLoading: orderLoading,
    error: orderError,
  } = useQuery<OrderDetail>({
    queryKey: ['order', selectedOrder?.id, tick],
    queryFn: () => apiFetch<OrderDetail>(`/orders/${selectedOrder!.id}`),
    enabled: Boolean(selectedOrder?.id),
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
        ...CHART_TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,51,102,0.06)' } },
        valueFormatter: (v: number) => `${fmtQty(v, 0)} kg`,
      },
      legend: { bottom: 2, icon: 'roundRect', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: C.outline, fontSize: 11 } },
      xAxis: {
        type: 'value',
        axisLabel: { color: C.outline, fontSize: 10, formatter: (v: number) => compactKg(v) },
        splitLine: { lineStyle: { color: C.grid, type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.code),
        axisLabel: { color: C.ink, fontSize: 11, fontFamily: 'monospace' },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        { name: 'Comprometido', type: 'bar', stack: 't', data: rows.map((r) => r.committedKg), color: C.navy, barMaxWidth: 11, itemStyle: { borderRadius: [4, 0, 0, 4] } },
        { name: 'Despachable', type: 'bar', stack: 't', data: rows.map((r) => r.availableKg), color: C.lime, barMaxWidth: 11 },
        { name: 'Faltante', type: 'bar', stack: 't', data: rows.map((r) => r.missingKg), color: C.accent, barMaxWidth: 11, itemStyle: { borderRadius: [0, 4, 4, 0] } },
      ],
    };
  }, [productInfo, queue, lineByKey]);

  const donutChart = useMemo(() => {
    const covered = Math.round(liveSummary.assignedKg);
    const missing = Math.round(liveSummary.missingKg);
    const total = covered + missing;
    const coveredPct = total > 0 ? Math.round((covered / total) * 100) : 100;
    return {
      title: {
        text: `${coveredPct}%`,
        subtext: 'cobertura',
        left: 'center',
        top: '33%',
        textStyle: { fontSize: 24, fontWeight: 800, color: C.navy },
        subtextStyle: { fontSize: 10, color: C.outline, fontWeight: 600 },
      },
      tooltip: { ...CHART_TOOLTIP, trigger: 'item', valueFormatter: (v: number) => `${fmtQty(v, 0)} kg` },
      legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: C.outline, fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['64%', '86%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#ffffff', borderWidth: 3, borderRadius: 6 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: [
            { name: 'Despachable', value: covered, itemStyle: { color: C.navy } },
            { name: 'Faltante', value: missing, itemStyle: { color: C.accent } },
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

  async function exportPlan() {
    // Generación bajo demanda: xlsx solo se carga al pulsar «Exportar».
    const XLSX = await import('xlsx');

    type ClientPlan = {
      code: string | null;
      name: string;
      entries: { entry: QueueEntry; line: OrderGroupLine }[];
    };

    const byClient = new Map<string, ClientPlan>();
    for (const entry of planEntries) {
      const ref = lineByKey.get(entry.key);
      if (!ref) continue;
      const key = ref.line.customerCode ?? ref.line.customerName ?? ref.group.key;
      let client = byClient.get(key);
      if (!client) {
        client = { code: ref.line.customerCode, name: ref.line.customerName ?? ref.group.label, entries: [] };
        byClient.set(key, client);
      }
      client.entries.push({ entry, line: ref.line });
    }
    if (byClient.size === 0) return;

    const clients = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const TABLE_HEADERS = [
      'Turno',
      'Pedido',
      'Código artículo',
      'Artículo',
      'Pendiente (unid.)',
      'Asignado (unid.)',
      'Faltante (unid.)',
      'Kg pendiente',
      'Kg asignado',
      'Kg faltante',
      'Almacén',
      'Entrega',
      'Autorizado',
    ];
    const COLUMN_WIDTHS = [7, 10, 16, 46, 14, 14, 13, 12, 12, 12, 9, 11, 11];

    // Una sola hoja: un bloque por cliente (encabezado + detalle).
    const aoa: (string | number)[][] = [];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    const lastColumn = TABLE_HEADERS.length - 1;

    aoa.push(['PLAN DE DESPACHO POR CLIENTE']);
    aoa.push([
      `Generado ${new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())} · solo renglones seleccionados en el plan`,
    ]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } });
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } });
    aoa.push([]);

    for (const client of clients) {
      const pendingQty = client.entries.reduce((sum, item) => sum + item.entry.pendingQty, 0);
      const assignedQty = client.entries.reduce((sum, item) => sum + item.entry.assignedQty, 0);
      const pendingKg = client.entries.reduce((sum, item) => sum + (item.entry.pendingKg ?? 0), 0);
      const missingKg = client.entries.reduce((sum, item) => sum + item.entry.missingKg, 0);

      const headerRow = aoa.length;
      aoa.push([
        `CLIENTE: ${client.name}${client.code ? ` · ${client.code}` : ''} · ${client.entries.length} renglón(es) · ${fmtQty(pendingQty, 0)} pend. · ${fmtQty(assignedQty, 0)} asignado · ${fmtQty(pendingKg, 0)} kg · ${fmtQty(missingKg, 0)} kg faltante`,
      ]);
      merges.push({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: lastColumn } });
      aoa.push(TABLE_HEADERS);

      for (const { entry, line } of [...client.entries].sort((a, b) => a.entry.priority - b.entry.priority)) {
        aoa.push([
          entry.priority,
          line.orderNumber,
          line.productCode,
          line.description ?? '—',
          entry.pendingQty,
          entry.assignedQty,
          entry.missingQty,
          Math.round(entry.pendingKg ?? 0),
          Math.round(entry.assignedKg),
          Math.round(entry.missingKg),
          line.warehouseCode ?? '—',
          fmtDate(line.requestedDate),
          line.authorized === null ? '—' : line.authorized ? 'SÍ' : 'NO',
        ]);
      }

      aoa.push([]);
    }

    const totalPendingKg = planEntries.reduce((sum, entry) => sum + (entry.pendingKg ?? 0), 0);
    const totalAssignedKg = planEntries.reduce((sum, entry) => sum + entry.assignedKg, 0);
    const totalMissingKg = planEntries.reduce((sum, entry) => sum + entry.missingKg, 0);
    const totalRow = aoa.length;
    aoa.push([
      `TOTAL GENERAL · ${clients.length} cliente(s) · ${planEntries.length} renglón(es) · ${fmtQty(totalPendingKg, 0)} kg pendientes · ${fmtQty(totalAssignedKg, 0)} kg asignados · ${fmtQty(totalMissingKg, 0)} kg faltantes`,
    ]);
    merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: lastColumn } });

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));
    sheet['!merges'] = merges;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Plan por cliente');
    XLSX.writeFile(workbook, 'plan-despacho-por-cliente.xlsx', { compression: true });
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Simulador de despacho"
          icon={ShoppingCart}
          greeting={greeting}
          title="Pedidos"
          subtitle="Simula qué puedes despachar hoy con tu existencia real. Marca renglones para armar el plan de despacho; se ordena por prioridad y nunca escribe en Profit."
        />

        {/* Centro de decisión: hero + controles + gráficas */}
        <section className="grid gap-space-md xl:grid-cols-12">
          <div className="flex flex-col gap-space-md xl:col-span-4">
            <HeroCard
              label="Despachable hoy"
              value={fmtQty(liveSummary.assignedKg, 0)}
              suffix="kg"
              hint={`${coveragePct}% de la demanda · ${fmtQty(liveSummary.missingKg, 0)} kg faltantes`}
              progress={coveragePct}
              icon={PackageCheck}
            />

            <div className="stagger grid grid-cols-2 gap-space-sm">
              <Kpi label="Faltante" value={fmtQty(liveSummary.missingKg, 0)} suffix="kg" tone="danger" />
              <Kpi label="Pendiente" value={fmtQty(liveSummary.pendingQty, 0)} suffix="unid." tone="muted" />
            </div>

            <Card className="p-space-md">
              <div className="flex flex-col gap-space-sm">
                <div>
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Modo de simulación</span>
                  <div className="mt-space-xs flex flex-wrap items-center gap-space-sm">
                    <Segmented ariaLabel="Modo de simulación" value={mode} onChange={setMode} options={MODE_OPTIONS} />
                  </div>
                  <p className="mt-space-xs text-body-sm text-on-surface-variant">
                    {mode === 'disponible' ? 'Asigna solo lo que hay; el resto queda como faltante.' : 'Descuenta todo lo pedido (puede sobregirar).'}
                  </p>
                </div>
                <div className="h-px bg-outline-variant/25" />
                <div>
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Agrupar y ordenar</span>
                  <div className="mt-space-xs flex flex-wrap items-center gap-space-sm">
                    <Select className="w-40" ariaLabel="Agrupar por" value={by} onChange={(v) => { setBy(v as OrderGroupBy); setExpanded(null); }} options={BY_OPTIONS} />
                    <Select className="w-full sm:w-64" ariaLabel="Orden" value={sort} onChange={(v) => setSort(v as DispatchSort)} options={SORT_OPTIONS} />
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-space-md xl:col-span-8">
            <div className="mb-space-sm flex flex-wrap items-start justify-between gap-space-sm">
              <div>
                <p className="text-title-md font-semibold text-primary">Cobertura en vivo</p>
                <p className="text-label-sm text-on-surface-variant">Lo marcado se compromete y descuenta existencia; el resto pasa a faltante.</p>
              </div>
              <Badge tone={coveragePct >= 100 ? 'success' : coveragePct > 0 ? 'warning' : 'danger'} dot>
                {coveragePct}% global
              </Badge>
            </div>
            <div className="grid gap-space-md sm:grid-cols-2">
              <div className="rounded-xl bg-surface/80 p-space-sm">
                <div className="mb-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">Cobertura por producto (kg)</div>
                <EChart option={coverageChart} height={220} ariaLabel="Cobertura por producto en kilogramos" />
              </div>
              <div className="rounded-xl bg-surface/80 p-space-sm">
                <div className="mb-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">Cobertura global (kg)</div>
                <EChart option={donutChart} height={220} ariaLabel="Cobertura global en kilogramos" />
              </div>
            </div>
          </Card>
        </section>

        {/* Filtros */}
        <Card className="p-space-md">
          <div className="mb-space-sm flex flex-wrap items-start justify-between gap-space-sm">
            <div>
              <p className="text-title-md font-semibold text-primary">Filtros</p>
              <p className="text-label-sm text-on-surface-variant">Acota la cartera; los KPIs y las gráficas se recalculan en vivo.</p>
            </div>
            <Badge tone={hasFilters ? 'primary' : 'muted'} dot>
              {hasFilters ? 'filtros activos' : 'sin filtros'}
            </Badge>
          </div>
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
                className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
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
          <Card className={`overflow-hidden ${planPinned ? 'xl:sticky xl:top-[86px] xl:z-20' : ''}`}>
            <div aria-hidden className="h-1 w-full bg-secondary-container" />
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
              <div className="flex flex-wrap items-center gap-space-md">
                <span className="font-bold uppercase tracking-wider text-label-md text-primary">Plan de despacho · {mode === 'disponible' ? 'solo despachable' : 'solicitado total'}</span>
                <span className="text-label-sm text-on-surface-variant">
                  {planEntries.length} renglón(es) · turnos por entrega
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-space-sm">
                <span className="tabular-nums font-bold text-secondary">{fmtQty(planSummary.assignedKg, 0)} kg asignados</span>
                <span className={`tabular-nums font-bold ${planSummary.missingKg > 0 ? 'text-error' : 'text-outline'}`}>
                  {fmtQty(planSummary.missingKg, 0)} kg faltantes
                </span>
                <button
                  type="button"
                  onClick={() => setPlanPinned((pinned) => !pinned)}
                  aria-pressed={planPinned}
                  title={planPinned ? 'El plan queda fijo arriba al hacer scroll' : 'El plan se desplaza con la página'}
                  className={`hidden h-9 items-center gap-space-xs rounded-pill border px-space-md font-semibold transition-colors xl:flex ${
                    planPinned
                      ? 'border-primary-container/30 bg-primary-fixed/70 text-primary hover:bg-primary-fixed'
                      : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  {planPinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
                  <span className="hidden sm:inline">{planPinned ? 'Soltar' : 'Fijar arriba'}</span>
                </button>
                <button onClick={exportPlan} title="Descargar Excel con el detalle por cliente" className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary">
                  <Download aria-hidden className="size-4" /> Exportar
                </button>
                <button
                  onClick={() => {
                    setSelection([]);
                    setPlanExpanded(null);
                  }}
                  className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-lowest"
                >
                  <Trash2 aria-hidden className="size-4" /> Limpiar
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-outline-variant/30 bg-surface-container-low/80">
                    <Th className="w-8" />
                    <Th>{by === 'producto' ? 'Producto' : 'Cliente'}</Th>
                    <Th align="right">Renglones</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="right">Asignado</Th>
                    <Th align="right">Faltante kg</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
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
                            <td colSpan={6} className="bg-surface-container-low/60 px-space-md py-space-sm">
                              <div className="overflow-x-auto rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
                                <table className="w-full border-collapse text-label-md">
                                  <thead>
                                    <tr className="border-b border-outline-variant/30">
                                      <Th align="right" className="w-14">Turno</Th>
                                      <Th>Pedido</Th>
                                      <Th>{by === 'producto' ? 'Cliente' : 'Artículo'}</Th>
                                      <Th align="right">Pend.</Th>
                                      <Th align="right">Asignado</Th>
                                      <Th align="right">Faltante</Th>
                                      <Th />
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-outline-variant/20">
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
                                            <button onClick={() => toggleLine(ref.line)} className="rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low">
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
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
              <div>
                <p className="text-title-md font-semibold text-primary">{by === 'producto' ? 'Productos en cartera' : 'Clientes en cartera'}</p>
                <p className="text-label-sm text-on-surface-variant">Priorizados por entrega y existencia · expande un grupo para marcar renglones.</p>
              </div>
              <Badge tone="muted" dot>
                {orderedGroups.length} grupo{orderedGroups.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-outline-variant/30 bg-surface-container-low/80">
                    <Th className="w-8" />
                    <Th>{by === 'producto' ? 'Producto' : 'Cliente'}</Th>
                    <Th>Cobertura</Th>
                    <Th align="right">{by === 'producto' ? 'Clientes' : 'Productos'}</Th>
                    <Th align="right">Pedidos</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="right">Pendiente kg</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20">
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
                        onOpenOrder={(id, number) => setSelectedOrder({ id, number })}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 px-space-md py-space-sm text-label-sm text-on-surface-variant">
              <span>
                {orderedGroups.length} grupo{orderedGroups.length === 1 ? '' : 's'} · pendiente {fmtQty(liveSummary.pendingQty, 0)} unid. / {fmtQty(liveSummary.pendingKg, 0)} kg
              </span>
              <span>«Asignado» y «faltante» reflejan tu existencia actual · {queue.length} renglones</span>
            </div>
          </Card>
        )}
      </main>

      {selectedOrder && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedOrder(null);
          }}
          className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-modal-title"
            className="animate-rise relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
          >
            <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

            <header className="flex shrink-0 flex-wrap items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
              <div className="flex min-w-0 items-start gap-space-sm">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
                  <FileText aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                    Ventas y CxC · Solicitud {orderDetail?.order.externalNumber ?? selectedOrder.number}
                  </p>
                  <h2 id="order-modal-title" className="truncate text-headline-md text-primary">
                    Pedido {orderDetail?.order.externalNumber ?? selectedOrder.number}
                  </h2>
                  <p className="truncate text-body-md text-on-surface-variant">
                    {orderDetail
                      ? `${orderDetail.order.customerName ?? 'Cliente desconocido'}${orderDetail.order.customerCode ? ` (${orderDetail.order.customerCode})` : ''}`
                      : 'Cargando detalle…'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-space-sm">
                {orderDetail && (
                  <Badge tone={STATUS_TONE[orderDetail.order.status]} dot>
                    {STATUS_LABEL[orderDetail.order.status]}
                  </Badge>
                )}
                <button
                  ref={closeOrderRef}
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  aria-label="Cerrar detalle del pedido"
                  className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
              {orderLoading && (
                <div className="flex flex-col gap-space-md">
                  <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-20 rounded-xl" />
                    ))}
                  </div>
                  <Skeleton className="h-6 w-56 rounded-pill" />
                  <Skeleton className="h-56 rounded-xl" />
                </div>
              )}

              {orderError && !(orderError instanceof AuthRequiredError) && (
                <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                  <AlertTriangle aria-hidden className="size-4" />{' '}
                  {orderError instanceof Error ? orderError.message : 'No se pudo consultar el pedido'}
                </p>
              )}

              {orderDetail && (
                <div className="flex flex-col gap-space-md">
                  <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
                    <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                      <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Emisión</p>
                      <p className="mt-space-2xs text-title-md font-bold text-primary">{fmtDate(orderDetail.order.orderDate)}</p>
                    </div>
                    <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                      <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Entrega comprometida</p>
                      <p className="mt-space-2xs text-title-md font-bold text-primary">{fmtDate(orderDetail.order.requestedDate)}</p>
                    </div>
                    <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                      <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Vendedor</p>
                      <p className="mt-space-2xs break-words text-title-md font-bold leading-tight text-primary">{orderDetail.order.vendor ?? '—'}</p>
                    </div>
                    <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
                      <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Tipo de cliente</p>
                      <p className="mt-space-2xs break-words text-title-md font-bold leading-tight text-primary">{orderDetail.order.customerType ?? '—'}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-space-sm">
                    <Badge tone="primary" dot>
                      {fmtQty(orderDetail.order.linesCount, 0)} renglones
                    </Badge>
                    <Badge tone={orderDetail.order.totalPendingQty < 0 ? 'danger' : 'warning'} dot>
                      {fmtQty(orderDetail.order.totalPendingQty, 0)} unidades pendientes
                    </Badge>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-outline-variant/35">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] border-collapse text-body-md">
                        <thead>
                          <tr className="border-b border-outline-variant/30 bg-surface-container-low/80">
                            <Th align="right">#</Th>
                            <Th>Código</Th>
                            <Th>Descripción</Th>
                            <Th>Unid.</Th>
                            <Th align="right">Cantidad</Th>
                            <Th align="right">Pendiente</Th>
                            <Th align="right">Kg</Th>
                            <Th>Alm.</Th>
                            <Th align="right">Stock 03</Th>
                            <Th align="right">Stock 68</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/20">
                          {orderDetail.lines.length === 0 && (
                            <tr>
                              <Td align="center" colSpan={10} className="py-space-xl text-on-surface-variant">
                                El pedido no tiene renglones sincronizados.
                              </Td>
                            </tr>
                          )}
                          {orderDetail.lines.map((line) => (
                            <tr key={line.lineNumber} className="transition-colors hover:bg-surface-container-low/70">
                              <Td align="right" className="tabular-nums text-on-surface-variant">{line.lineNumber}</Td>
                              <Td className="font-bold tabular-nums text-primary">{line.productCode}</Td>
                              <Td className="max-w-md truncate" title={line.description ?? ''}>{line.description ?? '—'}</Td>
                              <Td className="text-on-surface-variant">{line.uom ?? '—'}</Td>
                              <Td align="right" className="tabular-nums text-outline">{fmtQty(line.quantity, 0)}</Td>
                              <Td align="right" className={`tabular-nums font-bold ${line.pendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
                                {fmtQty(line.pendingQty, 2)}
                              </Td>
                              <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.pendingKg, 0)}</Td>
                              <Td className="tabular-nums text-on-surface-variant">{line.warehouseCode ?? '—'}</Td>
                              <Td align="right" className="tabular-nums">{fmtQty(line.stock03, 0)}</Td>
                              <Td align="right" className="tabular-nums">{fmtQty(line.stock68, 0)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="text-label-sm normal-case text-on-surface-variant">
                    Valores crudos de Profit (cotización + renglones). «Autorizado» = cotización con estado 1. Los pendientes
                    negativos son sobre-compromisos reales del ERP. Cualquier «—» significa que la fuente no expone el dato.
                  </p>
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm sm:px-space-lg">
              <span className="text-label-sm normal-case text-on-surface-variant">Solo lectura · datos sincronizados desde Profit</span>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="h-9 rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
              >
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      )}
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
  onOpenOrder,
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
  /** Abre el detalle del pedido en un modal, sin salir del simulador. */
  onOpenOrder: (orderId: string, orderNumber: string) => void;
}) {
  const coveragePct = Math.round(coverage * 100);
  const tone = coveragePct >= 100 ? 'success' : coveragePct > 0 ? 'warning' : 'danger';
  return (
    <>
      <tr className={`transition-colors ${selectedCount > 0 ? 'bg-secondary-container/15' : 'hover:bg-surface-container-low/70'}`}>
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
                    className="shrink-0 rounded-pill bg-primary-container px-2 py-0.5 text-label-sm font-bold text-on-primary"
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
            <CoverageBar ratio={coverage} className="w-20" />
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
          <td colSpan={7} className="bg-surface-container-low/60 px-space-md py-space-sm">
            <div className="overflow-x-auto rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
              <table className="w-full border-collapse text-label-md">
                <thead>
                  <tr className="border-b border-outline-variant/30">
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
                <tbody className="divide-y divide-outline-variant/20">
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
                          <button
                            type="button"
                            onClick={() => onOpenOrder(line.orderId, line.orderNumber)}
                            className="rounded-pill border border-outline-variant/40 px-2.5 py-1 font-semibold text-label-md text-primary-container transition-colors hover:bg-surface-container-low"
                          >
                            Ver
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
    </>
  );
}

'use client';

// ============================================================
// Pedidos (Fase 4 + reporte ampliado) — estilo Stitch.
//  - Conmutador "Por cliente" / "Por producto".
//  - Acordeón con UN solo grupo abierto a la vez.
//  - Check de PROYECCIÓN: simula vender el renglón y descuenta el stock
//    proyectado del producto (global por producto). Es SOLO visual y se
//    guarda en el navegador; NUNCA escribe en Profit (semilla de la Fase 6).
//  - Filtros: texto, estado, tipo de cliente, vendedor, autorizado y fechas.
// ============================================================

import type {
  OrderGroup,
  OrderGroupBy,
  OrderGroupLine,
  OrderGroupedResponse,
  OrderStatus,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Search, ShoppingCart, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, DateInput, Kpi, PageHeader, Select, Td, TextInput, Th, fmtDate, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

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

const STATUS_LABEL: Record<OrderStatus, string> = {
  ABIERTO: 'Abierto',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
};

// ---------- Proyección (simulación visual, solo en el navegador) ----------
const PROJ_KEY = 'nexo.proyeccion.v1';

interface ProjectionItem {
  key: string;
  orderNumber: string;
  client: string;
  productCode: string;
  productDescription: string;
  qty: number;
  kg: number;
}

type ProjectionMap = Record<string, ProjectionItem>;

function loadProjection(): ProjectionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PROJ_KEY);
    return raw ? (JSON.parse(raw) as ProjectionMap) : {};
  } catch {
    return {};
  }
}

function lineKey(line: OrderGroupLine): string {
  return `${line.orderId}#${line.productCode}`;
}

export default function PedidosPage() {
  const [tick, setTick] = useState(0);
  const [by, setBy] = useState<OrderGroupBy>('cliente');
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [projection, setProjection] = useState<ProjectionMap>({});
  const [hydrated, setHydrated] = useState(false);

  // Restaurar/persistir la proyección (recordar entre recargas).
  useEffect(() => {
    setProjection(loadProjection());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) window.localStorage.setItem(PROJ_KEY, JSON.stringify(projection));
  }, [projection, hydrated]);

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
    queryKey: [
      'orders-grouped',
      tick,
      by,
      q,
      status,
      customerType,
      vendor,
      authorized,
      customerCode,
      emisionDesde,
      emisionHasta,
      entregaDesde,
      entregaHasta,
    ],
    queryFn: () => apiFetch<OrderGroupedResponse>(`/orders/grouped?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const groups = useMemo(() => data?.groups ?? [], [data]);

  // Stock físico por producto (suma de almacenes) y consumo comprometido.
  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups) {
      for (const l of g.lines) {
        if (!map.has(l.productCode)) map.set(l.productCode, (l.stock03 ?? 0) + (l.stock68 ?? 0));
      }
    }
    return map;
  }, [groups]);

  const committedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of Object.values(projection)) {
      map.set(item.productCode, (map.get(item.productCode) ?? 0) + item.qty);
    }
    return map;
  }, [projection]);

  const committedTotals = useMemo(() => {
    let qty = 0;
    let kg = 0;
    const values = Object.values(projection);
    for (const item of values) {
      qty += item.qty;
      kg += item.kg;
    }
    return { qty, kg, count: values.length };
  }, [projection]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const hasFilters = Boolean(
    q || status || customerType || vendor || authorized || emisionDesde || emisionHasta || entregaDesde || entregaHasta || customerCode,
  );

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

  function toggleLine(line: OrderGroupLine, group: OrderGroup) {
    const key = lineKey(line);
    setProjection((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: {
          key,
          orderNumber: line.orderNumber,
          client: by === 'producto' ? (line.customerName ?? line.orderNumber) : group.label,
          productCode: line.productCode,
          productDescription: line.description ?? line.productCode,
          qty: line.pendingQty,
          kg: line.pendingKg ?? 0,
        },
      };
    });
  }

  function toggleGroup(group: OrderGroup) {
    const allCommitted = group.lines.every((l) => projection[lineKey(l)]);
    setProjection((prev) => {
      const next = { ...prev };
      for (const line of group.lines) {
        const key = lineKey(line);
        if (allCommitted) {
          delete next[key];
        } else {
          next[key] = {
            key,
            orderNumber: line.orderNumber,
            client: by === 'producto' ? (line.customerName ?? line.orderNumber) : group.label,
            productCode: line.productCode,
            productDescription: line.description ?? line.productCode,
            qty: line.pendingQty,
            kg: line.pendingKg ?? 0,
          };
        }
      }
      return next;
    });
  }

  function exportProjection() {
    const rows: string[][] = [['Producto', 'Descripcion', 'Cliente', 'Pedido', 'Cantidad', 'Kg', 'Stock total', 'Queda']];
    for (const item of Object.values(projection)) {
      const stock = stockByProduct.get(item.productCode) ?? 0;
      const committed = committedByProduct.get(item.productCode) ?? 0;
      rows.push([
        item.productCode,
        item.productDescription,
        item.client,
        item.orderNumber,
        String(item.qty),
        String(item.kg),
        String(stock),
        String(stock - committed),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'proyeccion-nexo.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Ventas y CxC · Solicitudes de clientes"
          icon={ShoppingCart}
          title="Pedidos"
          subtitle="Solicitudes con sus renglones. Cambia entre vista por cliente o por producto y usa el check para simular la venta: el stock proyectado se descuenta solo en pantalla (nunca en Profit)."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Grupos" value={String(groups.length)} icon={ShoppingCart} />
              <Kpi label="Pendiente" value={data ? fmtQty(data.totalPendingQty, 0) : '—'} suffix="unid." />
              <Kpi label="Pendiente kg" value={data ? fmtQty(data.totalPendingKg, 0) : '—'} tone="muted" />
              <Kpi
                label="Comprometido"
                value={fmtQty(committedTotals.kg, 0)}
                suffix="kg"
                tone="danger"
                hint={`${committedTotals.count} renglón(es)`}
              />
            </div>
          }
        />

        {/* Panel de filtros */}
        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-12">
            <Select
              className="lg:col-span-2"
              value={by}
              onChange={(v) => {
                setBy(v as OrderGroupBy);
                setExpanded(null);
              }}
              options={BY_OPTIONS}
              ariaLabel="Agrupar por"
            />
            <TextInput
              className="lg:col-span-4"
              icon={Search}
              value={q}
              onChange={setQ}
              placeholder="Buscar por N° de pedido o cliente…"
              ariaLabel="Buscar pedido"
            />
            <Select className="lg:col-span-2" value={status} onChange={(v) => setStatus(v as OrderStatus | '')} options={STATUS_OPTIONS} ariaLabel="Estado" />
            <Select className="lg:col-span-2" value={authorized} onChange={setAuthorized} options={AUTH_OPTIONS} ariaLabel="Autorizado" />
            <TextInput className="lg:col-span-2" value={customerType} onChange={setCustomerType} placeholder="Tipo de cliente (ej. L1)" ariaLabel="Tipo de cliente" />
            <TextInput className="lg:col-span-3" value={vendor} onChange={setVendor} placeholder="Vendedor (nombre)…" ariaLabel="Vendedor" />
            <div className="flex items-center gap-space-xs lg:col-span-3">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Entrega</span>
              <DateInput ariaLabel="Entrega desde" value={entregaDesde} onChange={setEntregaDesde} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Entrega hasta" value={entregaHasta} onChange={setEntregaHasta} className="w-full" />
            </div>
            <div className="flex items-center gap-space-xs lg:col-span-3">
              <span className="whitespace-nowrap font-semibold uppercase text-label-sm text-outline">Emisión</span>
              <DateInput ariaLabel="Emisión desde" value={emisionDesde} onChange={setEmisionDesde} className="w-full" />
              <span className="text-outline">–</span>
              <DateInput ariaLabel="Emisión hasta" value={emisionHasta} onChange={setEmisionHasta} className="w-full" />
            </div>
            <div className="flex flex-wrap items-center gap-space-sm lg:col-span-3">
              <button
                onClick={resetFilters}
                disabled={!hasFilters}
                className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                Limpiar filtros
              </button>
              <button
                onClick={exportProjection}
                disabled={committedTotals.count === 0}
                className="flex h-9 items-center gap-space-xs rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                <Download aria-hidden className="size-4" /> Exportar proyección
              </button>
              <button
                onClick={() => setProjection({})}
                disabled={committedTotals.count === 0}
                className="flex h-9 items-center gap-space-xs rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
              >
                <Trash2 aria-hidden className="size-4" /> Limpiar
              </button>
            </div>
          </div>
          {customerCode && (
            <p className="mt-space-sm text-body-md text-on-surface-variant">
              Filtrando por cliente <strong className="text-primary">{customerCode}</strong>
            </p>
          )}
        </Card>

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
                    <Th align="right">{by === 'producto' ? 'Clientes' : 'Productos'}</Th>
                    <Th align="right">Pedidos</Th>
                    <Th align="right">Renglones</Th>
                    <Th align="right">Pendiente</Th>
                    <Th align="right">Pendiente kg</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {groups.length === 0 && (
                    <tr>
                      <Td align="center" className="py-space-xl text-on-surface-variant">
                        {hasFilters ? 'Sin pedidos para los filtros aplicados.' : 'No hay pedidos sincronizados.'}
                      </Td>
                    </tr>
                  )}
                  {groups.map((group) => {
                    const isOpen = expanded === group.key;
                    const allCommitted = group.lines.every((l) => projection[lineKey(l)]);
                    return (
                      <FragmentGroup
                        key={group.key}
                        group={group}
                        by={by}
                        isOpen={isOpen}
                        allCommitted={allCommitted}
                        projection={projection}
                        stockByProduct={stockByProduct}
                        committedByProduct={committedByProduct}
                        onToggleGroup={() => toggleGroup(group)}
                        onToggleLine={(line) => toggleLine(line, group)}
                        onToggleOpen={() => setExpanded(isOpen ? null : group.key)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
              <span>
                {groups.length} grupo{groups.length === 1 ? '' : 's'} · pendiente total {fmtQty(data.totalPendingQty, 0)} unid. /{' '}
                {fmtQty(data.totalPendingKg, 0)} kg
              </span>
              <span>Proyección: {committedTotals.count} renglón(es) · se guarda en este navegador</span>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

// ---------- Fila de grupo + panel desplegable (una sola abierta) ----------
function FragmentGroup({
  group,
  by,
  isOpen,
  allCommitted,
  projection,
  stockByProduct,
  committedByProduct,
  onToggleGroup,
  onToggleLine,
  onToggleOpen,
}: {
  group: OrderGroup;
  by: OrderGroupBy;
  isOpen: boolean;
  allCommitted: boolean;
  projection: ProjectionMap;
  stockByProduct: Map<string, number>;
  committedByProduct: Map<string, number>;
  onToggleGroup: () => void;
  onToggleLine: (line: OrderGroupLine) => void;
  onToggleOpen: () => void;
}) {
  return (
    <>
      <tr className="transition-colors hover:bg-surface-container-low">
        <Td>
          <input
            type="checkbox"
            checked={allCommitted}
            onChange={onToggleGroup}
            aria-label="Seleccionar grupo completo"
            className="size-4 accent-[var(--color-primary-container)]"
          />
        </Td>
        <Td>
          <button onClick={onToggleOpen} className="flex items-center gap-space-xs text-left">
            {isOpen ? <ChevronDown aria-hidden className="size-4 text-primary" /> : <ChevronRight aria-hidden className="size-4 text-outline" />}
            <span className="flex flex-col">
              <span className="font-semibold text-on-surface">{group.label}</span>
              {group.code && <span className="text-label-sm tabular-nums text-outline">{group.code}</span>}
            </span>
          </button>
        </Td>
        <Td align="right" className="tabular-nums">{group.itemsCount}</Td>
        <Td align="right" className="tabular-nums">{group.ordersCount}</Td>
        <Td align="right" className="tabular-nums">{group.linesCount}</Td>
        <Td align="right" className={`tabular-nums font-bold ${group.totalPendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
          {fmtQty(group.totalPendingQty, 0)}
        </Td>
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
                    {by === 'cliente' && <Th>Entrega</Th>}
                    {by === 'producto' && <Th>Cliente</Th>}
                    <Th>Código</Th>
                    <Th>Descripción</Th>
                    <Th>Unid.</Th>
                    <Th align="right">Cant.</Th>
                    <Th align="right">Pend.</Th>
                    <Th align="right">Kg</Th>
                    <Th>Alm.</Th>
                    <Th align="right">Stock 03</Th>
                    <Th align="right">Stock 68</Th>
                    <Th align="right">Proyectado</Th>
                    <Th align="center">Autorizado</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {group.lines.map((line) => {
                    const key = lineKey(line);
                    const checked = Boolean(projection[key]);
                    const stock = stockByProduct.get(line.productCode) ?? 0;
                    const committed = committedByProduct.get(line.productCode) ?? 0;
                    const remaining = stock - committed;
                    return (
                      <tr key={key} className={checked ? 'bg-success-container' : undefined}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleLine(line)}
                            aria-label="Simular venta de este renglón"
                            className="size-4 accent-[var(--color-primary-container)]"
                          />
                        </Td>
                        <Td className="font-bold tabular-nums text-primary">{line.orderNumber}</Td>
                        {by === 'cliente' && <Td className="tabular-nums text-on-surface-variant">{fmtDate(line.requestedDate)}</Td>}
                        {by === 'producto' && <Td className="max-w-[16rem] truncate" title={line.customerName ?? ''}>{line.customerName ?? '—'}</Td>}
                        <Td className="font-bold tabular-nums text-primary">{line.productCode}</Td>
                        <Td className="max-w-md truncate" title={line.description ?? ''}>{line.description ?? '—'}</Td>
                        <Td className="text-on-surface-variant">{line.uom ?? '—'}</Td>
                        <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.quantity, 0)}</Td>
                        <Td align="right" className={`tabular-nums font-bold ${line.pendingQty < 0 ? 'text-error' : 'text-on-surface'}`}>
                          {fmtQty(line.pendingQty, 0)}
                        </Td>
                        <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(line.pendingKg, 0)}</Td>
                        <Td className="tabular-nums text-on-surface-variant">{line.warehouseCode ?? '—'}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(line.stock03, 0)}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(line.stock68, 0)}</Td>
                        <Td align="right" className={`tabular-nums font-bold ${remaining < 0 ? 'text-error' : 'text-secondary'}`}>
                          {fmtQty(remaining, 0)}
                        </Td>
                        <Td align="center">
                          {line.authorized === null ? (
                            <span className="text-outline">—</span>
                          ) : (
                            <Badge tone={line.authorized ? 'success' : 'muted'}>{line.authorized ? 'SÍ' : 'NO'}</Badge>
                          )}
                        </Td>
                        <Td align="right">
                          <Link href={`/pedidos/${line.orderId}`} className="font-semibold text-primary-container hover:underline">
                            Ver
                          </Link>
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

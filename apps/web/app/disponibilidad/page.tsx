'use client';

// ============================================================
// Disponibilidad por Producto (Fase 3) — rediseño estilo Stitch.
// Existencia física (última fotografía) − solicitado pendiente de pedidos
// activos. Estado: DISPONIBLE | PARCIAL | FALTANTE | SIN_DEMANDA.
// ============================================================

import type { AvailabilityResponse, AvailabilityRow, AvailabilityStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, PackageSearch, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  fmtQty,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Despachable',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin solicitud',
};

const STATUS_TONE: Record<AvailabilityStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  DISPONIBLE: 'success',
  PARCIAL: 'warning',
  FALTANTE: 'danger',
  SIN_DEMANDA: 'muted',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'FALTANTE', label: 'Faltante (incluye parcial)' },
  { value: 'DISPONIBLE', label: 'Despachable' },
  { value: 'SIN_DEMANDA', label: 'Sin solicitud' },
];

// El filtro «Faltante» agrupa los estados FALTANTE y PARCIAL; cada fila
// conserva su etiqueta original en la tabla.
function matchesStatus(rowStatus: AvailabilityStatus, filter: AvailabilityStatus | ''): boolean {
  if (!filter) return true;
  if (filter === 'FALTANTE') return rowStatus === 'FALTANTE' || rowStatus === 'PARCIAL';
  return rowStatus === filter;
}

// Presentación del artículo en Profit (`uni_venta`): SAC = saco, KG = granel.
// Mismo criterio que en Forecast.
type UnitFilter = 'ALL' | 'SAC' | 'KG';

const UNIT_OPTIONS: { value: UnitFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SAC', label: 'Saco' },
  { value: 'KG', label: 'Granel (kg)' },
];

function matchesUnit(uom: string, filter: UnitFilter): boolean {
  return filter === 'ALL' || uom === filter;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Sin fotografía de inventario';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

// Existencia de un almacén concreto; `null` = la fuente no lo expone («—»).
function stockOf(row: AvailabilityRow, warehouseCode: string): number | null {
  return row.stockByWarehouse.find((w) => w.warehouseCode === warehouseCode)?.qty ?? null;
}

// «A producir (SAC)»: SOLO los artículos a granel (KG) muestran un 0 tachado,
// porque no se producen en sacos. Los artículos SAC mantienen su 0 normal.
function renderToProduceSacs(row: AvailabilityRow) {
  if (row.uom !== 'SAC') {
    return (
      <span
        className="text-on-surface-variant line-through decoration-1"
        title="No aplica: el artículo se produce a granel (kg)"
      >
        0
      </span>
    );
  }
  return (
    <span className={row.toProduceQty > 0 ? 'font-bold text-error' : 'text-on-surface-variant'}>
      {fmtQty(row.toProduceQty, 0)}
    </span>
  );
}

const COLUMNS: Column<AvailabilityRow>[] = [
  {
    key: 'codigo',
    header: 'Código',
    kind: 'id',
    sortValue: (r) => r.productCode,
    render: (r) => <span className="font-bold tabular-nums text-primary">{r.productCode}</span>,
  },
  {
    key: 'descripcion',
    header: 'Descripción',
    title: (r) => r.description,
    sortValue: (r) => r.description,
    render: (r) => r.description,
  },
  { key: 'unid', header: 'Unid.', render: (r) => <span className="text-on-surface-variant">{r.uom}</span> },
  {
    key: 'stock03',
    header: 'Stock 03',
    align: 'right',
    sortValue: (r) => stockOf(r, 'Stock 03') ?? 0,
    render: (r) => fmtQty(stockOf(r, 'Stock 03'), 0),
  },
  {
    key: 'stock9999',
    header: 'Stock 9999',
    align: 'right',
    sortValue: (r) => stockOf(r, 'Stock 9999') ?? 0,
    render: (r) => fmtQty(stockOf(r, 'Stock 9999'), 0),
  },
  {
    key: 'stock68',
    header: 'Stock 68',
    align: 'right',
    sortValue: (r) => stockOf(r, 'Stock 68') ?? 0,
    render: (r) => fmtQty(stockOf(r, 'Stock 68'), 0),
  },
  {
    key: 'existencia',
    header: 'Existencia',
    align: 'right',
    kind: 'metric',
    sortValue: (r) => r.stockTotal,
    render: (r) => <span className="font-bold">{fmtQty(r.stockTotal, 0)}</span>,
  },
  {
    key: 'solicitado',
    header: 'Solicitado',
    align: 'right',
    kind: 'metric',
    sortValue: (r) => r.demandQty,
    render: (r) => fmtQty(r.demandQty, 0),
  },
  {
    key: 'despachable',
    header: 'Despachable',
    align: 'right',
    kind: 'metric',
    sortValue: (r) => r.availableQty,
    render: (r) => <span className="font-bold text-secondary">{fmtQty(r.availableQty, 0)}</span>,
  },
  {
    key: 'aProducir',
    header: 'A producir (SAC)',
    align: 'right',
    sortValue: (r) => r.toProduceQty,
    render: renderToProduceSacs,
  },
  {
    key: 'aProducirKg',
    header: 'A producir (kg)',
    align: 'right',
    kind: 'metric',
    sortValue: (r) => r.toProduceKg ?? 0,
    render: (r) => (
      <span className={(r.toProduceKg ?? 0) > 0 ? 'text-error' : 'text-on-surface-variant'}>{fmtQty(r.toProduceKg, 0)}</span>
    ),
  },
  {
    key: 'neto',
    header: 'Neto (unid.)',
    align: 'right',
    sortValue: (r) => r.netQty,
    render: (r) => <span className={r.netQty < 0 ? 'text-error' : ''}>{fmtQty(r.netQty, 0)}</span>,
  },
  {
    key: 'estado',
    header: 'Estado',
    align: 'center',
    kind: 'status',
    sortValue: (r) => STATUS_LABEL[r.status],
    render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
  },
];

export default function DisponibilidadPage() {
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AvailabilityStatus | ''>('');
  const [unit, setUnit] = useState<UnitFilter>('ALL');
  // El KPI «A producir» se puede ver en kg (por defecto) o en toneladas.
  const [inTons, setInTons] = useState(false);

  const { data, isLoading, error } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', tick],
    queryFn: () => apiFetch<AvailabilityResponse>('/availability'),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        matchesUnit(r.uom, unit) &&
        matchesStatus(r.status, status) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [data, search, status, unit]);

  const kpis = useMemo(() => {
    const all = data?.rows ?? [];
    return {
      productos: all.length,
      faltantes: all.filter((r) => r.status === 'FALTANTE').length,
      parciales: all.filter((r) => r.status === 'PARCIAL').length,
      despachables: all.filter((r) => r.status === 'DISPONIBLE').length,
      toProduceKg: all.reduce((acc, r) => acc + (r.toProduceKg ?? 0), 0),
    };
  }, [data]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Módulo de Existencias y Solicitado"
          icon={Boxes}
          title="Disponibilidad por Producto"
          subtitle={`Existencias físicas en almacenes vs. solicitado pendiente de pedidos activos. Fotografía de inventario: ${fmtDateTime(
            data?.snapshotAt ?? null,
          )}${data?.source === 'fixtures' ? ' · DATOS DE DESARROLLO (fixtures)' : ''}`}
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Productos" value={String(kpis.productos)} icon={Boxes} />
              <Kpi
                label="Faltante"
                value={String(kpis.faltantes + kpis.parciales)}
                tone="danger"
                hint={`${kpis.faltantes} sin existencia · ${kpis.parciales} parciales`}
              />
              <Kpi label="Despachable" value={String(kpis.despachables)} tone="success" hint="cubren todo el solicitado" />
              <div className="relative">
                <Kpi
                  label="A producir"
                  value={inTons ? fmtQty(kpis.toProduceKg / 1000, 2) : fmtQty(kpis.toProduceKg, 0)}
                  suffix={inTons ? 't' : 'kg'}
                  tone="danger"
                />
                <label
                  className="absolute right-2 top-2 flex cursor-pointer items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline"
                  title="Mostrar el total a producir en toneladas"
                >
                  <input
                    type="checkbox"
                    checked={inTons}
                    onChange={(e) => setInTons(e.target.checked)}
                    aria-label="Mostrar a producir en toneladas"
                    className="size-3.5 cursor-pointer accent-[var(--color-primary-container)]"
                  />
                  Ton
                </label>
              </div>
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-12">
            <TextInput
              className="lg:col-span-4"
              icon={Search}
              value={search}
              onChange={setSearch}
              placeholder="Buscar harina, alimento o código (ej. ABAEQUI01)…"
              ariaLabel="Buscar producto"
            />
            <Select
              className="lg:col-span-2"
              value={status}
              onChange={(v) => setStatus(v as AvailabilityStatus | '')}
              options={STATUS_OPTIONS}
              ariaLabel="Filtrar por estado"
            />
            <div className="flex items-center gap-space-sm lg:col-span-3">
              <span className="font-semibold uppercase text-label-sm text-outline">Presentación</span>
              <Segmented ariaLabel="Presentación" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
            </div>
          </div>
        </Card>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando disponibilidad…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <Card className="overflow-hidden">
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(r) => r.productCode}
              empty={
                <EmptyState
                  icon={PackageSearch}
                  title={search || status ? 'Sin resultados para los filtros aplicados' : 'Sin datos de disponibilidad'}
                  description="Ajusta la búsqueda, el estado o la presentación para ver productos."
                />
              }
            />
            <div className="flex items-start gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
              <PackageSearch aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-space-2xs">
                <span>
                  {rows.length} de {data.rows.length} productos · unidades en la unidad de venta de cada producto (SAC/KG),
                  no se mezclan entre sí. <strong className="text-on-surface">Existencia</strong> = Stock 03 + Stock 9999 +
                  Stock 68.
                </span>
                <span>
                  <strong className="text-on-surface">Despachable</strong> = parte del solicitado que cubre la existencia
                  actual (mínimo entre existencia y solicitado). No es el stock libre: eso es{' '}
                  <strong className="text-on-surface">Neto</strong> (existencia − solicitado).
                </span>
                <span>
                  <strong className="text-on-surface">A producir (SAC)</strong>: el{' '}
                  <span className="line-through decoration-1">0</span> tachado corresponde a artículos a granel (KG),
                  que no se producen en sacos; en los artículos SAC el 0 es una cantidad real.
                </span>
              </div>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

'use client';

// ============================================================
// Disponibilidad por Producto (Fase 3).
// Existencia física (última fotografía) − demanda pendiente de pedidos
// activos. Estado: DISPONIBLE | PARCIAL | FALTANTE | SIN_DEMANDA.
//
// Contrato de UI: docs/design/DESIGN_SYSTEM.md
// ============================================================

import type { AvailabilityResponse, AvailabilityRow, AvailabilityStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { Boxes, PackageSearch, RotateCcw, Search, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Column,
  DataTable,
  EmptyState,
  ErrorNote,
  FilterBar,
  Kpi,
  PageHeader,
  Select,
  TextInput,
  UnitFilter,
  UnitFilterControl,
  fmtDateTime,
  fmtInt,
  matchesUnit,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Disponible',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin demanda',
};

const STATUS_TONE: Record<AvailabilityStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  DISPONIBLE: 'success',
  PARCIAL: 'warning',
  FALTANTE: 'danger',
  SIN_DEMANDA: 'muted',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Estado: Todos' },
  { value: 'FALTANTE', label: 'Faltante' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'DISPONIBLE', label: 'Disponible' },
  { value: 'SIN_DEMANDA', label: 'Sin demanda' },
];

export default function DisponibilidadPage() {
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AvailabilityStatus | ''>('');
  const [unit, setUnit] = useState<UnitFilter>('ALL');

  const { data, isLoading, error } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', tick],
    queryFn: () => apiFetch<AvailabilityResponse>('/availability'),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const all = useMemo(() => data?.rows ?? [], [data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        matchesUnit(r.uom, unit) &&
        (!status || r.status === status) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [all, search, status, unit]);

  const kpis = useMemo(
    () => ({
      productos: all.length,
      faltantes: all.filter((r) => r.status === 'FALTANTE').length,
      parciales: all.filter((r) => r.status === 'PARCIAL').length,
      disponibles: all.filter((r) => r.status === 'DISPONIBLE').length,
      toProduceKg: all.reduce((acc, r) => acc + (r.toProduceKg ?? 0), 0),
    }),
    [all],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setUnit('ALL');
  }, []);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const filtersActive = (status ? 1 : 0) + (unit !== 'ALL' ? 1 : 0);
  const filtered = Boolean(search.trim() || status || unit !== 'ALL');
  const snapshotLabel = data?.snapshotAt ? fmtDateTime(data.snapshotAt) : 'Sin fotografía de inventario';

  // Mientras carga no hay dato: se muestra «—», nunca un 0 engañoso.
  const number = (value: number) => (isLoading ? '—' : fmtInt(value));

  const columns: Column<AvailabilityRow>[] = [
    {
      key: 'code',
      header: 'Código',
      kind: 'id',
      render: (r) => r.productCode,
      title: (r) => r.productCode,
      sortValue: (r) => r.productCode,
    },
    {
      key: 'description',
      header: 'Descripción',
      kind: 'id',
      render: (r) => r.description,
      title: (r) => r.description,
      sortValue: (r) => r.description,
    },
    {
      key: 'uom',
      header: 'Unid.',
      kind: 'field',
      render: (r) => <span className="text-on-surface-variant">{r.uom}</span>,
      sortValue: (r) => r.uom,
    },
    {
      key: 'stock03',
      header: 'Stock 03',
      align: 'right',
      kind: 'detail',
      render: (r) => <span className="text-on-surface-variant">{fmtInt(r.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 03')?.qty ?? null)}</span>,
      sortValue: (r) => r.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 03')?.qty ?? 0,
    },
    {
      key: 'stock68',
      header: 'Stock 68',
      align: 'right',
      kind: 'detail',
      render: (r) => <span className="text-on-surface-variant">{fmtInt(r.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 68')?.qty ?? null)}</span>,
      sortValue: (r) => r.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 68')?.qty ?? 0,
    },
    {
      key: 'stock',
      header: 'Existencia',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className="font-bold text-on-surface">{fmtInt(r.stockTotal)}</span>,
      sortValue: (r) => r.stockTotal,
    },
    {
      key: 'demand',
      header: 'Demanda',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className={r.demandQty > 0 ? 'font-bold text-on-surface' : 'text-outline'}>{fmtInt(r.demandQty)}</span>,
      sortValue: (r) => r.demandQty,
    },
    {
      key: 'available',
      header: 'Disponible',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className="font-bold text-secondary">{fmtInt(r.availableQty)}</span>,
      sortValue: (r) => r.availableQty,
    },
    {
      key: 'produce',
      header: 'A producir',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className={r.toProduceQty > 0 ? 'font-bold text-critical' : 'text-outline'}>{fmtInt(r.toProduceQty)}</span>,
      sortValue: (r) => r.toProduceQty,
    },
    {
      key: 'kg',
      header: 'A producir (kg)',
      align: 'right',
      kind: 'detail',
      render: (r) => (
        <span className={r.toProduceKg && r.toProduceKg > 0 ? 'text-critical' : 'text-on-surface-variant'}>
          {r.toProduceKg === null || r.toProduceKg === undefined ? '—' : fmtInt(r.toProduceKg)}
        </span>
      ),
      sortValue: (r) => r.toProduceKg ?? 0,
    },
    {
      key: 'net',
      header: 'Neto',
      align: 'right',
      kind: 'detail',
      render: (r) => <span className={r.netQty < 0 ? 'text-critical' : 'text-on-surface-variant'}>{fmtInt(r.netQty)}</span>,
      sortValue: (r) => r.netQty,
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'center',
      kind: 'status',
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
      sortValue: (r) => STATUS_LABEL[r.status],
    },
  ];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-lg xl:p-space-xl">
        <PageHeader
          icon={Boxes}
          title="Disponibilidad por Producto"
          subtitle={
            <>
              Existencia física de los almacenes menos la demanda pendiente de pedidos activos. Fotografía de inventario:{' '}
              <strong className="font-semibold text-on-surface">{isLoading ? 'Consultando…' : snapshotLabel}</strong>
              {data?.source === 'fixtures' ? ' · DATOS DE DESARROLLO (fixtures)' : ''}
            </>
          }
        />

        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-3 xl:grid-cols-5">
          <Kpi
            label="Productos"
            value={number(kpis.productos)}
            icon={Boxes}
            hint={isLoading || rows.length === kpis.productos ? undefined : `Mostrando ${rows.length}`}
          />
          <Kpi label="Faltante" value={number(kpis.faltantes)} tone="danger" />
          <Kpi label="Parcial" value={number(kpis.parciales)} tone="warning" />
          <Kpi label="Disponible" value={number(kpis.disponibles)} tone="success" />
          <Kpi label="A producir" value={isLoading ? '—' : fmtInt(kpis.toProduceKg)} suffix="kg" tone="danger" />
        </div>

        {error && !(error instanceof AuthRequiredError) && (
          <ErrorNote>{error instanceof Error ? error.message : 'Error al consultar la disponibilidad.'}</ErrorNote>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            title="Disponibilidad por producto"
            description="Unidades en la unidad de venta de cada producto (SAC/KG): no se mezclan entre sí. Ordena pulsando el encabezado de una columna."
          />
          <FilterBar
            activeCount={filtersActive}
            search={
              <TextInput
                icon={Search}
                type="search"
                value={search}
                onChange={setSearch}
                placeholder="Buscar harina, alimento o código (ej. ABAEQUI01)…"
                ariaLabel="Buscar producto por descripción o código"
              />
            }
            filters={
              <>
                <Select
                  className="md:w-56"
                  value={status}
                  onChange={(v) => setStatus(v as AvailabilityStatus | '')}
                  options={STATUS_OPTIONS}
                  ariaLabel="Filtrar por estado"
                />
                <UnitFilterControl value={unit} onChange={setUnit} />
              </>
            }
          />
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.productCode}
            loading={isLoading}
            loadingRows={8}
            defaultSortKey="code"
            empty={
              filtered ? (
                <EmptyState
                  icon={SearchX}
                  title="Sin productos para los filtros aplicados"
                  description="Ningún artículo coincide con la búsqueda y el estado elegidos. Quítalos para ver la lista completa."
                  action={
                    <Button variant="outline" icon={RotateCcw} onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={PackageSearch}
                  title="Sin datos de disponibilidad"
                  description="Todavía no hay una fotografía de inventario con productos. Sincroniza Profit para ver existencias y demanda."
                />
              )
            }
          />
          {!isLoading && data && (
            <div
              aria-live="polite"
              className="flex items-center gap-space-sm border-t border-surface-container px-space-lg py-space-sm text-label-sm text-on-surface-variant"
            >
              <PackageSearch aria-hidden className="size-4 shrink-0" />
              {rows.length} de {all.length} productos
              {filtered ? ' con los filtros aplicados' : ''} · la existencia es la última fotografía cargada.
            </div>
          )}
        </Card>
      </main>
    </>
  );
}

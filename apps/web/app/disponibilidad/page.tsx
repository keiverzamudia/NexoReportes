'use client';

// ============================================================
// Disponibilidad por Producto (Fase 3) — rediseño estilo Stitch.
// Existencia física (última fotografía) − demanda pendiente de pedidos
// activos. Estado: DISPONIBLE | PARCIAL | FALTANTE | SIN_DEMANDA.
// ============================================================

import type { AvailabilityResponse, AvailabilityRow, AvailabilityStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, PackageSearch, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, Kpi, PageHeader, Select, Td, TextInput, Th, fmtQty } from '../../components/ui';
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

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Sin fotografía de inventario';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

export default function DisponibilidadPage() {
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AvailabilityStatus | ''>('');

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
        (!status || r.status === status) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [data, search, status]);

  const kpis = useMemo(() => {
    const all = data?.rows ?? [];
    return {
      productos: all.length,
      faltantes: all.filter((r) => r.status === 'FALTANTE').length,
      parciales: all.filter((r) => r.status === 'PARCIAL').length,
      disponibles: all.filter((r) => r.status === 'DISPONIBLE').length,
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
          eyebrow="Módulo de Existencias y Demanda Neta"
          icon={Boxes}
          title="Disponibilidad por Producto"
          subtitle={`Existencias físicas en almacenes vs. demanda pendiente de pedidos activos. Fotografía de inventario: ${fmtDateTime(
            data?.snapshotAt ?? null,
          )}${data?.source === 'fixtures' ? ' · DATOS DE DESARROLLO (fixtures)' : ''}`}
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Productos" value={String(kpis.productos)} icon={Boxes} />
              <Kpi label="Faltante" value={String(kpis.faltantes)} tone="danger" />
              <Kpi label="Parcial" value={String(kpis.parciales)} tone="warning" />
              <Kpi label="Disponible" value={String(kpis.disponibles)} tone="success" />
              <Kpi label="A producir" value={fmtQty(kpis.toProduceKg, 0)} suffix="kg" tone="danger" />
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
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-surface-container bg-surface-container">
                    <Th>Código</Th>
                    <Th>Descripción</Th>
                    <Th>Unid.</Th>
                    <Th align="right">Stock 03</Th>
                    <Th align="right">Stock 68</Th>
                    <Th align="right">Existencia</Th>
                    <Th align="right">Demanda</Th>
                    <Th align="right">Disponible</Th>
                    <Th align="right">A producir</Th>
                    <Th align="right">A producir (kg)</Th>
                    <Th align="right">Neto</Th>
                    <Th align="center">Estado</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {rows.length === 0 && (
                    <tr>
                      <Td align="center" className="py-space-xl text-on-surface-variant">
                        {search || status ? 'Sin resultados para los filtros aplicados.' : 'Sin datos de disponibilidad.'}
                      </Td>
                    </tr>
                  )}
                  {rows.map((row: AvailabilityRow) => {
                    const stock03 = row.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 03')?.qty ?? null;
                    const stock68 = row.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 68')?.qty ?? null;
                    return (
                      <tr key={row.productCode} className="transition-colors hover:bg-surface-container-low">
                        <Td className="font-bold tabular-nums text-primary">{row.productCode}</Td>
                        <Td className="max-w-md truncate" title={row.description}>{row.description}</Td>
                        <Td className="text-on-surface-variant">{row.uom}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(stock03, 0)}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(stock68, 0)}</Td>
                        <Td align="right" className="tabular-nums font-bold">{fmtQty(row.stockTotal, 0)}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(row.demandQty, 0)}</Td>
                        <Td align="right" className="tabular-nums text-secondary font-bold">{fmtQty(row.availableQty, 0)}</Td>
                        <Td align="right" className={`tabular-nums font-bold ${row.toProduceQty > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                          {fmtQty(row.toProduceQty, 0)}
                        </Td>
                        <Td align="right" className={`tabular-nums ${row.toProduceKg && row.toProduceKg > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                          {fmtQty(row.toProduceKg, 0)}
                        </Td>
                        <Td align="right" className={`tabular-nums ${row.netQty < 0 ? 'text-error' : ''}`}>{fmtQty(row.netQty, 0)}</Td>
                        <Td align="center">
                          <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
              <PackageSearch aria-hidden className="size-4" />
              {rows.length} de {data.rows.length} productos · unidades en la unidad de venta de cada producto (SAC/KG), no se
              mezclan entre sí.
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

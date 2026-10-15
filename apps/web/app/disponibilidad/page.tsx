'use client';

// ============================================================
// Disponibilidad neta por producto (Fase 3).
// Lee GET /api/availability (lo sincronizado desde Profit):
//   existencia física (última fotografía) − demanda pendiente.
// Estado por fila: DISPONIBLE | PARCIAL | FALTANTE | SIN_DEMANDA.
// ============================================================

import type { AvailabilityResponse, AvailabilityRow, AvailabilityStatus } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Search, Truck, Warehouse } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Disponible',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin demanda',
};

// Chip de estado con semáforo del design system (lima=ok, ámbar=parcial, rojo=falta).
const STATUS_CHIP: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'bg-secondary-container text-on-secondary-container',
  PARCIAL: 'bg-surface-container-highest text-on-surface',
  FALTANTE: 'bg-error-container text-on-error-container',
  SIN_DEMANDA: 'bg-surface-container-low text-on-surface-variant border border-outline-variant',
};

function fmt(value: number): string {
  return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 }).format(value);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Sin fotografía de inventario';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export default function DisponibilidadPage() {
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', tick],
    queryFn: () => apiFetch<AvailabilityResponse>('/availability'),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (!search.trim()) return all;
    const needle = search.trim().toLowerCase();
    return all.filter((r) => r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle));
  }, [data, search]);

  const kpis = useMemo(() => {
    const all = data?.rows ?? [];
    return {
      productos: all.length,
      faltantes: all.filter((r) => r.status === 'FALTANTE').length,
      parciales: all.filter((r) => r.status === 'PARCIAL').length,
      aProducir: all.reduce((acc, r) => acc + r.toProduceQty, 0),
    };
  }, [data]);

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  return (
    <>
      <AppNav />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-space-lg p-space-xl">
        <header className="flex flex-wrap items-end justify-between gap-space-md">
          <div>
            <h1 className="text-headline-lg italic">Disponibilidad neta</h1>
            <p className="text-body-md text-on-surface-variant">
              Existencia física − demanda pendiente ·{' '}
              <span className="tabular-nums">Fotografía: {fmtDateTime(data?.snapshotAt ?? null)}</span>
              {data?.source === 'fixtures' && <strong className="ml-space-sm text-error">(datos de desarrollo)</strong>}
            </p>
          </div>
          <label className="flex items-center gap-space-sm rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm">
            <Search aria-hidden className="size-4 text-on-surface-variant" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código o descripción…"
              className="w-64 bg-transparent text-body-md text-on-surface outline-none"
              aria-label="Buscar producto"
            />
          </label>
        </header>

        <section aria-label="Resumen" className="grid gap-space-md sm:grid-cols-3">
          <div className="flex items-center gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
            <Boxes aria-hidden className="size-5 text-primary-container" />
            <div>
              <p className="text-label-md uppercase text-on-surface-variant">Productos con demanda o stock</p>
              <p className="text-data-tabular-lg tabular-nums">{fmt(kpis.productos)}</p>
            </div>
          </div>
          <div className="flex items-center gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
            <Truck aria-hidden className="size-5 text-primary-container" />
            <div>
              <p className="text-label-md uppercase text-on-surface-variant">Parciales / faltantes</p>
              <p className="text-data-tabular-lg tabular-nums">
                {fmt(kpis.parciales)} / {fmt(kpis.faltantes)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
            <Warehouse aria-hidden className="size-5 text-primary-container" />
            <div>
              <p className="text-label-md uppercase text-on-surface-variant">A producir (total, unidades)</p>
              <p className="text-data-tabular-lg tabular-nums">{fmt(kpis.aProducir)}</p>
            </div>
          </div>
        </section>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando disponibilidad…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
            <table className="w-full border-collapse text-data-tabular-md">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-md uppercase text-on-surface-variant">
                  <th scope="col" className="px-space-md py-space-sm">Código</th>
                  <th scope="col" className="px-space-md py-space-sm">Descripción</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Stock 03</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Stock 68</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Existencia</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Demanda</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Disponible</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">A producir</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Neto</th>
                  <th scope="col" className="px-space-md py-space-sm">Unidad</th>
                  <th scope="col" className="px-space-md py-space-sm">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-space-md py-space-xl text-center text-body-md text-on-surface-variant">
                      Sin resultados{search ? ` para “${search}”` : ''}.
                    </td>
                  </tr>
                )}
                {rows.map((row: AvailabilityRow) => {
                  const stock03 = row.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 03')?.qty ?? null;
                  const stock68 = row.stockByWarehouse.find((w) => w.warehouseCode === 'Stock 68')?.qty ?? null;
                  return (
                    <tr key={row.productCode} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                      <td className="px-space-md py-space-sm font-semibold">{row.productCode}</td>
                      <td className="max-w-xs truncate px-space-md py-space-sm" title={row.description}>
                        {row.description}
                      </td>
                      <td className="px-space-md py-space-sm text-right tabular-nums">{stock03 === null ? '—' : fmt(stock03)}</td>
                      <td className="px-space-md py-space-sm text-right tabular-nums">{stock68 === null ? '—' : fmt(stock68)}</td>
                      <td className="px-space-md py-space-sm text-right font-semibold tabular-nums">{fmt(row.stockTotal)}</td>
                      <td className="px-space-md py-space-sm text-right tabular-nums">{fmt(row.demandQty)}</td>
                      <td className="px-space-md py-space-sm text-right tabular-nums">{fmt(row.availableQty)}</td>
                      <td className={`px-space-md py-space-sm text-right font-semibold tabular-nums ${row.toProduceQty > 0 ? 'text-error' : ''}`}>
                        {fmt(row.toProduceQty)}
                      </td>
                      <td className={`px-space-md py-space-sm text-right tabular-nums ${row.netQty < 0 ? 'text-error' : ''}`}>
                        {fmt(row.netQty)}
                      </td>
                      <td className="px-space-md py-space-sm">{row.uom}</td>
                      <td className="px-space-md py-space-sm">
                        <span className={`rounded-full px-space-sm py-space-2xs text-label-md uppercase ${STATUS_CHIP[row.status]}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="text-body-md text-on-surface-variant">
          {rows.length} de {data?.rows.length ?? 0} productos · unidades en la unidad de venta de cada producto (SAC/KG).
        </footer>
      </main>
    </>
  );
}

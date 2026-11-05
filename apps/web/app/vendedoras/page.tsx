'use client';

// ============================================================
// Vendedoras vs Forecast.
//
// Informe propio (no una pestaña de Forecast): evalúa a cada vendedora con
// los clientes que realmente le compraron, su representación en la venta del
// mes y la cuota de la meta de la empresa que debe cumplir. La venta se
// atribuye al vendedor de la nota de entrega (no al asignado a la cartera).
//
// Las cifras vienen del API (`/forecast/sellers`); esta página solo controla
// el periodo y monta el informe.
// ============================================================

import type { ForecastSellersResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, RefreshCw, Trophy } from 'lucide-react';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { SellerReport } from '../../components/forecast/SellerReport';
import { Card, Kpi, PageHeader, Segmented, Select, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

type SalesBasis = 'WORKING' | 'CALENDAR';

const BASIS_OPTIONS: { value: SalesBasis; label: string }[] = [
  { value: 'WORKING', label: 'Hábiles' },
  { value: 'CALENDAR', label: 'Calendario' },
];

const HISTORY_OPTIONS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
];

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function SellersPage() {
  const [tick, setTick] = useState(0);
  const [ym, setYm] = useState(currentMonthValue);
  const [basis, setBasis] = useState<SalesBasis>('WORKING');
  const [includeToday, setIncludeToday] = useState(false);
  const [historyMonths, setHistoryMonths] = useState('6');

  const [yearPart, monthPart] = ym.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  const report = useQuery<ForecastSellersResponse>({
    queryKey: ['forecast-sellers', tick, year, month, basis, includeToday, historyMonths],
    queryFn: () =>
      apiFetch<ForecastSellersResponse>(
        `/forecast/sellers?year=${year}&month=${month}&basis=${basis}&months=${historyMonths}&includeToday=${
          includeToday ? 'true' : 'false'
        }`,
      ),
    // El informe es caro (Profit + catálogo): evitar refetch al volver a la
    // pestaña o al cambiar de filtro dentro del mismo minuto.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (report.error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totals = report.data?.totals;
  const sellers = report.data?.sellers.length ?? 0;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · Fuerza de ventas"
          icon={Trophy}
          title="Vendedoras"
          subtitle="Cumplimiento de la meta por vendedora y sus clientes, con la cuota que a cada una le toca del forecast de la empresa."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Vendedoras" value={String(sellers)} icon={Trophy} />
              <Kpi
                label="Meta del mes"
                value={totals ? fmtQty(totals.forecastKg, 0) : '—'}
                suffix="kg"
                tone="primary"
              />
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="flex flex-col gap-space-md lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-2 gap-space-sm sm:flex sm:flex-wrap sm:items-end sm:gap-space-md">
              <label className="col-span-1 flex min-w-0 flex-col gap-space-2xs">
                <span className="font-semibold uppercase text-label-sm text-outline">Mes</span>
                <input
                  type="month"
                  value={ym}
                  onChange={(e) => setYm(e.target.value || currentMonthValue())}
                  className="h-10 w-full rounded-xl bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
                />
              </label>
              <label className="col-span-1 flex min-w-0 flex-col gap-space-2xs">
                <span className="font-semibold uppercase text-label-sm text-outline">Histórico</span>
                <Select
                  ariaLabel="Ventana histórica de la cuota"
                  value={historyMonths}
                  onChange={setHistoryMonths}
                  options={HISTORY_OPTIONS}
                  className="h-10 w-full sm:w-32"
                />
              </label>
              <div className="col-span-2 flex flex-col gap-space-2xs sm:col-span-1">
                <span className="font-semibold uppercase text-label-sm text-outline">Base de días</span>
                <Segmented
                  ariaLabel="Base de días del informe"
                  value={basis}
                  onChange={setBasis}
                  options={BASIS_OPTIONS}
                />
              </div>
              <label className="col-span-2 flex h-10 items-center gap-space-xs text-body-md text-on-surface-variant sm:col-span-1">
                <input
                  type="checkbox"
                  checked={includeToday}
                  onChange={(e) => setIncludeToday(e.target.checked)}
                  className="size-4 accent-[var(--color-secondary-container)]"
                />
                Incluir hoy
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-space-sm lg:justify-end">
              <span className="hidden items-center gap-1 text-label-md text-on-surface-variant sm:inline-flex">
                <CalendarDays aria-hidden className="size-4 text-outline" />
                Cuota = participación en los meses cerrados de la ventana
              </span>
              <button
                type="button"
                onClick={() => setTick((value) => value + 1)}
                disabled={report.isFetching}
                className="inline-flex h-10 w-full items-center justify-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-60 sm:w-auto"
              >
                <RefreshCw aria-hidden className={`size-4 ${report.isFetching ? 'animate-spin' : ''}`} /> Actualizar
              </button>
            </div>
          </div>
        </Card>

        {report.error && !(report.error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />
            {report.error instanceof Error ? report.error.message : 'Error al consultar'}
          </p>
        )}

        <SellerReport
          report={report.data}
          isLoading={report.isLoading}
          error={report.error instanceof Error ? report.error : null}
          onRetry={() => void report.refetch()}
        />
      </main>
    </>
  );
}

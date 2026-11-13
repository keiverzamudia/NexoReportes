'use client';

// ============================================================
// Vendedor vs Forecast.
//
// Informe propio (no una pestaña de Forecast): evalúa a cada vendedor con su
// cartera asignada en Profit (`clientes.co_ven`) —o con el vendedor de la nota
// si se elige ese criterio—, su representación en la venta del mes y la cuota
// de la meta de la empresa que debe cumplir.
//
// Las cifras vienen del API (`/forecast/sellers`); esta página solo controla
// el periodo y monta el informe.
// ============================================================

import type { ForecastSellerAttribution, ForecastSellersResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Info, RefreshCw, Trophy, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { SellerReport } from '../../components/forecast/SellerReport';
import { Card, Kpi, PageHeader, Segmented, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

type SalesBasis = 'WORKING' | 'CALENDAR';

const BASIS_OPTIONS: { value: SalesBasis; label: string }[] = [
  { value: 'WORKING', label: 'Hábiles' },
  { value: 'CALENDAR', label: 'Calendario' },
];

const ATTRIBUTION_OPTIONS: { value: ForecastSellerAttribution; label: string }[] = [
  { value: 'PORTFOLIO', label: 'Cartera' },
  { value: 'NOTE', label: 'Nota de entrega' },
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
  // El histórico del informe arranca en 3 meses y se cambia desde el
  // expediente del vendedor.
  const [historyMonths, setHistoryMonths] = useState('3');
  const [attribution, setAttribution] = useState<ForecastSellerAttribution>('PORTFOLIO');
  // El botón «Actualizar» pide al API que ignore su caché de 5 minutos.
  const manualRefresh = useRef(false);

  const [yearPart, monthPart] = ym.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  const report = useQuery<ForecastSellersResponse>({
    queryKey: ['forecast-sellers', tick, year, month, basis, includeToday, historyMonths, attribution],
    queryFn: () =>
      apiFetch<ForecastSellersResponse>(
        `/forecast/sellers?year=${year}&month=${month}&basis=${basis}&months=${historyMonths}&includeToday=${
          includeToday ? 'true' : 'false'
        }&attribution=${attribution}&refresh=${manualRefresh.current ? 'true' : 'false'}`,
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
  const effectiveAttribution = report.data?.attribution ?? attribution;
  const portfolioFallback =
    attribution === 'PORTFOLIO' && report.data !== undefined && !report.data.assignmentAvailable;

  const refresh = () => {
    manualRefresh.current = true;
    void report.refetch().finally(() => {
      manualRefresh.current = false;
    });
  };

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Comercial · Fuerza de ventas"
          icon={Trophy}
          title="Vendedor"
          subtitle="Cumplimiento de la meta por vendedor y su cartera asignada en Profit, con la cuota que a cada uno le toca del forecast de la empresa."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Vendedores" value={String(sellers)} icon={Trophy} />
              <Kpi
                label="Clientes en cartera"
                value={totals ? fmtQty(totals.assignedClientCount, 0) : '—'}
                icon={Users}
              />
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
              <div className="col-span-2 flex flex-col gap-space-2xs sm:col-span-1">
                <span className="font-semibold uppercase text-label-sm text-outline">Base de días</span>
                <Segmented
                  ariaLabel="Base de días del informe"
                  value={basis}
                  onChange={setBasis}
                  options={BASIS_OPTIONS}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-space-2xs sm:col-span-1">
                <span className="font-semibold uppercase text-label-sm text-outline">Atribución</span>
                <Segmented
                  ariaLabel="Criterio de atribución de la venta"
                  value={attribution}
                  onChange={setAttribution}
                  options={ATTRIBUTION_OPTIONS}
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
                onClick={refresh}
                disabled={report.isFetching}
                className="inline-flex h-10 w-full items-center justify-center gap-space-2xs rounded-xl border border-outline-variant/50 px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-60 sm:w-auto"
              >
                <RefreshCw aria-hidden className={`size-4 ${report.isFetching ? 'animate-spin' : ''}`} /> Actualizar
              </button>
            </div>
          </div>

          <p className="mt-space-sm flex items-start gap-space-2xs text-label-md text-on-surface-variant">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-outline" />
            {effectiveAttribution === 'PORTFOLIO'
              ? 'Cartera: cada cliente cuenta para el vendedor que tiene asignado hoy en Profit. La cartera se muestra completa, aunque el cliente no haya comprado.'
              : 'Nota de entrega: la venta se acredita a quien firmó la nota. La columna de cartera muestra el vendedor asignado en Profit.'}
          </p>

          {portfolioFallback && (
            <p
              role="status"
              className="mt-space-sm flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-md py-space-sm text-body-md text-on-warning-container"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              No se pudo leer la cartera de Profit. El informe cae a la venta por nota de entrega; vuelve a intentar
              con «Actualizar».
            </p>
          )}
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
          historyMonths={Number(historyMonths)}
          onHistoryMonthsChange={(months) => setHistoryMonths(String(months))}
          includeToday={includeToday}
        />
      </main>
    </>
  );
}

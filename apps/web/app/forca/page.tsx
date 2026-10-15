'use client';

// ============================================================
// Forca — pronóstico de producción (línea ABA = alimentos balanceados).
//
//  · Pestaña «Asignador»: forca MENSUAL por artículo (se fija y queda
//    bloqueado; para cambiarlo pide la clave especial) + reparto por las
//    4 semanas con un factor % editable (100 = reparto parejo).
//  · Pestaña «Reporte»: plan semanal por artículo con
//        producción = max(0, max(forca_sem, demanda_sem) − stock global).
//
//  Datos propios de Nexo: NUNCA se escribe en Profit.
// ============================================================

import type { ForecastPlanResponse, ForecastResponse, ForecastRow } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Check, Download, Lock, Save, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, Kpi, PageHeader, Segmented, Td, TextInput, Th, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const C = { navy: '#003366', red: '#dc2626', lime: '#95C800', outline: '#737780', grid: '#e1f0ff' };

type Tab = 'asignador' | 'reporte';

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function ForcaPage() {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>('asignador');
  const [ym, setYm] = useState(currentMonthValue);
  const [search, setSearch] = useState('');
  const [onlyDemand, setOnlyDemand] = useState(false);

  const [yearPart, monthPart] = ym.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  const forecast = useQuery<ForecastResponse>({
    queryKey: ['forecast', tick, year, month],
    queryFn: () => apiFetch<ForecastResponse>(`/forecast?year=${year}&month=${month}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const plan = useQuery<ForecastPlanResponse>({
    queryKey: ['forecast-plan', tick, year, month],
    queryFn: () => apiFetch<ForecastPlanResponse>(`/forecast/plan?year=${year}&month=${month}`),
    enabled: tab === 'reporte',
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const rows = useMemo(() => {
    const all = forecast.data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!onlyDemand || r.demandMonthQty > 0) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [forecast.data, search, onlyDemand]);

  const error = forecast.error ?? plan.error;
  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const weeks = forecast.data?.weekRanges ?? [];
  const totalForca = (forecast.data?.rows ?? []).reduce((a, r) => a + r.monthlyQty, 0);

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Producción · Alimentos balanceados (línea ABA)"
          icon={CalendarRange}
          title="Forca"
          subtitle="Pronóstico mensual por artículo, repartido en las semanas del mes. Al fijarlo queda bloqueado (se cambia con clave); los factores semanales siguen editables."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Artículos" value={String(forecast.data?.rows.length ?? 0)} icon={CalendarRange} />
              <Kpi label="Forca del mes" value={fmtQty(totalForca, 0)} suffix="unid." tone="primary" />
            </div>
          }
        />

        <Card className="p-space-md">
          <div className="flex flex-wrap items-end justify-between gap-space-md">
            <div className="flex flex-wrap items-center gap-space-md">
              <label className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase text-label-sm text-outline">Mes</span>
                <input
                  type="month"
                  value={ym}
                  onChange={(e) => setYm(e.target.value || currentMonthValue())}
                  className="h-9 rounded-lg bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
                />
              </label>
              <Segmented
                ariaLabel="Pestaña"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'asignador', label: 'Asignador' },
                  { value: 'reporte', label: 'Reporte' },
                ]}
              />
            </div>
            {tab === 'asignador' && (
              <div className="flex flex-wrap items-center gap-space-md">
                <TextInput icon={Search} value={search} onChange={setSearch} placeholder="Buscar artículo…" ariaLabel="Buscar artículo" />
                <label className="flex items-center gap-space-xs text-body-md text-on-surface-variant">
                  <input type="checkbox" checked={onlyDemand} onChange={(e) => setOnlyDemand(e.target.checked)} className="size-4 accent-[var(--color-primary-container)]" />
                  Solo con demanda
                </label>
              </div>
            )}
          </div>
        </Card>

        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {tab === 'asignador' && (
          <>
            {forecast.isLoading && <p className="text-body-md text-on-surface-variant">Cargando artículos de producción…</p>}
            {forecast.data && (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-body-md">
                    <thead>
                      <tr className="border-b border-surface-container bg-surface-container">
                        <Th>Código</Th>
                        <Th>Descripción</Th>
                        <Th align="right">Stock</Th>
                        <Th align="right">Demanda mes</Th>
                        <Th align="right">Forca mes</Th>
                        {weeks.map((w) => (
                          <Th key={w.weekIndex} align="center">{w.label}</Th>
                        ))}
                        <Th align="right">Total sem.</Th>
                        <Th align="center">Estado</Th>
                        <Th align="right">Acciones</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {rows.length === 0 && (
                        <tr>
                          <Td align="center" className="py-space-xl text-on-surface-variant">
                            {search || onlyDemand ? 'Sin artículos para el filtro.' : 'No hay artículos de producción sincronizados.'}
                          </Td>
                        </tr>
                      )}
                      {rows.map((row) => (
                        <ForecastEditor
                          key={row.productCode}
                          row={row}
                          year={year}
                          month={month}
                          weekLabels={weeks.map((w) => w.label)}
                          onSaved={() => forecast.refetch()}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}

        {tab === 'reporte' && (
          <>
            {plan.isLoading && <p className="text-body-md text-on-surface-variant">Calculando plan de producción…</p>}
            {plan.data && <PlanReport data={plan.data} />}
          </>
        )}
      </main>
    </>
  );
}

// ---------- Editor de una fila (forca mensual + semanas) ----------
function ForecastEditor({
  row,
  year,
  month,
  weekLabels,
  onSaved,
}: {
  row: ForecastRow;
  year: number;
  month: number;
  weekLabels: string[];
  onSaved: () => void;
}) {
  const [monthly, setMonthly] = useState(String(row.monthlyQty));
  const [pcts, setPcts] = useState<string[]>(row.weeks.map((w) => String(w.pct)));
  const [monthlyUnlocked, setMonthlyUnlocked] = useState(false);

  const monthlyNum = Number(monthly.replace(',', '.')) || 0;
  const weekQty = (index: number) => {
    const pct = Number(pcts[index]?.replace(',', '.') ?? 100) || 0;
    return Math.round(((monthlyNum / 4) * (pct / 100)) * 1000) / 1000;
  };
  const weeksTotal = pcts.reduce((acc, _, i) => acc + weekQty(i), 0);

  const monthlyEditable = !row.locked || monthlyUnlocked;

  const saveMonthly = useMutation({
    mutationFn: async () => {
      let unlockKey: string | undefined;
      if (row.locked) {
        const typed = window.prompt('El forca de ese mes ya está fijado. Ingresa la clave especial para cambiarlo:') ?? undefined;
        if (!typed) throw new Error('Cambio cancelado: falta la clave especial.');
        unlockKey = typed;
      }
      return apiFetch(`/forecast/${encodeURIComponent(row.productCode)}`, {
        method: 'PUT',
        body: JSON.stringify({ year, month, monthlyQty: monthlyNum, unlockKey }),
      });
    },
    onSuccess: () => {
      setMonthlyUnlocked(false);
      onSaved();
    },
  });

  const saveWeeks = useMutation({
    mutationFn: () =>
      apiFetch(`/forecast/${encodeURIComponent(row.productCode)}/weeks`, {
        method: 'PATCH',
        body: JSON.stringify({
          year,
          month,
          weeks: pcts.map((pct, i) => ({ weekIndex: i + 1, pct: Number(pct.replace(',', '.')) || 0 })),
        }),
      }),
    onSuccess: onSaved,
  });

  const busy = saveMonthly.isPending || saveWeeks.isPending;
  const feedback = saveMonthly.error ?? saveWeeks.error;
  const ok = saveMonthly.isSuccess || saveWeeks.isSuccess;

  return (
    <tr className="transition-colors hover:bg-surface-container-low">
      <Td className="font-bold tabular-nums text-primary">{row.productCode}</Td>
      <Td className="max-w-[18rem] truncate" title={row.description}>{row.description}</Td>
      <Td align="right" className="tabular-nums">{fmtQty(row.stockTotal, 0)}</Td>
      <Td align="right" className={`tabular-nums ${row.demandMonthQty > 0 ? 'font-semibold text-on-surface' : 'text-outline'}`}>
        {fmtQty(row.demandMonthQty, 0)}
      </Td>
      <Td align="right">
        <div className="flex items-center justify-end gap-space-xs">
          <input
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            disabled={!monthlyEditable}
            inputMode="decimal"
            className="h-9 w-24 rounded-lg bg-surface px-space-sm text-right tabular-nums text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Forca mensual"
          />
          {row.locked && !monthlyUnlocked && (
            <button
              onClick={() => setMonthlyUnlocked(true)}
              title="El mes está fijado; habilita para cambiar (pedirá la clave)"
              className="flex h-8 items-center gap-space-2xs rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low"
            >
              <Lock aria-hidden className="size-3.5" /> Fijado
            </button>
          )}
        </div>
      </Td>
      {row.weeks.map((w, i) => (
        <Td key={w.weekIndex} align="center">
          <div className="flex flex-col items-center gap-space-2xs">
            <div className="flex items-center gap-space-2xs">
              <input
                value={pcts[i] ?? '100'}
                onChange={(e) => setPcts((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                inputMode="decimal"
                className="h-7 w-14 rounded-md bg-surface px-space-2xs text-right tabular-nums text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
                aria-label={`${weekLabels[i] ?? 'Semana'} %`}
              />
              <span className="text-label-sm text-outline">%</span>
            </div>
            <span className="tabular-nums text-label-sm font-semibold text-on-surface">{fmtQty(weekQty(i), 0)}</span>
          </div>
        </Td>
      ))}
      <Td align="right" className="tabular-nums font-bold">{fmtQty(weeksTotal, 0)}</Td>
      <Td align="center">
        <Badge tone={row.locked ? 'primary' : 'muted'}>{row.locked ? 'Fijado' : 'Sin fijar'}</Badge>
      </Td>
      <Td align="right">
        <div className="flex flex-col items-end gap-space-2xs">
          <div className="flex items-center gap-space-xs">
            <button
              onClick={() => saveMonthly.mutate()}
              disabled={busy || !monthlyEditable}
              title="Fijar / guardar el forca del mes"
              className="flex h-8 items-center gap-space-2xs rounded-md bg-primary-container px-space-sm text-label-sm font-semibold text-on-primary hover:bg-primary disabled:opacity-50"
            >
              {row.locked && !monthlyUnlocked ? <Lock aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />} Fijar mes
            </button>
            <button
              onClick={() => saveWeeks.mutate()}
              disabled={busy}
              title="Guardar factores de semana (siempre editable)"
              className="flex h-8 items-center gap-space-2xs rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
            >
              <Save aria-hidden className="size-3.5" /> Semanas
            </button>
          </div>
          {ok && <span className="text-label-sm text-success">Guardado</span>}
          {feedback && <span className="max-w-[16rem] text-label-sm text-error">{feedback instanceof Error ? feedback.message : 'Error'}</span>}
        </div>
      </Td>
    </tr>
  );
}

// ---------- Reporte / plan de producción ----------
function PlanReport({ data }: { data: ForecastPlanResponse }) {
  const weeks = data.weekRanges;
  const chart = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 10, bottom: 40, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmtQty(v, 0)} unid.` },
      legend: { bottom: 2, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: C.outline, fontSize: 11 } },
      xAxis: { type: 'category', data: weeks.map((w) => w.label), axisLabel: { color: C.outline, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: C.outline, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: 'Demanda', type: 'bar', data: weeks.map((w) => data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0)), color: C.navy, barMaxWidth: 26 },
        { name: 'Producción', type: 'bar', data: weeks.map((w) => data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.productionQty ?? 0), 0)), color: C.red, barMaxWidth: 26 },
      ],
    }),
    [data, weeks],
  );

  function exportCsv() {
    const header = ['Codigo', 'Descripcion', 'Stock'];
    for (const w of weeks) header.push(`${w.label} Forca`, `${w.label} Demanda`, `${w.label} Produccion`);
    header.push('Prod mes (unid)', 'Prod mes (kg)');
    const rows = data.rows.map((r) => {
      const out: string[] = [r.productCode, r.description, String(r.stockTotal)];
      for (const w of weeks) {
        const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
        out.push(String(wk?.forcaQty ?? 0), String(wk?.demandQty ?? 0), String(wk?.productionQty ?? 0));
      }
      out.push(String(r.productionMonthQty), String(r.productionMonthKg));
      return out;
    });
    const csv = [header, ...rows].map((line) => line.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plan-produccion-${data.year}-${String(data.month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <Card className="p-space-md lg:col-span-7">
          <div className="mb-space-xs font-semibold uppercase text-label-sm text-outline">Demanda vs producción por semana (unidades)</div>
          <EChart option={chart} height={230} ariaLabel="Demanda versus producción por semana" />
        </Card>
        <Card className="flex flex-col justify-between p-space-md lg:col-span-5">
          <div className="grid grid-cols-2 gap-space-sm">
            <Kpi label="Forca del mes" value={fmtQty(data.totals.forcaQty, 0)} suffix="unid." tone="primary" />
            <Kpi label="Demanda del mes" value={fmtQty(data.totals.demandQty, 0)} suffix="unid." tone="default" />
            <Kpi label="Producción total" value={fmtQty(data.totals.productionQty, 0)} suffix="unid." tone="danger" />
            <Kpi label="Producción en kg" value={fmtQty(data.totals.productionKg, 0)} suffix="kg" tone="danger" />
          </div>
          <button
            onClick={exportCsv}
            className="mt-space-md flex h-9 items-center justify-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary hover:bg-primary"
          >
            <Download aria-hidden className="size-4" /> Exportar plan (CSV)
          </button>
          <p className="mt-space-sm text-label-sm text-on-surface-variant">
            Regla: <strong>producción = max(0, max(forca, demanda) − stock global)</strong> por semana y artículo.
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body-md">
            <thead className="bg-surface-container">
              <tr className="border-b border-surface-container">
                <Th rowSpan={2}>Código</Th>
                <Th rowSpan={2}>Descripción</Th>
                <Th rowSpan={2} align="right">Stock</Th>
                {weeks.map((w) => (
                  <Th key={w.weekIndex} align="center" className="border-l border-surface-container">{w.label}</Th>
                ))}
                <Th rowSpan={2} align="right" className="border-l border-surface-container">Prod. mes</Th>
              </tr>
              <tr className="border-b border-surface-container">
                {weeks.map((w) => (
                  <Fragment key={w.weekIndex}>
                    <Th align="right" className="border-l border-surface-container">Forca</Th>
                    <Th align="right">Dem.</Th>
                    <Th align="right">Prod.</Th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {data.rows.map((r) => (
                <tr key={r.productCode} className="transition-colors hover:bg-surface-container-low">
                  <Td className="font-bold tabular-nums text-primary">{r.productCode}</Td>
                  <Td className="max-w-[16rem] truncate" title={r.description}>{r.description}</Td>
                  <Td align="right" className="tabular-nums">{fmtQty(r.stockTotal, 0)}</Td>
                  {weeks.map((w) => {
                    const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
                    return (
                      <Fragment key={w.weekIndex}>
                        <Td align="right" className="border-l border-surface-container tabular-nums text-on-surface-variant">{fmtQty(wk?.forcaQty ?? 0, 0)}</Td>
                        <Td align="right" className="tabular-nums">{fmtQty(wk?.demandQty ?? 0, 0)}</Td>
                        <Td align="right" className={`tabular-nums font-bold ${(wk?.productionQty ?? 0) > 0 ? 'text-error' : 'text-outline'}`}>{fmtQty(wk?.productionQty ?? 0, 0)}</Td>
                      </Fragment>
                    );
                  })}
                  <Td align="right" className="border-l border-surface-container tabular-nums font-bold text-primary">{fmtQty(r.productionMonthQty, 0)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <Td colSpan={3} className="uppercase text-label-sm text-outline">Totales</Td>
                {weeks.map((w) => {
                  const dem = data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0);
                  const prod = data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.productionQty ?? 0), 0);
                  return (
                    <Fragment key={w.weekIndex}>
                      <Td align="right" className="border-l border-surface-container tabular-nums text-on-surface-variant">—</Td>
                      <Td align="right" className="tabular-nums">{fmtQty(dem, 0)}</Td>
                      <Td align="right" className="tabular-nums text-error">{fmtQty(prod, 0)}</Td>
                    </Fragment>
                  );
                })}
                <Td align="right" className="border-l border-surface-container tabular-nums text-error">{fmtQty(data.totals.productionQty, 0)}</Td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}

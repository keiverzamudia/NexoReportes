'use client';

// ============================================================
// Forca — pronóstico de producción (línea ABA = alimentos balanceados).
//
//  · Pestaña «Asignador»: forca MENSUAL por artículo (se fija y queda
//    bloqueado; para cambiarlo pide la clave especial) + CANTIDAD por cada
//    una de las 4 semanas. Por defecto se llena con el PROMEDIO
//    (forca mensual / 4) y esa cantidad se ajusta semana a semana.
//  · Pestaña «Reporte»: se elige la SEMANA a evaluar (o «Todas»). Para una
//    semana se muestra, por artículo, el forca y además los mismos campos de
//    la tabla de Disponibilidad (Stock 03/68, Existencia, Demanda,
//    Disponible, A producir, kg, Neto, Estado), calculados con el motor de
//    disponibilidad sobre la demanda objetivo = max(forca, demanda).
//
//  Datos propios de Nexo: NUNCA se escribe en Profit.
// ============================================================

import type { AvailabilityStatus, ForecastPlanResponse, ForecastResponse, ForecastRow, ForecastWeekRow } from '@nexo/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Check, Download, Lock, Save, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
import { AppNav, LoginScreen } from '../../components/shell';
import { Badge, Card, Kpi, PageHeader, Segmented, Select, Td, TextInput, Th, fmtQty } from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const C = { navy: '#003366', red: '#dc2626', lime: '#95C800', outline: '#737780', grid: '#e1f0ff' };

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

type Tab = 'asignador' | 'reporte';

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Bloque semanal al que pertenece un día (1-7 / 8-14 / 15-21 / 22-fin).
function weekIndexOf(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function parseNumber(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
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
          subtitle="Pronóstico mensual por artículo repartido en las semanas del mes por cantidad. Al fijar el mes queda bloqueado (se cambia con clave); las cantidades por semana siguen editables."
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
                        <Th align="right">Promedio</Th>
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
                          onSaved={() => forecast.refetch()}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
                  Las cantidades de cada semana se llenan por defecto con el <strong>promedio = forca mes / 4</strong> y son
                  libremente editables. «Fijar mes» guarda el forca mensual (y pide clave si ya estaba fijado).
                </div>
              </Card>
            )}
          </>
        )}

        {tab === 'reporte' && (
          <>
            {plan.isLoading && <p className="text-body-md text-on-surface-variant">Calculando plan de producción…</p>}
            {plan.data && <PlanReport key={ym} data={plan.data} />}
          </>
        )}
      </main>
    </>
  );
}

// ---------- Editor de una fila (forca mensual + cantidad por semana) ----------
function ForecastEditor({
  row,
  year,
  month,
  onSaved,
}: {
  row: ForecastRow;
  year: number;
  month: number;
  onSaved: () => void;
}) {
  const [monthly, setMonthly] = useState(String(row.monthlyQty));
  const [qtys, setQtys] = useState<string[]>(row.weeks.map((w) => String(w.qty)));
  const [monthlyUnlocked, setMonthlyUnlocked] = useState(false);

  const monthlyNum = parseNumber(monthly);
  const weeksTotal = qtys.reduce((acc, q) => acc + parseNumber(q), 0);
  const monthlyEditable = !row.locked || monthlyUnlocked;

  const applyWeeks = (weeks: ForecastWeekRow[]) => {
    if (weeks.length === 4) setQtys(weeks.map((w) => String(w.qty)));
  };

  const saveMonthly = useMutation<{ weeks: ForecastWeekRow[] }, Error, void>({
    mutationFn: async () => {
      let unlockKey: string | undefined;
      if (row.locked) {
        const typed = window.prompt('El forca de ese mes ya está fijado. Ingresa la clave especial para cambiarlo:') ?? undefined;
        if (!typed) throw new Error('Cambio cancelado: falta la clave especial.');
        unlockKey = typed;
      }
      return apiFetch<{ weeks: ForecastWeekRow[] }>(`/forecast/${encodeURIComponent(row.productCode)}`, {
        method: 'PUT',
        body: JSON.stringify({ year, month, monthlyQty: monthlyNum, unlockKey }),
      });
    },
    onSuccess: (data) => {
      setMonthlyUnlocked(false);
      applyWeeks(data.weeks ?? []);
      onSaved();
    },
  });

  const saveWeeks = useMutation<{ weeks: ForecastWeekRow[] }, Error, void>({
    mutationFn: () =>
      apiFetch<{ weeks: ForecastWeekRow[] }>(`/forecast/${encodeURIComponent(row.productCode)}/weeks`, {
        method: 'PATCH',
        body: JSON.stringify({
          year,
          month,
          weeks: qtys.map((q, i) => ({ weekIndex: i + 1, qty: parseNumber(q) })),
        }),
      }),
    onSuccess: (data) => {
      applyWeeks(data.weeks ?? []);
      onSaved();
    },
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
      <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(row.averageQty, 0)}</Td>
      {row.weeks.map((w, i) => (
        <Td key={w.weekIndex} align="center">
          <input
            value={qtys[i] ?? ''}
            onChange={(e) => setQtys((prev) => prev.map((q, idx) => (idx === i ? e.target.value : q)))}
            inputMode="decimal"
            className={`h-8 w-20 rounded-md px-space-2xs text-right tabular-nums text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container ${
              parseNumber(qtys[i] ?? '') !== row.averageQty ? 'bg-amber-50 font-semibold' : 'bg-surface'
            }`}
            aria-label={`Semana ${w.weekIndex}`}
          />
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
              title="Fijar / guardar el forca del mes. Si cambia el valor, el reparto semanal vuelve al promedio."
              className="flex h-8 items-center gap-space-2xs rounded-md bg-primary-container px-space-sm text-label-sm font-semibold text-on-primary hover:bg-primary disabled:opacity-50"
            >
              {row.locked && !monthlyUnlocked ? <Lock aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />} Fijar mes
            </button>
            <button
              onClick={() => saveWeeks.mutate()}
              disabled={busy}
              title="Guardar las cantidades por semana (siempre editable)"
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
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === data.year && today.getMonth() + 1 === data.month;
  const defaultWeek = isCurrentMonth ? String(weekIndexOf(today.getDate())) : '1';
  const [selected, setSelected] = useState<string>(defaultWeek);

  const weekOptions = [
    ...weeks.map((w) => ({ value: String(w.weekIndex), label: `Semana ${w.weekIndex} (${w.from.slice(8)}-${w.to.slice(8)})` })),
    { value: 'all', label: 'Todas las semanas' },
  ];
  const weekIndex = selected === 'all' ? null : Number(selected);
  const selectedRange = weeks.find((w) => w.weekIndex === weekIndex) ?? null;

  const chart = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 10, bottom: 40, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmtQty(v, 0)} unid.` },
      legend: { bottom: 2, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: C.outline, fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: weeks.map((w) => w.label),
        axisLabel: { color: C.outline, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: { type: 'value', axisLabel: { color: C.outline, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: 'Demanda', type: 'bar', data: weeks.map((w) => data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0)), color: C.navy, barMaxWidth: 26 },
        { name: 'A producir', type: 'bar', data: weeks.map((w) => data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.toProduceQty ?? 0), 0)), color: C.red, barMaxWidth: 26 },
      ],
    }),
    [data, weeks],
  );

  // Totales de la semana elegida (o del mes si se ven todas).
  const totals = useMemo(() => {
    const pick = (w: (typeof data.rows)[number]['weeks'][number]) => w;
    if (weekIndex === null) {
      return {
        forca: data.totals.forcaQty,
        demand: data.totals.demandQty,
        toProduce: data.totals.productionQty,
        toProduceKg: data.totals.productionKg,
      };
    }
    const ws = data.rows.map((r) => r.weeks.find((w) => w.weekIndex === weekIndex)).filter(Boolean).map((w) => pick(w!));
    return {
      forca: ws.reduce((a, w) => a + w.forcaQty, 0),
      demand: ws.reduce((a, w) => a + w.demandQty, 0),
      toProduce: ws.reduce((a, w) => a + w.toProduceQty, 0),
      toProduceKg: ws.reduce((a, w) => a + (w.toProduceKg ?? 0), 0),
    };
  }, [data, weekIndex]);

  function exportCsv() {
    const header = ['Codigo', 'Descripcion', 'Unid', 'Stock 03', 'Stock 68', 'Existencia'];
    if (weekIndex === null) {
      for (const w of weeks) header.push(`${w.label} Forca`, `${w.label} Demanda`, `${w.label} A producir`);
    } else {
      header.push('Promedio', `S${weekIndex} Forca`, `S${weekIndex} Demanda`, 'Disponible', 'A producir', 'A producir (kg)', 'Neto', 'Estado');
    }
    header.push('Prod mes (unid)', 'Prod mes (kg)');
    const body = data.rows.map((r) => {
      const out: string[] = [r.productCode, r.description, r.uom, String(r.stock03), String(r.stock68), String(r.stockTotal)];
      if (weekIndex === null) {
        for (const w of weeks) {
          const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
          out.push(String(wk?.forcaQty ?? 0), String(wk?.demandQty ?? 0), String(wk?.toProduceQty ?? 0));
        }
      } else {
        const wk = r.weeks.find((x) => x.weekIndex === weekIndex);
        out.push(
          String(r.averageQty),
          String(wk?.forcaQty ?? 0),
          String(wk?.demandQty ?? 0),
          String(wk?.availableQty ?? 0),
          String(wk?.toProduceQty ?? 0),
          String(wk?.toProduceKg ?? ''),
          String(wk?.netQty ?? 0),
          wk?.status ?? '',
        );
      }
      out.push(String(r.productionMonthQty), String(r.productionMonthKg));
      return out;
    });
    const csv = [header, ...body].map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const suffix = weekIndex === null ? 'todas' : `s${weekIndex}`;
    link.download = `plan-produccion-${data.year}-${String(data.month).padStart(2, '0')}-${suffix}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <Card className="p-space-md lg:col-span-7">
          <div className="mb-space-xs font-semibold uppercase text-label-sm text-outline">Demanda vs a producir por semana (unidades)</div>
          <EChart option={chart} height={230} ariaLabel="Demanda versus producción por semana" />
        </Card>
        <Card className="flex flex-col justify-between gap-space-md p-space-md lg:col-span-5">
          <label className="flex flex-col gap-space-2xs">
            <span className="font-semibold uppercase text-label-sm text-outline">Semana a evaluar</span>
            <Select value={selected} onChange={setSelected} options={weekOptions} ariaLabel="Semana a evaluar" />
            <span className="text-label-sm text-on-surface-variant">
              {selectedRange
                ? `Del ${selectedRange.from} al ${selectedRange.to}.`
                : 'Vista consolidada de todo el mes.'}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-space-sm">
            <Kpi label={weekIndex === null ? 'Forca del mes' : 'Forca de la semana'} value={fmtQty(totals.forca, 0)} suffix="unid." tone="primary" />
            <Kpi label={weekIndex === null ? 'Demanda del mes' : 'Demanda de la semana'} value={fmtQty(totals.demand, 0)} suffix="unid." />
            <Kpi label="A producir" value={fmtQty(totals.toProduce, 0)} suffix="unid." tone="danger" />
            <Kpi label="A producir en kg" value={fmtQty(totals.toProduceKg, 0)} suffix="kg" tone="danger" />
          </div>
          <button
            onClick={exportCsv}
            className="flex h-9 items-center justify-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary hover:bg-primary"
          >
            <Download aria-hidden className="size-4" /> Exportar plan (CSV)
          </button>
          <p className="text-label-sm text-on-surface-variant">
            Cada semana: <strong>a producir = max(0, max(forca, demanda) − existencia)</strong>. Los campos de existencia,
            disponible, neto y estado usan el mismo cálculo que la vista de Disponibilidad.
          </p>
        </Card>
      </div>

      {weekIndex === null ? (
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
                          <Td align="right" className={`tabular-nums font-bold ${(wk?.toProduceQty ?? 0) > 0 ? 'text-error' : 'text-outline'}`}>{fmtQty(wk?.toProduceQty ?? 0, 0)}</Td>
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
                    const f = data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.forcaQty ?? 0), 0);
                    const dem = data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0);
                    const prod = data.rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.toProduceQty ?? 0), 0);
                    return (
                      <Fragment key={w.weekIndex}>
                        <Td align="right" className="border-l border-surface-container tabular-nums text-on-surface-variant">{fmtQty(f, 0)}</Td>
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
      ) : (
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
                  <Th align="right">Promedio</Th>
                  <Th align="right">Forca sem.</Th>
                  <Th align="right">Disponible</Th>
                  <Th align="right">A producir</Th>
                  <Th align="right">A producir (kg)</Th>
                  <Th align="right">Neto</Th>
                  <Th align="center">Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {data.rows.map((r) => {
                  const wk = r.weeks.find((x) => x.weekIndex === weekIndex);
                  if (!wk) return null;
                  return (
                    <tr key={r.productCode} className="transition-colors hover:bg-surface-container-low">
                      <Td className="font-bold tabular-nums text-primary">{r.productCode}</Td>
                      <Td className="max-w-[16rem] truncate" title={r.description}>{r.description}</Td>
                      <Td className="text-on-surface-variant">{r.uom}</Td>
                      <Td align="right" className="tabular-nums">{fmtQty(r.stock03, 0)}</Td>
                      <Td align="right" className="tabular-nums">{fmtQty(r.stock68, 0)}</Td>
                      <Td align="right" className="tabular-nums font-bold">{fmtQty(r.stockTotal, 0)}</Td>
                      <Td align="right" className="tabular-nums">{fmtQty(wk.demandQty, 0)}</Td>
                      <Td align="right" className="tabular-nums text-on-surface-variant">{fmtQty(r.averageQty, 0)}</Td>
                      <Td align="right" className="tabular-nums font-semibold text-on-surface">{fmtQty(wk.forcaQty, 0)}</Td>
                      <Td align="right" className="tabular-nums font-bold text-secondary">{fmtQty(wk.availableQty, 0)}</Td>
                      <Td align="right" className={`tabular-nums font-bold ${wk.toProduceQty > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                        {fmtQty(wk.toProduceQty, 0)}
                      </Td>
                      <Td align="right" className={`tabular-nums ${wk.toProduceKg && wk.toProduceKg > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                        {fmtQty(wk.toProduceKg, 0)}
                      </Td>
                      <Td align="right" className={`tabular-nums ${wk.netQty < 0 ? 'text-error' : ''}`}>{fmtQty(wk.netQty, 0)}</Td>
                      <Td align="center">
                        <Badge tone={STATUS_TONE[wk.status]}>{STATUS_LABEL[wk.status]}</Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                  <Td colSpan={6} className="uppercase text-label-sm text-outline">Totales de la semana</Td>
                  <Td align="right" className="tabular-nums">{fmtQty(totals.demand, 0)}</Td>
                  <Td />
                  <Td align="right" className="tabular-nums">{fmtQty(totals.forca, 0)}</Td>
                  <Td />
                  <Td align="right" className="tabular-nums text-error">{fmtQty(totals.toProduce, 0)}</Td>
                  <Td align="right" className="tabular-nums text-error">{fmtQty(totals.toProduceKg, 0)}</Td>
                  <Td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

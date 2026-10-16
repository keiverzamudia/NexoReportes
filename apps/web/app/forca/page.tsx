'use client';

// ============================================================
// Forca — pronóstico de producción (línea ABA = alimentos balanceados).
//
//  · Pestaña «Asignador»: forca mensual por artículo (se fija y queda
//    bloqueado; se cambia con la clave especial) + cantidad por cada una de
//    las 4 semanas. Por defecto se llena con el promedio (forca mes / 4).
//  · Pestaña «Reporte»: se elige la semana a evaluar (o todo el mes). Por
//    semana se muestra, además del forca, los mismos campos de la tabla de
//    Disponibilidad por Producto, calculados con el motor de disponibilidad
//    sobre la demanda objetivo = max(forca de la semana, demanda de la semana).
//
//  Datos propios de Nexo: NUNCA se escribe en Profit.
//  Contrato de UI: docs/design/DESIGN_SYSTEM.md
// ============================================================

import type { AvailabilityStatus, ForecastPlanResponse, ForecastRow, ForecastResponse, ForecastWeekRow } from '@nexo/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarRange, Check, Download, Lock, Save, Search, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
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
  Segmented,
  Select,
  TextInput,
  cx,
  fmtInt,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Cubierto',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin forca ni demanda',
};

const STATUS_TONE: Record<AvailabilityStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  DISPONIBLE: 'success',
  PARCIAL: 'warning',
  FALTANTE: 'danger',
  SIN_DEMANDA: 'muted',
};

const CHART = { navy: '#003366', lime: '#95C800', red: '#dc2626', outline: '#737780', grid: '#e1f0ff' };

type Tab = 'asignador' | 'reporte';
type UnitFilter = 'ALL' | 'SAC' | 'KG';

const UNIT_OPTIONS: { value: UnitFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SAC', label: 'Saco' },
  { value: 'KG', label: 'Granel (kg)' },
];

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
  const [unit, setUnit] = useState<UnitFilter>('ALL');

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

  const error = forecast.error ?? plan.error;
  if (error instanceof AuthRequiredError) return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;

  const all = forecast.data?.rows ?? [];
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (unit === 'ALL' || r.uom === unit) &&
        (!onlyDemand || r.demandMonthQty > 0) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [all, search, onlyDemand, unit]);

  const totals = useMemo(
    () => ({
      forca: all.reduce((a, r) => a + r.monthlyQty, 0),
      locked: all.filter((r) => r.locked).length,
      demand: all.reduce((a, r) => a + r.demandMonthQty, 0),
    }),
    [all],
  );

  const filtersActive = (unit !== 'ALL' ? 1 : 0) + (onlyDemand ? 1 : 0);

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-xl">
        <PageHeader
          icon={CalendarRange}
          title="Forca"
          subtitle={`Pronóstico mensual por artículo repartido en las semanas del mes. Al fijar el mes queda bloqueado (se cambia con la clave especial); las cantidades por semana siguen editables.${
            forecast.data?.rows.length ? ` ${forecast.data.rows.length} artículos de la línea ABA.` : ''
          }`}
        />

        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-3 xl:grid-cols-4">
          <Kpi label="Artículos" value={String(rows.length)} icon={CalendarRange} hint={rows.length === all.length ? undefined : `de ${all.length}`} />
          <Kpi label="Forca del mes" value={fmtInt(totals.forca)} suffix="unid." tone="primary" />
          <Kpi label="Fijados" value={`${totals.locked}/${all.length}`} tone={totals.locked > 0 ? 'success' : 'muted'} />
          <Kpi label="Demanda del mes" value={fmtInt(totals.demand)} suffix="unid." tone="default" />
        </div>

        <Card>
          <div className="flex flex-col gap-space-md border-b border-surface-container px-space-lg py-space-md xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-space-md">
              <label className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Mes</span>
                <input
                  type="month"
                  value={ym}
                  onChange={(e) => setYm(e.target.value || currentMonthValue())}
                  className="h-11 rounded-lg bg-surface-container-low px-space-sm text-base text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container md:h-9 md:text-body-md"
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
              <div className="flex items-center gap-space-sm">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Presentación</span>
                <Segmented ariaLabel="Presentación" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
              </div>
            </div>
          </div>

          {tab === 'asignador' && (
            <FilterBar
              activeCount={filtersActive}
              search={<TextInput icon={Search} value={search} onChange={setSearch} placeholder="Buscar artículo o código…" ariaLabel="Buscar artículo" />}
              filters={
                <>
                  <label className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={onlyDemand}
                      onChange={(e) => setOnlyDemand(e.target.checked)}
                      className="size-4 accent-[var(--color-primary-container)]"
                    />
                    Solo con demanda
                  </label>
                </>
              }
            />
          )}
        </Card>

        {error && !(error instanceof AuthRequiredError) && <ErrorNote>{error instanceof Error ? error.message : 'Error al consultar'}</ErrorNote>}

        {tab === 'asignador' && (
          <Asignador rows={rows} year={year} month={month} loading={forecast.isLoading} totalRows={all.length} onSaved={() => forecast.refetch()} />
        )}

        {tab === 'reporte' && <Reporte data={plan.data} loading={plan.isLoading} unit={unit} />}
      </main>
    </>
  );
}

// ============================================================
// Asignador: forca mensual + cantidades por semana.
// El borrador vive en el estado de la página (un mapa por código) para que
// cada fila siga siendo "tonta" y la tabla se ordene sin perder lo escrito.
// ============================================================

type Draft = { monthly: string; weeks: string[] };

function Asignador({
  rows,
  year,
  month,
  loading,
  totalRows,
  onSaved,
}: {
  rows: ForecastRow[];
  year: number;
  month: number;
  loading: boolean;
  totalRows: number;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState<Record<string, { tone: 'ok' | 'error'; text: string }>>({});

  const write = (code: string, draft: Draft) => setDrafts((prev) => ({ ...prev, [code]: draft }));
  const clear = (code: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  const note = (code: string, tone: 'ok' | 'error', text: string) => setNotes((prev) => ({ ...prev, [code]: { tone, text } }));

  const saveMonthly = useMutation<{ weeks: ForecastWeekRow[] }, Error, ForecastRow>({
    mutationFn: async (row) => {
      const draft = drafts[row.productCode];
      const monthlyQty = parseNumber(draft?.monthly ?? String(row.monthlyQty));
      let unlockKey: string | undefined;
      if (row.locked) {
        const typed = window.prompt('El forca de ese mes ya está fijado. Ingresa la clave especial para cambiarlo:') ?? undefined;
        if (!typed) throw new Error('Cambio cancelado: falta la clave especial.');
        unlockKey = typed;
      }
      return apiFetch<{ weeks: ForecastWeekRow[] }>(`/forecast/${encodeURIComponent(row.productCode)}`, {
        method: 'PUT',
        body: JSON.stringify({ year, month, monthlyQty, unlockKey }),
      });
    },
    onSuccess: (_data, row) => {
      clear(row.productCode);
      note(row.productCode, 'ok', 'Mes fijado');
      onSaved();
    },
    onError: (err, row) => note(row.productCode, 'error', err.message),
  });

  const saveWeeks = useMutation<{ weeks: ForecastWeekRow[] }, Error, ForecastRow>({
    mutationFn: async (row) => {
      const draft = drafts[row.productCode];
      const weeks = (draft?.weeks ?? row.weeks.map((w) => String(w.qty))).map((q, i) => ({ weekIndex: i + 1, qty: parseNumber(q) }));
      return apiFetch<{ weeks: ForecastWeekRow[] }>(`/forecast/${encodeURIComponent(row.productCode)}/weeks`, {
        method: 'PATCH',
        body: JSON.stringify({ year, month, weeks }),
      });
    },
    onSuccess: (_data, row) => {
      clear(row.productCode);
      note(row.productCode, 'ok', 'Semanas guardadas');
      onSaved();
    },
    onError: (err, row) => note(row.productCode, 'error', err.message),
  });

  const busy = saveMonthly.isPending || saveWeeks.isPending;

  const columns: Column<ForecastRow>[] = [
    {
      key: 'code',
      header: 'Código',
      kind: 'id',
      render: (r) => r.productCode,
      sortValue: (r) => r.productCode,
    },
    {
      key: 'description',
      header: 'Descripción',
      kind: 'id',
      className: 'max-w-[13rem]',
      render: (r) => r.description,
      title: (r) => r.description,
      sortValue: (r) => r.description,
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
      header: 'Demanda mes',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className={r.demandMonthQty > 0 ? 'font-bold text-on-surface' : 'text-outline'}>{fmtInt(r.demandMonthQty)}</span>,
      sortValue: (r) => r.demandMonthQty,
    },
    {
      key: 'monthly',
      header: 'Forca mes',
      align: 'right',
      kind: 'metric',
      render: (r) => {
        const draft = drafts[r.productCode];
        return (
          <span className="inline-flex items-center">
            <input
              value={draft?.monthly ?? String(r.monthlyQty)}
              onChange={(e) => write(r.productCode, { monthly: e.target.value, weeks: draft?.weeks ?? r.weeks.map((w) => String(w.qty)) })}
              inputMode="decimal"
              aria-label={`Forca mensual de ${r.productCode}`}
              className={cx(
                'h-11 w-16 rounded-lg px-space-2xs text-right tabular-nums text-base text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container md:h-8 md:text-body-md',
                r.locked ? 'bg-surface-container' : 'bg-surface-container-low',
              )}
            />
          </span>
        );
      },
      sortValue: (r) => r.monthlyQty,
    },
    {
      key: 'average',
      header: 'Promedio',
      align: 'right',
      kind: 'detail',
      render: (r) => <span className="text-on-surface-variant">{fmtInt(r.averageQty)}</span>,
      sortValue: (r) => r.averageQty,
    },
    ...[0, 1, 2, 3].map((i) => ({
      key: `w${i + 1}`,
      header: `S${i + 1}`,
      align: 'right' as const,
      kind: 'metric' as const,
      render: (r: ForecastRow) => {
        const draft = drafts[r.productCode];
        const value = draft?.weeks?.[i] ?? String(r.weeks[i]?.qty ?? 0);
        const changed = parseNumber(value) !== r.averageQty;
        return (
          <input
            value={value}
            onChange={(e) => {
              const weeks = (draft?.weeks ?? r.weeks.map((w) => String(w.qty))).map((q, idx) => (idx === i ? e.target.value : q));
              write(r.productCode, { monthly: draft?.monthly ?? String(r.monthlyQty), weeks });
            }}
            inputMode="decimal"
            aria-label={`Semana ${i + 1} de ${r.productCode}`}
            className={cx(
              'h-11 w-14 rounded-lg px-space-2xs text-right tabular-nums text-base text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container md:h-8 md:text-body-md',
              changed ? 'bg-warning-container font-semibold' : 'bg-surface-container-low',
            )}
          />
        );
      },
    })),
    {
      key: 'total',
      header: 'Total sem.',
      align: 'right',
      kind: 'metric',
      render: (r) => {
        const draft = drafts[r.productCode];
        const total = draft?.weeks ? draft.weeks.reduce((a, q) => a + parseNumber(q), 0) : r.weeksTotalQty;
        return <span className="font-bold text-primary">{fmtInt(total)}</span>;
      },
      sortValue: (r) => r.weeksTotalQty,
    },
    {
      key: 'state',
      header: 'Estado',
      align: 'center',
      kind: 'status',
      render: (r) => <Badge tone={r.locked ? 'primary' : 'muted'} dot>{r.locked ? 'Fijado' : 'Sin fijar'}</Badge>,
      sortValue: (r) => (r.locked ? 1 : 0),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      className: 'whitespace-nowrap',
      render: (r) => {
        const dirty = Boolean(drafts[r.productCode]);
        const noteForRow = notes[r.productCode];
        return (
          <div className="flex flex-col items-end gap-space-2xs">
            <div className="flex flex-nowrap items-center justify-end gap-space-xs">
              <Button
                variant={r.locked ? 'outline' : 'primary'}
                icon={r.locked ? Lock : Check}
                onClick={() => saveMonthly.mutate(r)}
                disabled={busy}
                ariaLabel={`Fijar el forca de ${r.productCode}`}
                title="Fijar y bloquear el forca del mes. Si cambia el valor, el reparto vuelve al promedio."
                className="md:h-8"
              >
                <span className="hidden max-md:inline">Fijar mes</span>
              </Button>
              <Button
                variant="outline"
                icon={Save}
                onClick={() => saveWeeks.mutate(r)}
                disabled={busy}
                ariaLabel={`Guardar las semanas de ${r.productCode}`}
                title="Guardar las cantidades por semana (siempre editable)"
                className="md:h-8"
              >
                <span className="hidden max-md:inline">Semanas</span>
              </Button>
            </div>
            {dirty && !noteForRow && <span className="text-label-sm text-warning">Sin guardar</span>}
            {noteForRow && (
              <span className={cx('max-w-[16rem] text-label-sm', noteForRow.tone === 'ok' ? 'text-success' : 'text-critical')}>{noteForRow.text}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Asignador del forca"
        description="Cada semana se llena por defecto con el promedio = forca mes ÷ 4 y es libremente editable. Las celdas en ámbar se apartaron del promedio."
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productCode}
        loading={loading}
        loadingRows={8}
        defaultSortKey="code"
        empty={
          <EmptyState
            icon={CalendarRange}
            title={rows.length === 0 && totalRows > 0 ? 'Sin artículos para los filtros aplicados' : 'Aún no hay artículos de producción'}
            description={
              rows.length === 0 && totalRows > 0
                ? 'Prueba con otra presentación, quita «Solo con demanda» o borra la búsqueda.'
                : 'Sincroniza para traer el catálogo de la línea ABA desde Profit.'
            }
          />
        }
      />
    </Card>
  );
}

// ============================================================
// Reporte: plan de producción por semana.
// ============================================================

function Reporte({ data, loading, unit }: { data: ForecastPlanResponse | undefined; loading: boolean; unit: UnitFilter }) {
  const today = new Date();
  const isCurrentMonth = data ? today.getFullYear() === data.year && today.getMonth() + 1 === data.month : false;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? (isCurrentMonth ? String(weekIndexOf(today.getDate())) : '1');
  const setSelected = (value: string) => setPicked(value);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => unit === 'ALL' || r.uom === unit), [data, unit]);
  const weeks = data?.weekRanges ?? [];
  const weekIndex = selected === 'all' ? null : Number(selected);
  const selectedRange = weeks.find((w) => w.weekIndex === weekIndex) ?? null;

  const chart = useMemo(() => {
    if (!data) return {};
    const byWeek = (w: number, pick: 'demandQty' | 'toProduceQty') =>
      rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w)?.[pick] ?? 0), 0);
    return {
      grid: { left: 4, right: 8, top: 24, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmtInt(v)} unid.` },
      legend: { top: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: CHART.outline, fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: weeks.map((w) => `S${w.weekIndex}`),
        axisLabel: { color: CHART.outline, fontSize: 11 },
        axisLine: { lineStyle: { color: CHART.grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: CHART.outline, fontSize: 10 },
        splitLine: { lineStyle: { color: CHART.grid } },
      },
      series: [
        { name: 'Demanda', type: 'bar', data: weeks.map((w) => byWeek(w.weekIndex, 'demandQty')), itemStyle: { color: CHART.navy }, barMaxWidth: 28 },
        { name: 'A producir', type: 'bar', data: weeks.map((w) => byWeek(w.weekIndex, 'toProduceQty')), itemStyle: { color: CHART.lime }, barMaxWidth: 28 },
      ],
    };
  }, [data, rows, weeks]);

  const totals = useMemo(() => {
    if (!weekIndex) {
      return {
        forca: rows.reduce((a, r) => a + r.forcaMonthQty, 0),
        demand: rows.reduce((a, r) => a + r.demandMonthQty, 0),
        produce: rows.reduce((a, r) => a + r.productionMonthQty, 0),
        produceKg: rows.reduce((a, r) => a + r.productionMonthKg, 0),
      };
    }
    const ws = rows.map((r) => r.weeks.find((w) => w.weekIndex === weekIndex)).filter(Boolean);
    return {
      forca: ws.reduce((a, w) => a + (w?.forcaQty ?? 0), 0),
      demand: ws.reduce((a, w) => a + (w?.demandQty ?? 0), 0),
      produce: ws.reduce((a, w) => a + (w?.toProduceQty ?? 0), 0),
      produceKg: ws.reduce((a, w) => a + (w?.toProduceKg ?? 0), 0),
    };
  }, [rows, weekIndex]);

  const weekOptions = useMemo(
    () => [
      ...weeks.map((w) => ({ value: String(w.weekIndex), label: `Semana ${w.weekIndex} · ${w.from.slice(8)}–${w.to.slice(8)}` })),
      { value: 'all', label: 'Todo el mes' },
    ],
    [weeks],
  );

  function exportCsv() {
    if (!data) return;
    const header = ['Codigo', 'Descripcion', 'Unid', 'Stock 03', 'Stock 68', 'Existencia'];
    if (weekIndex) {
      header.push(`S${weekIndex} Forca`, `S${weekIndex} Demanda`, 'Objetivo', 'Disponible', 'A producir', 'A producir (kg)', 'Excedente', 'Estado');
    } else {
      for (const w of weeks) header.push(`S${w.weekIndex} Forca`, `S${w.weekIndex} Demanda`, `S${w.weekIndex} A producir`);
    }
    header.push('Prod mes (unid)', 'Prod mes (kg)');
    const body = rows.map((r) => {
      const out: (string | number)[] = [r.productCode, r.description, r.uom, r.stock03, r.stock68, r.stockTotal];
      if (weekIndex) {
        const wk = r.weeks.find((w) => w.weekIndex === weekIndex);
        out.push(
          wk?.forcaQty ?? 0,
          wk?.demandQty ?? 0,
          wk?.objectiveQty ?? 0,
          wk?.availableQty ?? 0,
          wk?.toProduceQty ?? 0,
          wk?.toProduceKg ?? '',
          Math.max(0, r.stockTotal - (wk?.objectiveQty ?? 0)),
          wk ? STATUS_LABEL[wk.status] : '',
        );
      } else {
        for (const w of weeks) {
          const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
          out.push(wk?.forcaQty ?? 0, wk?.demandQty ?? 0, wk?.toProduceQty ?? 0);
        }
      }
      out.push(r.productionMonthQty, r.productionMonthKg);
      return out;
    });
    const csv = [header, ...body].map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `plan-produccion-${data.year}-${String(data.month).padStart(2, '0')}-${weekIndex ? `s${weekIndex}` : 'mes'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !data) {
    return (
      <Card className="overflow-hidden">
        <CardHeader title="Plan de producción" />
        <DataTable columns={[]} rows={[]} rowKey={() => ''} loading loadingRows={8} />
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-12">
        <Card className="animate-rise xl:col-span-7">
          <CardHeader title="Demanda vs a producir por semana" description="Unidades, todo el mes en curso." />
          <div className="p-space-md">
            <EChart option={chart} height={240} ariaLabel="Demanda versus producción por semana" />
          </div>
        </Card>

        <Card className="animate-rise xl:col-span-5">
          <CardHeader
            title="Resumen"
            action={
              <Button variant="outline" icon={Download} onClick={exportCsv} title="Descargar el plan en CSV">
                <span className="hidden sm:inline">Exportar CSV</span>
              </Button>
            }
          />
          <div className="flex flex-col gap-space-md p-space-md">
            <label className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Semana a evaluar</span>
              <Select value={selected} onChange={setSelected} options={weekOptions} ariaLabel="Semana a evaluar" />
              <span className="text-label-sm text-on-surface-variant">
                {selectedRange ? `Del ${selectedRange.from} al ${selectedRange.to}.` : 'Vista consolidada de todo el mes.'}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-space-sm">
              <Kpi label={weekIndex ? 'Forca semana' : 'Forca mes'} value={fmtInt(totals.forca)} suffix="unid." tone="primary" />
              <Kpi label={weekIndex ? 'Demanda semana' : 'Demanda mes'} value={fmtInt(totals.demand)} suffix="unid." tone="default" />
              <Kpi label="A producir" value={fmtInt(totals.produce)} suffix="unid." tone={totals.produce > 0 ? 'danger' : 'muted'} icon={TrendingUp} />
              <Kpi label="A producir" value={fmtInt(totals.produceKg)} suffix="kg" tone={totals.produceKg > 0 ? 'danger' : 'muted'} />
            </div>
            <p className="text-label-sm text-on-surface-variant">
              <strong>Objetivo = el mayor entre el forca y la demanda.</strong> A producir = max(0, objetivo − existencia); si sobra, la
              diferencia se muestra como <strong>excedente</strong>.
            </p>
          </div>
        </Card>
      </div>

      {weekIndex ? (
        <WeekTable rows={rows} weekIndex={weekIndex} />
      ) : (
        <MonthMatrix rows={rows} weeks={weeks.map((w) => w.weekIndex)} />
      )}
    </>
  );
}

function WeekTable({ rows, weekIndex }: { rows: ForecastPlanResponse['rows']; weekIndex: number }) {
  const columns: Column<ForecastPlanResponse['rows'][number]>[] = [
    { key: 'code', header: 'Código', kind: 'id', render: (r) => r.productCode, sortValue: (r) => r.productCode },
    { key: 'description', header: 'Descripción', kind: 'id', render: (r) => r.description, title: (r) => r.description },
    { key: 'uom', header: 'Unid.', kind: 'detail', render: (r) => r.uom },
    { key: 'stock03', header: 'Stock 03', align: 'right', kind: 'detail', render: (r) => fmtInt(r.stock03), sortValue: (r) => r.stock03 },
    { key: 'stock68', header: 'Stock 68', align: 'right', kind: 'detail', render: (r) => fmtInt(r.stock68), sortValue: (r) => r.stock68 },
    { key: 'stock', header: 'Existencia', align: 'right', kind: 'metric', render: (r) => <span className="font-bold">{fmtInt(r.stockTotal)}</span>, sortValue: (r) => r.stockTotal },
    {
      key: 'demand',
      header: 'Demanda',
      align: 'right',
      kind: 'metric',
      render: (r) => fmtInt(r.weeks.find((w) => w.weekIndex === weekIndex)?.demandQty),
      sortValue: (r) => r.weeks.find((w) => w.weekIndex === weekIndex)?.demandQty ?? 0,
    },
    {
      key: 'forca',
      header: 'Forca sem.',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className="font-semibold">{fmtInt(r.weeks.find((w) => w.weekIndex === weekIndex)?.forcaQty)}</span>,
      sortValue: (r) => r.weeks.find((w) => w.weekIndex === weekIndex)?.forcaQty ?? 0,
    },
    {
      key: 'available',
      header: 'Disponible',
      align: 'right',
      kind: 'detail',
      render: (r) => <span className="font-bold text-secondary">{fmtInt(r.weeks.find((w) => w.weekIndex === weekIndex)?.availableQty)}</span>,
    },
    {
      key: 'produce',
      header: 'A producir',
      align: 'right',
      kind: 'metric',
      render: (r) => {
        const wk = r.weeks.find((w) => w.weekIndex === weekIndex);
        const value = wk?.toProduceQty ?? 0;
        return <span className={value > 0 ? 'font-bold text-critical' : 'text-outline'}>{fmtInt(value)}</span>;
      },
      sortValue: (r) => r.weeks.find((w) => w.weekIndex === weekIndex)?.toProduceQty ?? 0,
    },
    {
      key: 'kg',
      header: 'A producir (kg)',
      align: 'right',
      kind: 'detail',
      render: (r) => {
        const kg = r.weeks.find((w) => w.weekIndex === weekIndex)?.toProduceKg;
        return <span className={kg && kg > 0 ? 'text-critical' : 'text-outline'}>{kg === null || kg === undefined ? '—' : fmtInt(kg)}</span>;
      },
    },
    {
      key: 'excedente',
      header: 'Excedente',
      align: 'right',
      kind: 'metric',
      render: (r) => {
        const wk = r.weeks.find((w) => w.weekIndex === weekIndex);
        const exc = Math.max(0, r.stockTotal - (wk?.objectiveQty ?? 0));
        return <span className={exc > 0 ? 'font-semibold text-success' : 'text-outline'}>{fmtInt(exc)}</span>;
      },
      sortValue: (r) => {
        const wk = r.weeks.find((w) => w.weekIndex === weekIndex);
        return Math.max(0, r.stockTotal - (wk?.objectiveQty ?? 0));
      },
    },
    {
      key: 'state',
      header: 'Estado',
      align: 'center',
      kind: 'status',
      render: (r) => {
        const status = r.weeks.find((w) => w.weekIndex === weekIndex)?.status ?? 'SIN_DEMANDA';
        return <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>;
      },
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Detalle de la semana ${weekIndex}`}
        description="Mismos campos que la vista de Disponibilidad por Producto, con la demanda objetivo de la semana."
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productCode}
        defaultSortKey="code"
        empty={<EmptyState icon={CalendarRange} title="Sin artículos para la presentación elegida" description="Cambia la presentación a «Todos»." />}
      />
      <div className="border-t border-surface-container px-space-lg py-space-sm text-label-sm text-on-surface-variant">
        <span className="font-semibold text-critical">Rojo</span> = falta producir ·{' '}
        <span className="font-semibold text-success">Verde</span> = sobra stock. Nunca hay los dos a la vez: si «A producir» es 0, mira el
        «Excedente».
      </div>
    </Card>
  );
}

function MonthMatrix({ rows, weeks }: { rows: ForecastPlanResponse['rows']; weeks: number[] }) {
  const columns: Column<ForecastPlanResponse['rows'][number]>[] = [
    { key: 'code', header: 'Código', kind: 'id', render: (r) => r.productCode, sortValue: (r) => r.productCode },
    { key: 'description', header: 'Descripción', kind: 'id', render: (r) => r.description, title: (r) => r.description },
    { key: 'stock', header: 'Existencia', align: 'right', kind: 'metric', render: (r) => fmtInt(r.stockTotal), sortValue: (r) => r.stockTotal },
    ...weeks.map((w) => ({
      key: `w${w}`,
      header: `S${w}`,
      align: 'right' as const,
      kind: 'metric' as const,
      title: undefined,
      render: (r: ForecastPlanResponse['rows'][number]) => {
        const wk = r.weeks.find((x) => x.weekIndex === w);
        const value = wk?.toProduceQty ?? 0;
        return (
          <span
            className={value > 0 ? 'font-bold text-critical' : 'text-outline'}
            title={`Forca ${fmtInt(wk?.forcaQty)} · Demanda ${fmtInt(wk?.demandQty)} · Objetivo ${fmtInt(wk?.objectiveQty)}`}
          >
            {fmtInt(value)}
          </span>
        );
      },
      sortValue: (r: ForecastPlanResponse['rows'][number]) => r.weeks.find((x) => x.weekIndex === w)?.toProduceQty ?? 0,
    })),
    {
      key: 'month',
      header: 'Prod. mes',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className="font-bold text-primary">{fmtInt(r.productionMonthQty)}</span>,
      sortValue: (r) => r.productionMonthQty,
    },
    {
      key: 'kg',
      header: 'Prod. mes (kg)',
      align: 'right',
      kind: 'detail',
      render: (r) => fmtInt(r.productionMonthKg),
      sortValue: (r) => r.productionMonthKg,
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Matriz de producción del mes" description="Unidades a producir por artículo y semana. Pasa el cursor o abre «Ver más» para el forca y la demanda." />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productCode}
        defaultSortKey="month"
        empty={<EmptyState icon={CalendarRange} title="Sin artículos para la presentación elegida" description="Cambia la presentación a «Todos»." />}
      />
    </Card>
  );
}

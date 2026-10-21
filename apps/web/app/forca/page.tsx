'use client';

// ============================================================
// Forca — pronóstico de producción (línea ABA = alimentos balanceados).
//
//  · Pestaña «Asignador»: forca MENSUAL por artículo leído de Profit
//    (`xart_fore.kg_mes`, sin conversión; solo lectura) + CANTIDAD por cada
//    una de las 4 semanas. Por defecto las semanas se llenan con el PROMEDIO
//    (forca mensual / 4) y es lo único que se ajusta en Nexo.
//  · Pestaña «Reporte»: se elige la SEMANA a evaluar (o «Todas»). Para una
//    semana se muestra, por artículo, el forca y además los mismos campos de
//    la tabla de Disponibilidad (Stock 03/68, Existencia, Solicitado,
//    Despachable, A producir, kg, Neto, Estado), calculados con el motor de
//    disponibilidad sobre el solicitado objetivo = max(forca, solicitado).
//
//  Forca mensual: Profit. Semanas: Nexo. NUNCA se escribe en Profit.
// ============================================================

import type {
  AvailabilityStatus,
  ForecastPlanResponse,
  ForecastPlanRow,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastRow,
  ForecastWeekRange,
} from '@nexo/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Download, Save, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
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

const C = { navy: '#003366', red: '#dc2626', lime: '#95C800', outline: '#737780', grid: '#e1f0ff' };

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Cubierto',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin forca ni solicitado',
};

const STATUS_TONE: Record<AvailabilityStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  DISPONIBLE: 'success',
  PARCIAL: 'warning',
  FALTANTE: 'danger',
  SIN_DEMANDA: 'muted',
};

type Tab = 'asignador' | 'reporte';

// Presentación del artículo en Profit: SAC = saco, KG = granel (a granel).
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

  const rows = useMemo(() => {
    const all = forecast.data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (unit === 'ALL' || r.uom === unit) &&
        (!onlyDemand || r.demandMonthQty > 0) &&
        (!needle || r.productCode.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
    );
  }, [forecast.data, search, onlyDemand, unit]);

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
          subtitle="Forca mensual por artículo ."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Artículos" value={String(rows.length)} icon={CalendarRange} />
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
              <div className="flex items-center gap-space-2xs">
                <span className="font-semibold uppercase text-label-sm text-outline">Presentación</span>
                <Segmented ariaLabel="Presentación" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
              </div>
            </div>
            {tab === 'asignador' && (
              <div className="flex flex-wrap items-center gap-space-md">
                <TextInput icon={Search} value={search} onChange={setSearch} placeholder="Buscar artículo…" ariaLabel="Buscar artículo" />
                <label className="flex items-center gap-space-xs text-body-md text-on-surface-variant">
                  <input type="checkbox" checked={onlyDemand} onChange={(e) => setOnlyDemand(e.target.checked)} className="size-4 accent-[var(--color-primary-container)]" />
                  Solo con solicitado
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

        {tab === 'asignador' && forecast.data && !forecast.data.profitForcaAvailable && (
          <p role="status" className="flex items-center gap-space-sm text-body-md text-amber-700">
            <AlertTriangle aria-hidden className="size-4" /> No se pudo leer el forca desde Profit (
            <code>xart_fore</code>); los artículos se muestran en 0.
          </p>
        )}

        {tab === 'asignador' && (
          <>
            {forecast.isLoading && <p className="text-body-md text-on-surface-variant">Cargando artículos de producción…</p>}
            {forecast.data && (
              <Card className="overflow-hidden">
                <ForcaAsignador
                  rows={rows}
                  weeks={weeks}
                  year={year}
                  month={month}
                  onSaved={() => forecast.refetch()}
                  searching={Boolean(search) || onlyDemand}
                />
                <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
                  Semanas del mes: {weeks.map((w) => w.label).join(' · ')}. Las cantidades de cada semana se llenan por
                  defecto con el <strong>promedio = forca mes / 4</strong> y son libremente editables. El forca mensual se
                  administra en Profit (<code>xart_fore</code>); aquí no se modifica.
                </div>
              </Card>
            )}
          </>
        )}

        {tab === 'reporte' && (
          <>
            {plan.isLoading && <p className="text-body-md text-on-surface-variant">Calculando plan de producción…</p>}
            {plan.data && <PlanReport key={ym} data={plan.data} unit={unit} />}
          </>
        )}
      </main>
    </>
  );
}

// ---------- Asignador: forca de Profit + cantidad por semana ----------
// Una sola tabla (DataTable) para todos los artículos. El borrador de cada fila
// vive aquí, para que la tabla del PC y la tarjeta del teléfono compartan el
// mismo estado sin duplicar el editor.
interface RowEdit {
  qtys: string[];
}

function ForcaAsignador({
  rows,
  weeks,
  year,
  month,
  onSaved,
  searching,
}: {
  rows: ForecastRow[];
  weeks: ForecastWeekRange[];
  year: number;
  month: number;
  onSaved: () => void;
  searching: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [fail, setFail] = useState<Record<string, string>>({});

  const editOf = (row: ForecastRow): RowEdit =>
    edits[row.productCode] ?? {
      qtys: row.weeks.map((w) => String(w.qty)),
    };

  const patch = (row: ForecastRow, part: Partial<RowEdit>) =>
    setEdits((prev) => ({ ...prev, [row.productCode]: { ...editOf(row), ...part } }));

  const clearEdit = (code: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });

  const markPending = (code: string) => {
    setFail((p) => ({ ...p, [code]: '' }));
    setOk((p) => ({ ...p, [code]: false }));
  };

  // Guarda SOLO las cantidades por semana. El forca mensual viene de Profit.
  const saveWeeks = useMutation<void, Error, { row: ForecastRow; qtys: string[] }>({
    mutationFn: async ({ row, qtys }) =>
      apiFetch(`/forecast/${encodeURIComponent(row.productCode)}/weeks`, {
        method: 'PATCH',
        body: JSON.stringify({
          year,
          month,
          weeks: qtys.map((q, i) => ({ weekIndex: i + 1, qty: parseNumber(q) })),
        }),
      }),
    onMutate: ({ row }) => markPending(row.productCode),
    onSuccess: (_data, { row }) => {
      clearEdit(row.productCode);
      setOk((p) => ({ ...p, [row.productCode]: true }));
      onSaved();
    },
    onError: (err, { row }) => setFail((p) => ({ ...p, [row.productCode]: err.message })),
  });

  const busyOf = (code: string) => saveWeeks.isPending && saveWeeks.variables?.row.productCode === code;

  const columns: Column<ForecastRow>[] = [
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
      sortValue: (r) => r.description,
      render: (r) => (
        <span className="block max-w-[13rem] truncate" title={r.description}>
          {r.description}
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      kind: 'metric',
      sortValue: (r) => r.stockTotal,
      render: (r) => fmtQty(r.stockTotal, 0),
    },
    {
      key: 'demandaMes',
      header: 'Solicitado mes',
      align: 'right',
      sortValue: (r) => r.demandMonthQty,
      render: (r) => (
        <span className={r.demandMonthQty > 0 ? 'font-semibold text-on-surface' : 'text-outline'}>{fmtQty(r.demandMonthQty, 0)}</span>
      ),
    },
    {
      key: 'forcaMes',
      header: 'Forca mes',
      align: 'right',
      render: (r) => (
        <span className="font-semibold tabular-nums text-on-surface" title="Valor leído de Profit (xart_fore.kg_mes)">
          {fmtQty(r.monthlyQty, 0)}
        </span>
      ),
    },
    {
      key: 'promedio',
      header: 'Promedio',
      align: 'right',
      render: (r) => <span className="text-on-surface-variant">{fmtQty(r.averageQty, 0)}</span>,
    },
    ...weeks.map((w) => ({
      key: `semana${w.weekIndex}`,
      header: `S${w.weekIndex}`,
      align: 'center' as const,
      render: (r: ForecastRow) => {
        const edit = editOf(r);
        const pos = r.weeks.findIndex((x) => x.weekIndex === w.weekIndex);
        const value = edit.qtys[pos] ?? '';
        return (
          <input
            value={value}
            onChange={(ev) => patch(r, { qtys: edit.qtys.map((q, idx) => (idx === pos ? ev.target.value : q)) })}
            inputMode="decimal"
            className={`h-8 w-[4.5rem] rounded-md px-space-2xs text-right tabular-nums text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container ${
              parseNumber(value) !== r.averageQty ? 'bg-amber-50 font-semibold' : 'bg-surface'
            }`}
            aria-label={`Semana ${w.weekIndex} de ${r.productCode}`}
          />
        );
      },
    })),
    {
      key: 'total',
      header: 'Total sem.',
      align: 'right',
      kind: 'metric',
      render: (r) => <span className="font-bold">{fmtQty(editOf(r).qtys.reduce((a, q) => a + parseNumber(q), 0), 0)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      align: 'center',
      kind: 'status',
      sortValue: (r) => (r.monthlyQty > 0 ? 'Profit' : 'Sin forca'),
      render: (r) => (
        <span className="whitespace-nowrap">
          <Badge tone={r.monthlyQty > 0 ? 'primary' : 'muted'}>{r.monthlyQty > 0 ? 'Profit' : 'Sin forca'}</Badge>
        </span>
      ),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      render: (r) => {
        const edit = editOf(r);
        const busy = busyOf(r.productCode);
        return (
          <div className="flex flex-col items-end gap-space-2xs">
            <button
              onClick={() => saveWeeks.mutate({ row: r, qtys: edit.qtys })}
              disabled={busy}
              title="Guardar las cantidades por semana"
              className="flex h-8 items-center gap-space-2xs whitespace-nowrap rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
            >
              <Save aria-hidden className="size-3.5" /> Semanas
            </button>
            {ok[r.productCode] && <span className="text-label-sm text-success">Guardado</span>}
            {fail[r.productCode] && <span className="max-w-[16rem] text-label-sm text-error">{fail[r.productCode]}</span>}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.productCode}
      empty={
        <EmptyState
          icon={CalendarRange}
          title={searching ? 'Sin artículos para el filtro' : 'No hay artículos de producción sincronizados'}
          description="Los artículos de la línea ABA se sincronizan desde la vista espejo de Profit."
        />
      }
    />
  );
}

// ---------- Reporte / plan de producción ----------
function PlanReport({ data, unit }: { data: ForecastPlanResponse; unit: UnitFilter }) {
  const weeks = data.weekRanges;
  const rows = useMemo(() => data.rows.filter((r) => unit === 'ALL' || r.uom === unit), [data, unit]);
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
        { name: 'Solicitado', type: 'bar', data: weeks.map((w) => rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0)), color: C.navy, barMaxWidth: 26 },
        { name: 'A producir', type: 'bar', data: weeks.map((w) => rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.toProduceQty ?? 0), 0)), color: C.red, barMaxWidth: 26 },
      ],
    }),
    [rows, weeks],
  );

  // Totales de la semana elegida (o del mes si se ven todas), ya filtrados.
  const totals = useMemo(() => {
    if (weekIndex === null) {
      return {
        forca: rows.reduce((a, r) => a + r.forcaMonthQty, 0),
        demand: rows.reduce((a, r) => a + r.demandMonthQty, 0),
        toProduce: rows.reduce((a, r) => a + r.productionMonthQty, 0),
        toProduceKg: rows.reduce((a, r) => a + r.productionMonthKg, 0),
        // El excedente es stock, no se acumula semana a semana: se mide contra
        // el objetivo más alto del mes.
        excedente: rows.reduce(
          (a, r) => a + Math.max(0, r.stockTotal - r.weeks.reduce((m, w) => Math.max(m, w.objectiveQty), 0)),
          0,
        ),
      };
    }
    const ws = rows
      .map((r) => ({ row: r, week: r.weeks.find((w) => w.weekIndex === weekIndex) }))
      .filter((x): x is { row: ForecastPlanRow; week: ForecastPlanWeek } => Boolean(x.week));
    return {
      forca: ws.reduce((a, x) => a + x.week.forcaQty, 0),
      demand: ws.reduce((a, x) => a + x.week.demandQty, 0),
      toProduce: ws.reduce((a, x) => a + x.week.toProduceQty, 0),
      toProduceKg: ws.reduce((a, x) => a + (x.week.toProduceKg ?? 0), 0),
      excedente: ws.reduce((a, x) => a + Math.max(0, x.row.stockTotal - x.week.objectiveQty), 0),
    };
  }, [rows, weekIndex]);

  // Filas con la semana elegida (las que no la tienen se omiten, como antes).
  const weekEntries = useMemo(
    () =>
      rows
        .map((row) => ({ row, week: row.weeks.find((w) => w.weekIndex === weekIndex) }))
        .filter((e): e is { row: ForecastPlanRow; week: ForecastPlanWeek } => Boolean(e.week)),
    [rows, weekIndex],
  );

  // Vista consolidada del mes: la matriz de semanas en columnas planas, para
  // que cada semana se ordene al pulsarla y el artículo quede anclado.
  const monthColumns = useMemo<Column<ForecastPlanRow>[]>(
    () => [
      {
        key: 'articulo',
        header: 'Artículo',
        kind: 'id',
        sortValue: (r) => r.productCode,
        render: (r) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-bold tabular-nums text-primary">{r.productCode}</span>
            <span className="max-w-[15rem] truncate text-label-sm text-on-surface-variant" title={r.description}>
              {r.description}
            </span>
          </span>
        ),
      },
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        kind: 'metric',
        sortValue: (r) => r.stockTotal,
        render: (r) => fmtQty(r.stockTotal, 0),
      },
      ...weeks.flatMap((w) => {
        const weekOf = (r: ForecastPlanRow) => r.weeks.find((x) => x.weekIndex === w.weekIndex);
        return [
          {
            key: `s${w.weekIndex}forca`,
            header: `S${w.weekIndex} Forca`,
            align: 'right' as const,
            className: 'border-l border-surface-container',
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.forcaQty ?? 0,
            render: (r: ForecastPlanRow) => (
              <span className="text-on-surface-variant" title={w.label}>
                {fmtQty(weekOf(r)?.forcaQty ?? 0, 0)}
              </span>
            ),
          },
          {
            key: `s${w.weekIndex}dem`,
            header: `S${w.weekIndex} Solic.`,
            align: 'right' as const,
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.demandQty ?? 0,
            render: (r: ForecastPlanRow) => <span title={w.label}>{fmtQty(weekOf(r)?.demandQty ?? 0, 0)}</span>,
          },
          {
            key: `s${w.weekIndex}prod`,
            header: `S${w.weekIndex} Prod.`,
            align: 'right' as const,
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.toProduceQty ?? 0,
            render: (r: ForecastPlanRow) => {
              const qty = weekOf(r)?.toProduceQty ?? 0;
              return (
                <span className={qty > 0 ? 'font-bold text-error' : 'text-outline'} title={w.label}>
                  {fmtQty(qty, 0)}
                </span>
              );
            },
          },
        ];
      }),
      {
        key: 'prodMes',
        header: 'Prod. mes',
        align: 'right',
        kind: 'metric',
        className: 'border-l border-surface-container',
        sortValue: (r) => r.productionMonthQty,
        render: (r) => <span className="font-bold text-primary">{fmtQty(r.productionMonthQty, 0)}</span>,
      },
    ],
    [weeks],
  );

  // Reporte de una semana: los mismos campos de la vista de Disponibilidad.
  const weekColumns = useMemo<Column<{ row: ForecastPlanRow; week: ForecastPlanWeek }>[]>(
    () => [
      {
        key: 'codigo',
        header: 'Código',
        kind: 'id',
        sortValue: (e) => e.row.productCode,
        render: (e) => <span className="font-bold tabular-nums text-primary">{e.row.productCode}</span>,
      },
      {
        key: 'descripcion',
        header: 'Descripción',
        sortValue: (e) => e.row.description,
        render: (e) => (
          <span className="block max-w-[13rem] truncate" title={e.row.description}>
            {e.row.description}
          </span>
        ),
      },
      { key: 'unid', header: 'Unid.', render: (e) => <span className="text-on-surface-variant">{e.row.uom}</span> },
      { key: 'stock03', header: 'Stock 03', align: 'right', sortValue: (e) => e.row.stock03, render: (e) => fmtQty(e.row.stock03, 0) },
      { key: 'stock68', header: 'Stock 68', align: 'right', sortValue: (e) => e.row.stock68, render: (e) => fmtQty(e.row.stock68, 0) },
      {
        key: 'existencia',
        header: 'Existencia',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.row.stockTotal,
        render: (e) => <span className="font-bold">{fmtQty(e.row.stockTotal, 0)}</span>,
      },
      {
        key: 'solicitado',
        header: 'Solicitado',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.demandQty,
        render: (e) => fmtQty(e.week.demandQty, 0),
      },
      {
        key: 'forcaSem',
        header: 'Forca sem.',
        align: 'right',
        sortValue: (e) => e.week.forcaQty,
        render: (e) => <span className="font-semibold text-on-surface">{fmtQty(e.week.forcaQty, 0)}</span>,
      },
      {
        key: 'despachable',
        header: 'Despachable',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.availableQty,
        render: (e) => <span className="font-bold text-secondary">{fmtQty(e.week.availableQty, 0)}</span>,
      },
      {
        key: 'aProducir',
        header: 'A producir',
        align: 'right',
        sortValue: (e) => e.week.toProduceQty,
        render: (e) => (
          <span
            className={e.week.toProduceQty > 0 ? 'font-bold text-error' : 'text-outline'}
            title={`Objetivo ${fmtQty(e.week.objectiveQty, 0)} − existencia ${fmtQty(e.row.stockTotal, 0)} → ${
              e.week.toProduceQty > 0 ? `faltan ${fmtQty(e.week.toProduceQty, 0)}` : 'la existencia cubre el objetivo'
            }`}
          >
            {fmtQty(e.week.toProduceQty, 0)}
          </span>
        ),
      },
      {
        key: 'aProducirKg',
        header: 'A producir (kg)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.toProduceKg ?? 0,
        render: (e) => (
          <span className={(e.week.toProduceKg ?? 0) > 0 ? 'text-error' : 'text-outline'}>{fmtQty(e.week.toProduceKg, 0)}</span>
        ),
      },
      {
        key: 'excedente',
        header: 'Excedente',
        align: 'right',
        sortValue: (e) => Math.max(0, e.row.stockTotal - e.week.objectiveQty),
        render: (e) => {
          // Sobrante de existencia sobre el objetivo: complementario de
          // «A producir», nunca hay los dos a la vez.
          const excedente = Math.max(0, e.row.stockTotal - e.week.objectiveQty);
          return (
            <span
              className={excedente > 0 ? 'font-semibold text-success' : 'text-outline'}
              title={`Existencia ${fmtQty(e.row.stockTotal, 0)} − objetivo ${fmtQty(e.week.objectiveQty, 0)} → ${
                excedente > 0 ? `sobran ${fmtQty(excedente, 0)}` : 'sin excedente'
              }`}
            >
              {fmtQty(excedente, 0)}
            </span>
          );
        },
      },
      {
        key: 'estado',
        header: 'Estado',
        align: 'center',
        kind: 'status',
        sortValue: (e) => STATUS_LABEL[e.week.status],
        render: (e) => <Badge tone={STATUS_TONE[e.week.status]}>{STATUS_LABEL[e.week.status]}</Badge>,
      },
    ],
    [],
  );

  function exportCsv() {
    const header = ['Codigo', 'Descripcion', 'Unid', 'Stock 03', 'Stock 68', 'Existencia'];
    if (weekIndex === null) {
      for (const w of weeks) header.push(`${w.label} Forca`, `${w.label} Solicitado`, `${w.label} A producir`);
    } else {
      header.push(
        `S${weekIndex} Forca`,
        `S${weekIndex} Solicitado`,
        'Objetivo',
        'Despachable',
        'A producir',
        'A producir (kg)',
        'Excedente',
        'Estado',
      );
    }
    header.push('Prod mes (unid)', 'Prod mes (kg)');
    const body = rows.map((r) => {
      const out: string[] = [r.productCode, r.description, r.uom, String(r.stock03), String(r.stock68), String(r.stockTotal)];
      if (weekIndex === null) {
        for (const w of weeks) {
          const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
          out.push(String(wk?.forcaQty ?? 0), String(wk?.demandQty ?? 0), String(wk?.toProduceQty ?? 0));
        }
      } else {
        const wk = r.weeks.find((x) => x.weekIndex === weekIndex);
        out.push(
          String(wk?.forcaQty ?? 0),
          String(wk?.demandQty ?? 0),
          String(wk?.objectiveQty ?? 0),
          String(wk?.availableQty ?? 0),
          String(wk?.toProduceQty ?? 0),
          String(wk?.toProduceKg ?? ''),
          String(Math.max(0, r.stockTotal - (wk?.objectiveQty ?? 0))),
          wk ? STATUS_LABEL[wk.status] : '',
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
          <div className="mb-space-xs font-semibold uppercase text-label-sm text-outline">Solicitado vs a producir por semana (unidades)</div>
          <EChart option={chart} height={230} ariaLabel="Solicitado versus producción por semana" />
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
            <Kpi label={weekIndex === null ? 'Solicitado del mes' : 'Solicitado de la semana'} value={fmtQty(totals.demand, 0)} suffix="unid." />
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
            <strong>Objetivo de la semana = el mayor entre el forca y el solicitado.</strong> Con eso:{' '}
            <strong>a producir = max(0, objetivo − existencia)</strong> y, si sobra stock, la diferencia se muestra como{' '}
            <strong>Excedente</strong>. Existencia, despachable y estado usan el mismo cálculo que la vista de
            Disponibilidad por Producto.
          </p>
        </Card>
      </div>

      {weekIndex === null ? (
        <Card className="overflow-hidden">
          <DataTable
            columns={monthColumns}
            rows={rows}
            rowKey={(r) => r.productCode}
            empty={<EmptyState icon={CalendarRange} title="Sin artículos para la presentación elegida" />}
            footer={
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <td className="px-space-sm py-space-xs uppercase text-label-sm text-outline">Totales</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(rows.reduce((a, r) => a + r.stockTotal, 0), 0)}</td>
                {weeks.map((w) => {
                  const f = rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.forcaQty ?? 0), 0);
                  const dem = rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.demandQty ?? 0), 0);
                  const prod = rows.reduce((a, r) => a + (r.weeks.find((x) => x.weekIndex === w.weekIndex)?.toProduceQty ?? 0), 0);
                  return (
                    <Fragment key={w.weekIndex}>
                      <td className="border-l border-surface-container px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">
                        {fmtQty(f, 0)}
                      </td>
                      <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(dem, 0)}</td>
                      <td className="px-space-sm py-space-xs text-right tabular-nums text-error">{fmtQty(prod, 0)}</td>
                    </Fragment>
                  );
                })}
                <td className="border-l border-surface-container px-space-sm py-space-xs text-right tabular-nums text-primary">
                  {fmtQty(totals.toProduce, 0)}
                </td>
              </tr>
            }
          />
          <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
            Semanas del mes: {weeks.map((w) => w.label).join(' · ')}. Cada semana se ordena al pulsar su encabezado y el
            artículo queda fijo al desplazar a la derecha.
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={weekColumns}
            rows={weekEntries}
            rowKey={(e) => e.row.productCode}
            empty={<EmptyState icon={CalendarRange} title="Sin artículos para la presentación elegida" />}
            footer={
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <td colSpan={6} className="px-space-sm py-space-xs uppercase text-label-sm text-outline">
                  Totales de la semana
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(totals.demand, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(totals.forca, 0)}</td>
                <td />
                <td className="px-space-sm py-space-xs text-right tabular-nums text-error">{fmtQty(totals.toProduce, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-error">{fmtQty(totals.toProduceKg, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-success">{fmtQty(totals.excedente, 0)}</td>
                <td />
              </tr>
            }
          />
          <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
            <span className="font-semibold text-error">Rojo</span> = falta producir ·{' '}
            <span className="font-semibold text-success">Verde</span> = sobra stock. «A producir» = max(0, objetivo −
            existencia) y «Excedente» = max(0, existencia − objetivo): <strong>nunca hay los dos a la vez</strong>. El
            objetivo de la semana es el <strong>mayor entre el forca semanal y el solicitado</strong>. Un 0 en «A producir»
            significa que la existencia ya cubre el objetivo (mira el «Excedente»).
          </div>
        </Card>
      )}
    </>
  );
}

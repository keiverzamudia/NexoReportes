'use client';

// ============================================================
// Forecast — pronóstico de producción (línea ABA = alimentos balanceados).
//
//  · Pestaña «Asignador»: forecast MENSUAL por artículo leído de Profit
//    (`forecast.kg_mensual`, convertido a kg según la presentación del
//    artículo; solo lectura) + CANTIDAD por cada una de las 4 semanas.
//    `forecast.fecha` indica el mes de vigencia. Por defecto las semanas se
//    llenan con el reparto por días del bloque (kg mensual × días ÷ días del
//    mes) y es lo único que se ajusta en Nexo.
//  · Pestaña «Reporte»: se elige la SEMANA a evaluar (o «Todas»). Todo se
//    calcula en kg: forecast, vendido (notas de entrega), cartera pendiente y
//    a producir con el stock arrastrado de la semana anterior. Los sacos se
//    derivan solo para presentación y el VENDIDO expone además su importe real
//    en USD (notas sin IVA, tasa de cada nota).
//
//  Forecast mensual: Profit. Semanas: Nexo. NUNCA se escribe en Profit.
// ============================================================

import type {
  AvailabilityStatus,
  ForecastCustomerSalesResponse,
  ForecastPlanResponse,
  ForecastPlanRow,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastRow,
  ForecastSalesResponse,
  ForecastWeekRange,
  UserSummary,
} from '@nexo/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, CalendarRange, Download, LineChart, RotateCcw, Save, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { EChart } from '../../components/EChart';
import { ProductPicker } from '../../components/ProductPicker';
import { AppNav, LoginScreen } from '../../components/shell';
import { ControlReport } from '../../components/forecast/ControlReport';
import { SalesReport } from '../../components/forecast/SalesReport';
import {
  Badge,
  Card,
  Column,
  CoverageBar,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  fmtQty,
  fmtUsd,
} from '../../components/ui';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import { hasPermission } from '../../lib/permissions';

const C = {
  navy: '#003366',
  navyLight: '#1d5a96',
  navySoft: '#7aa8d4',
  red: '#dc2626',
  redLight: '#f87171',
  lime: '#95C800',
  limeDark: '#4b6700',
  outline: '#737780',
  grid: '#e1f0ff',
  ink: '#081d2c',
  surface: '#ffffff',
};

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  DISPONIBLE: 'Cubierto',
  PARCIAL: 'Parcial',
  FALTANTE: 'Faltante',
  SIN_DEMANDA: 'Sin forecast ni solicitado',
};

const STATUS_TONE: Record<AvailabilityStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  DISPONIBLE: 'success',
  PARCIAL: 'warning',
  FALTANTE: 'danger',
  SIN_DEMANDA: 'muted',
};

type Tab = 'asignador' | 'reporte' | 'ventas';

// Presentación del artículo en Profit: SAC = saco, KG = granel (a granel).
type UnitFilter = 'ALL' | 'SAC' | 'KG';

// Días que entran al denominador del run-rate.
type SalesBasis = 'WORKING' | 'CALENDAR';

const BASIS_OPTIONS: { value: SalesBasis; label: string }[] = [
  { value: 'WORKING', label: 'Hábiles' },
  { value: 'CALENDAR', label: 'Calendario' },
];

const HISTORY_OPTIONS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
];

const UNIT_OPTIONS: { value: UnitFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SAC', label: 'Saco' },
  { value: 'KG', label: 'Granel (kg)' },
];

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseNumber(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Formato compacto para ejes y etiquetas de barra: 950 · 12,4 k · 1,9 M.
// El tooltip siempre muestra el valor exacto con separador de miles.
function compactQty(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(value / 1_000_000)} M`;
  }
  if (abs >= 10_000) {
    return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(value / 1_000)} k`;
  }
  return fmtQty(value, 0);
}

export default function ForecastPage() {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>('asignador');
  // «Ventas vs Forecast» puede mirar la desviación por producto o por cliente.
  const [salesView, setSalesView] = useState<'product' | 'customer'>('product');
  const [ym, setYm] = useState(currentMonthValue);
  const [search, setSearch] = useState('');
  const [onlyDemand, setOnlyDemand] = useState(false);
  const [unit, setUnit] = useState<UnitFilter>('ALL');
  // Informe «Ventas vs Forecast»: base de días, ventana histórica y corte.
  const [basis, setBasis] = useState<SalesBasis>('WORKING');
  const [includeToday, setIncludeToday] = useState(false);
  const [historyMonths, setHistoryMonths] = useState('6');

  const [yearPart, monthPart] = ym.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  const me = useQuery<UserSummary | null>({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 15_000,
    retry: false,
  });
  const canEdit = hasPermission(me.data?.permissions, 'forecast', 'update');

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

  const sales = useQuery<ForecastSalesResponse>({
    queryKey: ['forecast-sales', tick, year, month, basis, includeToday, historyMonths],
    queryFn: () =>
      apiFetch<ForecastSalesResponse>(
        `/forecast/sales?year=${year}&month=${month}&basis=${basis}&months=${historyMonths}&includeToday=${
          includeToday ? 'true' : 'false'
        }`,
      ),
    enabled: tab === 'ventas',
    // El informe es caro (Profit + catálogo): evitar refetch al volver a la
    // pestaña o al cambiar de tab dentro del mismo minuto. «Sincronizar»
    // incrementa `tick` y fuerza la recarga cuando el usuario lo pide.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const customerSales = useQuery<ForecastCustomerSalesResponse>({
    queryKey: ['forecast-sales-customers', tick, year, month, includeToday],
    queryFn: () =>
      apiFetch<ForecastCustomerSalesResponse>(
        `/forecast/sales/customers?year=${year}&month=${month}&includeToday=${includeToday ? 'true' : 'false'}`,
      ),
    // Solo se pide al abrir el modo cliente: el informe de productos no paga
    // esta consulta adicional.
    enabled: tab === 'ventas' && salesView === 'customer',
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
  // El informe de ventas pinta su propio error; solo la sesión vencida se
  // resuelve aquí para no duplicar banners.
  if ([forecast.error, plan.error, sales.error, customerSales.error].some((err) => err instanceof AuthRequiredError)) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const weeks = forecast.data?.weekRanges ?? [];
  const totalForecast = (forecast.data?.rows ?? []).reduce((a, r) => a + r.monthlyQty, 0);
  // El encabezado resume la pestaña activa: en «Ventas» manda el informe de
  // facturación (el catálogo local de producción puede estar vacío en dev).
  const isCustomerView = tab === 'ventas' && salesView === 'customer';
  const headerArticles = isCustomerView
    ? (customerSales.data?.totals.activeCustomerCount ?? 0)
    : tab === 'ventas'
      ? (sales.data?.rows.length ?? 0)
      : rows.length;
  const headerForecastKg = isCustomerView
    ? (customerSales.data?.totals.actualKg ?? 0)
    : tab === 'ventas'
      ? (sales.data?.totals.forecastKg ?? 0)
      : totalForecast;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Producción · Alimentos balanceados (línea ABA)"
          icon={CalendarRange}
          title="Forecast"
          subtitle={
            isCustomerView
              ? 'Meta histórica de cada cliente (promedio de los últimos 3 meses) contra su venta y proyección.'
              : 'Forecast mensual por artículo y ventas reales de Profit contra la meta.'
          }
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi
                label={isCustomerView ? 'Clientes con meta' : 'Artículos'}
                value={String(isCustomerView ? (customerSales.data?.totals.targetCustomerCount ?? 0) : headerArticles)}
                icon={CalendarRange}
              />
              <Kpi
                label={isCustomerView ? 'Venta a la fecha' : 'Forecast del mes'}
                value={fmtQty(headerForecastKg, 0)}
                suffix="kg"
                tone="primary"
              />
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
                  { value: 'ventas', label: 'Ventas vs Forecast' },
                ]}
              />
              {!isCustomerView && (
                <div className="flex items-center gap-space-2xs">
                  <span className="font-semibold uppercase text-label-sm text-outline">Presentación</span>
                  <Segmented ariaLabel="Presentación" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
                </div>
              )}
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
            {tab === 'ventas' && (
              <div className="flex flex-wrap items-end gap-space-md">
                {!isCustomerView && (
                  <div className="flex flex-col gap-space-2xs">
                    <span className="font-semibold uppercase text-label-sm text-outline">Base de días</span>
                    <Segmented ariaLabel="Base de días del informe" value={basis} onChange={setBasis} options={BASIS_OPTIONS} />
                  </div>
                )}
                {!isCustomerView && (
                  <label className="flex flex-col gap-space-2xs">
                    <span className="font-semibold uppercase text-label-sm text-outline">Histórico</span>
                    <Select
                      ariaLabel="Ventana histórica"
                      value={historyMonths}
                      onChange={setHistoryMonths}
                      options={HISTORY_OPTIONS}
                      className="h-9 w-32"
                    />
                  </label>
                )}
                <label className="flex h-9 items-center gap-space-xs text-body-md text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={includeToday}
                    onChange={(e) => setIncludeToday(e.target.checked)}
                    className="size-4 accent-[var(--color-secondary-container)]"
                  />
                  Incluir hoy
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

        {tab === 'asignador' && forecast.data && !forecast.data.profitForecastAvailable && (
          <p role="status" className="flex items-center gap-space-sm text-body-md text-amber-700">
            <AlertTriangle aria-hidden className="size-4" /> No se pudo leer el forecast desde Profit (
            <code>forecast</code>); los artículos se muestran en 0.
          </p>
        )}

        {tab === 'asignador' && (
          <>
            {forecast.isLoading && <p className="text-body-md text-on-surface-variant">Cargando artículos de producción…</p>}
            {forecast.data && (
              <Card className="overflow-hidden">
                <ForecastAsignador
                  rows={rows}
                  weeks={weeks}
                  year={year}
                  month={month}
                  onSaved={() => forecast.refetch()}
                  searching={Boolean(search) || onlyDemand}
                  canEdit={canEdit}
                />
                <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
                  Semanas del mes: {weeks.map((w) => w.label).join(' · ')}. Las cantidades de cada semana se llenan por
                  defecto con el <strong>reparto por días del bloque</strong> (kg mensual × días ÷ días del mes) y son
                  libremente editables. El forecast mensual se administra en Profit (<code>forecast</code>) y se muestra en{' '}
                  <strong>kilogramos</strong>: los artículos SAC se multiplican por su kg por saco y el granel se mantiene
                  en kg. Aquí no se modifica.
                </div>
              </Card>
            )}
          </>
        )}

        {tab === 'reporte' && (
          <>
            {plan.isLoading && <p className="text-body-md text-on-surface-variant">Calculando plan de producción…</p>}
            {plan.data && <ReporteBlock key={ym} data={plan.data} unit={unit} />}
          </>
        )}

        {tab === 'ventas' && (
          <SalesReport
            report={sales.data}
            isLoading={sales.isLoading}
            error={sales.error instanceof Error ? sales.error : null}
            unit={unit}
            canEdit={canEdit}
            onRetry={() => void sales.refetch()}
            mode={salesView}
            onModeChange={setSalesView}
            customerReport={customerSales.data}
            customerLoading={customerSales.isLoading}
            customerError={customerSales.error instanceof Error ? customerSales.error : null}
            onCustomerRetry={() => void customerSales.refetch()}
            forecast={forecast.data}
            forecastLoading={forecast.isLoading}
          />
        )}
      </main>
    </>
  );
}

// ---------- Asignador: forecast de Profit + cantidad por semana ----------
// Una sola tabla (DataTable) para todos los artículos. El borrador de cada fila
// vive aquí, para que la tabla del PC y la tarjeta del teléfono compartan el
// mismo estado sin duplicar el editor.
interface RowEdit {
  qtys: string[];
}

function ForecastAsignador({
  rows,
  weeks,
  year,
  month,
  onSaved,
  searching,
  canEdit,
}: {
  rows: ForecastRow[];
  weeks: ForecastWeekRange[];
  year: number;
  month: number;
  onSaved: () => void;
  searching: boolean;
  /** Permiso `forecast:update`: sin él la tabla es de solo lectura. */
  canEdit: boolean;
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

  // Guarda SOLO las cantidades por semana. El forecast mensual viene de Profit.
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
        <span className="flex min-w-0 items-center gap-space-xs">
          <span className="block max-w-[13rem] truncate" title={r.description}>
            {r.description}
          </span>
          <Badge tone="muted">{r.uom}</Badge>
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
      key: 'forecastMes',
      header: 'Forecast mes (kg)',
      align: 'right',
      render: (r) => (
        <span className="font-semibold tabular-nums text-on-surface" title="Valor de Profit (forecast.kg_mensual) convertido a kilogramos según la presentación del artículo para el mes de vigencia">
          {fmtQty(r.monthlyQty, 0)}
        </span>
      ),
    },
    {
      key: 'promedio',
      header: 'Mes ÷ 4 (kg)',
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
        const suggested = r.weeks.find((x) => x.weekIndex === w.weekIndex)?.suggestedQty ?? 0;
        return (
          <input
            value={value}
            onChange={(ev) => patch(r, { qtys: edit.qtys.map((q, idx) => (idx === pos ? ev.target.value : q)) })}
            inputMode="decimal"
            disabled={!canEdit}
            title={`Sugerido por días del bloque: ${fmtQty(suggested, 0)} kg`}
            className={`h-8 w-[4.5rem] rounded-md px-space-2xs text-right tabular-nums text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60 ${
              parseNumber(value) !== suggested ? 'bg-amber-50 font-semibold' : 'bg-surface'
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
      sortValue: (r) => (r.monthlyQty > 0 ? 'Profit' : 'Sin forecast'),
      render: (r) => (
        <span className="whitespace-nowrap">
          <Badge tone={r.monthlyQty > 0 ? 'primary' : 'muted'}>{r.monthlyQty > 0 ? 'Profit' : 'Sin forecast'}</Badge>
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
            {canEdit ? (
              <button
                onClick={() => saveWeeks.mutate({ row: r, qtys: edit.qtys })}
                disabled={busy}
                title="Guardar las cantidades por semana"
                className="flex h-8 items-center gap-space-2xs whitespace-nowrap rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
              >
                <Save aria-hidden className="size-3.5" /> Semanas
              </button>
            ) : (
              <span className="text-label-sm text-outline" title="No tienes permiso para editar semanas">
                Solo lectura
              </span>
            )}
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
// Acción de fila: enfocar ese artículo en la gráfica sin salir de la tabla.
function FocusProductButton({ code, onClick }: { code: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver ${code} en la gráfica`}
      title={`Ver ${code} en la gráfica`}
      className="grid size-6 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70"
    >
      <LineChart aria-hidden className="size-3.5" />
    </button>
  );
}

// Reporte: dos vistas sobre el mismo payload. «Plan de producción» es la de
// siempre; «Básico» es la tabla comparativa con el stock por almacén,
// forecast / solicitado / venta.
function ReporteBlock({ data, unit }: { data: ForecastPlanResponse; unit: UnitFilter }) {
  const [view, setView] = useState<'plan' | 'basico'>('plan');
  return (
    <>
      <div className="flex justify-end">
        <Segmented
          ariaLabel="Vista del reporte"
          value={view}
          onChange={setView}
          options={[
            { value: 'plan', label: 'Plan de producción' },
            { value: 'basico', label: 'Básico' },
          ]}
        />
      </div>
      {view === 'plan' ? <PlanReport data={data} unit={unit} /> : <ControlReport data={data} unit={unit} />}
    </>
  );
}

function PlanReport({ data, unit }: { data: ForecastPlanResponse; unit: UnitFilter }) {
  const weeks = data.weekRanges;
  const allRows = useMemo(() => data.rows.filter((r) => unit === 'ALL' || r.uom === unit), [data, unit]);
  // Mes en curso: se abre en su semana; mes cerrado o futuro: vista del mes
  // (matriz semanal con vendido), que es la lectura útil del histórico.
  const defaultWeek = data.currentWeekIndex !== null ? String(data.currentWeekIndex) : 'all';
  const [selected, setSelected] = useState<string>(defaultWeek);
  const [productCode, setProductCode] = useState<string | null>(null);

  // Si cambia la presentación (SAC/KG) y el producto elegido deja de existir
  // en el filtro, volvemos al consolidado global en lugar de dejar la vista vacía.
  useEffect(() => {
    if (productCode && !allRows.some((row) => row.productCode === productCode)) setProductCode(null);
  }, [allRows, productCode]);

  const weekOptions = [
    ...weeks.map((w) => ({ value: String(w.weekIndex), label: `Semana ${w.weekIndex} (${w.from.slice(8)}-${w.to.slice(8)})` })),
    { value: 'all', label: 'Todas las semanas' },
  ];
  const weekIndex = selected === 'all' ? null : Number(selected);
  const selectedRange = weeks.find((w) => w.weekIndex === weekIndex) ?? null;

  // Alcance del reporte: consolidado de todos los artículos o uno solo.
  const productOptions = useMemo(
    () =>
      [...allRows]
        .sort((a, b) => a.productCode.localeCompare(b.productCode, 'es'))
        .map((row) => ({ value: row.productCode, description: row.description, uom: row.uom })),
    [allRows],
  );
  const selectedProduct = productCode ? (allRows.find((row) => row.productCode === productCode) ?? null) : null;
  const rows = useMemo(() => (selectedProduct ? [selectedProduct] : allRows), [allRows, selectedProduct]);

  // Serie semanal (agregada al alcance elegido). Todo en kg: mezclar sacos de
  // 40 kg con sacos de 10 kg y con granel no significa nada.
  const chartData = useMemo(
    () =>
      weeks.map((week) => {
        let demand = 0;
        let sold = 0;
        let soldUsd = 0;
        let toProduce = 0;
        let forecast = 0;
        for (const row of rows) {
          const weekRow = row.weeks.find((entry) => entry.weekIndex === week.weekIndex);
          if (!weekRow) continue;
          demand += weekRow.demandKg;
          sold += weekRow.soldKg;
          soldUsd += weekRow.soldUsd;
          toProduce += weekRow.toProduceKg;
          forecast += weekRow.forecastKg;
        }
        return { week, demand, sold, soldUsd, toProduce, forecast };
      }),
    [rows, weeks],
  );

  const hasForecast = chartData.some((entry) => entry.forecast > 0);

  const chart = useMemo(() => {
    // Barras de la semana evaluada a plena opacidad + borde lima; el resto se
    // atenúa para que la lectura sea inmediata sin perder el contexto del mes.
    const barData = (key: 'sold' | 'demand' | 'toProduce') =>
      chartData.map((entry, index) => {
        const isSelected = weekIndex !== null && weeks[index]?.weekIndex === weekIndex;
        return {
          value: entry[key],
          itemStyle: {
            opacity: weekIndex === null || isSelected ? 1 : 0.62,
            ...(isSelected ? { borderColor: C.lime, borderWidth: 2 } : {}),
          },
        };
      });

    const barLabel = {
      show: true,
      position: 'top',
      distance: 8,
      color: '#43474f',
      fontSize: 9,
      fontWeight: 600,
      formatter: (params: { value?: unknown }) => {
        const value = Number(params.value);
        return Number.isFinite(value) && value > 0 ? compactQty(value) : '';
      },
    };

    return {
      animationDuration: 450,
      animationDurationUpdate: 300,
      grid: { left: 4, right: 16, top: 44, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 51, 102, 0.05)' } },
        backgroundColor: C.surface,
        borderColor: '#c3c6d1',
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: C.ink, fontSize: 12 },
        extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -28px rgba(8,29,44,.5);',
        formatter: (params: { dataIndex: number }[]) => {
          const first = params[0];
          const entry = first ? chartData[first.dataIndex] : undefined;
          if (!entry) return '';
          const line = (label: string, value: number, color: string, usd?: number) =>
            `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:5px;">
              <span style="display:inline-flex;align-items:center;gap:6px;color:#43474f;">
                <span style="width:8px;height:8px;border-radius:2px;background:${color};"></span>${label}
              </span>
              <strong style="font-variant-numeric:tabular-nums;color:${C.ink};">${fmtQty(value, 0)} kg${
                usd !== undefined ? ` · ≈ ${fmtUsd(usd)}` : ''
              }</strong>
            </div>`;
          return `<div style="min-width:230px;">
            <div style="font-weight:700;color:#001e40;margin-bottom:2px;">Semana ${entry.week.weekIndex}
              <span style="font-weight:400;color:${C.outline};font-size:11px;">(${entry.week.from.slice(8)}-${entry.week.to.slice(8)})</span>
            </div>
            ${line('Vendido', entry.sold, C.navy, entry.soldUsd > 0 ? entry.soldUsd : undefined)}
            ${line('Solicitado (cartera)', entry.demand, C.navySoft)}
            ${line('A producir', entry.toProduce, C.red)}
            ${hasForecast ? line('Forecast', entry.forecast, C.limeDark) : ''}
          </div>`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        textStyle: { color: C.outline, fontSize: 11 },
      },
      xAxis: {
        type: 'category',
        data: weeks.map((week) => week.label),
        axisLabel: {
          color: C.outline,
          fontSize: 11,
          margin: 12,
          formatter: (label: string, index: number) =>
            weekIndex !== null && weeks[index]?.weekIndex === weekIndex ? `{active|${label}}` : label,
          rich: { active: { color: C.navy, fontWeight: 700, fontSize: 11 } },
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'kg',
        nameTextStyle: { color: C.outline, fontSize: 10, align: 'right' },
        axisLabel: { color: C.outline, fontSize: 10, formatter: (value: number) => compactQty(value) },
        splitLine: { lineStyle: { color: C.grid, type: [4, 4] } },
        splitNumber: 4,
      },
      series: [
        {
          name: 'Vendido',
          type: 'bar',
          data: barData('sold'),
          barMaxWidth: 20,
          barGap: '12%',
          barCategoryGap: '42%',
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: C.navyLight },
                { offset: 1, color: C.navy },
              ],
            },
          },
          emphasis: { focus: 'series' },
          label: barLabel,
          labelLayout: { hideOverlap: true },
        },
        {
          name: 'Solicitado',
          type: 'bar',
          data: barData('demand'),
          barMaxWidth: 20,
          itemStyle: { borderRadius: [5, 5, 0, 0], color: C.navySoft },
          emphasis: { focus: 'series' },
        },
        {
          name: 'A producir',
          type: 'bar',
          data: barData('toProduce'),
          barMaxWidth: 20,
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: C.redLight },
                { offset: 1, color: C.red },
              ],
            },
          },
          emphasis: { focus: 'series' },
          label: barLabel,
          labelLayout: { hideOverlap: true },
        },
        ...(hasForecast
          ? [
              {
                name: 'Forecast',
                type: 'line',
                data: chartData.map((entry) => entry.forecast),
                color: C.limeDark,
                smooth: 0.25,
                showSymbol: false,
                lineStyle: { width: 2, type: 'dashed', color: C.limeDark },
                itemStyle: { color: C.limeDark },
                z: 3,
              },
            ]
          : []),
      ],
    };
  }, [chartData, hasForecast, weekIndex, weeks]);

  // Totales del alcance elegido, en kg (la semana o el mes completo).
  const totals = useMemo(() => {
    if (weekIndex === null) {
      return {
        forecast: rows.reduce((a, r) => a + r.forecastMonthKg, 0),
        sold: rows.reduce((a, r) => a + r.soldMonthKg, 0),
        soldUsd: rows.reduce((a, r) => a + r.soldMonthUsd, 0),
        demand: rows.reduce((a, r) => a + r.demandMonthKg, 0),
        toProduce: rows.reduce((a, r) => a + r.productionMonthKg, 0),
        toProduceSacks: rows.reduce((a, r) => a + (r.productionMonthSacks ?? 0), 0),
        objective: 0,
        available: 0,
        excess: 0,
        attainment: null as number | null,
      };
    }
    const ws = rows
      .map((r) => ({ row: r, week: r.weeks.find((w) => w.weekIndex === weekIndex) }))
      .filter((x): x is { row: ForecastPlanRow; week: ForecastPlanWeek } => Boolean(x.week));
    const forecast = ws.reduce((a, x) => a + x.week.forecastKg, 0);
    const sold = ws.reduce((a, x) => a + x.week.soldKg, 0);
    return {
      forecast,
      sold,
      soldUsd: ws.reduce((a, x) => a + x.week.soldUsd, 0),
      demand: ws.reduce((a, x) => a + x.week.demandKg, 0),
      toProduce: ws.reduce((a, x) => a + x.week.toProduceKg, 0),
      toProduceSacks: ws.reduce((a, x) => a + (x.week.toProduceSacks ?? 0), 0),
      objective: ws.reduce((a, x) => a + x.week.objectiveKg, 0),
      available: ws.reduce((a, x) => a + x.week.availableKg, 0),
      excess: ws.reduce((a, x) => a + x.week.excessKg, 0),
      attainment: forecast > 0 && sold > 0 ? round1((sold / forecast) * 100) : null,
    };
  }, [rows, weekIndex]);

  // Cobertura de la semana evaluada: lo ya vendido + lo despachable contra el
  // objetivo. En una semana futura, vendido = 0.
  const coverage =
    weekIndex !== null && totals.objective > 0
      ? Math.min(1, (totals.available + totals.sold) / totals.objective)
      : 0;

  // Importe vendido en bolívares a la tasa VIGENTE (no la de cada nota): es la
  // lectura que pidió el usuario para contrastar el valor de hoy.
  const soldBs = data.exchangeRate !== null && data.exchangeRate > 0 ? totals.soldUsd * data.exchangeRate : null;
  const soldSecondary =
    totals.soldUsd > 0
      ? {
          value: fmtUsd(totals.soldUsd),
          hint: soldBs !== null ? `Bs ${fmtQty(soldBs, 0)} a la tasa de hoy` : undefined,
          title:
            soldBs !== null && data.exchangeRate !== null
              ? `Bs ${fmtQty(soldBs, 0)} a la tasa de hoy (${fmtQty(data.exchangeRate, 2)} Bs/US$). Importe de las notas de entrega, sin IVA.`
              : 'Importe de las notas de entrega, sin IVA, a la tasa de cada nota.',
        }
      : undefined;

  // Filas con la semana elegida (las que no la tienen se omiten, como antes).
  const weekEntries = useMemo(
    () =>
      rows
        .map((row) => ({ row, week: row.weeks.find((w) => w.weekIndex === weekIndex) }))
        .filter((e): e is { row: ForecastPlanRow; week: ForecastPlanWeek } => Boolean(e.week)),
    [rows, weekIndex],
  );

  // La semana elegida ya terminó: el reporte se lee como resultado (vendido).
  const selectedClosed = weekEntries.length > 0 && weekEntries.every((e) => e.week.closed);

  const empty = (
    <EmptyState
      icon={CalendarRange}
      title={
        selectedProduct
          ? `Sin datos de ${selectedProduct.productCode} en esta vista`
          : 'Sin artículos para la presentación elegida'
      }
      description={
        selectedProduct
          ? `${selectedProduct.description} no tiene semanas calculadas en este mes.`
          : 'Prueba otra presentación (Saco / Granel) o vuelve al consolidado global.'
      }
      action={
        selectedProduct ? (
          <button
            type="button"
            onClick={() => setProductCode(null)}
            className="inline-flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary hover:bg-primary"
          >
            <RotateCcw aria-hidden className="size-4" /> Volver a la vista global
          </button>
        ) : undefined
      }
    />
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
          <span className="flex min-w-0 items-center gap-space-xs">
            {productCode !== r.productCode && (
              <FocusProductButton code={r.productCode} onClick={() => setProductCode(r.productCode)} />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="font-bold tabular-nums text-primary">{r.productCode}</span>
              <span className="max-w-[15rem] truncate text-label-sm text-on-surface-variant" title={r.description}>
                {r.description}
              </span>
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
            key: `s${w.weekIndex}forecast`,
            header: `S${w.weekIndex} Forecast`,
            align: 'right' as const,
            className: 'border-l border-surface-container',
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.forecastKg ?? 0,
            render: (r: ForecastPlanRow) => (
              <span className="text-on-surface-variant" title={`${w.label} · kg`}>
                {fmtQty(weekOf(r)?.forecastKg ?? 0, 0)}
              </span>
            ),
          },
          {
            key: `s${w.weekIndex}sold`,
            header: `S${w.weekIndex} Vendido`,
            align: 'right' as const,
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.soldKg ?? 0,
            render: (r: ForecastPlanRow) => {
              const sold = weekOf(r)?.soldKg ?? 0;
              const usd = weekOf(r)?.soldUsd ?? 0;
              return (
                <span
                  className={sold > 0 ? 'font-semibold text-primary' : 'text-outline'}
                  title={`${w.label} · ${fmtQty(sold, 0)} kg despachados${usd > 0 ? ` · ≈ ${fmtUsd(usd)}` : ''}`}
                >
                  {fmtQty(sold, 0)}
                </span>
              );
            },
          },
          {
            key: `s${w.weekIndex}prod`,
            header: `S${w.weekIndex} A prod.`,
            align: 'right' as const,
            sortValue: (r: ForecastPlanRow) => weekOf(r)?.toProduceKg ?? 0,
            render: (r: ForecastPlanRow) => {
              const qty = weekOf(r)?.toProduceKg ?? 0;
              const week = weekOf(r);
              return (
                <span
                  className={qty > 0 ? 'font-bold text-error' : 'text-outline'}
                  title={
                    week?.closed
                      ? `${w.label} cerrada · kg`
                      : `${w.label} · objetivo ${fmtQty(week?.objectiveKg ?? 0, 0)} − stock ${fmtQty(
                          week?.stockKg ?? 0,
                          0,
                        )} kg`
                  }
                >
                  {fmtQty(qty, 0)}
                </span>
              );
            },
          },
        ];
      }),
      {
        key: 'prodMes',
        header: 'Prod. mes (kg)',
        align: 'right',
        kind: 'metric',
        className: 'border-l border-surface-container',
        sortValue: (r) => r.productionMonthKg,
        render: (r) => <span className="font-bold text-primary">{fmtQty(r.productionMonthKg, 0)}</span>,
      },
      {
        key: 'vendidoMesUsd',
        header: 'Vendido mes ($)',
        align: 'right',
        kind: 'metric',
        className: 'border-l border-surface-container',
        sortValue: (r) => r.soldMonthUsd,
        render: (r) => (
          <span className={r.soldMonthUsd > 0 ? 'font-bold text-primary' : 'text-outline'}>
            {r.soldMonthUsd > 0 ? fmtUsd(r.soldMonthUsd) : '—'}
          </span>
        ),
      },
    ],
    [weeks, productCode],
  );

  // Reporte de una semana: todos los campos en kg, con los sacos derivados.
  const weekColumns = useMemo<Column<{ row: ForecastPlanRow; week: ForecastPlanWeek }>[]>(
    () => [
      {
        key: 'codigo',
        header: 'Código',
        kind: 'id',
        sortValue: (e) => e.row.productCode,
        render: (e) => (
          <span className="flex items-center gap-space-xs">
            {productCode !== e.row.productCode && (
              <FocusProductButton code={e.row.productCode} onClick={() => setProductCode(e.row.productCode)} />
            )}
            <span className="font-bold tabular-nums text-primary">{e.row.productCode}</span>
          </span>
        ),
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
      { key: 'stock9999', header: 'Stock 9999', align: 'right', sortValue: (e) => e.row.stock9999, render: (e) => fmtQty(e.row.stock9999, 0) },
      { key: 'stock68', header: 'Stock 68', align: 'right', sortValue: (e) => e.row.stock68, render: (e) => fmtQty(e.row.stock68, 0) },
      {
        key: 'existencia',
        header: 'Existencia',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.row.stockTotal,
        render: (e) => (
          <span className="font-bold" title={`${fmtQty(e.row.stockTotal, 0)} ${e.row.uom} · ${fmtQty(e.row.stockKg, 0)} kg`}>
            {fmtQty(e.row.stockTotal, 0)}
          </span>
        ),
      },
      {
        key: 'solicitado',
        header: 'Solicitado (kg)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.demandKg,
        render: (e) => (
          <span className="tabular-nums text-on-surface-variant" title="Cartera pendiente con entrega efectiva en la semana">
            {fmtQty(e.week.demandKg, 0)}
          </span>
        ),
      },
      {
        key: 'forecastSem',
        header: 'Forecast sem. (kg)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.forecastKg,
        render: (e) => <span className="font-semibold text-on-surface">{fmtQty(e.week.forecastKg, 0)}</span>,
      },
      {
        key: 'vendido',
        header: 'Vendido (kg)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.soldKg,
        render: (e) => (
          <span className={e.week.soldKg > 0 ? 'font-bold text-primary' : 'text-outline'}>
            {fmtQty(e.week.soldKg, 0)}
          </span>
        ),
      },
      {
        key: 'vendidoUsd',
        header: 'Vendido ($)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.soldUsd,
        render: (e) => (
          <span
            className={e.week.soldUsd > 0 ? 'font-semibold text-primary' : 'text-outline'}
            title="Importe de las notas de entrega de la semana, sin IVA y a la tasa de cada nota"
          >
            {e.week.soldUsd > 0 ? fmtUsd(e.week.soldUsd) : '—'}
          </span>
        ),
      },
      {
        key: 'cumplimiento',
        header: 'Cumpl.',
        align: 'right',
        sortValue: (e) => e.week.attainmentPct ?? -1,
        render: (e) => {
          const pct = e.week.attainmentPct;
          if (pct === null) return <span className="text-outline">—</span>;
          return (
            <span className={pct >= 100 ? 'font-semibold text-success' : pct >= 80 ? 'text-warning' : 'font-semibold text-error'}>
              {fmtQty(pct, 0)}%
            </span>
          );
        },
      },
      {
        key: 'despachable',
        header: 'Despachable (kg)',
        align: 'right',
        kind: 'metric',
        sortValue: (e) => e.week.availableKg,
        render: (e) => (
          <span className="font-bold text-secondary" title={e.week.closed ? 'Semana cerrada' : `Stock al inicio de la semana: ${fmtQty(e.week.stockKg, 0)} kg`}>
            {e.week.closed ? '—' : fmtQty(e.week.availableKg, 0)}
          </span>
        ),
      },
      {
        key: 'aProducir',
        header: 'A producir (kg)',
        align: 'right',
        sortValue: (e) => e.week.toProduceKg,
        render: (e) => {
          const week = e.week;
          return (
            <span
              className={week.toProduceKg > 0 ? 'font-bold text-error' : 'text-outline'}
              title={
                week.closed
                  ? 'Semana cerrada: no se sugiere producción; compara Vendido vs Forecast'
                  : `Objetivo ${fmtQty(week.objectiveKg, 0)} kg − stock al inicio ${fmtQty(week.stockKg, 0)} kg`
              }
            >
              {fmtQty(week.toProduceKg, 0)}
            </span>
          );
        },
      },
      {
        key: 'aProducirSacos',
        header: 'A producir (sacos)',
        align: 'right',
        sortValue: (e) => e.week.toProduceSacks ?? -1,
        render: (e) => {
          if (e.week.toProduceSacks === null) {
            return (
              <span className="text-outline" title="El artículo se produce a granel: se planifica en kg">
                —
              </span>
            );
          }
          return (
            <span className={e.week.toProduceSacks > 0 ? 'font-semibold text-error' : 'text-outline'}>
              {fmtQty(e.week.toProduceSacks, 0)}
            </span>
          );
        },
      },
      {
        key: 'excedente',
        header: 'Excedente (kg)',
        align: 'right',
        sortValue: (e) => e.week.excessKg,
        render: (e) => (
          <span
            className={e.week.excessKg > 0 ? 'font-semibold text-success' : 'text-outline'}
            title={
              e.week.closed
                ? 'Semana cerrada: el stock de hoy no representa el de esa semana'
                : `Stock al inicio ${fmtQty(e.week.stockKg, 0)} − objetivo ${fmtQty(e.week.objectiveKg, 0)} kg`
            }
          >
            {e.week.closed ? '—' : fmtQty(e.week.excessKg, 0)}
          </span>
        ),
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
    [productCode],
  );

  function exportCsv() {
    const header = ['Codigo', 'Descripcion', 'Unid', 'Stock 03', 'Stock 9999', 'Stock 68', 'Existencia (unid)', 'Existencia (kg)'];
    if (weekIndex === null) {
      for (const w of weeks) header.push(`${w.label} Forecast (kg)`, `${w.label} Vendido (kg)`, `${w.label} Vendido (USD)`, `${w.label} A producir (kg)`);
    } else {
      header.push(
        `S${weekIndex} Forecast (kg)`,
        `S${weekIndex} Solicitado (kg)`,
        `S${weekIndex} Vendido (kg)`,
        `S${weekIndex} Vendido (USD)`,
        'Objetivo (kg)',
        'Despachable (kg)',
        'A producir (kg)',
        'A producir (sacos)',
        'Excedente (kg)',
        'Cumpl. %',
        'Estado',
      );
    }
    header.push('Prod mes (kg)', 'Prod mes (sacos)', 'Vendido mes (USD)');
    const body = rows.map((r) => {
      const out: string[] = [
        r.productCode,
        r.description,
        r.uom,
        String(r.stock03),
        String(r.stock9999),
        String(r.stock68),
        String(r.stockTotal),
        String(r.stockKg),
      ];
      if (weekIndex === null) {
        for (const w of weeks) {
          const wk = r.weeks.find((x) => x.weekIndex === w.weekIndex);
          out.push(
            String(wk?.forecastKg ?? 0),
            String(wk?.soldKg ?? 0),
            String(wk?.soldUsd ?? 0),
            String(wk?.toProduceKg ?? 0),
          );
        }
      } else {
        const wk = r.weeks.find((x) => x.weekIndex === weekIndex);
        out.push(
          String(wk?.forecastKg ?? 0),
          String(wk?.demandKg ?? 0),
          String(wk?.soldKg ?? 0),
          String(wk?.soldUsd ?? 0),
          String(wk?.objectiveKg ?? 0),
          String(wk?.availableKg ?? 0),
          String(wk?.toProduceKg ?? 0),
          String(wk?.toProduceSacks ?? ''),
          String(wk?.excessKg ?? 0),
          String(wk?.attainmentPct ?? ''),
          wk ? STATUS_LABEL[wk.status] : '',
        );
      }
      out.push(String(r.productionMonthKg), String(r.productionMonthSacks ?? ''), String(r.soldMonthUsd));
      return out;
    });
    const csv = [header, ...body].map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const suffix = weekIndex === null ? 'todas' : `s${weekIndex}`;
    const scope = selectedProduct ? `-${selectedProduct.productCode.replace(/[^\w-]+/g, '_')}` : '';
    link.download = `plan-produccion-${data.year}-${String(data.month).padStart(2, '0')}-${suffix}${scope}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-space-md lg:grid-cols-12">
        <Card className="min-w-0 p-space-md lg:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-space-sm">
            <div className="min-w-0">
              <div className="font-semibold uppercase text-label-sm text-outline">
                Vendido, solicitado y a producir por semana (kg)
              </div>
              <p className="mt-space-2xs text-label-sm text-on-surface-variant">
                {selectedProduct ? (
                  <>
                    <strong className="text-on-surface">{selectedProduct.productCode}</strong> ·{' '}
                    {selectedProduct.description}
                  </>
                ) : (
                  <>{allRows.length} artículos · consolidado</>
                )}
                {' · '}
                {weekIndex === null ? (
                  '4 semanas del mes'
                ) : (
                  <>
                    <strong className="text-on-surface">Semana {weekIndex}</strong> resaltada
                  </>
                )}
              </p>
            </div>
            {selectedProduct && (
              <button
                type="button"
                onClick={() => setProductCode(null)}
                className="inline-flex h-8 shrink-0 items-center gap-space-xs rounded-lg border border-outline-variant/50 px-space-sm text-label-md font-semibold text-primary-container transition-colors hover:bg-surface-container-low"
              >
                <RotateCcw aria-hidden className="size-3.5" /> Ver global
              </button>
            )}
          </div>

          <div className="mt-space-sm flex flex-col gap-space-xs sm:max-w-md">
            <span className="font-semibold uppercase text-label-sm text-outline">Producto en la gráfica</span>
            <ProductPicker
              value={productCode}
              onChange={setProductCode}
              options={productOptions}
              allLabel={`Todos los productos (${allRows.length})`}
            />
          </div>

          <EChart
            option={chart}
            height={selectedProduct ? 320 : 300}
            ariaLabel={
              selectedProduct
                ? `Vendido, solicitado y producción por semana de ${selectedProduct.productCode}`
                : 'Vendido, solicitado y producción por semana (todos los artículos)'
            }
            className="mt-space-sm"
            pointerCategories={weeks.map((_, index) => index)}
            onIndexDoubleClick={(index) => {
              const week = weeks[index];
              if (week) setSelected(String(week.weekIndex));
            }}
          />
          <p className="mt-space-xs text-label-sm text-on-surface-variant">
            Doble clic en una semana de la gráfica para cargar su detalle en el panel y en la tabla.
          </p>
        </Card>

        <Card className="flex min-w-0 flex-col gap-space-md p-space-md lg:col-span-5">
          {selectedProduct && (
            <div className="flex items-start gap-space-sm rounded-xl border border-primary-fixed bg-surface-container-low p-space-sm">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-container text-on-primary">
                <Boxes aria-hidden className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-space-xs">
                  <span className="font-bold tabular-nums text-primary">{selectedProduct.productCode}</span>
                  <Badge tone="muted">{selectedProduct.uom}</Badge>
                  <span className="text-label-sm text-on-surface-variant">
                    Stock {fmtQty(selectedProduct.stockTotal, 0)}
                  </span>
                </div>
                <p className="truncate text-label-sm text-on-surface-variant" title={selectedProduct.description}>
                  {selectedProduct.description}
                </p>
              </div>
            </div>
          )}

          <label className="flex flex-col gap-space-2xs">
            <span className="font-semibold uppercase text-label-sm text-outline">Semana a evaluar</span>
            <Select value={selected} onChange={setSelected} options={weekOptions} ariaLabel="Semana a evaluar" />
            <span className="text-label-sm text-on-surface-variant">
              {selectedRange
                ? `Del ${selectedRange.from} al ${selectedRange.to}.`
                : 'Vista consolidada de todo el mes.'}
            </span>
          </label>

          <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
            <Kpi label={weekIndex === null ? 'Forecast del mes' : 'Forecast de la semana'} value={fmtQty(totals.forecast, 0)} suffix="kg" tone="primary" />
            <Kpi
              label={weekIndex === null ? 'Vendido del mes' : 'Vendido de la semana'}
              value={fmtQty(totals.sold, 0)}
              suffix="kg"
              secondary={soldSecondary}
            />
            <Kpi label={weekIndex === null ? 'Solicitado del mes' : 'Solicitado de la semana'} value={fmtQty(totals.demand, 0)} suffix="kg" />
            <Kpi label="A producir" value={fmtQty(totals.toProduce, 0)} suffix="kg" tone="danger" />
          </div>

          {(totals.toProduceSacks > 0 || (weekIndex !== null && totals.attainment !== null)) && (
            <div className="flex flex-wrap items-baseline justify-between gap-space-sm text-label-sm text-on-surface-variant">
              <span>{totals.toProduceSacks > 0 ? `≈ ${fmtQty(totals.toProduceSacks, 0)} sacos (solo SAC)` : ''}</span>
              {weekIndex !== null && totals.attainment !== null && (
                <span>
                  Cumplimiento:{' '}
                  <strong className={totals.attainment >= 100 ? 'text-success' : 'text-error'}>
                    {fmtQty(totals.attainment, 0)}%
                  </strong>{' '}
                  (vendido ÷ forecast)
                </span>
              )}
            </div>
          )}

          {selectedClosed && (
            <p className="rounded-xl bg-surface-container-low px-space-sm py-space-xs text-label-sm text-on-surface-variant">
              Semana cerrada: se lee como resultado (vendido vs forecast) y no sugiere producción.
            </p>
          )}

          {weekIndex !== null && !selectedClosed && (
            <div className="rounded-xl border border-outline-variant/35 bg-surface/70 p-space-sm">
              <div className="flex items-baseline justify-between gap-space-sm">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                  Cobertura de la semana
                </span>
                <span
                  className={`text-title-md font-bold tabular-nums ${
                    coverage >= 0.999 ? 'text-success' : coverage > 0 ? 'text-warning' : 'text-error'
                  }`}
                >
                  {fmtQty(coverage * 100, 0)}%
                </span>
              </div>
              <CoverageBar ratio={coverage} className="mt-space-xs" />
              <div className="mt-space-2xs flex items-center justify-between gap-space-sm text-label-sm text-on-surface-variant">
                <span>
                  Vendido {fmtQty(totals.sold, 0)} + despachable {fmtQty(totals.available, 0)}
                </span>
                <span>Objetivo {fmtQty(totals.objective, 0)}</span>
              </div>
            </div>
          )}

          <button
            onClick={exportCsv}
            title={selectedProduct ? `Exportar solo ${selectedProduct.productCode}` : 'Exportar el consolidado'}
            className="flex h-9 items-center justify-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary hover:bg-primary"
          >
            <Download aria-hidden className="size-4" /> Exportar plan (CSV)
          </button>
          <p className="text-label-sm text-on-surface-variant">
            <strong>Objetivo = el mayor entre el forecast y el solicitado de la semana.</strong> A producir = max(0,
            objetivo − stock al inicio); el stock arrastra lo producido y lo vendido en las semanas anteriores, así que
            el mes no repite la misma brecha. Si sobra stock se muestra como <strong>Excedente</strong>.
          </p>
          <p className="text-label-sm text-on-surface-variant">
            <strong>Vendido ($)</strong> = notas de entrega no anuladas, importe neto sin IVA y a la tasa de cada nota.
            El equivalente en Bs usa la tasa de hoy.
          </p>
        </Card>
      </div>

      {weekIndex === null ? (
        <Card className="overflow-hidden">
          <DataTable
            columns={monthColumns}
            rows={rows}
            rowKey={(r) => r.productCode}
            empty={empty}
            footer={
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <td className="px-space-sm py-space-xs uppercase text-label-sm text-outline">Totales</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(rows.reduce((a, r) => a + r.stockTotal, 0), 0)}</td>
                {weeks.map((w) => {
                  const of = (pick: (x: ForecastPlanWeek) => number) =>
                    rows.reduce((a, r) => {
                      const week = r.weeks.find((x) => x.weekIndex === w.weekIndex);
                      return a + (week ? pick(week) : 0);
                    }, 0);
                  return (
                    <Fragment key={w.weekIndex}>
                      <td className="border-l border-surface-container px-space-sm py-space-xs text-right tabular-nums text-on-surface-variant">
                        {fmtQty(of((x) => x.forecastKg), 0)}
                      </td>
                      <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">
                        {fmtQty(of((x) => x.soldKg), 0)}
                      </td>
                      <td className="px-space-sm py-space-xs text-right tabular-nums text-error">
                        {fmtQty(of((x) => x.toProduceKg), 0)}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="border-l border-surface-container px-space-sm py-space-xs text-right tabular-nums text-primary">
                  {fmtQty(totals.toProduce, 0)}
                </td>
                <td className="border-l border-surface-container px-space-sm py-space-xs text-right tabular-nums text-primary">
                  {fmtUsd(totals.soldUsd)}
                </td>
              </tr>
            }
          />
          <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
            Semanas del mes: {weeks.map((w) => w.label).join(' · ')}. Cada semana se ordena al pulsar su encabezado y el
            artículo queda fijo al desplazar a la derecha.
            {!selectedProduct && ' Usa el icono de gráfica de una fila para enfocar ese artículo.'}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={weekColumns}
            rows={weekEntries}
            rowKey={(e) => e.row.productCode}
            empty={empty}
            footer={
              <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
                <td colSpan={7} className="px-space-sm py-space-xs uppercase text-label-sm text-outline">
                  Totales de la semana
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(totals.demand, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(totals.forecast, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtQty(totals.sold, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmtUsd(totals.soldUsd)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">
                  {totals.attainment === null ? '—' : `${fmtQty(totals.attainment, 0)}%`}
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums">{fmtQty(totals.available, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-error">{fmtQty(totals.toProduce, 0)}</td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-error">
                  {totals.toProduceSacks > 0 ? fmtQty(totals.toProduceSacks, 0) : ''}
                </td>
                <td className="px-space-sm py-space-xs text-right tabular-nums text-success">{fmtQty(totals.excess, 0)}</td>
                <td />
              </tr>
            }
          />
          <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
            Las cantidades van en <strong>kg</strong>; el vendido añade su importe en <strong>$</strong> (notas sin IVA,
            tasa de cada nota). Los sacos se derivan con el kg por saco y solo aplican a artículos SAC.{' '}
            <span className="font-semibold text-error">Rojo</span> = falta producir ·{' '}
            <span className="font-semibold text-success">Verde</span> = sobra stock. El objetivo de la semana es el{' '}
            <strong>mayor entre el forecast y el solicitado</strong>, y el stock es el que queda tras producir y consumir
            las semanas anteriores. <strong>Vendido</strong> son las notas de entrega de esa semana y <strong>Cumpl.</strong>{' '}
            es vendido ÷ forecast. En las semanas cerradas no se sugiere producción.
          </div>
        </Card>
      )}
    </>
  );
}

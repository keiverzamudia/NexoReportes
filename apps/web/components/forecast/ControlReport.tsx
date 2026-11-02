'use client';

// ============================================================
// Reporte → Control: la tabla del pizarrón.
//
// Código · Descripción · Forecast · Solicitado · Vtas
//   · Diferencia venta − forecast
//   · Diferencia venta + solicitado − forecast
//
// Mensual o semanal (bloques 1-7 / 8-14 / 15-21 / 22-fin) y en kg o en la
// unidad de venta (sacos para SAC, kg para granel). No escribe nada.
// ============================================================

import type { ForecastPlanResponse, ForecastPlanRow } from '@nexo/contracts';
import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CONTROL_COLUMN_HELP,
  CONTROL_HELP_RULES,
  CONTROL_HELP_TERMS,
  CONTROL_HELP_TITLE,
} from '../../content/help/forecast-plan';
import { controlValues, toDisplayUnit, type ControlUnit } from '../../lib/forecast-control';
import { ModuleHelp } from '../help/ColumnHelp';
import { Badge, Card, Column, DataTable, Segmented, Select, fmtQty } from '../ui';

type Period = 'month' | 'week';
type UnitFilter = 'ALL' | 'SAC' | 'KG';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Mensual' },
  { value: 'week', label: 'Semanal' },
];

const UNIT_OPTIONS: { value: ControlUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'uom', label: 'Sacos / unid.' },
];

function weekIndexOf(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function signedClass(value: number): string {
  if (value > 0) return 'font-semibold tabular-nums text-success';
  if (value < 0) return 'font-semibold tabular-nums text-critical';
  return 'tabular-nums text-outline';
}

export function ControlReport({ data, unit }: { data: ForecastPlanResponse; unit: UnitFilter }) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === data.year && today.getMonth() + 1 === data.month;
  const [period, setPeriod] = useState<Period>('month');
  const [controlUnit, setControlUnit] = useState<ControlUnit>('kg');
  const [weekIndex, setWeekIndex] = useState<number>(isCurrentMonth ? weekIndexOf(today.getDate()) : 1);

  const rows = useMemo(
    () => data.rows.filter((row) => unit === 'ALL' || row.uom === unit),
    [data.rows, unit],
  );

  const periodLabel = period === 'month' ? 'del mes' : `de la semana ${weekIndex}`;
  const unitLabel = controlUnit === 'kg' ? 'kg' : 'sacos/unid.';

  const display = (kg: number, row: ForecastPlanRow) => toDisplayUnit(kg, row.kgPerUom, controlUnit);
  const fmt = (value: number) => fmtQty(value, 0);

  const columns = useMemo<Column<ForecastPlanRow>[]>(
    () => [
      {
        key: 'codigo',
        header: 'Código',
        help: CONTROL_COLUMN_HELP.codigo,
        kind: 'id',
        sortValue: (row) => row.productCode,
        render: (row) => <span className="font-bold tabular-nums text-primary">{row.productCode}</span>,
      },
      {
        key: 'descripcion',
        header: 'Descripción',
        help: CONTROL_COLUMN_HELP.descripcion,
        sortValue: (row) => row.description,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-space-xs">
            <span className="block max-w-[14rem] truncate" title={row.description}>
              {row.description}
            </span>
            <Badge tone="muted">{row.uom}</Badge>
          </span>
        ),
      },
      {
        key: 'forecast',
        header: 'Forecast',
        help: CONTROL_COLUMN_HELP.forecast,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => controlValues(row, period === 'month' ? null : weekIndex).forecastKg,
        render: (row) => {
          const value = controlValues(row, period === 'month' ? null : weekIndex);
          return (
            <span className="font-semibold tabular-nums text-on-surface">
              {fmt(display(value.forecastKg, row))}
            </span>
          );
        },
      },
      {
        key: 'solicitado',
        header: 'Solicitado',
        help: CONTROL_COLUMN_HELP.solicitado,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => controlValues(row, period === 'month' ? null : weekIndex).demandKg,
        render: (row) => {
          const value = controlValues(row, period === 'month' ? null : weekIndex);
          return (
            <span className="tabular-nums text-on-surface-variant">
              {fmt(display(value.demandKg, row))}
            </span>
          );
        },
      },
      {
        key: 'ventas',
        header: 'Vtas',
        help: CONTROL_COLUMN_HELP.ventas,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => controlValues(row, period === 'month' ? null : weekIndex).soldKg,
        render: (row) => {
          const value = controlValues(row, period === 'month' ? null : weekIndex);
          return (
            <span className={value.soldKg > 0 ? 'font-bold tabular-nums text-primary' : 'tabular-nums text-outline'}>
              {fmt(display(value.soldKg, row))}
            </span>
          );
        },
      },
      {
        key: 'difVenta',
        header: 'Dif. venta − forecast',
        help: CONTROL_COLUMN_HELP.difVenta,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => controlValues(row, period === 'month' ? null : weekIndex).gapSaleKg,
        render: (row) => {
          const value = controlValues(row, period === 'month' ? null : weekIndex).gapSaleKg;
          return (
            <span className={signedClass(value)} title={value >= 0 ? 'Excedente sobre la meta' : 'Falta para la meta'}>
              {fmt(display(value, row))}
            </span>
          );
        },
      },
      {
        key: 'difCobertura',
        header: 'Dif. venta + solicitado − forecast',
        help: CONTROL_COLUMN_HELP.difCobertura,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => controlValues(row, period === 'month' ? null : weekIndex).gapCoverageKg,
        render: (row) => {
          const value = controlValues(row, period === 'month' ? null : weekIndex).gapCoverageKg;
          return (
            <span
              className={signedClass(value)}
              title={value >= 0 ? 'La meta queda cubierta con la venta y los pedidos' : 'Aún falta cubrir parte de la meta'}
            >
              {fmt(display(value, row))}
            </span>
          );
        },
      },
    ],
    [period, weekIndex, controlUnit],
  );

  const weekOptions = data.weekRanges.map((week) => ({
    value: String(week.weekIndex),
    label: `Semana ${week.weekIndex} (${week.from.slice(8)}-${week.to.slice(8)})`,
  }));

  const totals = useMemo(() => {
    const w = period === 'month' ? null : weekIndex;
    return rows.reduce(
      (acc, row) => {
        const value = controlValues(row, w);
        acc.forecast += display(value.forecastKg, row);
        acc.demand += display(value.demandKg, row);
        acc.sold += display(value.soldKg, row);
        acc.gapSale += display(value.gapSaleKg, row);
        acc.gapCoverage += display(value.gapCoverageKg, row);
        return acc;
      },
      { forecast: 0, demand: 0, sold: 0, gapSale: 0, gapCoverage: 0 },
    );
  }, [rows, period, weekIndex, controlUnit]);

  return (
    <>
      <Card className="flex flex-col gap-space-md p-space-md">
        <div className="flex flex-wrap items-end justify-between gap-space-md">
          <div className="min-w-0">
            <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">Control</p>
            <p className="text-body-sm text-on-surface-variant">
              Forecast, solicitado y venta {periodLabel}, en {unitLabel}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-space-md">
            <div className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase text-label-sm text-outline">Periodo</span>
              <Segmented ariaLabel="Periodo del control" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
            </div>
            {period === 'week' && (
              <label className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase text-label-sm text-outline">Semana</span>
                <Select
                  ariaLabel="Semana del control"
                  value={String(weekIndex)}
                  onChange={(value) => setWeekIndex(Number(value))}
                  options={weekOptions}
                  className="h-9 w-44"
                />
              </label>
            )}
            <div className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase text-label-sm text-outline">Unidad</span>
              <Segmented ariaLabel="Unidad del control" value={controlUnit} onChange={setControlUnit} options={UNIT_OPTIONS} />
            </div>
            <ModuleHelp
              title={CONTROL_HELP_TITLE}
              narrative={`Se comparan la meta de Profit, lo vendido por nota de entrega y lo solicitado ${periodLabel}.`}
              rules={CONTROL_HELP_RULES}
              terms={CONTROL_HELP_TERMS}
            />
          </div>
        </div>

        {!data.salesAvailable && (
          <p className="flex items-start gap-space-sm rounded-xl bg-warning-container/50 px-space-md py-space-sm text-body-md text-on-warning-container">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            Profit no devolvió los despachos: la columna Vtas queda en 0 y las diferencias solo reflejan la meta. No
            se muestran cifras inventadas.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <DataTable<ForecastPlanRow>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.productCode}
          showHelpRow={false}
          footer={
            <tr className="border-t-2 border-surface-container bg-surface-container-low font-bold">
              <td className="px-space-sm py-space-xs uppercase text-label-sm text-outline" colSpan={2}>
                Totales ({unitLabel})
              </td>
              <td className="px-space-sm py-space-xs text-right tabular-nums">{fmt(totals.forecast)}</td>
              <td className="px-space-sm py-space-xs text-right tabular-nums">{fmt(totals.demand)}</td>
              <td className="px-space-sm py-space-xs text-right tabular-nums text-primary">{fmt(totals.sold)}</td>
              <td className={`px-space-sm py-space-xs text-right ${signedClass(totals.gapSale)}`}>{fmt(totals.gapSale)}</td>
              <td className={`px-space-sm py-space-xs text-right ${signedClass(totals.gapCoverage)}`}>
                {fmt(totals.gapCoverage)}
              </td>
            </tr>
          }
        />
        <div className="border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
          Positivo = excedente sobre la meta · negativo = falta por cubrir. En «Sacos / unid.» los artículos SAC se
          convierten con su kg por saco y el granel se mantiene en kg (lo indica su badge).
        </div>
      </Card>
    </>
  );
}

import type { ForecastPlanRow, ForecastPlanWeek } from '@nexo/contracts';

// ============================================================
// Motor puro de la vista «Básico» (Reporte → Básico).
//
// Trabaja SIEMPRE en kg para las diferencias (forecast y venta son kg; la
// demanda tiene su propio kg) y solo convierte a la unidad de venta al pintar.
// Un artículo a granel no se convierte: su unidad ya es kg.
// ============================================================

export type ControlUnit = 'kg' | 'uom';

export interface ControlValues {
  /** Meta del periodo en kg. */
  forecastKg: number;
  /** Solicitado del periodo en kg. */
  demandKg: number;
  /** Venta del periodo en kg. */
  soldKg: number;
  /** Venta − forecast (positivo = excedente). */
  gapSaleKg: number;
  /** Venta + solicitado − forecast (positivo = meta cubierta). */
  gapCoverageKg: number;
}

function weekOf(row: ForecastPlanRow, weekIndex: number | null): ForecastPlanWeek | null {
  if (weekIndex === null) return null;
  return row.weeks.find((week) => week.weekIndex === weekIndex) ?? null;
}

export function controlValues(row: ForecastPlanRow, weekIndex: number | null): ControlValues {
  const week = weekOf(row, weekIndex);
  const forecastKg = week ? week.forecastQty : row.forecastMonthQty;
  const demandKg = week ? week.demandKg : row.demandMonthKg;
  const soldKg = week ? week.soldKg : row.soldMonthKg;
  return {
    forecastKg,
    demandKg,
    soldKg,
    gapSaleKg: soldKg - forecastKg,
    gapCoverageKg: soldKg + demandKg - forecastKg,
  };
}

/**
 * Convierte kg a la unidad mostrada. En modo `uom`, los artículos con
 * `kgPerUom > 0` (sacos) se dividen; el granel se queda en kg.
 */
export function toDisplayUnit(kg: number, kgPerUom: number | null | undefined, unit: ControlUnit): number {
  if (unit === 'kg') return kg;
  if (kgPerUom && kgPerUom > 0) return kg / kgPerUom;
  return kg;
}

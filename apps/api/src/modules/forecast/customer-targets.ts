import type { ForecastCustomerSalesHistoryMonth } from '@nexo/contracts';
import { MonthCalendar, computeRunRate, roundTo } from './sales-run-rate';

// ============================================================
// Meta histórica por cliente («Clientes vs meta»).
//
// Reglas:
//  · Ventana = los 3 meses CERRADOS anteriores al mes del informe.
//  · Meta   = promedio de los kg de los meses CON COMPRA dentro de la ventana.
//    Un cliente que compró 1 solo mes tiene esa compra como meta (peso 100 %).
//    Sin ninguna compra → meta 0 y el cliente queda «sin meta».
//  · La proyección de cierre y el resto de métricas reutilizan `computeRunRate`
//    con la meta en lugar del forecast oficial: misma regla de días hábiles,
//    mismo corte a ayer, mismos nulos sin meta. Cero matemática nueva.
//
// Función PURA: sin Prisma, sin HTTP y sin `new Date()` implícito.
// ============================================================

/** Ventana fija de la meta por cliente (meses cerrados anteriores). */
export const CUSTOMER_TARGET_HISTORY_MONTHS = 3;

export interface CustomerTargetInput {
  actualKg: number;
  /** Los 3 meses de la ventana, en orden cronológico (con ceros). */
  history: ForecastCustomerSalesHistoryMonth[];
  calendar: MonthCalendar;
}

export interface CustomerTargetMetrics {
  /** Promedio de los meses con compra (0 si no hubo). */
  targetKg: number;
  /** Cuántos meses de la ventana tuvieron compra (0–3). */
  targetMonths: number;
  dailyAvgKg: number;
  projectedKg: number | null;
  attainmentPct: number | null;
  projectedAttainmentPct: number | null;
  gapKg: number | null;
  requiredDailyKg: number | null;
}

export function customerTargetMetrics(input: CustomerTargetInput): CustomerTargetMetrics {
  const history = input.history.map((month) => ({
    year: month.year,
    month: month.month,
    kg: month.kg > 0 && Number.isFinite(month.kg) ? roundTo(month.kg) : 0,
  }));
  const monthsWithSales = history.filter((month) => month.kg > 0);
  const targetKg =
    monthsWithSales.length > 0
      ? roundTo(monthsWithSales.reduce((acc, month) => acc + month.kg, 0) / monthsWithSales.length, 1)
      : 0;

  const runRate = computeRunRate({
    actualKg: input.actualKg,
    forecastKg: targetKg,
    calendar: input.calendar,
  });

  return {
    targetKg,
    targetMonths: monthsWithSales.length,
    dailyAvgKg: runRate.dailyAvgKg,
    projectedKg: runRate.projectedKg,
    attainmentPct: runRate.attainmentPct,
    projectedAttainmentPct: runRate.projectedAttainmentPct,
    gapKg: runRate.gapKg,
    requiredDailyKg: runRate.requiredDailyKg,
  };
}

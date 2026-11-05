import type { ForecastSalesSource, ForecastSalesStatus } from '@nexo/contracts';
import { roundTo } from './sales-run-rate';

// ============================================================
// Resolución de la meta MENSUAL que usa el informe.
//
// Es una función pura para que «Ventas vs Forecast» y «Vendedoras vs Forecast»
// no puedan divergir: ambos llaman aquí con la misma lectura viva de `forecast`
// y el mismo snapshot local (`ForecastTarget`).
//
// Regla:
//  �� Mes en curso (OPEN)  → meta viva de Profit si está disponible.
//  �� Mes cerrado          → snapshot congelado si existe; si no, lectura viva.
//  �� Mes futuro           → meta viva si existe; si no, sin meta.
//
// `byCode` incluye la UNIÓN de códigos vivos y capturados: un artículo que
// desapareció de `forecast` después de capturarse debe seguir visible (con la
// meta capturada) para que la UI muestre el drift.
// ============================================================

export interface CapturedTarget {
  targetKg: number;
}

export interface ResolvedForecastTargets {
  /** La meta del informe sale de la lectura viva de Profit. */
  useLive: boolean;
  /** false = no se pudo leer `forecast` y no hay snapshot que cubra el mes. */
  forecastAvailable: boolean;
  source: ForecastSalesSource;
  /** Meta en kg por artículo (viva o capturada según la regla). */
  byCode: Map<string, number>;
  /** Unión de códigos con meta viva o capturada. */
  codes: string[];
  /** Suma de `byCode`, redondeada igual que las filas del informe. */
  totalKg: number;
}

export function resolveForecastTargets(
  status: ForecastSalesStatus,
  liveAvailable: boolean,
  liveByCode: Map<string, number>,
  capturedByCode: Map<string, CapturedTarget>,
): ResolvedForecastTargets {
  const isLive = status === 'OPEN';
  const hasSnapshot = capturedByCode.size > 0;
  const useLive = liveAvailable && liveByCode.size > 0 && (isLive || !hasSnapshot);
  const forecastAvailable = isLive || !hasSnapshot ? liveAvailable : true;

  const codes = new Set<string>([...liveByCode.keys(), ...capturedByCode.keys()]);
  const byCode = new Map<string, number>();
  let total = 0;

  for (const code of codes) {
    const value = useLive
      ? roundTo(liveByCode.get(code) ?? 0)
      : roundTo(capturedByCode.get(code)?.targetKg ?? 0);
    byCode.set(code, value);
    total += value;
  }

  return {
    useLive,
    forecastAvailable,
    source: useLive ? 'LIVE' : hasSnapshot ? (isLive ? 'CAPTURED' : 'SNAPSHOT') : 'NONE',
    byCode,
    codes: [...codes],
    totalKg: roundTo(total),
  };
}

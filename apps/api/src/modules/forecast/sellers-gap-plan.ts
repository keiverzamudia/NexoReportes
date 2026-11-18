// ============================================================
// Plan de cierre de brecha (motor PURO).
//
// Recibe el margen real de cada cliente (`headroomKg`: cuánto puede crecer por
// encima de lo esperado sin pasar de su mejor mes de los últimos 12) y la
// brecha de la red (`meta − esperado`). Devuelve cuántos kg le toca a cada
// cliente para cerrar el mes.
//
// Reglas:
//  · Nunca pide más que el margen real del cliente (no se inventa capacidad).
//  · Si el margen total no alcanza, cubre lo que hay y devuelve el resto como
//    `uncoveredKg`: la UI lo muestra en vez de repartirlo a la fuerza.
//  · Σ plan = lo cubierto, al kilo (mayor resto vía `allocateByWeight`).
//  · Sin brecha o sin margen: todo en cero y la brecha queda sin cubrir.
// ============================================================

import { roundTo } from './sales-run-rate';
import { allocateByWeight } from './sellers-allocation';

export interface GapPlanResult {
  /** Kg del plan por clave (vendedor + cliente). */
  plan: Map<string, number>;
  /** Brecha que se intentó cubrir. */
  gapKg: number;
  /** Kg efectivamente asignados (≤ gapKg). */
  coveredKg: number;
  /** Kg que la cartera actual no puede absorber. */
  uncoveredKg: number;
}

export interface GapPlanOptions {
  /** Decimales del reparto (por defecto 1: gramos). */
  decimals?: number;
}

/**
 * Reparte `gapKg` entre las claves según su margen real (`headroom`).
 *
 * La suma de lo repartido nunca supera la brecha ni el margen de cada clave.
 */
export function allocateGapByHeadroom(
  headroom: Map<string, number>,
  gapKg: number,
  options: GapPlanOptions = {},
): GapPlanResult {
  const decimals = options.decimals ?? 1;
  const gap = Number.isFinite(gapKg) && gapKg > 0 ? roundTo(gapKg, decimals) : 0;
  const plan = new Map<string, number>();

  if (gap <= 0) {
    for (const key of headroom.keys()) plan.set(key, 0);
    return { plan, gapKg: 0, coveredKg: 0, uncoveredKg: 0 };
  }

  const clean = new Map<string, number>();
  let total = 0;
  for (const [key, value] of headroom) {
    const safe = Number.isFinite(value) && value > 0 ? roundTo(value, decimals) : 0;
    clean.set(key, safe);
    total += safe;
  }
  total = roundTo(total, decimals);

  if (clean.size === 0 || total <= 0) {
    for (const key of headroom.keys()) plan.set(key, 0);
    return { plan, gapKg: gap, coveredKg: 0, uncoveredKg: gap };
  }

  // Solo se reparte lo que el margen real permite: si la brecha es mayor,
  // el excedente queda como `uncoveredKg`.
  const target = Math.min(gap, total);
  const allocated = allocateByWeight(clean, target, { decimals });

  let covered = 0;
  for (const [key, value] of clean) {
    const planned = Math.max(0, allocated.get(key) ?? 0);
    plan.set(key, planned);
    covered += planned;
  }
  covered = roundTo(covered, decimals);

  // El redondeo puede pasarse ±0,1 kg: se corrige en la clave de mayor plan.
  if (covered > gap) {
    const excess = roundTo(covered - gap, decimals);
    let targetKey: string | null = null;
    let targetValue = -1;
    for (const [key, value] of plan) {
      if (value > targetValue) {
        targetKey = key;
        targetValue = value;
      }
    }
    if (targetKey !== null) {
      plan.set(targetKey, roundTo(Math.max(0, targetValue - excess), decimals));
      covered = roundTo(Math.max(0, covered - excess), decimals);
    }
  }

  return {
    plan,
    gapKg: gap,
    coveredKg: covered,
    uncoveredKg: roundTo(Math.max(0, gap - covered), decimals),
  };
}

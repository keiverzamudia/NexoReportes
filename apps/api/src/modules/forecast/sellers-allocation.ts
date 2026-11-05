// ============================================================
// Motor PURO del reparto de la meta entre vendedoras y clientes.
//
// Sin Prisma, sin HTTP y sin `new Date()`: recibe pesos (kg históricos) y un
// total, y devuelve cuotas en kg que suman EXACTAMENTE el total (salvo el
// redondeo al decimal pedido, que se corrige con el método del mayor residuo).
//
// Reglas:
//  �� Sin histórico (Σ pesos = 0) el reparto es igualitario si el llamador lo
//    pide (`equalWhenEmpty`), o todo cero si no hay base alguna.
//  �� El residuo de redondeo se aplica a la clave de mayor peso: una vendedora
//    puede quedar ±0,1 kg y las demás exactas.
//  �� Nunca devuelve negativos, NaN ni Infinity.
// ============================================================

function round(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sanitize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface AllocateOptions {
  /** Decimales de la cuota (por defecto 1: gramos). */
  decimals?: number;
  /**
   * Sin pesos positivos: reparte el total en partes iguales. Útil cuando la
   * ventana histórica está vacía (instalación nueva) pero hay vendedoras.
   */
  equalWhenEmpty?: boolean;
}

/**
 * Reparte `total` proporcionalmente a `weights`.
 *
 * @param weights kg históricos por clave (vendedora o cliente).
 * @param total   meta en kg que se reparte.
 */
export function allocateByWeight(
  weights: Map<string, number>,
  total: number,
  options: AllocateOptions = {},
): Map<string, number> {
  const decimals = options.decimals ?? 1;
  const keys = [...weights.keys()];
  const result = new Map<string, number>();

  if (keys.length === 0) return result;

  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  if (safeTotal <= 0) {
    for (const key of keys) result.set(key, 0);
    return result;
  }

  const clean = new Map<string, number>();
  for (const key of keys) clean.set(key, sanitize(weights.get(key) ?? 0));

  let weightSum = 0;
  for (const value of clean.values()) weightSum += value;

  if (weightSum <= 0) {
    if (!options.equalWhenEmpty) {
      for (const key of keys) result.set(key, 0);
      return result;
    }
    for (const key of keys) clean.set(key, 1);
    weightSum = keys.length;
  }

  const raw = new Map<string, number>();
  let assigned = 0;
  for (const key of keys) {
    const value = (clean.get(key) ?? 0) / weightSum * safeTotal;
    raw.set(key, value);
    const rounded = round(value, decimals);
    result.set(key, rounded);
    assigned += rounded;
  }

  // Residuo de redondeo: se lo queda la clave de mayor peso (y, a igualdad,
  // la primera en el orden de inserción). `toFixed` evita -0.
  const residual = round(safeTotal - assigned, decimals);
  if (Math.abs(residual) >= 1 / 10 ** decimals) {
    let target = keys[0]!;
    let targetWeight = -1;
    for (const key of keys) {
      const value = clean.get(key) ?? 0;
      if (value > targetWeight) {
        target = key;
        targetWeight = value;
      }
    }
    const fixed = round((result.get(target) ?? 0) + residual, decimals);
    result.set(target, fixed > 0 ? fixed : 0);
  }

  return result;
}

/** Porcentaje seguro (null si el total no es positivo). */
export function sharePct(value: number, total: number, decimals = 1): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return round(value / total * 100, decimals);
}

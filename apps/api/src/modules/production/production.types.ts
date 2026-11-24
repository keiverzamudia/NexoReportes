import type { ProductionCostBasis, ProductionFormulaKind } from '@nexo/contracts';

// Estructuras normalizadas que usan los motores puros y el servicio.
// No dependen de Prisma ni de HTTP: se pueden probar con fixtures.

export interface FormulaComponent {
  line: number;
  code: string;
  description: string;
  type: string;
  uom: string;
  qty: number;
  kgPerUom: number | null;
  // Costos en bolívares históricos de Profit (columnas «Último»/«Promedio»).
  lastCost: number | null;
  avgCost: number | null;
  // Costos en dólares de Profit («Último OM»/«Prom. OM»). Base canónica.
  lastCostUsd: number | null;
  avgCostUsd: number | null;
  // Fila «Reposición» de Profit (`art.cos_merc`), solo en Bs.
  replacementCost: number | null;
  inactive: boolean;
}

export interface Formula {
  id: number;
  kind: ProductionFormulaKind;
  name: string;
  // Producto dueño de la cédula (base en las BASE, producto en MASTER/BATCH).
  productCode: string;
  productDescription: string;
  // Producto terminado al que se aplica esta fórmula.
  appliesToProductCode: string;
  appliesToDescription: string;
  appliesToUom: string;
  appliesToKgPerUom: number | null;
  outputQty: number;
  outputUom: string;
  batchKg: number | null;
  hoursPerBatch: number | null;
  isStandard: boolean;
  updatedAt: string | null;
  baseProductCode: string | null;
  baseProductDescription: string | null;
  components: FormulaComponent[];
}

export interface ExplodedComponent {
  component: FormulaComponent;
  requiredQty: number;
  requiredKg: number | null;
  unitCost: number | null;
  totalCost: number | null;
}

export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Costo unitario canónico en USD. Prioriza el costo en dólares de Profit
 * (`ult_cos_om`/`cos_pro_om`, columnas «Último OM»/«Prom. OM»). Solo si ese
 * campo no existe convierte el Bs histórico con la tasa del día.
 */
export function componentCost(
  component: FormulaComponent,
  basis: ProductionCostBasis,
  exchangeRate: number | null,
): number | null {
  const usd = basis === 'AVG' ? component.avgCostUsd : component.lastCostUsd;
  if (usd !== null && Number.isFinite(usd) && usd > 0) return usd;
  const bs = basis === 'AVG' ? component.avgCost : component.lastCost;
  if (bs !== null && Number.isFinite(bs) && bs > 0 && exchangeRate !== null && exchangeRate > 0) {
    return bs / exchangeRate;
  }
  return null;
}

export function formulaCost(formula: Formula, basis: ProductionCostBasis, exchangeRate: number | null): number {
  return round(
    formula.components.reduce((acc, component) => {
      const cost = componentCost(component, basis, exchangeRate);
      return cost === null ? acc : acc + component.qty * cost;
    }, 0),
    6,
  );
}

export function formulaOutputKg(formula: Formula, productKgPerUom: number | null): number | null {
  if (formula.outputUom === 'KG') return formula.outputQty > 0 ? formula.outputQty : null;
  if (formula.outputUom === 'SAC') {
    if (productKgPerUom === null || productKgPerUom <= 0) return null;
    return formula.outputQty * productKgPerUom;
  }
  // Otras unidades: se asume que la cantidad de la cédula ya está en la unidad
  // de venta y no se inventa un factor de conversión.
  return formula.outputQty > 0 ? formula.outputQty : null;
}

export function formulaCostPerKg(
  formula: Formula,
  productKgPerUom: number | null,
  basis: ProductionCostBasis,
  exchangeRate: number | null,
): number | null {
  const outputKg = formulaOutputKg(formula, productKgPerUom);
  if (outputKg === null || outputKg <= 0) return null;
  const total = formulaCost(formula, basis, exchangeRate);
  return total > 0 ? round(total / outputKg, 6) : null;
}

export function formulaCostPerSack(
  formula: Formula,
  productKgPerUom: number | null,
  basis: ProductionCostBasis,
  exchangeRate: number | null,
): number | null {
  if (isBulkPresentation(formula.appliesToUom, productKgPerUom)) return null;
  return sackCostFromKg(formulaCostPerKg(formula, productKgPerUom, basis, exchangeRate), productKgPerUom);
}

/** Convierte el costo canónico en USD a la moneda de la respuesta. */
export function displayCost(
  valueUsd: number | null,
  currency: 'BS' | 'USD',
  exchangeRate: number | null,
): number | null {
  if (valueUsd === null || !Number.isFinite(valueUsd)) return null;
  if (currency === 'USD') return round(valueUsd, 6);
  if (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;
  return round(valueUsd * exchangeRate, 4);
}

/**
 * Costo de reposición de un componente en USD: `cos_merc` de Profit es un
 * valor en Bs y se convierte con la tasa del día. Si está en 0 se usa el
 * último costo (`fallback = true`) para no inventar un valor.
 */
export function componentReplacementCost(
  component: FormulaComponent,
  exchangeRate: number | null,
): {
  cost: number | null;
  fallback: boolean;
} {
  const replacement = component.replacementCost;
  if (
    replacement !== null &&
    Number.isFinite(replacement) &&
    replacement > 0 &&
    exchangeRate !== null &&
    exchangeRate > 0
  ) {
    return { cost: replacement / exchangeRate, fallback: false };
  }
  return { cost: componentCost(component, 'LAST', exchangeRate), fallback: true };
}

export function formulaReplacementCost(formula: Formula, exchangeRate: number | null): number {
  return round(
    formula.components.reduce((acc, component) => {
      const { cost } = componentReplacementCost(component, exchangeRate);
      return cost === null ? acc : acc + component.qty * cost;
    }, 0),
    6,
  );
}

/** Componentes de la cédula sin valor de reposición cargado en Profit. */
export function formulaMissingReplacement(formula: Formula, exchangeRate: number | null): FormulaComponent[] {
  const seen = new Set<string>();
  const missing: FormulaComponent[] = [];
  for (const component of formula.components) {
    if (componentReplacementCost(component, exchangeRate).fallback === false) continue;
    const key = component.code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(component);
  }
  return missing;
}

export function formulaReplacementCostPerKg(
  formula: Formula,
  productKgPerUom: number | null,
  exchangeRate: number | null,
): number | null {
  const outputKg = formulaOutputKg(formula, productKgPerUom);
  if (outputKg === null || outputKg <= 0) return null;
  const total = formulaReplacementCost(formula, exchangeRate);
  return total > 0 ? round(total / outputKg, 6) : null;
}

/** Un producto es granel cuando no se vende por saco o su presentación es 1 kg. */
export function isBulkPresentation(uom: string | null | undefined, presentationKg: number | null): boolean {
  return (uom ?? '').toUpperCase() !== 'SAC' || presentationKg === null || presentationKg <= 1;
}

/** Costo de un saco a partir del costo por kg y la presentación real (kg/saco). */
export function sackCostFromKg(perKg: number | null, presentationKg: number | null): number | null {
  if (perKg === null || presentationKg === null || presentationKg <= 1) return null;
  return round(perKg * presentationKg, 4);
}

export function formulaReplacementCostPerSack(
  formula: Formula,
  productKgPerUom: number | null,
  exchangeRate: number | null,
): number | null {
  if (isBulkPresentation(formula.appliesToUom, productKgPerUom)) return null;
  return sackCostFromKg(formulaReplacementCostPerKg(formula, productKgPerUom, exchangeRate), productKgPerUom);
}

export interface DemandInput {
  forecastKg: number;
  soldKg: number;
  ordersKg: number;
  safetyKg: number;
  availableKg: number;
  policy: 'MAX' | 'FORECAST' | 'ORDERS' | 'SUM';
}

export interface DemandResult {
  forecastRemainingKg: number;
  demandKg: number;
  requiredKg: number;
}

export function computeDemand(input: DemandInput): DemandResult {
  const forecastKg = Math.max(0, input.forecastKg);
  const soldKg = Math.max(0, input.soldKg);
  const ordersKg = Math.max(0, input.ordersKg);
  const forecastRemainingKg = round(Math.max(0, forecastKg - soldKg));
  const demandKg =
    input.policy === 'FORECAST'
      ? forecastRemainingKg
      : input.policy === 'ORDERS'
        ? ordersKg
        : input.policy === 'SUM'
          ? round(forecastRemainingKg + ordersKg)
          : round(Math.max(forecastRemainingKg, ordersKg));
  const requiredKg = round(Math.max(0, demandKg + Math.max(0, input.safetyKg) - Math.max(0, input.availableKg)));
  return { forecastRemainingKg, demandKg, requiredKg };
}

export interface BatchResult {
  batches: number;
  productionKg: number;
  productionSacks: number | null;
}

export function resolveBatches(requiredKg: number, batchKg: number | null, kgPerUom: number | null): BatchResult {
  if (requiredKg <= 0) return { batches: 0, productionKg: 0, productionSacks: 0 };
  if (batchKg !== null && batchKg > 0) {
    const batches = Math.ceil(requiredKg / batchKg);
    const productionKg = round(batches * batchKg);
    return {
      batches,
      productionKg,
      productionSacks: kgPerUom !== null && kgPerUom > 0 ? round(productionKg / kgPerUom, 0) : null,
    };
  }
  // Sin lote configurado: se produce exactamente lo requerido, sin inventar un
  // tamaño de lote. La UI muestra el aviso de lote faltante.
  return {
    batches: 1,
    productionKg: round(requiredKg),
    productionSacks: kgPerUom !== null && kgPerUom > 0 ? round(requiredKg / kgPerUom, 0) : null,
  };
}

export function productionFactor(
  formula: Formula,
  productionKg: number,
  productionSacks: number | null,
  productKgPerUom: number | null,
): number {
  if (formula.outputQty <= 0) return 0;
  if (formula.outputUom === 'SAC' && productionSacks !== null) {
    return productionSacks / formula.outputQty;
  }
  if (formula.outputUom === 'KG') {
    return productionKg / formula.outputQty;
  }
  const outputKg = formulaOutputKg(formula, productKgPerUom);
  if (outputKg !== null && outputKg > 0) return productionKg / outputKg;
  return productionSacks !== null ? productionSacks / formula.outputQty : 0;
}

export function explode(
  formula: Formula,
  productionKg: number,
  productionSacks: number | null,
  productKgPerUom: number | null,
  basis: ProductionCostBasis,
  exchangeRate: number | null,
): ExplodedComponent[] {
  const factor = productionFactor(formula, productionKg, productionSacks, productKgPerUom);
  if (factor <= 0) return [];
  return formula.components.map((component) => {
    const requiredQty = round(component.qty * factor, 6);
    const requiredKg =
      component.uom === 'KG'
        ? requiredQty
        : component.kgPerUom !== null && component.kgPerUom > 0
          ? round(requiredQty * component.kgPerUom, 6)
          : null;
    const unitCost = componentCost(component, basis, exchangeRate);
    return {
      component,
      requiredQty,
      requiredKg,
      unitCost,
      totalCost: unitCost === null ? null : round(requiredQty * unitCost, 6),
    };
  });
}

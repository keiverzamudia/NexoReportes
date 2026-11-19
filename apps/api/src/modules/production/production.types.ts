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
  lastCost: number | null;
  avgCost: number | null;
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

export function componentCost(component: FormulaComponent, basis: ProductionCostBasis): number | null {
  const cost = basis === 'AVG' ? component.avgCost : component.lastCost;
  if (cost === null || !Number.isFinite(cost) || cost <= 0) return null;
  return cost;
}

export function formulaCost(formula: Formula, basis: ProductionCostBasis): number {
  return round(
    formula.components.reduce((acc, component) => {
      const cost = componentCost(component, basis);
      return cost === null ? acc : acc + component.qty * cost;
    }, 0),
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
): number | null {
  const outputKg = formulaOutputKg(formula, productKgPerUom);
  if (outputKg === null || outputKg <= 0) return null;
  const total = formulaCost(formula, basis);
  return total > 0 ? round(total / outputKg) : null;
}

export function formulaCostPerSack(
  formula: Formula,
  productKgPerUom: number | null,
  basis: ProductionCostBasis,
): number | null {
  if (formula.outputUom === 'SAC') {
    const total = formulaCost(formula, basis);
    return total > 0 && formula.outputQty > 0 ? round(total / formula.outputQty) : null;
  }
  const perKg = formulaCostPerKg(formula, productKgPerUom, basis);
  if (perKg === null || productKgPerUom === null || productKgPerUom <= 0) return null;
  return round(perKg * productKgPerUom);
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
    const unitCost = componentCost(component, basis);
    return {
      component,
      requiredQty,
      requiredKg,
      unitCost,
      totalCost: unitCost === null ? null : round(requiredQty * unitCost),
    };
  });
}

export function convertCost(value: number | null, currency: 'BS' | 'USD', exchangeRate: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (currency === 'BS') return round(value);
  if (exchangeRate === null || exchangeRate <= 0) return null;
  return round(value / exchangeRate);
}

export function convertMoney(value: number | null, currency: 'BS' | 'USD', exchangeRate: number | null): number | null {
  return convertCost(value, currency, exchangeRate);
}

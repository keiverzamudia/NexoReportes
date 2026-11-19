import type { ProductionNutrientStatus, ProductionNutrientValue } from '@nexo/contracts';
import { Formula, round } from './production.types';

export interface NutrientDefinition {
  code: string;
  name: string;
  unit: string;
  category: string;
  sortOrder: number;
}

export interface IngredientNutrientValue {
  ingredientCode: string;
  nutrientCode: string;
  value: number;
  basis: string;
}

export interface NutrientSpecification {
  productCode: string;
  nutrientCode: string;
  minValue: number | null;
  maxValue: number | null;
  targetValue: number | null;
}

export interface FormulaNutritionResult {
  available: boolean;
  coveragePct: number;
  nutrients: ProductionNutrientValue[];
}

/**
 * Calcula la nutrición de una fórmula a partir de los kg de cada componente y
 * los valores por kg de ingrediente cargados en Nexo.
 *
 * - Los componentes que no están en KG se convierten con `kgPerUom` cuando
 *   existe; si no, se omiten del cálculo (no se inventa una conversión).
 * - Los nutrientes sin dato quedan en `null` y con estado `NO_DATA`.
 * - La especificación es opcional: sin mín/máx el nutriente queda en `OK`.
 */
export function computeFormulaNutrition(
  formula: Formula,
  productKgPerUom: number | null,
  nutrients: NutrientDefinition[],
  ingredientValues: IngredientNutrientValue[],
  specs: NutrientSpecification[],
): FormulaNutritionResult {
  const outputKg =
    formula.outputUom === 'KG'
      ? formula.outputQty
      : formula.outputUom === 'SAC' && productKgPerUom !== null && productKgPerUom > 0
        ? formula.outputQty * productKgPerUom
        : null;

  if (outputKg === null || outputKg <= 0) {
    return {
      available: false,
      coveragePct: 0,
      nutrients: nutrients.map((nutrient) => ({
        code: nutrient.code,
        name: nutrient.name,
        unit: nutrient.unit,
        category: nutrient.category,
        sortOrder: nutrient.sortOrder,
        value: null,
        specMin: null,
        specMax: null,
        specTarget: null,
        status: 'NO_DATA' as ProductionNutrientStatus,
      })),
    };
  }

  // kg de cada componente dentro de la fórmula.
  const componentKg: Array<{ code: string; kg: number }> = [];
  for (const component of formula.components) {
    let kg: number | null = null;
    if (component.uom === 'KG') kg = component.qty;
    else if (component.kgPerUom !== null && component.kgPerUom > 0) kg = component.qty * component.kgPerUom;
    if (kg !== null && kg > 0) componentKg.push({ code: component.code, kg });
  }

  const valuesByIngredient = new Map<string, Map<string, number>>();
  for (const entry of ingredientValues) {
    if (!valuesByIngredient.has(entry.ingredientCode)) valuesByIngredient.set(entry.ingredientCode, new Map());
    valuesByIngredient.get(entry.ingredientCode)!.set(entry.nutrientCode, entry.value);
  }

  const specByNutrient = new Map(specs.map((spec) => [spec.nutrientCode, spec]));
  const coveredIngredients = new Set<string>();

  const rows: ProductionNutrientValue[] = nutrients
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((nutrient) => {
      let total = 0;
      let hasValue = false;
      for (const component of componentKg) {
        const value = valuesByIngredient.get(component.code)?.get(nutrient.code);
        if (value === undefined || !Number.isFinite(value)) continue;
        total += component.kg * value;
        hasValue = true;
        coveredIngredients.add(component.code);
      }

      const value = hasValue ? round(total / outputKg, 4) : null;
      const spec = specByNutrient.get(nutrient.code);
      const min = spec?.minValue ?? null;
      const max = spec?.maxValue ?? null;
      const target = spec?.targetValue ?? null;

      let status: ProductionNutrientStatus;
      if (value === null) status = 'NO_DATA';
      else if (min !== null && value < min) status = 'LOW';
      else if (max !== null && value > max) status = 'HIGH';
      else status = 'OK';

      return {
        code: nutrient.code,
        name: nutrient.name,
        unit: nutrient.unit,
        category: nutrient.category,
        sortOrder: nutrient.sortOrder,
        value,
        specMin: min,
        specMax: max,
        specTarget: target,
        status,
      };
    });

  const coveragePct =
    componentKg.length === 0 ? 0 : round((coveredIngredients.size / componentKg.length) * 100, 1);

  return {
    available: coveredIngredients.size > 0,
    coveragePct,
    nutrients: rows,
  };
}

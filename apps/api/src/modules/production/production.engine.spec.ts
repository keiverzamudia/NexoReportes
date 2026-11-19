import { describe, expect, it } from 'vitest';
import { computeFormulaNutrition } from './nutrition.engine';
import {
  computeDemand,
  convertCost,
  explode,
  Formula,
  formulaCost,
  formulaCostPerKg,
  formulaCostPerSack,
  resolveBatches,
} from './production.types';

// Caso de oro tomado de una explosión guardada en Profit:
// 20.000 sacos de ABAGP13 con la cédula 1038.
const ABAGP13_1038: Formula = {
  id: 1038,
  kind: 'BATCH',
  name: 'Lote 1038',
  productCode: 'ABAGP13',
  productDescription: 'GALLINA PONEDORA PLUS 18% - 40 KG',
  appliesToProductCode: 'ABAGP13',
  appliesToDescription: 'GALLINA PONEDORA PLUS 18% - 40 KG',
  appliesToUom: 'SAC',
  appliesToKgPerUom: 40,
  outputQty: 1,
  outputUom: 'SAC',
  batchKg: 3000,
  hoursPerBatch: 1,
  isStandard: false,
  updatedAt: '2025-04-10T00:00:00.000Z',
  baseProductCode: null,
  baseProductDescription: null,
  components: [
    { line: 1, code: 'MATPRI01', description: 'MAIZ AMARILLO', type: 'MACROS', uom: 'KG', qty: 18.224, kgPerUom: 1, lastCost: 293.03882, avgCost: 293.03882, inactive: false },
    { line: 2, code: 'MATPRI02', description: 'SOYA', type: 'MACROS', uom: 'KG', qty: 9.359, kgPerUom: 1, lastCost: 365.249, avgCost: 391.47938, inactive: false },
    { line: 3, code: 'MATPRI04', description: 'HARINA DE ARROZ', type: 'MACROS', uom: 'KG', qty: 2.024, kgPerUom: 1, lastCost: 292.75015, avgCost: 292.75015, inactive: false },
    { line: 4, code: 'MATPRI06', description: 'SACOS 97 X 60 SIN IMPRESION', type: 'EMPAQ', uom: 'UND', qty: 1, kgPerUom: null, lastCost: 322.56574, avgCost: null, inactive: false },
  ],
};

describe('producción · demanda', () => {
  it('usa el forecast restante cuando los pedidos no lo superan', () => {
    const result = computeDemand({
      forecastKg: 10000,
      soldKg: 4000,
      ordersKg: 3000,
      safetyKg: 0,
      availableKg: 0,
      policy: 'MAX',
    });
    expect(result.forecastRemainingKg).toBe(6000);
    expect(result.demandKg).toBe(6000);
    expect(result.requiredKg).toBe(6000);
  });

  it('usa los pedidos cuando superan el forecast restante', () => {
    const result = computeDemand({
      forecastKg: 10000,
      soldKg: 4000,
      ordersKg: 8000,
      safetyKg: 0,
      availableKg: 1000,
      policy: 'MAX',
    });
    expect(result.demandKg).toBe(8000);
    expect(result.requiredKg).toBe(7000);
  });

  it('no produce si el forecast ya se llenó y no hay pedidos', () => {
    const result = computeDemand({
      forecastKg: 10000,
      soldKg: 10000,
      ordersKg: 0,
      safetyKg: 0,
      availableKg: 500,
      policy: 'MAX',
    });
    expect(result.forecastRemainingKg).toBe(0);
    expect(result.demandKg).toBe(0);
    expect(result.requiredKg).toBe(0);
  });

  it('respeta el stock de seguridad y no recorta el requerimiento a negativo', () => {
    const result = computeDemand({
      forecastKg: 1000,
      soldKg: 0,
      ordersKg: 0,
      safetyKg: 200,
      availableKg: 1500,
      policy: 'FORECAST',
    });
    expect(result.requiredKg).toBe(0);
  });
});

describe('producción · lotes', () => {
  it('redondea al lote configurado', () => {
    expect(resolveBatches(7000, 3000, 40)).toEqual({
      batches: 3,
      productionKg: 9000,
      productionSacks: 225,
    });
  });

  it('sin lote configurado produce lo requerido y lo marca como un lote', () => {
    expect(resolveBatches(1234, null, 40)).toEqual({
      batches: 1,
      productionKg: 1234,
      productionSacks: 31,
    });
  });
});

describe('producción · explosión', () => {
  it('reproduce la explosión guardada de ABAGP13 (20.000 sacos, cédula 1038)', () => {
    const rows = explode(ABAGP13_1038, 800000, 20000, 40, 'LAST');
    const byCode = new Map(rows.map((row) => [row.component.code, row]));

    expect(byCode.get('MATPRI01')?.requiredQty).toBe(364480);
    expect(byCode.get('MATPRI02')?.requiredQty).toBe(187180);
    expect(byCode.get('MATPRI04')?.requiredQty).toBe(40480);
    expect(byCode.get('MATPRI06')?.requiredQty).toBe(20000);
  });

  it('calcula el costo por kilo y por saco', () => {
    const total = formulaCost(ABAGP13_1038, 'LAST');
    expect(total).toBeGreaterThan(0);

    const perSack = formulaCostPerSack(ABAGP13_1038, 40, 'LAST');
    const perKg = formulaCostPerKg(ABAGP13_1038, 40, 'LAST');
    expect(perSack).not.toBeNull();
    expect(perKg).not.toBeNull();
    expect(perKg!).toBeCloseTo(perSack! / 40, 2);
  });
});

describe('producción · moneda', () => {
  it('convierte bolívares a dólares con la tasa del día', () => {
    expect(convertCost(917.7751, 'USD', 917.7751)).toBe(1);
    expect(convertCost(1000, 'BS', 917.7751)).toBe(1000);
    expect(convertCost(1000, 'USD', null)).toBeNull();
  });
});

describe('producción · nutrición', () => {
  it('pondera los nutrientes por los kg de cada ingrediente', () => {
    const formula: Formula = {
      ...ABAGP13_1038,
      outputQty: 1,
      outputUom: 'KG',
      components: [
        { line: 1, code: 'MAIZ', description: 'Maíz', type: 'MACROS', uom: 'KG', qty: 0.5, kgPerUom: 1, lastCost: 1, avgCost: 1, inactive: false },
        { line: 2, code: 'SOYA', description: 'Soya', type: 'MACROS', uom: 'KG', qty: 0.5, kgPerUom: 1, lastCost: 1, avgCost: 1, inactive: false },
      ],
    };
    const result = computeFormulaNutrition(
      formula,
      1,
      [{ code: 'PROTEIN', name: 'Proteína', unit: '%', category: 'MACRO', sortOrder: 10 }],
      [
        { ingredientCode: 'MAIZ', nutrientCode: 'PROTEIN', value: 8, basis: 'AS_FED' },
        { ingredientCode: 'SOYA', nutrientCode: 'PROTEIN', value: 48, basis: 'AS_FED' },
      ],
      [{ productCode: 'ABAGP13', nutrientCode: 'PROTEIN', minValue: 20, maxValue: 30, targetValue: 25 }],
    );

    expect(result.available).toBe(true);
    expect(result.coveragePct).toBe(100);
    expect(result.nutrients[0]?.value).toBe(28);
    expect(result.nutrients[0]?.status).toBe('OK');
  });
});

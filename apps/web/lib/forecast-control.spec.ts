import { describe, expect, it } from 'vitest';
import type { ForecastPlanRow } from '@nexo/contracts';
import { controlValues, toDisplayUnit } from './forecast-control';

function week(weekIndex: number, overrides: Partial<ForecastPlanRow['weeks'][number]> = {}) {
  return {
    weekIndex,
    closed: false,
    forecastKg: 30_000,
    demandKg: 0,
    demandQty: 0,
    soldKg: 0,
    soldSacks: null,
    stockKg: 400_000,
    objectiveKg: 30_000,
    availableKg: 30_000,
    toProduceKg: 0,
    toProduceSacks: null,
    excessKg: 370_000,
    attainmentPct: null,
    status: 'DISPONIBLE' as const,
    ...overrides,
  };
}

function row(overrides: Partial<ForecastPlanRow> = {}): ForecastPlanRow {
  return {
    productCode: 'ABAGP13',
    description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
    uom: 'SAC',
    category: null,
    kgPerUom: 40,
    stockTotal: 10_000,
    stock03: 10_000,
    stock9999: 0,
    stock68: 0,
    stockKg: 400_000,
    forecastMonthKg: 120_000,
    averageQty: 30_000,
    demandMonthQty: 500,
    demandMonthKg: 20_000,
    soldMonthKg: 100_000,
    productionMonthKg: 0,
    productionMonthSacks: null,
    weeks: [
      week(1, {
        demandKg: 5_000,
        demandQty: 125,
        soldKg: 28_000,
        objectiveKg: 30_000,
        availableKg: 30_000,
        toProduceKg: 0,
        excessKg: 370_000,
        attainmentPct: 93.3,
        status: 'DISPONIBLE',
      }),
      week(2),
    ],
    ...overrides,
  };
}

describe('controlValues — diferencias de la vista Básico', () => {
  it('mensual: venta − forecast y venta + solicitado − forecast', () => {
    const values = controlValues(row(), null);
    expect(values.forecastKg).toBe(120_000);
    expect(values.demandKg).toBe(20_000);
    expect(values.soldKg).toBe(100_000);
    expect(values.gapSaleKg).toBe(-20_000);
    expect(values.gapCoverageKg).toBe(0);
  });

  it('semanal: usa los kg de la semana elegida', () => {
    const values = controlValues(row(), 1);
    expect(values.forecastKg).toBe(30_000);
    expect(values.demandKg).toBe(5_000);
    expect(values.soldKg).toBe(28_000);
    expect(values.gapSaleKg).toBe(-2_000);
    expect(values.gapCoverageKg).toBe(3_000);
  });

  it('semana inexistente: cae a los totales del mes sin romper', () => {
    expect(controlValues(row(), 9).soldKg).toBe(100_000);
  });
});

describe('toDisplayUnit — kg o unidad de venta', () => {
  it('convierte a sacos cuando hay kg por unidad', () => {
    expect(toDisplayUnit(100_000, 40, 'uom')).toBe(2_500);
  });

  it('deja el granel en kg', () => {
    expect(toDisplayUnit(1_234, null, 'uom')).toBe(1_234);
    expect(toDisplayUnit(1_234, 0, 'uom')).toBe(1_234);
  });

  it('en modo kg no convierte nada', () => {
    expect(toDisplayUnit(100_000, 40, 'kg')).toBe(100_000);
  });
});

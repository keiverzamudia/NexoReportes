import { describe, expect, it } from 'vitest';
import type { ForecastPlanRow } from '@nexo/contracts';
import { controlValues, toDisplayUnit } from './forecast-control';

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
    forecastMonthQty: 120_000,
    averageQty: 30_000,
    demandMonthQty: 500,
    demandMonthKg: 20_000,
    soldMonthKg: 100_000,
    productionMonthQty: 0,
    productionMonthKg: 0,
    weeks: [
      { weekIndex: 1, forecastQty: 30_000, demandQty: 125, demandKg: 5_000, soldKg: 28_000, objectiveQty: 30_000, availableQty: 10_000, toProduceQty: 20_000, toProduceKg: 800_000, netQty: -20_000, status: 'FALTANTE' },
      { weekIndex: 2, forecastQty: 30_000, demandQty: 0, demandKg: 0, soldKg: 0, objectiveQty: 30_000, availableQty: 10_000, toProduceQty: 20_000, toProduceKg: 800_000, netQty: -20_000, status: 'FALTANTE' },
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

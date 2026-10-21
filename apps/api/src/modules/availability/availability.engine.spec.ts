import { describe, expect, it } from 'vitest';
import { AvailabilityInput, computeAvailability, computeAvailabilityRows } from './availability.engine';

function input(overrides: Partial<AvailabilityInput>): AvailabilityInput {
  return {
    productCode: 'ABAEQUI01',
    description: 'ALFALFA EN PELLETS L.V SAC (10 KG)',
    uom: 'SAC',
    kgPerUom: 10,
    stockByWarehouse: [],
    demandQty: 0,
    demandKg: null,
    ...overrides,
  };
}

function stock(stocks: Record<string, number>) {
  return Object.entries(stocks).map(([warehouseCode, qty]) => ({
    warehouseCode,
    warehouseName: warehouseCode,
    qty,
    reservedQty: 0,
  }));
}

describe('computeAvailability — Caso de aceptación 1', () => {
  it('Alfalfa: demanda 10, existencia 6 → 6 disponibles y 4 a producir', () => {
    const row = computeAvailability(
      input({ demandQty: 10, demandKg: 100, stockByWarehouse: stock({ 'Stock 03': 4, 'Stock 68': 2 }) }),
    );

    expect(row.stockTotal).toBe(6);
    expect(row.demandQty).toBe(10);
    expect(row.netQty).toBe(-4); // se expone el déficit, no se recorta
    expect(row.availableQty).toBe(6);
    expect(row.toProduceQty).toBe(4);
    expect(row.status).toBe('PARCIAL');
    expect(row.demandKg).toBe(100);
  });
});

describe('computeAvailability — estados', () => {
  it('DISPONIBLE: la existencia cubre toda la demanda', () => {
    const row = computeAvailability(input({ demandQty: 5, stockByWarehouse: stock({ 'Stock 68': 10 }) }));
    expect(row.availableQty).toBe(5);
    expect(row.toProduceQty).toBe(0);
    expect(row.netQty).toBe(5);
    expect(row.status).toBe('DISPONIBLE');
  });

  it('FALTANTE: demanda sin ninguna existencia → todo a producir', () => {
    const row = computeAvailability(input({ demandQty: 8, stockByWarehouse: stock({ 'Stock 03': 0 }) }));
    expect(row.stockTotal).toBe(0);
    expect(row.availableQty).toBe(0);
    expect(row.toProduceQty).toBe(8);
    expect(row.status).toBe('FALTANTE');
  });

  it('SIN_DEMANDA: existencia libre sin pedidos pendientes', () => {
    const row = computeAvailability(input({ demandQty: 0, stockByWarehouse: stock({ 'Stock 03': 12 }) }));
    expect(row.availableQty).toBe(0);
    expect(row.toProduceQty).toBe(0);
    expect(row.netQty).toBe(12);
    expect(row.status).toBe('SIN_DEMANDA');
  });
});

describe('computeAvailability — conservación de signos (sobre-compromiso)', () => {
  it('pendiente negativo reduce la demanda neta y libera existencia', () => {
    // Renglón real ABABOV67 con pendiente -247 y existencia 45.
    const row = computeAvailability(input({ productCode: 'ABABOV67', demandQty: -247, stockByWarehouse: stock({ 'Stock 03': 45 }) }));
    expect(row.demandQty).toBe(-247);
    expect(row.netQty).toBe(292); // 45 − (−247)
    expect(row.availableQty).toBe(0);
    expect(row.toProduceQty).toBe(0);
    expect(row.status).toBe('SIN_DEMANDA');
  });

  it('mezcla de positivos y negativos: la red neta puede quedar negativa', () => {
    const rows = computeAvailabilityRows([
      input({ productCode: 'A', demandQty: 100, stockByWarehouse: stock({ S: 40 }) }),
      input({ productCode: 'B', demandQty: -10, stockByWarehouse: stock({ S: 40 }) }),
    ]);
    expect(rows[0]!.status).toBe('PARCIAL');
    expect(rows[0]!.netQty).toBe(-60);
    expect(rows[1]!.status).toBe('SIN_DEMANDA');
    expect(rows[1]!.netQty).toBe(50);
  });
});

describe('computeAvailability — existencia combinada y redondeo', () => {
  it('suma la existencia de todos los almacenes (03 + 9999 + 68)', () => {
    const row = computeAvailability(
      input({ demandQty: 3, stockByWarehouse: stock({ 'Stock 03': 5, 'Stock 9999': 4, 'Stock 68': 2 }) }),
    );
    expect(row.stockTotal).toBe(11);
    expect(row.stockByWarehouse).toHaveLength(3);
    expect(row.status).toBe('DISPONIBLE');
  });

  it('redondea decimales a 3 posiciones conservando el signo', () => {
    const row = computeAvailability(
      input({ uom: 'KG', demandQty: 33.33333, stockByWarehouse: stock({ S: 10.5 }), demandKg: 33.33333 }),
    );
    expect(row.demandQty).toBe(33.333);
    expect(row.stockTotal).toBe(10.5);
    expect(row.netQty).toBe(-22.833);
    expect(row.toProduceQty).toBe(22.833);
  });

  it('respeta la unidad por producto (SAC y KG conviven sin mezclarse)', () => {
    const sac = computeAvailability(input({ productCode: 'SAC-1', uom: 'SAC', demandQty: 10, stockByWarehouse: stock({ S: 6 }) }));
    const kg = computeAvailability(input({ productCode: 'KG-1', uom: 'KG', demandQty: 500, stockByWarehouse: stock({ S: 500 }) }));
    expect(sac.uom).toBe('SAC');
    expect(sac.toProduceQty).toBe(4);
    expect(kg.uom).toBe('KG');
    expect(kg.toProduceQty).toBe(0);
    expect(kg.status).toBe('DISPONIBLE');
  });
});

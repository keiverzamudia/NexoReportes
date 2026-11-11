import { describe, expect, it } from 'vitest';
import { buildDispatchRemovals, type RemovalLineRow } from './dispatch-removals';

function row(overrides: Partial<RemovalLineRow> = {}): RemovalLineRow {
  return {
    id: 'line-1',
    sheetId: 'sheet-1',
    orderNumber: '408251710',
    productCode: 'ABAPOR77',
    description: 'POLLO ENGORDE 35KG',
    uom: 'SAC',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    plannedQty: 60,
    plannedKg: 2400,
    removalReason: 'PEDIDO_CERRADO_EN_PROFIT',
    removedAt: new Date('2026-11-10T17:45:00.000Z'),
    removedByName: 'Profit',
    sheet: { id: 'sheet-1', number: 'DSP-2026-0003', status: 'EN_PROCESO' },
    ...overrides,
  };
}

describe('buildDispatchRemovals', () => {
  it('agrupa por pedido, junta despachos y conserva el motivo más reciente', () => {
    const result = buildDispatchRemovals([
      row(),
      row({
        id: 'line-2',
        productCode: 'ABABOV85',
        plannedKg: 400,
        removalReason: 'RETIRADO_DEL_PLAN',
        removedAt: new Date('2026-11-11T09:32:00.000Z'),
        removedByName: 'JUILLIARD ANGULO',
      }),
      row({
        id: 'line-3',
        sheetId: 'sheet-2',
        orderNumber: '408251710',
        productCode: 'ABABOV85',
        plannedKg: 400,
        sheet: { id: 'sheet-2', number: 'DSP-2026-0004', status: 'DESPACHADO' },
      }),
    ]);

    expect(result.totals.orders).toBe(1);
    expect(result.totals.lines).toBe(3);
    expect(result.totals.plannedKg).toBe(3200);
    expect(result.totals.byReason).toMatchObject({
      PEDIDO_CERRADO_EN_PROFIT: 2,
      RETIRADO_DEL_PLAN: 1,
    });
    expect(result.orders[0]!.sheets.map((sheet) => sheet.number)).toEqual(['DSP-2026-0003', 'DSP-2026-0004']);
    expect(result.orders[0]!.reasons).toEqual(['PEDIDO_CERRADO_EN_PROFIT', 'RETIRADO_DEL_PLAN']);
    expect(result.orders[0]!.removedAt).toBe('2026-11-11T09:32:00.000Z');
    expect(result.orders[0]!.removedByNames).toEqual(['JUILLIARD ANGULO', 'Profit']);
    // Los renglones se ordenan por retiro más reciente.
    expect(result.orders[0]!.lines[0]!.productCode).toBe('ABABOV85');
  });

  it('ordena pedidos del retiro más reciente al más antiguo', () => {
    const result = buildDispatchRemovals([
      row({ orderNumber: '100', removedAt: new Date('2026-11-01T10:00:00.000Z') }),
      row({ id: 'line-2', orderNumber: '200', removedAt: new Date('2026-11-05T10:00:00.000Z') }),
    ]);

    expect(result.orders.map((order) => order.orderNumber)).toEqual(['200', '100']);
  });

  it('acepta renglones sin número de pedido sin romper la agrupación', () => {
    const result = buildDispatchRemovals([row({ orderNumber: '  ' })]);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]!.orderNumber).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { ScenarioLineRef } from '@nexo/contracts';
import { buildDraftPlan } from './draft-plan';

// ============================================================
// Plan vivo del equipo: el reparto se hace en orden de marcado y el stock
// libre es exactamente lo que queda tras descontar lo de todos.
// ============================================================

type Row = Record<string, any>;

function createFakePrisma(quantities: Record<string, number>, stock = 50) {
  const rows: Row[] = Object.entries(quantities).map(([orderNumber, qty]) => ({
    orderId: `o-${orderNumber}`,
    productCode: 'P',
    description: 'Producto',
    uom: 'SAC',
    quantity: qty,
    pendingQty: qty,
    pendingKg: qty * 10,
    warehouses: null,
    order: {
      externalNumber: orderNumber,
      customerCode: `C-${orderNumber}`,
      customerName: `Cliente ${orderNumber}`,
      requestedDate: new Date('2026-11-02T00:00:00.000Z'),
      authorized: true,
    },
  }));

  return {
    salesOrderLine: {
      findMany: async ({ where }: Row) =>
        rows.filter(
          (row) =>
            where.order.externalNumber.in.includes(row.order.externalNumber) &&
            where.productCode.in.includes(row.productCode),
        ),
    },
    inventorySnapshot: {
      findFirst: async () => ({
        lines: [{ productCode: 'P', warehouseCode: 'Stock 03', qty: stock }],
      }),
    },
    deliveryDateOverride: {
      findMany: async () => [],
    },
  };
}

function ref(orderNumber: string, selectedAt: string): ScenarioLineRef {
  return { orderNumber, productCode: 'P', selectedById: `u-${orderNumber}`, selectedByName: orderNumber, selectedAt };
}

describe('buildDraftPlan', () => {
  it('tres vendedores marcan 10 de 50: 30 comprometidos y 20 libres', async () => {
    const prisma = createFakePrisma({ A: 10, B: 10, C: 10 }, 50);
    const plan = await buildDraftPlan(prisma as never, [
      ref('A', '2026-11-02T10:00:00.000Z'),
      ref('B', '2026-11-02T10:01:00.000Z'),
      ref('C', '2026-11-02T10:02:00.000Z'),
    ]);

    expect(plan.assignments.map((item) => item.assignedQty)).toEqual([10, 10, 10]);
    expect(plan.freeByProduct).toEqual([{ productCode: 'P', stock: 50, committed: 30, free: 20 }]);
    expect(plan.lines).toHaveLength(3);
  });

  it('el cuarto que marca 30 solo obtiene los 20 libres y deja 10 faltantes', async () => {
    const prisma = createFakePrisma({ A: 10, B: 10, C: 10, D: 30 }, 50);
    const plan = await buildDraftPlan(prisma as never, [
      ref('A', '2026-11-02T10:00:00.000Z'),
      ref('B', '2026-11-02T10:01:00.000Z'),
      ref('C', '2026-11-02T10:02:00.000Z'),
      ref('D', '2026-11-02T10:03:00.000Z'),
    ]);

    expect(plan.assignments.map((item) => item.assignedQty)).toEqual([10, 10, 10, 20]);
    expect(plan.assignments[3]!.missingQty).toBe(10);
    expect(plan.freeByProduct[0]!.free).toBe(0);
  });

  it('marca como faltantes de cartera los renglones que ya no existen', async () => {
    const prisma = createFakePrisma({ A: 10 }, 50);
    const plan = await buildDraftPlan(prisma as never, [
      ref('A', '2026-11-02T10:00:00.000Z'),
      ref('Z', '2026-11-02T10:01:00.000Z'),
    ]);

    expect(plan.lines).toHaveLength(1);
    expect(plan.missingRefs.map((item) => item.orderNumber)).toEqual(['Z']);
  });
});

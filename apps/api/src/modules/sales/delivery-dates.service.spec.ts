import { describe, expect, it } from 'vitest';
import { DeliveryDatesService } from './delivery-dates.service';

// Fake mínimo de Prisma para la capa de fechas tentativas.
function createFakePrisma() {
  const state = {
    overrides: [] as any[],
    changes: [] as any[],
  };
  const lines = [
    {
      productCode: 'ABABOV85',
      order: {
        externalNumber: '6819',
        requestedDate: new Date('2026-10-20T00:00:00.000Z'),
        customerCode: '294201237',
        isActive: true,
      },
    },
    {
      productCode: 'ABAPOR77',
      order: {
        externalNumber: '6819',
        requestedDate: new Date('2026-10-20T00:00:00.000Z'),
        customerCode: '294201237',
        isActive: true,
      },
    },
  ];
  const prisma = {
    state,
    salesOrderLine: {
      findMany: async (args: any) =>
        lines.filter(
          (line) =>
            args.where.productCode.in.includes(line.productCode) &&
            args.where.order.externalNumber.in.includes(line.order.externalNumber) &&
            line.order.isActive,
        ),
    },
    deliveryDateOverride: {
      findMany: async (args: any) =>
        state.overrides.filter((override) => args.where.orderNumber.in.includes(override.orderNumber)),
      upsert: async (args: any) => {
        const found = state.overrides.find(
          (override) =>
            override.orderNumber === args.where.orderNumber_productCode.orderNumber &&
            override.productCode === args.where.orderNumber_productCode.productCode,
        );
        if (found) {
          Object.assign(found, args.update);
          return found;
        }
        const created = { id: `ov-${state.overrides.length + 1}`, ...args.create };
        state.overrides.push(created);
        return created;
      },
      delete: async (args: any) => {
        const index = state.overrides.findIndex((override) => override.id === args.where.id);
        return state.overrides.splice(index, 1)[0];
      },
    },
    deliveryDateChange: {
      create: async (args: any) => {
        state.changes.push(args.data);
        return args.data;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return prisma;
}

const audit = { record: async () => undefined } as never;
const items = [
  { orderNumber: '6819', productCode: 'ABABOV85' },
  { orderNumber: '6819', productCode: 'ABAPOR77' },
];

describe('DeliveryDatesService', () => {
  it('guarda la tentativa por renglón y deja la original intacta', async () => {
    const prisma = createFakePrisma();
    const service = new DeliveryDatesService(prisma as never, audit);

    const result = await service.setDates(items, '2026-10-27', undefined, { id: 'u1', code: 'KZ' });

    expect(result).toEqual({ updated: 2, restored: 0, unchanged: 0 });
    expect(prisma.state.overrides).toHaveLength(2);
    expect(prisma.state.overrides[0]!.tentativeDate.toISOString()).toContain('2026-10-27');
    expect(prisma.state.overrides[0]!.orderNumber).toBe('6819');
    expect(prisma.state.changes).toHaveLength(2);
    expect(prisma.state.changes[0]!.action).toBe('SET');
  });

  it('no duplica si la fecha ya estaba y restaura a la original', async () => {
    const prisma = createFakePrisma();
    const service = new DeliveryDatesService(prisma as never, audit);

    await service.setDates(items, '2026-10-27', undefined, { id: 'u1' });
    const again = await service.setDates(items, '2026-10-27', undefined, { id: 'u1' });
    expect(again).toEqual({ updated: 0, restored: 0, unchanged: 2 });
    expect(prisma.state.changes).toHaveLength(2);

    const restored = await service.restoreDates(items, undefined, { id: 'u1' });
    expect(restored).toEqual({ updated: 0, restored: 2, unchanged: 0 });
    expect(prisma.state.overrides).toHaveLength(0);
    expect(prisma.state.changes.slice(-2).every((change) => change.action === 'RESTORE')).toBe(true);
  });

  it('elegir la fecha original de Profit equivale a restaurar', async () => {
    const prisma = createFakePrisma();
    const service = new DeliveryDatesService(prisma as never, audit);

    const result = await service.setDates(items, '2026-10-20', undefined, { id: 'u1' });

    expect(result).toEqual({ updated: 0, restored: 0, unchanged: 2 });
    expect(prisma.state.overrides).toHaveLength(0);
    expect(prisma.state.changes).toHaveLength(0);
  });

  it('falla si algún renglón ya no existe o no está activo', async () => {
    const prisma = createFakePrisma();
    const service = new DeliveryDatesService(prisma as never, audit);

    await expect(
      service.setDates([{ orderNumber: '9999', productCode: 'NOEXISTE' }], '2026-10-27', undefined, { id: 'u1' }),
    ).rejects.toThrow(/No se encontraron renglones activos/);
  });

  it('resuelve el mapa pedido#artículo para el reporte', async () => {
    const prisma = createFakePrisma();
    const service = new DeliveryDatesService(prisma as never, audit);

    await service.setDates(items, '2026-10-27', undefined, { id: 'u1' });
    const map = await service.resolveForLines(items);

    expect(map.get('6819#ABABOV85')).toContain('2026-10-27');
    expect(map.get('6819#ABAPOR77')).toContain('2026-10-27');
  });
});

import { describe, expect, it } from 'vitest';
import { FixturesProfitAdapter } from './fixtures.adapter';
import { ProfitAdapter } from './profit.adapter';
import { SyncService } from './sync.service';

// Fake de Prisma en memoria: cubre los métodos usados por SyncService para
// PRODUCTOS/CLIENTES/PEDIDOS sin tocar la BD real de desarrollo.
function createFakePrisma() {
  const products = new Map<string, Record<string, unknown>>();
  const customers = new Map<string, Record<string, unknown>>();
  const orders = new Map<string, Record<string, unknown>>();
  const lines = new Map<string, Record<string, unknown>>();
  const syncRuns: Record<string, unknown>[] = [];
  const syncErrors: Record<string, unknown>[] = [];

  const upsertMap = (table: Map<string, Record<string, unknown>>) => ({
    upsert: async ({ where, update, create }: { where: { externalCode?: string; externalNumber?: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
      const key = (where.externalCode ?? where.externalNumber) as string;
      const existing = table.get(key);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const created = { ...create, externalCode: where.externalCode, externalNumber: where.externalNumber };
      table.set(key, created);
      return created;
    },
    updateMany: async ({ where, data }: { where: { externalCode?: { notIn: string[] }; externalNumber?: { notIn: string[] } }; data: Record<string, unknown> }) => {
      const notIn = (where.externalCode ?? where.externalNumber)?.notIn ?? [];
      let count = 0;
      for (const [key, record] of table) {
        if (!notIn.includes(key) && record['isActive'] !== false) {
          Object.assign(record, data);
          count += 1;
        }
      }
      return { count };
    },
    findUnique: async ({ where }: { where: { externalCode?: string; externalNumber?: string } }) => {
      const key = (where.externalCode ?? where.externalNumber) as string;
      return table.get(key) ?? null;
    },
    count: async () => table.size,
  });

  return {
    tables: { products, customers, orders, lines },
    syncRuns,
    syncErrors,
    syncRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const run = { id: `run-${syncRuns.length + 1}`, startedAt: new Date(), ...data };
        syncRuns.push(run);
        return run;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const run = syncRuns.find((r) => r['id'] === where.id) as Record<string, unknown>;
        Object.assign(run, data);
        return run;
      },
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
    },
    syncError: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        syncErrors.push(data);
        return data;
      },
    },
    product: upsertMap(products),
    customer: upsertMap(customers),
    salesOrder: upsertMap(orders),
    salesOrderLine: {
      upsert: async ({ where, update, create }: { where: { orderId_lineNumber: { orderId: string; lineNumber: number } }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const key = `${where.orderId_lineNumber.orderId}#${where.orderId_lineNumber.lineNumber}`;
        const existing = lines.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { ...create };
        lines.set(key, created);
        return created;
      },
    },
  };
}

const auditStub = { record: async () => undefined };
const configStub = {
  get: (key: string) => {
    if (key === 'sync.pageSize') return 5000;
    if (key === 'profit.views') return {};
    return undefined;
  },
};

function serviceWith(adapter: ProfitAdapter, prisma: ReturnType<typeof createFakePrisma>) {
  return new SyncService(adapter, prisma as never, auditStub as never, configStub as never);
}

describe('SyncService.run (idempotencia — Caso de aceptación 11)', () => {
  it('ejecutar la sincronización dos veces no duplica productos', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    const first = await service.run('PRODUCTOS');
    expect(first.status).toBe('EXITOSA');
    expect(prisma.tables.products.size).toBe(6);

    const second = await service.run('PRODUCTOS');
    expect(second.status).toBe('EXITOSA');
    expect(prisma.tables.products.size).toBe(6); // sin duplicados
  });

  it('sincroniza clientes conservando el tipo de cliente (L1/L2/L3/COR)', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    await service.run('CLIENTES');
    expect(prisma.tables.customers.size).toBe(6);
    expect(prisma.tables.customers.get('406821691025')?.['customerType']).toBe('L1  EXCLUSIVOS');
    expect(prisma.tables.customers.get('183334693025')?.['customerType']).toBe('COR CORPORATIVO');
  });

  it('marca como inactivos los productos ausentes en una corrida posterior (baja lógica, sin borrado)', async () => {
    const prisma = createFakePrisma();
    // Adaptador que la segunda vez omite un producto.
    let full = true;
    const adapter: ProfitAdapter = {
      dialect: 'fixtures',
      testConnection: async () => ({ connected: true }),
      listViews: async () => [],
      select: async () => {
        const rows = [
          { codigo: 'P1', descripcion: 'Producto 1', unidad: 'SAC' },
          { codigo: 'P2', descripcion: 'Producto 2', unidad: 'SAC' },
        ];
        return full ? rows : rows.slice(0, 1);
      },
    };

    await serviceWith(adapter, prisma).run('PRODUCTOS');
    expect(prisma.tables.products.size).toBe(2);

    full = false;
    await serviceWith(adapter, prisma).run('PRODUCTOS');
    expect(prisma.tables.products.size).toBe(2); // no se borra nada
    expect(prisma.tables.products.get('P1')?.['isActive']).toBe(true);
    expect(prisma.tables.products.get('P2')?.['isActive']).toBe(false);
    expect(prisma.tables.products.get('P2')?.['removedAt']).toBeInstanceOf(Date);
  });

  it('PEDIDOS_DETALLE sin PEDIDOS previos falla con error registrado (orden de dependencia)', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    const run = await service.run('PEDIDOS_DETALLE');
    expect(run.status).toBe('ERROR');
    expect(prisma.syncErrors.length).toBeGreaterThan(0);
  });

  it('el flujo completo PEDIDOS → DETALLE funciona en orden', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    await service.run('PEDIDOS');
    expect(prisma.tables.orders.size).toBe(4);
    const run = await service.run('PEDIDOS_DETALLE');
    expect(run.status).toBe('EXITOSA');
    expect(run.recordsUpserted).toBe(8);
  });
});

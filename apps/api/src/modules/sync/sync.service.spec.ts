import { describe, expect, it } from 'vitest';
import { FixturesProfitAdapter } from './fixtures.adapter';
import { ProfitAdapter } from './profit.adapter';
import { SyncService } from './sync.service';

// Fake de Prisma en memoria: cubre los métodos usados por SyncService para
// derivar dominios desde la vista aplanada, sin tocar la BD real de desarrollo.
function createFakePrisma() {
  const products = new Map<string, Record<string, unknown>>();
  const customers = new Map<string, Record<string, unknown>>();
  const orders = new Map<string, Record<string, unknown>>();
  const warehouses = new Map<string, Record<string, unknown>>();
  const lines = new Map<string, Record<string, unknown>>();
  const snapshotLines: Record<string, unknown>[] = [];
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
      const created = { id: `id-${key}`, ...create, externalCode: where.externalCode, externalNumber: where.externalNumber };
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
    tables: { products, customers, orders, warehouses, lines, snapshotLines },
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
    warehouse: upsertMap(warehouses),
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
      deleteMany: async ({ where }: { where: { orderId: string; lineNumber: { gt: number } } }) => {
        let count = 0;
        for (const [key, record] of lines) {
          if (key.startsWith(`${where.orderId}#`) && (record['lineNumber'] as number) > where.lineNumber.gt) {
            lines.delete(key);
            count += 1;
          }
        }
        return { count };
      },
    },
    inventorySnapshot: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: `snap-${syncRuns.length}`, ...data }),
    },
    inventorySnapshotLine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        snapshotLines.push(data);
        return data;
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

describe('SyncService.run (derivación desde la vista aplanada)', () => {
  it('PRODUCTOS: catálogo derivado de co_art, idempotente entre corridas (Caso 11)', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    const first = await service.run('PRODUCTOS');
    expect(first.status).toBe('EXITOSA');
    expect(prisma.tables.products.size).toBe(6);

    const second = await service.run('PRODUCTOS');
    expect(second.status).toBe('EXITOSA');
    expect(prisma.tables.products.size).toBe(6); // sin duplicados
  });

  it('PRODUCTOS: recorta el padding real de char y conserva unidad y kg por unidad', async () => {
    const prisma = createFakePrisma();
    await serviceWith(new FixturesProfitAdapter(), prisma).run('PRODUCTOS');
    const product = prisma.tables.products.get('ABAEQUI01');
    expect(product?.['description']).toBe('ALFALFA EN PELLETS L.V SAC (10 KG)');
    expect(product?.['uom']).toBe('SAC');
    // relacion_empaque de la vista = kg por unidad de venta.
    expect(product?.['kgPerUom']).toBe(10);
    expect(prisma.tables.products.get('ABABOV58')?.['kgPerUom']).toBe(35);
  });

  it('PRODUCTOS: no borra kgPerUom conocido si una corrida posterior trae la columna en NULL', async () => {
    const prisma = createFakePrisma();
    const base = {
      nro_solicitud: 1, co_cli: '153064128', cli_des: 'C', co_art: 'ART1', art_des: 'Artículo 1',
      pendiente: 1, uni_venta: 'SAC', Stock_03: 0, Stock_68: 0,
    };
    const adapter: ProfitAdapter = {
      dialect: 'fixtures',
      testConnection: async () => ({ connected: true }),
      listViews: async () => [],
      describeView: async () => [],
      select: async () => [{ ...base, relacion_empaque: 35, kg: 35 }],
    };
    await serviceWith(adapter, prisma).run('PRODUCTOS');
    expect(prisma.tables.products.get('ART1')?.['kgPerUom']).toBe(35);

    // Columna en NULL: se conserva el dato conocido (no se escribe null).
    adapter.select = async () => [{ ...base, relacion_empaque: null, kg: null }];
    await serviceWith(adapter, prisma).run('PRODUCTOS');
    expect(prisma.tables.products.get('ART1')?.['kgPerUom']).toBe(35);
  });

  it('CLIENTES: catálogo derivado de co_cli con el nombre exacto de la vista', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    await service.run('CLIENTES');
    expect(prisma.tables.customers.size).toBe(2);
    expect(prisma.tables.customers.get('153064128')?.['name']).toBe('JOSEF HENDRIX HERNANDEZ REYES');
    expect(prisma.tables.customers.get('505835220')?.['name']).toBe('AGRO INVERSIONES MP, C.A');
    // La vista no trae tipo de cliente ni vendedor: no se inventan.
    expect(prisma.tables.customers.get('153064128')?.['customerType']).toBeUndefined();
  });

  it('ALMACENES: se derivan de las columnas de existencia de la vista', async () => {
    const prisma = createFakePrisma();
    await serviceWith(new FixturesProfitAdapter(), prisma).run('ALMACENES');
    expect(prisma.tables.warehouses.has('Stock 03')).toBe(true);
    expect(prisma.tables.warehouses.has('Stock 68')).toBe(true);
  });

  it('marca como inactivos los productos ausentes en una corrida posterior (baja lógica, sin borrado)', async () => {
    const prisma = createFakePrisma();
    // Adaptador que la segunda vez omite un artículo.
    let full = true;
    const base = { emision: '2025-09-03', entrega: '2025-09-10', co_cli: '153064128', cli_des: 'C', pendiente: 1, uni_venta: 'SAC', Stock_03: 0, Stock_68: 0 };
    const adapter: ProfitAdapter = {
      dialect: 'fixtures',
      testConnection: async () => ({ connected: true }),
      listViews: async () => [],
      describeView: async () => [],
      select: async () => {
        const rows = [
          { ...base, nro_solicitud: 1, co_art: 'P1', art_des: 'Producto 1' },
          { ...base, nro_solicitud: 2, co_art: 'P2', art_des: 'Producto 2' },
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

  it('PEDIDOS → DETALLE funciona en orden y numera renglones de forma determinista', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    await service.run('CLIENTES');
    const ordersRun = await service.run('PEDIDOS');
    expect(ordersRun.status).toBe('EXITOSA');
    expect(prisma.tables.orders.size).toBe(6); // 6 solicitudes distintas en fixtures

    const run = await service.run('PEDIDOS_DETALLE');
    expect(run.status).toBe('EXITOSA');
    expect(run.recordsUpserted).toBe(7); // 7 renglones en fixtures

    // La solicitud 3536 tiene 2 renglones (ABABOV58, ABAGP13) numerados 1..2.
    const order = prisma.tables.orders.get('3536');
    const orderLineKeys = [...prisma.tables.lines.keys()].filter((k) => k.startsWith(`${order?.['id']}#`));
    expect(orderLineKeys.length).toBe(2);

    // Pendiente negativo conservado en el renglón de sobre-compromiso,
    // junto con su kg crudo de Profit (-247 × 35).
    const negative = [...prisma.tables.lines.values()].find((l) => Number(l['pendingQty']) === -247);
    expect(negative).toBeDefined();
    expect(negative?.['productCode']).toBe('ABABOV67');
    expect(Number(negative?.['pendingKg'])).toBe(-8645);

    // Renglón normal: kg = pendiente × relacion_empaque tal como lo trae Profit.
    const normal = [...prisma.tables.lines.values()].find((l) => Number(l['pendingQty']) === 217);
    expect(Number(normal?.['pendingKg'])).toBe(7595);
  });

  it('EXISTENCIAS: fotografía por corrida con una línea por artículo/almacén no nulo', async () => {
    const prisma = createFakePrisma();
    const service = serviceWith(new FixturesProfitAdapter(), prisma);

    await service.run('PRODUCTOS');
    await service.run('ALMACENES');
    const run = await service.run('EXISTENCIAS');
    expect(run.status).toBe('EXITOSA');
    // 6 artículos × 2 almacenes (todas las columnas con dato en fixtures).
    expect(prisma.tables.snapshotLines.length).toBe(12);

    // Corrida posterior crea OTRA fotografía (no muta la anterior).
    await service.run('EXISTENCIAS');
    expect(prisma.tables.snapshotLines.length).toBe(24);
  });

  it('una fila inválida no enmascara la corrida: se registra como error', async () => {
    const prisma = createFakePrisma();
    const adapter: ProfitAdapter = {
      dialect: 'fixtures',
      testConnection: async () => ({ connected: true }),
      listViews: async () => [],
      describeView: async () => [],
      select: async () => [{ nro_solicitud: null, co_cli: 'X', co_art: 'P1', pendiente: 1 }],
    };
    const run = await serviceWith(adapter, prisma).run('PRODUCTOS');
    expect(run.status).toBe('ERROR');
    expect(prisma.syncErrors.length).toBe(1);
    expect(prisma.tables.products.size).toBe(0); // nada de la fila inválida se persiste
  });
});

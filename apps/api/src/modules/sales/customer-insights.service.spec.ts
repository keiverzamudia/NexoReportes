import { describe, expect, it } from 'vitest';
import { FixturesProfitAdapter } from '../sync/fixtures.adapter';
import { CustomerInsightsService } from './customer-insights.service';

const NOW = new Date();

function monthAgo(offset: number): { key: string; year: number; date: string } {
  const date = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - offset, 1));
  return {
    key: date.toISOString().slice(0, 7),
    year: date.getUTCFullYear(),
    date: date.toISOString().slice(0, 10),
  };
}

function volumeRow(offset: number, product: string, units: number, note: string) {
  const month = monthAgo(offset);
  return {
    anio: month.year,
    mes: Number(month.key.slice(5, 7)),
    nota: note,
    co_art: product,
    art_des: `Producto ${product}`,
    uni_venta: 'SAC',
    uni_relac: 35,
    unid: units,
    kg: units * 35,
    fecha: month.date,
  };
}

function billingRow(offset: number, billed: number, missingRate = 0) {
  const month = monthAgo(offset);
  return {
    anio: month.year,
    mes: Number(month.key.slice(5, 7)),
    facturado: billed,
    creditos: 0,
    documentos: 1,
    sin_tasa: missingRate,
  };
}

interface FakeOptions {
  volumeFails?: boolean;
  billingFails?: boolean;
  similarFails?: boolean;
  billingPartial?: boolean;
}

function createProfit(options: FakeOptions = {}) {
  const calls: string[] = [];
  const volume = [
    volumeRow(0, 'A', 100, 'N-A-0'),
    volumeRow(2, 'A', 100, 'N-A-2'),
    volumeRow(12, 'A', 50, 'N-A-12'),
    volumeRow(12, 'B', 40, 'N-B-12'),
    volumeRow(14, 'B', 40, 'N-B-14'),
  ];
  const billing = [
    billingRow(0, 1000, options.billingPartial ? 1 : 0),
    billingRow(2, 1000),
    billingRow(12, 800),
  ];
  const similar = [
    { co_art: 'A', art_des: 'Producto A', uni_venta: 'SAC', uni_relac: 35, clientes: 30, unid: 100, kg: 3500, total_tipo: 60 },
    { co_art: 'Z', art_des: 'Producto Z', uni_venta: 'SAC', uni_relac: 35, clientes: 20, unid: 80, kg: 2800, total_tipo: 60 },
  ];
  return {
    dialect: 'fixtures',
    selectQuery: async (sql: string) => {
      calls.push(sql);
      if (sql.includes('customer_insights_products')) {
        if (options.volumeFails) throw new Error('Profit no responde');
        return volume;
      }
      if (sql.includes('customer_insights_billing')) {
        if (options.billingFails) throw new Error('Sin facturación');
        return billing;
      }
      if (sql.includes('customer_insights_similar')) {
        if (options.similarFails) throw new Error('Sin surtido');
        return similar;
      }
      return [];
    },
    calls: () => calls,
    countBy: (marker: string) => calls.filter((sql) => sql.includes(marker)).length,
  };
}

function createPrisma() {
  return {
    customer: {
      findUnique: async () => ({
        name: 'CLIENTE UNO',
        customerType: 'L1 EXCLUSIVOS',
        vendor: 'VENDEDOR UNO',
        isActive: true,
      }),
    },
    salesOrder: {
      findMany: async () => [
        {
          externalNumber: 'P-1',
          requestedDate: new Date('2026-11-10T00:00:00.000Z'),
          lines: [{ productCode: 'A', pendingQty: 5, pendingKg: 175 }],
        },
      ],
    },
  } as never;
}

function createStatements() {
  return {
    summaries: async (code: string) => ({
      items: [
        {
          code,
          name: 'CLIENTE UNO',
          saldo: 100,
          saldoVencido: 50,
          credito: 0,
          limiteCredito: 1000,
          documentos: 1,
          vencidos: 1,
        },
      ],
      asOf: new Date().toISOString(),
      moneda: 'USD',
      source: 'fixtures',
    }),
  } as never;
}

function createDeliveryDates() {
  return {
    resolveForLines: async () => new Map([['P-1#A', '2026-11-12T00:00:00.000Z']]),
  } as never;
}

function createService(profit: unknown, statements: unknown = createStatements()) {
  return new CustomerInsightsService(
    createPrisma(),
    profit as never,
    statements as never,
    createDeliveryDates(),
  );
}

describe('CustomerInsightsService', () => {
  it('compone la ficha con volumen, facturación, pedidos y cartera', async () => {
    const profit = createProfit();
    const service = createService(profit);

    const result = await service.get('c1', { months: 24, currency: 'USD' });

    expect(result.customer.code).toBe('C1');
    expect(result.customer.name).toBe('CLIENTE UNO');
    expect(result.customer.customerType).toBe('L1 EXCLUSIVOS');
    expect(result.available).toBe(true);
    expect(result.billingAvailable).toBe(true);
    expect(result.totals.sacks).toBe(200);
    expect(result.totals.tonnes).toBe(7);
    expect(result.orders.activeCount).toBe(1);
    expect(result.orders.pendingQty).toBe(5);
    expect(result.orders.nextDeliveryDate).toBe('2026-11-12');
    expect(result.account?.saldoVencido).toBe(50);
    expect(result.source).toBe('fixtures');
    expect(result.productBillingEstimated).toBe(true);
  });

  it('excluye del surtido del segmento los productos que el cliente ya compra', async () => {
    const service = createService(createProfit());
    const result = await service.get('C1', { months: 24, currency: 'USD' });

    expect(result.similarProducts.map((product) => product.code)).toEqual(['Z']);
  });

  it('cachea la respuesta completa por cliente, ventana y moneda', async () => {
    const profit = createProfit();
    const service = createService(profit);

    await service.get('C1', { months: 24, currency: 'USD' });
    await service.get('C1', { months: 24, currency: 'USD' });

    expect((profit as unknown as { countBy: (marker: string) => number }).countBy('customer_insights_products')).toBe(1);
  });

  it('invalidate fuerza una nueva lectura', async () => {
    const profit = createProfit();
    const service = createService(profit);

    await service.get('C1', { months: 24, currency: 'USD' });
    service.invalidate();
    await service.get('C1', { months: 24, currency: 'USD' });

    expect((profit as unknown as { countBy: (marker: string) => number }).countBy('customer_insights_products')).toBe(2);
  });

  it('si falla la facturación conserva el volumen y no cachea', async () => {
    const profit = createProfit({ billingFails: true });
    const service = createService(profit);

    const first = await service.get('C1', { months: 24, currency: 'USD' });
    const second = await service.get('C1', { months: 24, currency: 'USD' });

    expect(first.available).toBe(true);
    expect(first.billingAvailable).toBe(false);
    expect(first.totals.billed).toBeNull();
    expect((profit as unknown as { countBy: (marker: string) => number }).countBy('customer_insights_products')).toBe(2);
    expect(second.billingAvailable).toBe(false);
  });

  it('si falla el volumen mantiene pedidos y cartera con available=false', async () => {
    const profit = createProfit({ volumeFails: true });
    const service = createService(profit);

    const result = await service.get('C1', { months: 24, currency: 'USD' });

    expect(result.available).toBe(false);
    expect(result.totals.kg).toBe(0);
    expect(result.orders.activeCount).toBe(1);
    expect(result.account?.saldo).toBe(100);
    expect(result.alerts.some((alert) => alert.key === 'cobranza')).toBe(true);
  });

  it('marca billingPartial cuando hay documentos sin tasa', async () => {
    const service = createService(createProfit({ billingPartial: true }));
    const result = await service.get('C1', { months: 24, currency: 'USD' });

    expect(result.billingPartial).toBe(true);
  });

  it('si falla la cartera no rompe la ficha', async () => {
    const statements = {
      summaries: async () => {
        throw new Error('cartera caída');
      },
    };
    const service = createService(createProfit(), statements);
    const result = await service.get('C1', { months: 24, currency: 'USD' });

    expect(result.account).toBeNull();
    expect(result.available).toBe(true);
  });

  it('en fixtures genera volumen, facturación y productos perdidos', async () => {
    const service = new CustomerInsightsService(
      createPrisma(),
      new FixturesProfitAdapter(),
      createStatements() as never,
      createDeliveryDates() as never,
    );

    const result = await service.get('153064128', { months: 24, currency: 'USD' });

    expect(result.available).toBe(true);
    expect(result.billingAvailable).toBe(true);
    expect(result.totals.tonnes).toBeGreaterThan(0);
    expect(result.totals.billed).toBeGreaterThan(0);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.lostProducts.length).toBeGreaterThan(0);
    expect(result.monthly).toHaveLength(24);
  });
});

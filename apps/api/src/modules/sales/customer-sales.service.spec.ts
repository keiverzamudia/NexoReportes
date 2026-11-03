import { describe, expect, it } from 'vitest';
import { FixturesProfitAdapter } from '../sync/fixtures.adapter';
import { CustomerSalesService, salesPeriodRange } from './customer-sales.service';

function fakeProfit(rows: Record<string, unknown>[] = [], fail = false) {
  let calls = 0;
  return {
    dialect: 'mssql',
    selectQuery: async () => {
      calls += 1;
      if (fail) throw new Error('Profit no responde');
      return rows;
    },
    calls: () => calls,
  } as never;
}

describe('salesPeriodRange', () => {
  const now = new Date(Date.UTC(2026, 10, 2)); // 2 de noviembre de 2026

  it('«mes» va del día 1 del mes en curso a mañana (exclusivo)', () => {
    expect(salesPeriodRange('mes', now)).toEqual({
      from: new Date(Date.UTC(2026, 10, 1)),
      to: new Date(Date.UTC(2026, 10, 3)),
    });
  });

  it('«3m» incluye el mes actual y los dos anteriores', () => {
    expect(salesPeriodRange('3m', now)?.from).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });

  it('«6m» incluye el mes actual y los cinco anteriores', () => {
    expect(salesPeriodRange('6m', now)?.from).toEqual(new Date(Date.UTC(2026, 5, 1)));
  });

  it('«12m» incluye el mes actual y los once anteriores', () => {
    expect(salesPeriodRange('12m', now)?.from).toEqual(new Date(Date.UTC(2025, 11, 1)));
  });

  it('«todos» no define ventana (se resuelve con 12m)', () => {
    expect(salesPeriodRange('todos', now)).toBeNull();
  });
});

describe('CustomerSalesService.aggregate', () => {
  it('mapea sacos, kg, notas y última venta por cliente', async () => {
    const profit = fakeProfit([
      {
        co_cli: ' 153064128 ',
        sacos: '140',
        kg: 0,
        kg_total: '4900',
        notas: '3',
        ultima: '2026-10-31T00:00:00.000Z',
      },
      {
        co_cli: '505835220',
        sacos: 0,
        kg: '4200.5',
        kg_total: '4200.5',
        notas: 2,
        ultima: '2026-10-30T00:00:00.000Z',
      },
    ]);
    const service = new CustomerSalesService(profit);

    const result = await service.aggregate('mes');

    expect(result.available).toBe(true);
    expect(result.byCode.get('153064128')).toEqual({
      sacks: 140,
      kg: 0,
      totalKg: 4900,
      notes: 3,
      lastSaleDate: '2026-10-31',
    });
    expect(result.byCode.get('505835220')).toEqual({
      sacks: 0,
      kg: 4200.5,
      totalKg: 4200.5,
      notes: 2,
      lastSaleDate: '2026-10-30',
    });
  });

  it('«todos» consulta la ventana de 12 meses', async () => {
    const profit = fakeProfit([]);
    const service = new CustomerSalesService(profit);

    await service.aggregate('todos');

    expect((profit as unknown as { calls: () => number }).calls()).toBe(1);
  });

  it('cachea el resultado por periodo', async () => {
    const profit = fakeProfit([]);
    const service = new CustomerSalesService(profit);

    await service.aggregate('3m');
    await service.aggregate('3m');

    expect((profit as unknown as { calls: () => number }).calls()).toBe(1);
  });

  it('si Profit falla devuelve available=false y no cachea el fallo', async () => {
    const profit = fakeProfit([], true);
    const service = new CustomerSalesService(profit);

    const first = await service.aggregate('mes');
    const second = await service.aggregate('mes');

    expect(first.available).toBe(false);
    expect(second.available).toBe(false);
    expect((profit as unknown as { calls: () => number }).calls()).toBe(2);
  });

  it('en fixtures respeta la unidad: SAC en sacos y KG en kg', async () => {
    const service = new CustomerSalesService(new FixturesProfitAdapter());

    const result = await service.aggregate('12m');

    expect(result.available).toBe(true);
    // Perfil SAC: sacos > 0 y kg (de renglones no SAC) en 0.
    expect(result.byCode.get('153064128')?.sacks).toBeGreaterThan(0);
    expect(result.byCode.get('153064128')?.kg).toBe(0);
    // Perfil KG: kg > 0 y sacos en 0.
    expect(result.byCode.get('505835220')?.kg).toBeGreaterThan(0);
    expect(result.byCode.get('505835220')?.sacks).toBe(0);
    // Dejó de vender hace más de 12 meses: fuera del universo.
    expect(result.byCode.has('900000003')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ForecastSalesQuery } from '@nexo/contracts';
import { ForecastService } from './forecast.service';
import { SellersService } from './sellers.service';
import { ProfitAdapter } from '../sync/profit.adapter';

// ============================================================
// Vendedoras vs Forecast con un adaptador falso en memoria.
// Mes del informe: marzo 2025 (siempre cerrado), histórico: sep-2024 → feb-2025.
// Así el calendario, el corte y la proyección son deterministas.
// ============================================================

const QUERY: ForecastSalesQuery = {
  year: 2025,
  month: 3,
  months: 6,
  basis: 'WORKING',
  includeToday: false,
};

function sale(input: {
  year: number;
  month: number;
  seller: string;
  sellerName: string;
  client: string;
  clientName: string;
  type?: string;
  kg: number;
  units?: number;
  notes?: number;
  last?: string;
}): Record<string, unknown> {
  return {
    anio: input.year,
    mes: input.month,
    co_ven: input.seller,
    ven_des: input.sellerName,
    co_cli: input.client,
    cli_des: input.clientName,
    tipo: input.type ?? 'L2 DISTRIBUIDORES',
    unid: input.units ?? input.kg,
    kg: input.kg,
    notas: input.notes ?? 1,
    ultima: input.last ?? `${input.year}-${String(input.month).padStart(2, '0')}-15`,
  };
}

function baseMonthly(): Record<string, unknown>[] {
  return [
    // Vendedora A: 600.000 kg históricos (nov-2024 + feb-2025).
    sale({ year: 2024, month: 11, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 200_000 }),
    sale({ year: 2025, month: 2, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 200_000 }),
    sale({ year: 2025, month: 2, seller: '012', sellerName: 'LIZ PEREZ', client: 'C2', clientName: 'CLIENTE DOS', kg: 200_000 }),
    // Vendedora B: 400.000 kg históricos.
    sale({ year: 2025, month: 2, seller: '025', sellerName: 'MEIDY ARIAS', client: 'C3', clientName: 'CLIENTE TRES', kg: 400_000 }),
    // Mes del informe (marzo 2025).
    sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 60_000, notes: 2, last: '2025-03-03' }),
    sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C2', clientName: 'CLIENTE DOS', kg: 40_000, last: '2025-03-04' }),
    sale({ year: 2025, month: 3, seller: '025', sellerName: 'MEIDY ARIAS', client: 'C3', clientName: 'CLIENTE TRES', kg: 50_000, last: '2025-03-05' }),
  ];
}

function baseDaily(): Record<string, unknown>[] {
  return [
    { fecha: '2025-03-03', co_ven: '012', kg: 60_000, unid: 60_000, notas: 2 },
    { fecha: '2025-03-04', co_ven: '012', kg: 40_000, unid: 40_000, notas: 1 },
    { fecha: '2025-03-05', co_ven: '025', kg: 50_000, unid: 50_000, notas: 1 },
  ];
}

function adapterWith(options: {
  monthly?: Record<string, unknown>[];
  daily?: Record<string, unknown>[];
  fail?: boolean;
} = {}) {
  const calls = { monthly: 0, daily: 0 };
  const adapter: ProfitAdapter = {
    dialect: 'fixtures',
    testConnection: async () => ({ connected: true }),
    listViews: async () => [],
    describeView: async () => [],
    select: async () => [],
    selectQuery: async (sqlText: string) => {
      const lower = sqlText.toLowerCase();
      if (lower.includes('nexo:seller_sales_monthly')) {
        calls.monthly += 1;
        if (options.fail) throw new Error('Profit caído');
        return options.monthly ?? [];
      }
      if (lower.includes('nexo:seller_sales_daily')) {
        calls.daily += 1;
        return options.daily ?? [];
      }
      return [];
    },
    authenticateUser: async () => null,
    listUsers: async () => [],
  };
  return { adapter, calls };
}

function forecastStub(options: {
  totalKg?: number;
  available?: boolean;
  source?: 'LIVE' | 'CAPTURED' | 'SNAPSHOT' | 'NONE';
} = {}) {
  return {
    companyTarget: vi.fn(async () => ({
      totalKg: options.totalKg ?? 1_000_000,
      available: options.available ?? true,
      source: options.source ?? 'SNAPSHOT',
    })),
  } as unknown as ForecastService;
}

describe('SellersService', () => {
  it('reparte la meta por participación histórica y reconcilia los totales', async () => {
    const { adapter } = adapterWith({ monthly: baseMonthly(), daily: baseDaily() });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    expect(report.salesAvailable).toBe(true);
    expect(report.allocationBasis).toBe('HISTORY');
    expect(report.totals.forecastKg).toBe(1_000_000);
    expect(report.totals.actualKg).toBe(150_000);
    expect(report.totals.sellerCount).toBe(2);
    expect(report.totals.clientCount).toBe(3);
    expect(report.sellers.map((seller) => seller.sellerCode)).toEqual(['012', '025']);

    const [liz, meidy] = report.sellers;
    expect(liz!.targetKg).toBe(600_000);
    expect(liz!.quotaPct).toBe(60);
    expect(liz!.sharePct).toBe(60);
    expect(liz!.currentSharePct).toBe(66.7);
    expect(liz!.attainmentPct).toBe(16.7);
    expect(liz!.projectedKg).toBe(100_000);
    expect(liz!.gapKg).toBe(-500_000);
    expect(liz!.clientCount).toBe(2);
    expect(liz!.activeClientCount).toBe(2);
    expect(Math.round(report.sellers.reduce((acc, seller) => acc + (seller.quotaPct ?? 0), 0) * 10) / 10).toBe(100);

    expect(meidy!.targetKg).toBe(400_000);
    expect(meidy!.quotaPct).toBe(40);
    expect(meidy!.attainmentPct).toBe(12.5);

    const clientTargets = Object.fromEntries(
      report.sellers.flatMap((seller) => seller.clients.map((client) => [client.clientCode, client.targetKg])),
    );
    expect(clientTargets).toEqual({ C1: 400_000, C2: 200_000, C3: 400_000 });

    const clientShares = Object.fromEntries(
      report.sellers.flatMap((seller) => seller.clients.map((client) => [client.clientCode, client.shareOfSellerPct])),
    );
    expect(clientShares).toEqual({ C1: 66.7, C2: 33.3, C3: 100 });

    expect(report.daily).toHaveLength(31);
    expect(report.daily[2]!.actualKg).toBe(60_000);
    expect(report.daily[3]!.cumulativeKg).toBe(100_000);
    expect(report.daily[4]!.cumulativeKg).toBe(150_000);
    expect(liz!.daily[4]!.cumulativeKg).toBe(100_000);
  });

  it('sin histórico reparte en partes iguales (EQUAL_FALLBACK)', async () => {
    const monthly = [
      sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 100 }),
      sale({ year: 2025, month: 3, seller: '025', sellerName: 'MEIDY ARIAS', client: 'C3', clientName: 'CLIENTE TRES', kg: 50 }),
    ];
    const { adapter } = adapterWith({ monthly });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    expect(report.allocationBasis).toBe('EQUAL_FALLBACK');
    expect(report.sellers.map((seller) => seller.targetKg)).toEqual([500_000, 500_000]);
    expect(report.sellers[0]!.quotaPct).toBe(50);
    // La vendedora sin base reparte su cuota entre sus clientes.
    expect(report.sellers[0]!.clients[0]!.targetKg).toBe(500_000);
  });

  it('sin meta deja las cuotas en null y no inventa porcentajes', async () => {
    const { adapter } = adapterWith({ monthly: baseMonthly(), daily: baseDaily() });
    const service = new SellersService(
      adapter,
      forecastStub({ totalKg: 0, available: false, source: 'NONE' }),
    );
    const report = await service.sellersReport(QUERY);

    expect(report.forecastAvailable).toBe(false);
    expect(report.forecastSource).toBe('NONE');
    expect(report.allocationBasis).toBe('NONE');
    expect(report.totals.forecastKg).toBe(0);
    expect(report.sellers.every((seller) => seller.targetKg === 0)).toBe(true);
    expect(report.sellers.every((seller) => seller.quotaPct === null)).toBe(true);
    expect(report.sellers.every((seller) => seller.attainmentPct === null)).toBe(true);
    // La venta y el reparto actual sí se muestran.
    expect(report.totals.actualKg).toBe(150_000);
    expect(report.sellers[0]!.currentSharePct).toBe(66.7);
  });

  it('ajusta el residuo de redondeo y mantiene la suma exacta de la meta', async () => {
    const monthly = [
      sale({ year: 2025, month: 2, seller: 'A', sellerName: 'A', client: 'CA', clientName: 'CA', kg: 1 }),
      sale({ year: 2025, month: 2, seller: 'B', sellerName: 'B', client: 'CB', clientName: 'CB', kg: 1 }),
      sale({ year: 2025, month: 2, seller: 'C', sellerName: 'C', client: 'CC', clientName: 'CC', kg: 1 }),
      sale({ year: 2025, month: 3, seller: 'A', sellerName: 'A', client: 'CA', clientName: 'CA', kg: 1 }),
    ];
    const { adapter } = adapterWith({ monthly });
    const service = new SellersService(adapter, forecastStub({ totalKg: 100 }));
    const report = await service.sellersReport(QUERY);

    const sum = report.sellers.reduce((acc, seller) => acc + seller.targetKg, 0);
    expect(Math.round(sum * 10) / 10).toBe(100);
    const targets = report.sellers.map((seller) => seller.targetKg).sort((a, b) => a - b);
    expect(targets).toEqual([33.3, 33.3, 33.4]);
  });

  it('degrada si Profit falla sin pintar ceros como ventas', async () => {
    const { adapter } = adapterWith({ fail: true });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    expect(report.salesAvailable).toBe(false);
    expect(report.sellers).toEqual([]);
    expect(report.daily).toEqual([]);
    expect(report.totals.actualKg).toBe(0);
  });

  it('cachea la respuesta por combinación de filtros', async () => {
    const { adapter, calls } = adapterWith({ monthly: baseMonthly(), daily: baseDaily() });
    const service = new SellersService(adapter, forecastStub());
    await service.sellersReport(QUERY);
    await service.sellersReport(QUERY);

    expect(calls.monthly).toBe(1);
    expect(calls.daily).toBe(1);
  });
});

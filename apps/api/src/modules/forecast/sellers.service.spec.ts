import { describe, expect, it, vi } from 'vitest';
import type { ForecastSellersQuery } from '@nexo/contracts';
import { ForecastService } from './forecast.service';
import { SellersService } from './sellers.service';
import { ProfitAdapter } from '../sync/profit.adapter';

// ============================================================
// Vendedor vs Forecast con un adaptador falso en memoria.
// Mes del informe: marzo 2025 (siempre cerrado), histórico: sep-2024 → feb-2025.
// Así el calendario, el corte y la proyección son deterministas.
// ============================================================

const QUERY: ForecastSellersQuery = {
  year: 2025,
  month: 3,
  months: 6,
  basis: 'WORKING',
  includeToday: false,
  attribution: 'PORTFOLIO',
  refresh: false,
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
  cartera?: string;
  carteraName?: string;
}): Record<string, unknown> {
  const cartera = input.cartera ?? input.seller;
  const carteraName = input.carteraName ?? input.sellerName;
  return {
    anio: input.year,
    mes: input.month,
    co_ven_nota: input.seller,
    ven_nota: input.sellerName,
    co_ven_cartera: cartera,
    ven_cartera: carteraName,
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
    // Vendedor A: 600.000 kg históricos (nov-2024 + feb-2025).
    sale({ year: 2024, month: 11, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 200_000 }),
    sale({ year: 2025, month: 2, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 200_000 }),
    sale({ year: 2025, month: 2, seller: '012', sellerName: 'LIZ PEREZ', client: 'C2', clientName: 'CLIENTE DOS', kg: 200_000 }),
    // Vendedor B: 400.000 kg históricos.
    sale({ year: 2025, month: 2, seller: '025', sellerName: 'MEIDY ARIAS', client: 'C3', clientName: 'CLIENTE TRES', kg: 400_000 }),
    // Mes del informe (marzo 2025).
    sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 60_000, notes: 2, last: '2025-03-03' }),
    sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C2', clientName: 'CLIENTE DOS', kg: 40_000, last: '2025-03-04' }),
    sale({ year: 2025, month: 3, seller: '025', sellerName: 'MEIDY ARIAS', client: 'C3', clientName: 'CLIENTE TRES', kg: 50_000, last: '2025-03-05' }),
  ];
}

function baseDaily(): Record<string, unknown>[] {
  return [
    { fecha: '2025-03-03', co_ven_nota: '012', co_ven_cartera: '012', kg: 60_000, unid: 60_000, notas: 2 },
    { fecha: '2025-03-04', co_ven_nota: '012', co_ven_cartera: '012', kg: 40_000, unid: 40_000, notas: 1 },
    { fecha: '2025-03-05', co_ven_nota: '025', co_ven_cartera: '025', kg: 50_000, unid: 50_000, notas: 1 },
  ];
}

function portfolioFrom(monthly: Record<string, unknown>[]): Record<string, unknown>[] {
  const byClient = new Map<string, Record<string, unknown>>();
  for (const row of monthly) {
    const code = String(row.co_cli);
    if (byClient.has(code)) continue;
    const sellerCode = String(row.co_ven_cartera ?? row.co_ven ?? '');
    byClient.set(code, {
      co_ven: sellerCode,
      ven_des: String(row.ven_cartera ?? row.ven_des ?? sellerCode),
      co_cli: code,
      cli_des: row.cli_des,
      tipo: row.tipo,
    });
  }
  return [...byClient.values()];
}

function adapterWith(
  options: {
    monthly?: Record<string, unknown>[];
    daily?: Record<string, unknown>[];
    portfolio?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
    sellerName?: string;
    fail?: boolean;
    portfolioFails?: boolean;
  } = {},
) {
  const calls = { monthly: 0, daily: 0, portfolio: 0, products: 0 };
  const monthly = options.monthly ?? [];
  const portfolio = options.portfolio ?? portfolioFrom(monthly);
  const adapter: ProfitAdapter = {
    dialect: 'fixtures',
    testConnection: async () => ({ connected: true }),
    listViews: async () => [],
    describeView: async () => [],
    select: async () => [],
    selectQuery: async (sqlText: string) => {
      const lower = sqlText.toLowerCase();
      if (lower.includes('nexo:seller_name')) {
        return [{ ven_des: options.sellerName ?? 'VENDEDOR DE PRUEBA' }];
      }
      if (lower.includes('nexo:seller_products')) {
        calls.products += 1;
        return options.products ?? [];
      }
      if (lower.includes('nexo:seller_portfolio')) {
        calls.portfolio += 1;
        if (options.portfolioFails) throw new Error('Cartera caída');
        return portfolio;
      }
      if (lower.includes('nexo:seller_sales_monthly')) {
        calls.monthly += 1;
        if (options.fail) throw new Error('Profit caído');
        return monthly;
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

function forecastStub(
  options: {
    totalKg?: number;
    available?: boolean;
    source?: 'LIVE' | 'CAPTURED' | 'SNAPSHOT' | 'NONE';
  } = {},
) {
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
    expect(report.attribution).toBe('PORTFOLIO');
    expect(report.assignmentAvailable).toBe(true);
    expect(report.allocationBasis).toBe('HISTORY');
    expect(report.totals.forecastKg).toBe(1_000_000);
    expect(report.totals.actualKg).toBe(150_000);
    expect(report.totals.sellerCount).toBe(2);
    expect(report.totals.clientCount).toBe(3);
    expect(report.totals.assignedClientCount).toBe(3);
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
    expect(liz!.assignedClientCount).toBe(2);
    expect(liz!.windowClientCount).toBe(2);
    expect(liz!.activeClientCount).toBe(2);
    expect(liz!.executedKg).toBe(100_000);
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

  it('incluye clientes de cartera sin venta y vendedores sin venta', async () => {
    const monthly = [
      sale({ year: 2025, month: 2, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 100 }),
      sale({ year: 2025, month: 3, seller: '012', sellerName: 'LIZ PEREZ', client: 'C1', clientName: 'CLIENTE UNO', kg: 40 }),
    ];
    const portfolio = [
      ...portfolioFrom(monthly),
      // Cliente asignado a LIZ que todavía no compró.
      { co_ven: '012', ven_des: 'LIZ PEREZ', co_cli: 'C9', cli_des: 'CLIENTE SIN COMPRA', tipo: 'L3 MINORISTA' },
      // Vendedor con cartera y cero venta.
      { co_ven: '031', ven_des: 'JUILIARD ANGULO', co_cli: 'C10', cli_des: 'CLIENTE DORMIDO', tipo: 'L2 DISTRIBUIDORES' },
    ];
    const { adapter } = adapterWith({ monthly, portfolio });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    expect(report.totals.clientCount).toBe(3);
    expect(report.totals.assignedClientCount).toBe(3);
    expect(report.totals.windowClientCount).toBe(1);
    expect(report.totals.activeClientCount).toBe(1);

    const liz = report.sellers.find((seller) => seller.sellerCode === '012')!;
    const juiliard = report.sellers.find((seller) => seller.sellerCode === '031')!;
    expect(liz.clientCount).toBe(2);
    expect(liz.assignedClientCount).toBe(2);
    expect(liz.windowClientCount).toBe(1);
    expect(liz.activeClientCount).toBe(1);
    expect(liz.clients.map((client) => client.clientCode)).toEqual(['C1', 'C9']);

    expect(juiliard).toBeDefined();
    expect(juiliard.actualKg).toBe(0);
    expect(juiliard.clientCount).toBe(1);
    expect(juiliard.assignedClientCount).toBe(1);
    expect(juiliard.clients[0]!.clientCode).toBe('C10');
    expect(juiliard.clients[0]!.actualKg).toBe(0);
    expect(juiliard.clients[0]!.targetKg).toBe(0);
  });

  it('atribuye la venta a la cartera y marca la nota de otro vendedor', async () => {
    const monthly = [
      sale({
        year: 2025,
        month: 2,
        seller: '031',
        sellerName: 'JUILIARD ANGULO',
        client: 'C1',
        clientName: 'CLIENTE UNO',
        kg: 100,
        cartera: '012',
        carteraName: 'LIZ PEREZ',
      }),
      sale({
        year: 2025,
        month: 3,
        seller: '031',
        sellerName: 'JUILIARD ANGULO',
        client: 'C1',
        clientName: 'CLIENTE UNO',
        kg: 50,
        cartera: '012',
        carteraName: 'LIZ PEREZ',
      }),
    ];
    const portfolio = [
      { co_ven: '012', ven_des: 'LIZ PEREZ', co_cli: 'C1', cli_des: 'CLIENTE UNO', tipo: 'L2 DISTRIBUIDORES' },
      { co_ven: '031', ven_des: 'JUILIARD ANGULO', co_cli: 'C2', cli_des: 'CLIENTE DOS', tipo: 'L2 DISTRIBUIDORES' },
    ];
    const { adapter } = adapterWith({ monthly, portfolio });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    const liz = report.sellers.find((seller) => seller.sellerCode === '012')!;
    const juiliard = report.sellers.find((seller) => seller.sellerCode === '031')!;
    expect(liz.actualKg).toBe(50);
    expect(liz.historicalKg).toBe(100);
    expect(liz.otherSellerKg).toBe(50);
    expect(juiliard.actualKg).toBe(0);
    expect(juiliard.executedKg).toBe(50);
    expect(juiliard.executedHistoricalKg).toBe(100);

    const client = liz.clients.find((row) => row.clientCode === 'C1')!;
    expect(client.actualKg).toBe(50);
    expect(client.otherSellerKg).toBe(50);
    expect(client.otherSellerNames).toEqual(['JUILIARD ANGULO']);
    expect(client.assignedSellerCode).toBe('012');
    expect(report.totals.actualKg).toBe(50);
  });

  it('con attribution=NOTE conserva la venta del emisor y muestra la cartera del cliente', async () => {
    const monthly = [
      sale({
        year: 2025,
        month: 2,
        seller: '031',
        sellerName: 'JUILIARD ANGULO',
        client: 'C1',
        clientName: 'CLIENTE UNO',
        kg: 100,
        cartera: '012',
        carteraName: 'LIZ PEREZ',
      }),
      sale({
        year: 2025,
        month: 3,
        seller: '031',
        sellerName: 'JUILIARD ANGULO',
        client: 'C1',
        clientName: 'CLIENTE UNO',
        kg: 50,
        cartera: '012',
        carteraName: 'LIZ PEREZ',
      }),
    ];
    const portfolio = [
      { co_ven: '012', ven_des: 'LIZ PEREZ', co_cli: 'C1', cli_des: 'CLIENTE UNO', tipo: 'L2 DISTRIBUIDORES' },
      { co_ven: '031', ven_des: 'JUILIARD ANGULO', co_cli: 'C2', cli_des: 'CLIENTE DOS', tipo: 'L2 DISTRIBUIDORES' },
    ];
    const { adapter } = adapterWith({ monthly, portfolio });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport({ ...QUERY, attribution: 'NOTE' });

    expect(report.attribution).toBe('NOTE');
    expect(report.totals.clientCount).toBe(1);
    expect(report.totals.assignedClientCount).toBe(2);
    expect(report.sellers.map((seller) => seller.sellerCode)).toEqual(['031']);
    const juiliard = report.sellers[0]!;
    expect(juiliard.actualKg).toBe(50);
    expect(juiliard.executedKg).toBe(50);
    expect(juiliard.assignedClientCount).toBe(1);
    const client = juiliard.clients.find((row) => row.clientCode === 'C1')!;
    expect(client.assignedSellerCode).toBe('012');
    expect(client.assignedSellerName).toBe('LIZ PEREZ');
  });

  it('desglosa los productos por cartera, firmado y otros', async () => {
    const products = [
      {
        anio: 2025,
        mes: 2,
        co_art: 'P1',
        art_des: 'PRODUCTO UNO',
        uni_venta: 'SAC',
        uni_relac: 35,
        co_cli: 'C1',
        co_ven_nota: '031',
        co_ven_cartera: '012',
        kg: 100,
        unid: 100,
        notas: 1,
        ultima: '2025-02-10',
      },
      {
        anio: 2025,
        mes: 3,
        co_art: 'P1',
        art_des: 'PRODUCTO UNO',
        uni_venta: 'SAC',
        uni_relac: 35,
        co_cli: 'C1',
        co_ven_nota: '031',
        co_ven_cartera: '012',
        kg: 50,
        unid: 50,
        notas: 1,
        ultima: '2025-03-05',
      },
      {
        anio: 2025,
        mes: 3,
        co_art: 'P2',
        art_des: 'PRODUCTO DOS',
        uni_venta: 'KG',
        uni_relac: 1,
        co_cli: 'C2',
        co_ven_nota: '031',
        co_ven_cartera: '012',
        kg: 30,
        unid: 30,
        notas: 1,
        ultima: '2025-03-06',
      },
    ];
    const { adapter, calls } = adapterWith({ products });
    const service = new SellersService(adapter, forecastStub());

    const liz = await service.sellerProducts('012', QUERY);
    expect(calls.products).toBe(1);
    expect(liz.sellerCode).toBe('012');
    expect(liz.sellerName).toBe('VENDEDOR DE PRUEBA');
    expect(liz.months).toBe(6);
    expect(liz.products.map((product) => product.productCode)).toEqual(['P1', 'P2']);

    const p1 = liz.products.find((product) => product.productCode === 'P1')!;
    expect(p1.carteraCurrentKg).toBe(50);
    expect(p1.carteraHistoricalKg).toBe(100);
    expect(p1.noteCurrentKg).toBe(0);
    expect(p1.noteHistoricalKg).toBe(0);
    expect(p1.otherCurrentKg).toBe(50);
    expect(p1.clientCount).toBe(1);
    expect(p1.carteraShareOfSellerPct).toBe(100);
    expect(p1.noteShareOfSellerPct).toBeNull();

    const p2 = liz.products.find((product) => product.productCode === 'P2')!;
    expect(p2.carteraCurrentKg).toBe(30);
    expect(p2.carteraHistoricalKg).toBe(0);
    expect(p2.noteCurrentKg).toBe(0);
    expect(p2.otherCurrentKg).toBe(30);
    expect(p2.carteraShareOfSellerPct).toBe(0);

    const juiliard = await service.sellerProducts('031', QUERY);
    const jp1 = juiliard.products.find((product) => product.productCode === 'P1')!;
    // El cliente está en la cartera de LIZ; JUILIARD solo lo firmó.
    expect(jp1.carteraCurrentKg).toBe(0);
    expect(jp1.carteraHistoricalKg).toBe(0);
    expect(jp1.noteCurrentKg).toBe(50);
    expect(jp1.noteHistoricalKg).toBe(100);
    expect(jp1.otherCurrentKg).toBe(0);
    expect(jp1.noteShareOfSellerPct).toBe(100);
  });

  it('cae a NOTE si no se puede leer la cartera de Profit', async () => {
    const { adapter } = adapterWith({
      monthly: baseMonthly(),
      daily: baseDaily(),
      portfolioFails: true,
    });
    const service = new SellersService(adapter, forecastStub());
    const report = await service.sellersReport(QUERY);

    expect(report.salesAvailable).toBe(true);
    expect(report.attribution).toBe('NOTE');
    expect(report.assignmentAvailable).toBe(false);
    expect(report.totals.assignedClientCount).toBe(0);
    expect(report.sellers.every((seller) => seller.assignedClientCount === 0)).toBe(true);
    expect(report.sellers.map((seller) => seller.sellerCode)).toEqual(['012', '025']);
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
    // El vendedor sin base reparte su cuota entre sus clientes.
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
    expect(calls.portfolio).toBe(1);
  });

  it('refresh=true ignora la caché y vuelve a consultar Profit', async () => {
    const { adapter, calls } = adapterWith({ monthly: baseMonthly(), daily: baseDaily() });
    const service = new SellersService(adapter, forecastStub());
    await service.sellersReport(QUERY);
    await service.sellersReport({ ...QUERY, refresh: true });

    expect(calls.monthly).toBe(2);
    expect(calls.daily).toBe(2);
    expect(calls.portfolio).toBe(2);
  });

  it('cachea por separado cartera y nota', async () => {
    const { adapter, calls } = adapterWith({ monthly: baseMonthly(), daily: baseDaily() });
    const service = new SellersService(adapter, forecastStub());
    await service.sellersReport(QUERY);
    await service.sellersReport({ ...QUERY, attribution: 'NOTE' });

    expect(calls.monthly).toBe(2);
  });
});

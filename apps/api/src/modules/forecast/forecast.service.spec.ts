import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForecastSalesQuery } from '@nexo/contracts';
import { ForecastService } from './forecast.service';
import { ProfitAdapter } from '../sync/profit.adapter';

// ============================================================
// Servicio de «Ventas vs Forecast» con un adaptador falso en memoria.
// No toca Profit, Prisma ni la red: verifica agrupación, proyección,
// tolerancia a fallos y caché.
// ============================================================

const BASE_MONTHLY: Record<string, unknown>[] = [
  { anio: 2026, mes: 7, co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 0, kg: 0, ultima_factura: '2026-07-31' },
  { anio: 2026, mes: 8, co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 10_000, kg: 400_000, ultima_factura: '2026-08-31' },
  { anio: 2026, mes: 9, co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 11_000, kg: 440_000, ultima_factura: '2026-09-30' },
  { anio: 2026, mes: 10, co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 7_500, kg: 300_000, ultima_factura: '2026-10-28' },
  { anio: 2026, mes: 8, co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, unid: 8_571, kg: 300_000, ultima_factura: '2026-08-30' },
  { anio: 2026, mes: 9, co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, unid: 9_429, kg: 330_000, ultima_factura: '2026-09-29' },
  { anio: 2026, mes: 10, co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, unid: 5_714, kg: 200_000, ultima_factura: '2026-10-27' },
];

function buildDaily(kgPerWorkingDay = 500_000 / 24) {
  const rows: Record<string, unknown>[] = [];
  for (let day = 1; day <= 28; day += 1) {
    if (new Date(Date.UTC(2026, 9, day)).getUTCDay() === 0) continue;
    rows.push({
      fecha: `2026-10-${String(day).padStart(2, '0')}`,
      kg: kgPerWorkingDay,
      unid: kgPerWorkingDay / 48,
      facturas: 3,
    });
  }
  return rows;
}

function adapterWith(options: {
  monthly?: Record<string, unknown>[];
  daily?: Record<string, unknown>[];
  dailyProducts?: Record<string, unknown>[];
  dayCustomers?: Record<string, unknown>[];
  customerProducts?: Record<string, unknown>[];
  weekly?: Record<string, unknown>[];
  forecast?: Record<string, unknown>[];
  fail?: boolean;
  failWeekly?: boolean;
  failDailyProducts?: boolean;
  failDayCustomers?: boolean;
  failCustomerProducts?: boolean;
}) {
  const calls = { total: 0, monthly: 0, daily: 0, weekly: 0, forecast: 0 };
  const adapter: ProfitAdapter = {
    dialect: 'fixtures',
    testConnection: async () => ({ connected: true }),
    listViews: async () => [],
    describeView: async () => [],
    select: async () => [],
    selectQuery: async (sqlText: string) => {
      calls.total += 1;
      const lower = sqlText.toLowerCase();
      if (lower.includes('dbo.forecast')) {
        calls.forecast += 1;
        // El servicio agrupa por `fecha`; por defecto las filas de prueba son
        // de octubre 2026 (el mes en curso de los tests).
        return (options.forecast ?? []).map((row) => ({ fecha: '2026-10-01', ...row }));
      }
      if (lower.includes('reng_nde')) {
        // Desviación por cliente: su marcador es propio y va antes que el
        // resto de consultas sobre `reng_nde`.
        if (lower.includes('nexo:customer_products')) {
          if (options.fail || options.failCustomerProducts) throw new Error('Profit caído');
          return options.customerProducts ?? [];
        }
        // La consulta semanal (plan de producción) va PRIMERO: también toca
        // `not_ent`/`reng_nde` y no debe devolver filas mensuales ni diarias.
        if (lower.includes('as semana')) {
          calls.weekly += 1;
          if (options.fail || options.failWeekly) throw new Error('Profit caído');
          return options.weekly ?? [];
        }
        if (options.fail) throw new Error('Profit caído');
        // Detalle del día (modal): cliente × artículo, marcador propio.
        if (lower.includes('nexo:daily_customer_products')) {
          if (options.failDayCustomers) throw new Error('Detalle caído');
          return options.dayCustomers ?? [];
        }
        // El desglose por artículo también agrupa por fecha: se detecta por el
        // marcador propio de la consulta.
        if (lower.includes('nexo:daily_products')) {
          if (options.failDailyProducts) throw new Error('Desglose caído');
          return options.dailyProducts ?? [];
        }
        if (lower.includes('as fecha')) {
          calls.daily += 1;
          return options.daily ?? [];
        }
        calls.monthly += 1;
        return options.monthly ?? [];
      }
      return [];
    },
    authenticateUser: async () => null,
    listUsers: async () => [],
  };
  return { adapter, calls };
}

interface FakeTargetRow {
  id: string;
  year: number;
  month: number;
  productCode: string;
  targetKg: number;
  capturedAt: Date;
  firstCapturedAt: Date | null;
  frozenAt: Date | null;
  lastSeenKg: number | null;
  lastSeenAt: Date | null;
  driftDetectedAt: Date | null;
}

// Prisma falso: catálogo local + tabla `ForecastTarget` en memoria. Cada test
// recibe una instancia limpia para que la captura de la meta no se mezcle.
// `products` permite simular artículos de producción (lo usa el plan).
function createFakePrisma(
  seed: Array<Pick<FakeTargetRow, 'year' | 'month' | 'productCode' | 'targetKg'>> = [],
  products: Array<{ externalCode: string; description: string; uom: string; kgPerUom: number | null }> = [
    {
      externalCode: 'ABABOV75',
      description: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG',
      uom: 'SAC',
      kgPerUom: 35,
    },
  ],
  customers: Array<{
    externalCode: string;
    name: string;
    customerType: string | null;
    vendor: string | null;
  }> = [],
  pending: {
    overrides?: Array<{ orderNumber: string; productCode: string; tentativeDate: Date }>;
    lines?: Array<{
      lineNumber?: number;
      productCode: string;
      description?: string;
      uom?: string;
      pendingQty?: number;
      pendingKg: number | null;
      order: {
        externalNumber: string;
        requestedDate: Date | null;
        customerCode?: string | null;
        customerName?: string | null;
        authorized?: boolean | null;
      };
    }>;
  } = {},
) {
  const capturedAt = new Date('2026-10-01T00:00:00Z');
  const targets: FakeTargetRow[] = seed.map((row) => ({
    ...row,
    id: `${row.year}-${row.month}-${row.productCode}`,
    capturedAt,
    firstCapturedAt: capturedAt,
    frozenAt: null,
    lastSeenKg: row.targetKg,
    lastSeenAt: capturedAt,
    driftDetectedAt: null,
  }));

  return {
    targets,
    product: {
      findMany: async () => products.map((product) => ({ ...product, category: null })),
    },
    customer: {
      findMany: async ({ where }: { where?: { externalCode?: { in?: string[] } } } = {}) => {
        const wanted = new Set(where?.externalCode?.in ?? customers.map((customer) => customer.externalCode));
        return customers.filter((customer) => wanted.has(customer.externalCode));
      },
    },
    // El plan pasa por `list()` / `stockIndex()` / `demandBuckets()`: sin datos
    // locales (sin forecast asignado, sin inventario ni pedidos) para aislar la
    // parte de ventas despachadas.
    forecast: {
      findMany: async () => [],
    },
    salesOrderLine: {
      findMany: async () => pending.lines ?? [],
    },
    deliveryDateOverride: {
      findMany: async () => pending.overrides ?? [],
    },
    inventorySnapshot: {
      findFirst: async () => null,
    },
    forecastTarget: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const or = (where?.OR as Array<{ year: number; month: number }> | undefined) ?? [];
        return targets.filter((row) =>
          or.length > 0
            ? or.some((entry) => entry.year === row.year && entry.month === row.month)
            : where?.year === undefined || (where.year === row.year && where.month === row.month),
        );
      },
      findUnique: async ({
        where,
      }: {
        where: { year_month_productCode: { year: number; month: number; productCode: string } };
      }) => {
        const key = where.year_month_productCode;
        return (
          targets.find(
            (row) => row.year === key.year && row.month === key.month && row.productCode === key.productCode,
          ) ?? null
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created: FakeTargetRow = {
          id: String(data.id ?? `${data.year}-${data.month}-${data.productCode}`),
          year: Number(data.year),
          month: Number(data.month),
          productCode: String(data.productCode),
          targetKg: Number(data.targetKg ?? 0),
          capturedAt: (data.capturedAt as Date | undefined) ?? new Date(),
          firstCapturedAt: (data.firstCapturedAt as Date | undefined) ?? null,
          frozenAt: (data.frozenAt as Date | undefined) ?? null,
          lastSeenKg: data.lastSeenKg === undefined ? null : Number(data.lastSeenKg),
          lastSeenAt: (data.lastSeenAt as Date | undefined) ?? null,
          driftDetectedAt: (data.driftDetectedAt as Date | undefined) ?? null,
        };
        targets.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = targets.find((entry) => entry.id === where.id);
        if (!row) throw new Error('ForecastTarget no encontrado');
        Object.assign(row, data);
        return row;
      },
    },
  };
}

type FakePrisma = ReturnType<typeof createFakePrisma>;

const fakeAudit = { record: async () => undefined };

function service(adapter: ProfitAdapter, prisma: FakePrisma = createFakePrisma()) {
  return new ForecastService(prisma as never, fakeAudit as never, adapter);
}

const QUERY: ForecastSalesQuery = { months: 3, basis: 'WORKING', includeToday: false } as ForecastSalesQuery;

describe('ForecastService.salesReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 29-oct-2026 12:00 en Caracas → el corte debe ser el 28.
    vi.setSystemTime(new Date('2026-10-29T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('compone totales, filas e histórico del mes en curso', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [
        { co_art: 'ABAGP13', forecast_mes: 480_000 },
        { co_art: 'ABABOV75', forecast_mes: 90_000 },
      ],
    });
    const db = createFakePrisma();

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.salesAvailable).toBe(true);
    expect(report.forecastAvailable).toBe(true);
    expect(report.forecastSource).toBe('LIVE');
    expect(report.status).toBe('OPEN');
    expect(report.asOf).toBe('2026-10-28');
    expect(report.days.workingElapsed).toBe(24);
    expect(report.days.workingRemaining).toBe(3);

    // Totales globales: 300.000 + 200.000 reales vs 480.000 + 90.000 de meta.
    expect(report.totals.forecastKg).toBe(570_000);
    expect(report.totals.actualKg).toBe(500_000);
    expect(report.totals.actualUnits).toBe(13_214);
    expect(report.totals.projectedKg).toBeCloseTo(562_500, 0);
    expect(report.totals.attainmentPct).toBeCloseTo(87.7, 1);
    expect(report.totals.projectedAttainmentPct).toBeCloseTo(98.7, 1);
    expect(report.totals.invoiceCount).toBe(72); // 24 días hábiles × 3 facturas
    expect(report.totals.lastInvoiceDate).toBe('2026-10-28');

    // Histórico de 3 meses cerrados (jul, ago, sep) a nivel global.
    expect(report.history.map((h) => h.actualKg)).toEqual([0, 700_000, 770_000]);
    expect(report.totals.historicalAvgKg).toBeCloseTo(490_000, 0);

    // Filas: 2 con venta + 1 solo forecast, ordenadas por meta descendente.
    expect(report.rows.map((r) => r.productCode)).toEqual(['ABAGP13', 'ABABOV75', 'ABABOV67']);

    const gallina = report.rows[0]!;
    expect(gallina.kgPerUom).toBe(40);
    expect(gallina.actualKg).toBe(300_000);
    expect(gallina.actualSacks).toBe(7_500);
    expect(gallina.attainmentPct).toBeCloseTo(62.5, 1);
    expect(gallina.projectedKg).toBeCloseTo(337_500, 0);
    expect(gallina.requiredDailyKg).toBeCloseTo(60_000, 0);

    const sinVenta = report.rows[1]!;
    expect(sinVenta.productCode).toBe('ABABOV75');
    expect(sinVenta.forecastKg).toBe(90_000);
    expect(sinVenta.actualKg).toBe(0);
    expect(sinVenta.attainmentPct).toBe(0);
    expect(sinVenta.description).toContain('VACA LECHERA'); // metadatos del catálogo local

    // El GET es de solo lectura: el snapshot lo hace el scheduler cada hora.
    expect(db.targets).toHaveLength(0);
  });

  it('producto con venta y sin forecast: porcentajes nulos, nunca Infinity', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY.filter((row) => row.mes !== 10).concat([
        { anio: 2026, mes: 10, co_art: 'ABAPOR47', art_des: 'CERDO', uni_venta: 'SAC', uni_relac: 40, unid: 100, kg: 4_000, ultima_factura: '2026-10-20' },
      ]),
      daily: buildDaily(10_000),
      forecast: [],
    });

    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 10 });
    const row = report.rows.find((r) => r.productCode === 'ABAPOR47')!;
    expect(row.forecastKg).toBe(0);
    expect(row.attainmentPct).toBeNull();
    expect(row.projectedAttainmentPct).toBeNull();
    expect(row.gapKg).toBeNull();
    expect(row.requiredDailyKg).toBeNull();
  });

  it('si Profit falla devuelve salesAvailable=false (sin excepción 500)', async () => {
    const { adapter } = adapterWith({ fail: true });
    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 10 });
    expect(report.salesAvailable).toBe(false);
    expect(report.forecastSource).toBe('NONE');
    expect(report.rows).toEqual([]);
    expect(report.totals.actualKg).toBe(0);
  });

  it('mes cerrado: la proyección es la venta real y consulta el forecast de ese mes', async () => {
    const { adapter, calls } = adapterWith({
      monthly: BASE_MONTHLY.filter((row) => row.mes === 9),
      daily: [],
      forecast: [],
    });

    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 9 });
    expect(report.status).toBe('CLOSED');
    expect(report.asOf).toBe('2026-09-30');
    expect(report.totals.actualKg).toBe(770_000);
    expect(report.totals.projectedKg).toBe(770_000);
    expect(report.totals.requiredDailyKg).toBeNull();
    // `forecast.fecha` permite pedir el mes cerrado; sin filas, no hay meta.
    expect(calls.forecast).toBe(1);
    expect(report.forecastSource).toBe('NONE');
  });

  it('la segunda llamada sale de caché y no vuelve a consultar Profit', async () => {
    const { adapter, calls } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const forecast = service(adapter);
    const first = await forecast.salesReport({ ...QUERY, year: 2026, month: 10 });
    const afterFirst = calls.total;
    const second = await forecast.salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(calls.total).toBe(afterFirst);
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.totals).toEqual(first.totals);
  });

  it('la serie diaria corta en el 28 y proyecta hasta el 31', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.daily).toHaveLength(31);
    expect(report.daily[27]!.cumulativeKg).toBeCloseTo(500_000, 0);
    expect(report.daily[28]!.cumulativeKg).toBeNull(); // hoy queda fuera del acumulado
    expect(report.daily[30]!.projectedCumulativeKg).toBeCloseTo(562_500, 0);
    expect(report.daily[30]!.forecastCumulativeKg).toBeCloseTo(480_000, 0);
  });

  it('proyecta los pedidos pendientes en su fecha de entrega efectiva', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const db = createFakePrisma([], undefined, [], {
      overrides: [
        { orderNumber: 'P-2', productCode: 'ABAGP13', tentativeDate: new Date('2026-10-22T00:00:00Z') },
      ],
      lines: [
        {
          productCode: 'ABAGP13',
          pendingKg: 12_000,
          order: { externalNumber: 'P-1', requestedDate: new Date('2026-10-20T00:00:00Z') },
        },
        // Pedido movido con fecha tentativa: pesa el 22, no el 15.
        {
          productCode: 'ABAGP13',
          pendingKg: 8_000,
          order: { externalNumber: 'P-2', requestedDate: new Date('2026-10-15T00:00:00Z') },
        },
        // Entrega en otro mes: no entra a la tira del informe.
        {
          productCode: 'ABABOV67',
          pendingKg: 5_000,
          order: { externalNumber: 'P-3', requestedDate: new Date('2026-11-02T00:00:00Z') },
        },
        // Atrasado: se queda en su día original junto a la venta real.
        {
          productCode: 'ABAGP13',
          pendingKg: 2_000,
          order: { externalNumber: 'P-4', requestedDate: new Date('2026-10-03T00:00:00Z') },
        },
      ],
    });

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.totals.pendingKg).toBe(22_000);
    expect(report.totals.pendingOrders).toBe(3);
    expect(report.daily[2]!.pendingKg).toBe(2_000); // 3 de octubre
    expect(report.daily[19]!.pendingKg).toBe(12_000); // 20 de octubre
    expect(report.daily[21]!.pendingKg).toBe(8_000); // 22 de octubre (tentativa)
    expect(report.daily[14]!.pendingKg).toBe(0); // 15 de octubre ya no cuenta
    expect(report.daily.reduce((acc, day) => acc + day.pendingKg, 0)).toBe(22_000);
  });

  it('si la cartera local falla, el informe de ventas sigue disponible', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const db = createFakePrisma();
    db.deliveryDateOverride.findMany = (async () => {
      throw new Error('SQLite caído');
    }) as never;

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.salesAvailable).toBe(true);
    expect(report.totals.pendingKg).toBe(0);
    expect(report.daily.every((day) => day.pendingKg === 0)).toBe(true);
  });

  it('la serie diaria trae el desglose por producto del día', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      dailyProducts: [
        { fecha: '2026-10-27', co_art: 'ABAGP13', kg: 10_000, unid: 250 },
        { fecha: '2026-10-27', co_art: 'ABABOV67', kg: 30_000, unid: 857 },
        { fecha: '2026-10-28', co_art: 'ABAGP13', kg: 5_000, unid: 125 },
      ],
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 10 });

    const day27 = report.daily[26]!;
    expect(day27.products.map((product) => product.productCode)).toEqual(['ABABOV67', 'ABAGP13']);
    expect(day27.products[0]).toEqual({ productCode: 'ABABOV67', kg: 30_000, units: 857 });
    // El día posterior al corte también conserva su desglose (día parcial).
    expect(report.daily[27]!.products).toHaveLength(1);
    expect(report.daily[25]!.products).toEqual([]);
  });

  it('si el desglose por producto falla, el informe sigue disponible', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
      failDailyProducts: true,
    });
    const report = await service(adapter).salesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.salesAvailable).toBe(true);
    expect(report.totals.actualKg).toBe(500_000);
    expect(report.daily).toHaveLength(31);
    expect(report.daily.every((day) => day.products.length === 0)).toBe(true);
  });

  it('mes cerrado: usa la meta guardada (snapshot) y la marca como histórica', async () => {
    const { adapter, calls } = adapterWith({
      monthly: BASE_MONTHLY.filter((row) => row.mes === 9),
      daily: [],
      forecast: [],
    });
    const db = createFakePrisma([
      { year: 2026, month: 9, productCode: 'ABAGP13', targetKg: 500_000 },
      { year: 2026, month: 8, productCode: 'ABAGP13', targetKg: 450_000 },
    ]);

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 9 });

    expect(report.forecastSource).toBe('SNAPSHOT');
    expect(report.forecastAvailable).toBe(true);
    expect(report.totals.forecastKg).toBe(500_000);
    expect(report.totals.attainmentPct).toBeCloseTo(154, 1);
    expect(report.totals.projectedAttainmentPct).toBeCloseTo(154, 1);
    // La consulta a `forecast` se hace igual (histórico/fallback), pero manda
    // el snapshot congelado del mes cerrado.
    expect(calls.forecast).toBe(1);

    // El histórico compara cada mes contra su propia meta guardada.
    expect(report.history.find((entry) => entry.month === 8)?.forecastKg).toBe(450_000);
    expect(report.history.find((entry) => entry.month === 7)?.forecastKg).toBeNull();
    const row = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.history.find((entry) => entry.month === 8)?.forecastKg).toBe(450_000);
  });

  it('mes cerrado sin snapshot: sin meta, sin banner de error y sin Infinity', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY.filter((row) => row.mes === 9),
      daily: [],
      forecast: [],
    });

    const report = await service(adapter, createFakePrisma()).salesReport({ ...QUERY, year: 2026, month: 9 });

    expect(report.forecastSource).toBe('NONE');
    expect(report.forecastAvailable).toBe(true);
    expect(report.totals.forecastKg).toBe(0);
    expect(report.totals.attainmentPct).toBeNull();
    expect(report.totals.projectedAttainmentPct).toBeNull();
    expect(report.history.every((entry) => entry.forecastKg === null)).toBe(true);
  });

  it('mes cerrado sin snapshot: usa la meta viva de forecast para ese mes', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY.filter((row) => row.mes === 9),
      daily: [],
      forecast: [{ fecha: '2026-09-01', co_art: 'ABAGP13', forecast_mes: 500_000 }],
    });

    const report = await service(adapter, createFakePrisma()).salesReport({ ...QUERY, year: 2026, month: 9 });

    expect(report.forecastSource).toBe('LIVE');
    expect(report.forecastAvailable).toBe(true);
    expect(report.totals.forecastKg).toBe(500_000);
    expect(report.totals.attainmentPct).toBeCloseTo(154, 1);
  });

  it('usa la fila de forecast cuyo fecha coincide con el mes pedido', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [
        { fecha: '2026-09-01', co_art: 'ABAGP13', forecast_mes: 1_000_000 },
        { fecha: '2026-10-01', co_art: 'ABAGP13', forecast_mes: 480_000 },
      ],
    });

    const report = await service(adapter, createFakePrisma()).salesReport({ ...QUERY, year: 2026, month: 10 });

    // El mes del informe toma su propia `fecha`; el histórico compara cada mes
    // contra la meta de `forecast` cuando no hay snapshot.
    expect(report.totals.forecastKg).toBe(480_000);
    expect(report.history.find((entry) => entry.month === 9)?.forecastKg).toBe(1_000_000);
    expect(report.history.find((entry) => entry.month === 8)?.forecastKg).toBeNull();
  });


  it('convierte a kg el forecast en sacos y deja el granel tal cual', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [
        // 12.000 sacos × 40 kg = 480.000 kg.
        { co_art: 'ABAGP13', forecast_mes: 12_000, uni_venta: 'SAC', uni_relac: 40 },
        // Granel: el valor ya está en kg y no se multiplica.
        { co_art: 'ABABOV75', forecast_mes: 90_000, uni_venta: 'KG', uni_relac: 1 },
      ],
    });

    const report = await service(adapter, createFakePrisma()).salesReport({ ...QUERY, year: 2026, month: 10 });

    const gallina = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    const granel = report.rows.find((entry) => entry.productCode === 'ABABOV75')!;
    expect(gallina.forecastKg).toBe(480_000);
    expect(granel.forecastKg).toBe(90_000);
    expect(report.totals.forecastKg).toBe(570_000);
  });

  it('el asignador expone el mensual convertido a kg', async () => {
    const { adapter } = adapterWith({
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 12_000, uni_venta: 'SAC', uni_relac: 40 }],
    });
    const db = createFakePrisma([], [
      { externalCode: 'ABAGP13', description: 'GALLINA PONEDORA PLUS 18% - 40 KG', uom: 'SAC', kgPerUom: 40 },
    ]);

    const list = await service(adapter, db).list(2026, 10);
    const row = list.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.monthlyQty).toBe(480_000);
    expect(row.averageQty).toBe(120_000);
  });

  it('captureForecastTargets guarda la meta viva del mes en curso', async () => {
    const { adapter } = adapterWith({
      forecast: [
        { co_art: 'ABAGP13', forecast_mes: 480_000 },
        { co_art: 'ABABOV67', forecast_mes: 300_000 },
      ],
    });
    const db = createFakePrisma();
    const forecast = service(adapter, db);

    const first = await forecast.captureForecastTargets();
    expect(first).toMatchObject({ year: 2026, month: 10, products: 2, captured: true, created: 2 });
    expect(db.targets).toHaveLength(2);

    // Idempotente: una segunda captura no duplica filas.
    const second = await forecast.captureForecastTargets();
    expect(second.products).toBe(2);
    expect(db.targets).toHaveLength(2);
  });

  it('corrige la meta dentro de la ventana de gracia y la congela después', async () => {
    vi.setSystemTime(new Date('2026-10-20T16:00:00.000Z')); // 20-oct 12:00 en Caracas
    const options = { forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }] };
    const { adapter } = adapterWith(options);
    const db = createFakePrisma();
    const forecast = service(adapter, db);

    const first = await forecast.captureForecastTargets();
    expect(first.created).toBe(1);
    expect(db.targets[0]!.targetKg).toBe(480_000);
    expect(db.targets[0]!.frozenAt).toBeNull();

    // Cambio dentro de las 72 h: se corrige (evita congelar el mes anterior).
    vi.setSystemTime(new Date('2026-10-21T16:00:00.000Z'));
    options.forecast = [{ co_art: 'ABAGP13', forecast_mes: 500_000 }];
    const second = await forecast.captureForecastTargets();
    expect(second.corrected).toBe(1);
    expect(db.targets[0]!.targetKg).toBe(500_000);
    expect(db.targets[0]!.frozenAt).toBeNull();

    // Pasada la gracia: se congela y solo se registra la diferencia.
    vi.setSystemTime(new Date('2026-10-24T16:00:00.000Z'));
    options.forecast = [{ co_art: 'ABAGP13', forecast_mes: 520_000 }];
    const third = await forecast.captureForecastTargets();
    expect(third.frozen).toBe(1);
    expect(third.drifted).toBe(1);
    expect(db.targets[0]!.targetKg).toBe(500_000);
    expect(db.targets[0]!.lastSeenKg).toBe(520_000);
    expect(db.targets[0]!.driftDetectedAt).toBeInstanceOf(Date);
    expect(db.targets[0]!.frozenAt).toBeInstanceOf(Date);
  });

  it('incluye todo el catálogo de producción aunque no tenga meta ni venta', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const db = createFakePrisma([], [
      {
        externalCode: 'ABAGP13',
        description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
        uom: 'SAC',
        kgPerUom: 40,
      },
      {
        externalCode: 'SINMETA',
        description: 'ARTICULO SIN META NI VENTA',
        uom: 'SAC',
        kgPerUom: 40,
      },
    ]);

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 10 });
    const sinMeta = report.rows.find((row) => row.productCode === 'SINMETA')!;
    expect(sinMeta.forecastKg).toBe(0);
    expect(sinMeta.actualKg).toBe(0);
    expect(sinMeta.description).toBe('ARTICULO SIN META NI VENTA');
    expect(sinMeta.forecastCapturedKg).toBeNull();
  });

  it('el mes en curso usa la meta viva y expone la captura y el drift', async () => {
    const { adapter } = adapterWith({
      monthly: BASE_MONTHLY,
      daily: buildDaily(),
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
    });
    const db = createFakePrisma([{ year: 2026, month: 10, productCode: 'ABAGP13', targetKg: 300_000 }]);
    db.targets[0]!.lastSeenKg = 480_000;
    db.targets[0]!.driftDetectedAt = new Date('2026-10-15T12:00:00Z');

    const report = await service(adapter, db).salesReport({ ...QUERY, year: 2026, month: 10 });
    const row = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.forecastKg).toBe(480_000);
    expect(row.forecastCapturedKg).toBe(300_000);
    expect(row.forecastLiveKg).toBe(480_000);
    expect(row.forecastDriftAt).not.toBeNull();
  });

  it('acepta el cambio de Profit y actualiza la captura histórica', async () => {
    const db = createFakePrisma([{ year: 2026, month: 10, productCode: 'ABAGP13', targetKg: 300_000 }]);
    db.targets[0]!.lastSeenKg = 320_000;
    db.targets[0]!.lastSeenAt = new Date('2026-10-15T12:00:00Z');
    db.targets[0]!.driftDetectedAt = new Date('2026-10-15T12:00:00Z');

    const forecast = service(adapterWith({}).adapter, db);
    const result = await forecast.acceptTargetDrift(2026, 10, 'ABAGP13');

    expect(result).toEqual({ ok: true, targetKg: 320_000 });
    expect(db.targets[0]!.targetKg).toBe(320_000);
    expect(db.targets[0]!.driftDetectedAt).toBeNull();
  });
});

// ============================================================
// Detalle de un día: modal «Desglose del día».
// ============================================================
describe('ForecastService.salesDayDetail', () => {
  const DAY_ROWS = [
    { fecha: '2026-10-27', co_cli: 'C1', cli_des: 'CLIENTE UNO', co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 150, kg: 6_000 },
    { fecha: '2026-10-27', co_cli: 'C1', cli_des: 'CLIENTE UNO', co_art: 'ABABOV67', art_des: 'MULTIESPECIE LINEA NARANJA SACO 35 KG', uni_venta: 'SAC', uni_relac: 35, unid: 100, kg: 3_500 },
    { fecha: '2026-10-27', co_cli: 'C2', cli_des: 'CLIENTE DOS', co_art: 'ABAGP13', art_des: 'GALLINA PONEDORA PLUS 18% - 40 KG', uni_venta: 'SAC', uni_relac: 40, unid: 100, kg: 4_000 },
  ];

  it('agrupa clientes y productos con su participación del día', async () => {
    const { adapter } = adapterWith({ dayCustomers: DAY_ROWS });
    const detail = await service(adapter).salesDayDetail('2026-10-27');

    expect(detail.available).toBe(true);
    expect(detail.kg).toBe(13_500);
    expect(detail.customers.map((customer) => customer.customerCode)).toEqual(['C1', 'C2']);
    expect(detail.customers[0]).toMatchObject({ customerName: 'CLIENTE UNO', kg: 9_500, sharePct: 70.4 });
    expect(detail.customers[0]!.products.map((product) => product.productCode)).toEqual(['ABAGP13', 'ABABOV67']);
    // La presentación viaja hasta la línea del cliente: 6.000 / 40 = 150 sacos.
    expect(detail.customers[0]!.products[0]).toMatchObject({
      productCode: 'ABAGP13',
      kg: 6_000,
      kgPerUom: 40,
      sacks: 150,
    });
    expect(detail.customers[0]!.products[1]).toMatchObject({
      productCode: 'ABABOV67',
      kg: 3_500,
      kgPerUom: 35,
      sacks: 100,
    });
    expect(detail.products.map((product) => product.productCode)).toEqual(['ABAGP13', 'ABABOV67']);
    expect(detail.products[0]).toMatchObject({ kg: 10_000, sharePct: 74.1, uom: 'SAC', sacks: 250 });
    expect(detail.truncated).toBe(false);
  });

  it('el granel no tiene presentación en sacos', async () => {
    const { adapter } = adapterWith({
      dayCustomers: [
        {
          fecha: '2026-10-27',
          co_cli: 'C1',
          cli_des: 'CLIENTE UNO',
          co_art: 'GRANEL01',
          art_des: 'GRANEL ABA',
          uni_venta: 'KG',
          uni_relac: 1,
          unid: 2_500,
          kg: 2_500,
        },
      ],
    });
    const detail = await service(adapter).salesDayDetail('2026-10-27');

    expect(detail.customers[0]!.products[0]).toMatchObject({ uom: 'KG', kgPerUom: null, sacks: null });
    expect(detail.products[0]).toMatchObject({ uom: 'KG', kgPerUom: null, sacks: null });
  });

  it('agrupa las notas sin cliente para que el reparto sume 100 %', async () => {
    const { adapter } = adapterWith({
      dayCustomers: [
        ...DAY_ROWS,
        { fecha: '2026-10-27', co_cli: '', cli_des: '', co_art: 'ABAGP13', art_des: 'GALLINA', uni_venta: 'SAC', uni_relac: 40, unid: 25, kg: 1_000 },
      ],
    });
    const detail = await service(adapter).salesDayDetail('2026-10-27');
    const sinCliente = detail.customers.find((customer) => customer.customerCode === '__sin_cliente__');

    expect(sinCliente).toMatchObject({ customerName: 'Sin cliente', kg: 1_000 });
    expect(detail.customers.reduce((acc, customer) => acc + (customer.sharePct ?? 0), 0)).toBeCloseTo(100, 0);
  });

  it('un día sin despachos devuelve listas vacías (no es un error)', async () => {
    const { adapter } = adapterWith({ dayCustomers: [] });
    const detail = await service(adapter).salesDayDetail('2026-10-31');

    expect(detail).toMatchObject({ available: true, kg: 0, products: [], customers: [], truncated: false });
  });

  it('si Profit falla, el detalle queda no disponible sin lanzar', async () => {
    const { adapter } = adapterWith({ failDayCustomers: true });
    const detail = await service(adapter).salesDayDetail('2026-10-27');

    expect(detail.available).toBe(false);
    expect(detail.products).toEqual([]);
    expect(detail.customers).toEqual([]);
  });

  it('suma la cartera pendiente del día por cliente y producto', async () => {
    const { adapter } = adapterWith({ dayCustomers: DAY_ROWS });
    const db = createFakePrisma([], undefined, [], {
      overrides: [
        { orderNumber: 'P-2', productCode: 'ABABOV67', tentativeDate: new Date('2026-10-27T00:00:00Z') },
      ],
      lines: [
        {
          productCode: 'ABAGP13',
          description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
          uom: 'SAC',
          pendingQty: 50,
          pendingKg: 2_000,
          order: {
            externalNumber: 'P-1',
            requestedDate: new Date('2026-10-27T00:00:00Z'),
            customerCode: 'C3',
            customerName: 'CLIENTE TRES',
            authorized: true,
          },
        },
        // Pedido movido al 27 con fecha tentativa: cuenta acá y no el 24.
        {
          productCode: 'ABABOV67',
          description: 'MULTIESPECIE LINEA NARANJA SACO 35 KG',
          uom: 'SAC',
          pendingQty: 30,
          pendingKg: 1_050,
          order: {
            externalNumber: 'P-2',
            requestedDate: new Date('2026-10-24T00:00:00Z'),
            customerCode: 'C1',
            customerName: 'CLIENTE UNO',
            authorized: null,
          },
        },
        // Entrega otro día: no entra en el 27.
        {
          productCode: 'ABAGP13',
          description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
          uom: 'SAC',
          pendingQty: 12,
          pendingKg: 500,
          order: {
            externalNumber: 'P-3',
            requestedDate: new Date('2026-10-28T00:00:00Z'),
            customerCode: 'C4',
            customerName: 'CLIENTE CUATRO',
            authorized: true,
          },
        },
      ],
    });

    const detail = await service(adapter, db).salesDayDetail('2026-10-27');

    expect(detail.pendingAvailable).toBe(true);
    expect(detail.pendingKg).toBe(3_050);
    expect(detail.pendingOrders).toBe(2);
    expect(detail.pendingCustomers.map((customer) => customer.customerCode)).toEqual(['C3', 'C1']);
    expect(detail.pendingCustomers[0]).toMatchObject({
      customerName: 'CLIENTE TRES',
      kg: 2_000,
      orderCount: 1,
      sharePct: 65.6,
    });
    expect(detail.pendingCustomers[0]!.lines[0]).toMatchObject({
      orderNumber: 'P-1',
      kg: 2_000,
      requestedDate: '2026-10-27',
      tentativeDate: null,
      authorized: true,
    });
    expect(detail.pendingCustomers[1]!.lines[0]).toMatchObject({
      orderNumber: 'P-2',
      requestedDate: '2026-10-24',
      tentativeDate: '2026-10-27',
    });
    expect(detail.pendingProducts.map((product) => product.productCode)).toEqual(['ABAGP13', 'ABABOV67']);
    expect(detail.pendingProducts[0]).toMatchObject({ kg: 2_000, orderCount: 1, sharePct: 65.6 });
    // La venta real no se mezcla con la cartera.
    expect(detail.kg).toBe(13_500);
  });

  it('si la cartera local falla, la venta del día sigue disponible', async () => {
    const { adapter } = adapterWith({ dayCustomers: DAY_ROWS });
    const db = createFakePrisma();
    db.deliveryDateOverride.findMany = (async () => {
      throw new Error('SQLite caído');
    }) as never;

    const detail = await service(adapter, db).salesDayDetail('2026-10-27');

    expect(detail.available).toBe(true);
    expect(detail.kg).toBe(13_500);
    expect(detail.pendingAvailable).toBe(false);
    expect(detail.pendingKg).toBe(0);
    expect(detail.pendingCustomers).toEqual([]);
  });

  it('si Profit falla, la cartera pendiente igual se muestra', async () => {
    const { adapter } = adapterWith({ failDayCustomers: true });
    const db = createFakePrisma([], undefined, [], {
      lines: [
        {
          productCode: 'ABAGP13',
          description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
          uom: 'SAC',
          pendingQty: 50,
          pendingKg: 2_000,
          order: {
            externalNumber: 'P-1',
            requestedDate: new Date('2026-10-27T00:00:00Z'),
            customerCode: 'C3',
            customerName: 'CLIENTE TRES',
            authorized: true,
          },
        },
      ],
    });

    const detail = await service(adapter, db).salesDayDetail('2026-10-27');

    expect(detail.available).toBe(false);
    expect(detail.pendingAvailable).toBe(true);
    expect(detail.pendingKg).toBe(2_000);
    expect(detail.pendingCustomers[0]!.customerCode).toBe('C3');
  });

  it('cachea el detalle por fecha', async () => {
    const { adapter, calls } = adapterWith({ dayCustomers: DAY_ROWS });
    const forecast = service(adapter);

    await forecast.salesDayDetail('2026-10-27');
    await forecast.salesDayDetail('2026-10-27');

    expect(calls.total).toBe(1);
  });
});

// ============================================================
// Participación por cliente: venta real del mes a la fecha.
// ============================================================
describe('ForecastService.customerSalesReport', () => {
  const CUSTOMER_ROWS = [
    { anio: 2026, mes: 10, co_cli: 'C1', cli_des: 'CLIENTE UNO', co_art: 'ABAGP13', art_des: 'GALLINA', uni_venta: 'SAC', uni_relac: 40, unid: 4_500, kg: 180_000, ultima_factura: '2026-10-27' },
    { anio: 2026, mes: 10, co_cli: 'C2', cli_des: 'CLIENTE DOS', co_art: 'ABAGP13', art_des: 'GALLINA', uni_venta: 'SAC', uni_relac: 40, unid: 3_000, kg: 120_000, ultima_factura: '2026-10-26' },
    { anio: 2026, mes: 10, co_cli: 'C1', cli_des: 'CLIENTE UNO', co_art: 'ABABOV67', art_des: 'MULTIESPECIE', uni_venta: 'SAC', uni_relac: 35, unid: 1_428, kg: 50_000, ultima_factura: '2026-10-25' },
    { anio: 2026, mes: 10, co_cli: 'C2', cli_des: 'CLIENTE DOS', co_art: 'ABABOV67', art_des: 'MULTIESPECIE', uni_venta: 'SAC', uni_relac: 35, unid: 4_285, kg: 150_000, ultima_factura: '2026-10-24' },
  ];

  const CUSTOMERS = [
    { externalCode: 'C1', name: 'CLIENTE UNO', customerType: 'L1 EXCLUSIVOS', vendor: 'VENDEDORA 1' },
    { externalCode: 'C2', name: 'CLIENTE DOS', customerType: 'L2 DISTRIBUIDORES', vendor: 'VENDEDORA 2' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calcula la participación del cliente y de cada producto', async () => {
    const { adapter } = adapterWith({ customerProducts: CUSTOMER_ROWS });
    const db = createFakePrisma([], [], CUSTOMERS);

    const report = await service(adapter, db).customerSalesReport({ ...QUERY, year: 2026, month: 10 });

    expect(report.salesAvailable).toBe(true);
    expect(report.asOf).toBe('2026-10-28');
    expect(report.totals.actualKg).toBe(500_000);
    expect(report.totals.customerCount).toBe(2);
    expect(report.totals.activeCustomerCount).toBe(2);
    expect(report.totals.productCount).toBe(2);

    const uno = report.customers.find((customer) => customer.customerCode === 'C1')!;
    const dos = report.customers.find((customer) => customer.customerCode === 'C2')!;
    expect(uno.actualKg).toBe(230_000);
    expect(dos.actualKg).toBe(270_000);
    expect(uno.sharePct).toBe(46);
    expect(dos.sharePct).toBe(54);
    expect(uno.customerName).toBe('CLIENTE UNO');
    expect(uno.customerType).toBe('L1 EXCLUSIVOS');
    expect(uno.vendor).toBe('VENDEDORA 1');
    expect(uno.productCount).toBe(2);

    const gallina = uno.products.find((product) => product.productCode === 'ABAGP13')!;
    const multi = uno.products.find((product) => product.productCode === 'ABABOV67')!;
    // Dentro del cliente, 180.000 de 230.000 = 78,3 %.
    expect(gallina.shareOfCustomerPct).toBe(78.3);
    expect(multi.shareOfCustomerPct).toBe(21.7);
    // Dentro del producto, C1 vendió 180.000 de 300.000 = 60 %.
    expect(gallina.shareOfProductPct).toBe(60);
    expect(gallina.sacks).toBe(4_500);
  });

  it('incluye clientes del catálogo sin venta con 0 %', async () => {
    const { adapter } = adapterWith({ customerProducts: CUSTOMER_ROWS });
    const db = createFakePrisma([], [], [
      ...CUSTOMERS,
      { externalCode: 'C0', name: 'CLIENTE SIN VENTA', customerType: null, vendor: null },
    ]);

    const report = await service(adapter, db).customerSalesReport({ ...QUERY, year: 2026, month: 10 });
    const sinVenta = report.customers.find((customer) => customer.customerCode === 'C0')!;

    expect(sinVenta.actualKg).toBe(0);
    expect(sinVenta.sharePct).toBe(0);
    expect(sinVenta.products).toEqual([]);
    expect(report.totals.customerCount).toBe(3);
    expect(report.totals.activeCustomerCount).toBe(2);
  });

  it('incluye un cliente con venta que no está en el catálogo local', async () => {
    const { adapter } = adapterWith({
      customerProducts: [
        ...CUSTOMER_ROWS,
        { anio: 2026, mes: 10, co_cli: 'NUEVO', cli_des: 'CLIENTE NUEVO', co_art: 'ABAGP13', art_des: 'GALLINA', uni_venta: 'SAC', uni_relac: 40, unid: 250, kg: 10_000, ultima_factura: '2026-10-28' },
      ],
    });

    const report = await service(adapter, createFakePrisma([], [], CUSTOMERS)).customerSalesReport({
      ...QUERY,
      year: 2026,
      month: 10,
    });
    const nuevo = report.customers.find((customer) => customer.customerCode === 'NUEVO')!;

    expect(nuevo.customerName).toBe('CLIENTE NUEVO');
    expect(nuevo.actualKg).toBe(10_000);
    expect(nuevo.sharePct).toBe(2);
  });

  it('si la consulta por cliente falla, no inventa ceros', async () => {
    const { adapter } = adapterWith({ failCustomerProducts: true });

    const report = await service(adapter, createFakePrisma([], [], CUSTOMERS)).customerSalesReport({
      ...QUERY,
      year: 2026,
      month: 10,
    });

    expect(report.salesAvailable).toBe(false);
    expect(report.customers).toEqual([]);
    expect(report.totals.actualKg).toBe(0);
  });

  it('cachea la respuesta y no vuelve a consultar Profit', async () => {
    const { adapter, calls } = adapterWith({ customerProducts: CUSTOMER_ROWS });
    const forecast = service(adapter, createFakePrisma([], [], CUSTOMERS));
    const first = await forecast.customerSalesReport({ ...QUERY, year: 2026, month: 10 });
    const afterFirst = calls.total;
    const second = await forecast.customerSalesReport({ ...QUERY, year: 2026, month: 10 });

    expect(calls.total).toBe(afterFirst);
    expect(second.generatedAt).toBe(first.generatedAt);
  });
});

// ============================================================
// Plan de producción: ventas despachadas por artículo y semana.
// ============================================================
describe('ForecastService.plan (despachos semanales)', () => {
  const PRODUCT = {
    externalCode: 'ABAGP13',
    description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
    uom: 'SAC',
    kgPerUom: 40,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cruza los kg de cada semana y el total del mes por artículo', async () => {
    const { adapter } = adapterWith({
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
      weekly: [
        { co_art: 'ABAGP13', semana: 1, kg: 1_000 },
        { co_art: 'ABAGP13', semana: 2, kg: 0 },
        { co_art: 'ABAGP13', semana: 3, kg: 500 },
        { co_art: 'ABAGP13', semana: 4, kg: 0 },
        // Otro artículo: no debe contaminar la fila consultada.
        { co_art: 'ABAPOR47', semana: 1, kg: 9_999 },
      ],
    });

    const report = await service(adapter, createFakePrisma([], [PRODUCT])).plan(2026, 10);

    expect(report.salesAvailable).toBe(true);
    const row = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.soldMonthKg).toBe(1_500);
    expect(row.weeks.map((week) => week.soldKg)).toEqual([1_000, 0, 500, 0]);
    expect(row.demandMonthKg).toBe(0); // sin pedidos activos en el fixture
  });

  it('lee el forecast del mes pedido aunque ya esté cerrado', async () => {
    const { adapter } = adapterWith({
      forecast: [{ fecha: '2026-09-01', co_art: 'ABAGP13', forecast_mes: 123_000 }],
    });

    const report = await service(adapter, createFakePrisma([], [PRODUCT])).plan(2026, 9);

    const row = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.forecastMonthQty).toBe(123_000);
    expect(row.averageQty).toBe(30_750);
  });

  it('si la consulta semanal falla: salesAvailable=false y soldMonthKg=0', async () => {
    const { adapter } = adapterWith({
      forecast: [{ co_art: 'ABAGP13', forecast_mes: 480_000 }],
      failWeekly: true,
    });

    const report = await service(adapter, createFakePrisma([], [PRODUCT])).plan(2026, 10);

    expect(report.salesAvailable).toBe(false);
    const row = report.rows.find((entry) => entry.productCode === 'ABAGP13')!;
    expect(row.soldMonthKg).toBe(0);
    expect(row.weeks.every((week) => week.soldKg === 0)).toBe(true);
    // El plan sigue disponible: solo faltan los despachos.
    expect(report.rows.length).toBeGreaterThan(0);
  });
});

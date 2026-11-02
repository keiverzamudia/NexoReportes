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
  weekly?: Record<string, unknown>[];
  forecast?: Record<string, unknown>[];
  fail?: boolean;
  failWeekly?: boolean;
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
      if (lower.includes('xart_fore')) {
        calls.forecast += 1;
        return options.forecast ?? [];
      }
      if (lower.includes('reng_nde')) {
        // La consulta semanal (plan de producción) va PRIMERO: también toca
        // `not_ent`/`reng_nde` y no debe devolver filas mensuales ni diarias.
        if (lower.includes('as semana')) {
          calls.weekly += 1;
          if (options.fail || options.failWeekly) throw new Error('Profit caído');
          return options.weekly ?? [];
        }
        if (options.fail) throw new Error('Profit caído');
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
  year: number;
  month: number;
  productCode: string;
  targetKg: number;
  capturedAt: Date;
}

// Prisma falso: catálogo local + tabla `ForecastTarget` en memoria. Cada test
// recibe una instancia limpia para que la captura de la meta no se mezcle.
// `products` permite simular artículos de producción (lo usa el plan).
function createFakePrisma(
  seed: Array<Omit<FakeTargetRow, 'capturedAt'>> = [],
  products: Array<{ externalCode: string; description: string; uom: string; kgPerUom: number | null }> = [
    {
      externalCode: 'ABABOV75',
      description: 'VACA LECHERA 21% ALTA ENERGIA SACO 35 KG',
      uom: 'SAC',
      kgPerUom: 35,
    },
  ],
) {
  const targets: FakeTargetRow[] = seed.map((row) => ({ ...row, capturedAt: new Date('2026-10-01T00:00:00Z') }));

  return {
    targets,
    product: {
      findMany: async () => products.map((product) => ({ ...product, category: null })),
    },
    // El plan pasa por `list()` / `stockIndex()` / `demandBuckets()`: sin datos
    // locales (sin forecast asignado, sin inventario ni pedidos) para aislar la
    // parte de ventas despachadas.
    forecast: {
      findMany: async () => [],
    },
    salesOrderLine: {
      findMany: async () => [],
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
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { year_month_productCode: { year: number; month: number; productCode: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const key = where.year_month_productCode;
        const index = targets.findIndex(
          (row) => row.year === key.year && row.month === key.month && row.productCode === key.productCode,
        );
        if (index >= 0) {
          targets[index] = { ...targets[index]!, ...(update as Partial<FakeTargetRow>) };
          return targets[index];
        }
        const created: FakeTargetRow = {
          year: Number(create.year),
          month: Number(create.month),
          productCode: String(create.productCode),
          targetKg: Number(create.targetKg),
          capturedAt: (create.capturedAt as Date | undefined) ?? new Date(),
        };
        targets.push(created);
        return created;
      },
    },
  };
}

type FakePrisma = ReturnType<typeof createFakePrisma>;

function service(adapter: ProfitAdapter, prisma: FakePrisma = createFakePrisma()) {
  return new ForecastService(prisma as never, {} as never, adapter);
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

    // La meta viva se guarda como snapshot para cuando cierre el mes.
    expect(db.targets).toHaveLength(2);
    expect(db.targets.map((t) => [t.productCode, t.targetKg])).toEqual([
      ['ABAGP13', 480_000],
      ['ABABOV75', 90_000],
    ]);
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

  it('mes cerrado: la proyección es la venta real y no consulta meta viva', async () => {
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
    expect(calls.forecast).toBe(0); // xart_fore solo aplica al mes en curso
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
    expect(calls.forecast).toBe(0); // no se consulta xart_fore en un mes cerrado

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
    expect(first).toEqual({ year: 2026, month: 10, products: 2, captured: true });
    expect(db.targets).toHaveLength(2);

    // Idempotente: una segunda captura no duplica filas.
    const second = await forecast.captureForecastTargets();
    expect(second.products).toBe(2);
    expect(db.targets).toHaveLength(2);
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

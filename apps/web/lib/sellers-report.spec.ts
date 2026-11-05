import { describe, expect, it } from 'vitest';
import type { ForecastSellerClientRow, ForecastSellerRow, ForecastSellersResponse } from '@nexo/contracts';
import {
  allocationLabel,
  buildSellerClientsCsv,
  buildSellerNarrative,
  buildSellersCsv,
  buildShareSlices,
  filterSellerClients,
  filterSellers,
  quotaGeometry,
  sellerHistoryPoints,
  sellerInitials,
} from './sellers-report';

function client(overrides: Partial<ForecastSellerClientRow> = {}): ForecastSellerClientRow {
  return {
    clientCode: 'C1',
    clientName: 'CLIENTE UNO',
    customerType: 'L2 DISTRIBUIDORES',
    historicalKg: 100,
    shareOfSellerPct: 50,
    quotaPct: 30,
    targetKg: 300,
    actualKg: 100,
    actualUnits: 100,
    invoiceCount: 2,
    lastInvoiceDate: '2025-03-04',
    isNew: false,
    dailyAvgKg: 5,
    projectedKg: 150,
    attainmentPct: 33.3,
    projectedAttainmentPct: 50,
    gapKg: -150,
    requiredDailyKg: 10,
    historicalAvgKg: 50,
    vsHistoricalPct: -10,
    ...overrides,
  };
}

function seller(overrides: Partial<ForecastSellerRow> = {}): ForecastSellerRow {
  const { lastInvoiceDate, ...rest } = overrides;
  return {
    sellerCode: '012',
    sellerName: 'LIZ ANTONELLA PEREZ BAEZ',
    clientCount: 1,
    activeClientCount: 1,
    invoiceCount: 2,
    historicalKg: 200,
    sharePct: 60,
    currentSharePct: 66.7,
    quotaPct: 60,
    targetKg: 600,
    actualKg: 100,
    actualUnits: 100,
    dailyAvgKg: 10,
    projectedKg: 200,
    attainmentPct: 16.7,
    projectedAttainmentPct: 33.3,
    gapKg: -400,
    requiredDailyKg: 20,
    historicalAvgKg: 100,
    vsHistoricalPct: -5,
    history: [
      { year: 2025, month: 2, actualKg: 100 },
      { year: 2025, month: 3, actualKg: 100 },
    ],
    daily: [],
    clients: [client()],
    ...rest,
    lastInvoiceDate: lastInvoiceDate ?? '2025-03-05',
  };
}

function report(overrides: Partial<ForecastSellersResponse> = {}): ForecastSellersResponse {
  return {
    year: 2025,
    month: 3,
    asOf: '2025-03-30',
    basis: 'WORKING',
    status: 'CLOSED',
    salesAvailable: true,
    forecastAvailable: true,
    forecastSource: 'SNAPSHOT',
    allocationBasis: 'HISTORY',
    days: {
      inMonth: 31,
      elapsed: 31,
      remaining: 0,
      workingInMonth: 27,
      workingElapsed: 27,
      workingRemaining: 0,
      today: '2026-11-04',
      cut: '2025-03-31',
    },
    totals: {
      forecastKg: 1_000,
      actualKg: 150,
      actualUnits: 150,
      dailyAvgKg: 5,
      projectedKg: 150,
      attainmentPct: 15,
      projectedAttainmentPct: 15,
      gapKg: -850,
      requiredDailyKg: null,
      historicalAvgKg: 100,
      vsHistoricalPct: 0,
      invoiceCount: 3,
      lastInvoiceDate: '2025-03-05',
      sellerCount: 2,
      clientCount: 2,
    },
    daily: [],
    sellers: [
      seller(),
      seller({
        sellerCode: '025',
        sellerName: 'MEIDY CRISTINA ARIAS VIDAL',
        historicalKg: 100,
        sharePct: 40,
        currentSharePct: 33.3,
        quotaPct: 40,
        targetKg: 400,
        actualKg: 50,
        actualUnits: 50,
        projectedKg: 50,
        attainmentPct: 12.5,
        projectedAttainmentPct: 12.5,
        gapKg: -350,
        clients: [client({ clientCode: 'C3', clientName: 'CLIENTE TRES', shareOfSellerPct: 100, quotaPct: 40, targetKg: 400, actualKg: 50 })],
      }),
    ],
    generatedAt: '2025-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sellerInitials', () => {
  it('toma la primera y la última palabra', () => {
    expect(sellerInitials('MEIDY CRISTINA ARIAS VIDAL')).toBe('MV');
    expect(sellerInitials('JUILIARD ANGULO')).toBe('JA');
    expect(sellerInitials('LA EMPRESA (ADM)')).toBe('LA');
    expect(sellerInitials('')).toBe('?');
  });
});

describe('filterSellers', () => {
  it('filtra por texto, venta y cuota', () => {
    const rows = report().sellers;
    expect(filterSellers(rows, { search: 'meidy', onlyWithSales: false, onlyWithQuota: false })).toHaveLength(1);
    expect(filterSellers(rows, { search: '', onlyWithSales: true, onlyWithQuota: false })).toHaveLength(2);
    expect(
      filterSellers([seller({ actualKg: 0 })], { search: '', onlyWithSales: true, onlyWithQuota: false }),
    ).toHaveLength(0);
    expect(
      filterSellers([seller({ targetKg: 0 })], { search: '', onlyWithSales: false, onlyWithQuota: true }),
    ).toHaveLength(0);
  });
});

describe('filterSellerClients', () => {
  it('filtra por texto, venta y sin base', () => {
    const clients = [client(), client({ clientCode: 'C2', clientName: 'NUEVO', targetKg: 0, isNew: true })];
    expect(filterSellerClients(clients, { search: 'nuevo', onlyWithSales: false, onlyWithoutBase: false })).toHaveLength(1);
    expect(filterSellerClients(clients, { search: '', onlyWithSales: false, onlyWithoutBase: true })).toHaveLength(1);
    expect(filterSellerClients(clients, { search: '', onlyWithSales: true, onlyWithoutBase: false })).toHaveLength(2);
  });
});

describe('buildSellerNarrative', () => {
  it('resume la red y la mayor cuota', () => {
    const text = buildSellerNarrative(report());
    expect(text).toContain('2 vendedoras');
    expect(text).toContain('150 kg');
    expect(text).toContain('1.000 kg');
    expect(text).toContain('LIZ ANTONELLA PEREZ BAEZ');
    expect(text).toContain('60,0 %');
  });

  it('explica un mes sin meta', () => {
    const text = buildSellerNarrative(
      report({
        forecastAvailable: false,
        forecastSource: 'NONE',
        totals: { ...report().totals, forecastKg: 0, projectedKg: null, projectedAttainmentPct: null, attainmentPct: null },
      }),
    );
    expect(text).toContain('no tiene meta');
  });

  it('no inventa proyección en un mes futuro', () => {
    const text = buildSellerNarrative(
      report({
        status: 'FUTURE',
        totals: { ...report().totals, actualKg: 0, projectedKg: null, projectedAttainmentPct: null, attainmentPct: null },
      }),
    );
    expect(text).toContain('Todavía no hay entregas');
  });
});

describe('buildShareSlices', () => {
  it('suma 100 % y agrupa el resto en «Otras»', () => {
    const sellers = Array.from({ length: 9 }, (_, index) =>
      seller({
        sellerCode: String(index),
        sellerName: `VENDEDORA ${index}`,
        actualKg: 100 - index * 5,
      }),
    );
    const slices = buildShareSlices(report({ sellers }), 6);
    expect(slices).toHaveLength(7);
    expect(slices.at(-1)!.other).toBe(true);
    expect(Math.round(slices.reduce((acc, slice) => acc + slice.pct, 0) * 10) / 10).toBe(100);
  });

  it('sin ventas no dibuja franja', () => {
    expect(buildShareSlices(report({ sellers: [seller({ actualKg: 0 })] }))).toEqual([]);
  });
});

describe('quotaGeometry', () => {
  it('sin meta la barra queda vacía', () => {
    const geometry = quotaGeometry({ targetKg: 0, actualKg: 100, projectedKg: 120 });
    expect(geometry.hasMeta).toBe(false);
    expect(geometry.actualWidthPct).toBe(0);
  });

  it('con meta recorta al 100 %', () => {
    const geometry = quotaGeometry({ targetKg: 100, actualKg: 200, projectedKg: 250 });
    expect(geometry.hasMeta).toBe(true);
    expect(geometry.actualClipped).toBe(true);
    expect(geometry.projectedWidthPct).toBe(100);
  });
});

describe('historial y etiquetas', () => {
  it('convierte los meses a puntos con la cuota actual', () => {
    const points = sellerHistoryPoints(seller());
    expect(points.map((point) => point.label)).toEqual(['feb', 'mar']);
    expect(points.every((point) => point.quotaKg === 600)).toBe(true);
  });

  it('explica el origen de la cuota', () => {
    expect(allocationLabel(report())).toContain('histórica');
    expect(allocationLabel(report({ allocationBasis: 'EQUAL_FALLBACK' }))).toContain('igualitaria');
    expect(allocationLabel(report({ allocationBasis: 'NONE' }))).toContain('sin meta');
  });
});

describe('CSV', () => {
  it('incluye BOM, encabezados y totales', () => {
    const csv = buildSellersCsv(report());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Vendedora');
    expect(csv).toContain('TOTALES');
    expect(csv).toContain('LIZ ANTONELLA PEREZ BAEZ');
  });

  it('exporta los clientes de una vendedora', () => {
    const csv = buildSellerClientsCsv(seller());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('CLIENTE UNO');
    expect(csv).toContain('300');
  });
});

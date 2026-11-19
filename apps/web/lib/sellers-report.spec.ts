import { describe, expect, it } from 'vitest';
import type { ForecastSellerClientRow, ForecastSellerRow, ForecastSellersResponse } from '@nexo/contracts';
import {
  allocationLabel,
  buildClientQuotaRisk,
  buildSellerClientsCsv,
  buildSellerFacturadoCsv,
  buildSellerLeakCsv,
  buildSellerNarrative,
  buildSellersCsv,
  buildShareSlices,
  clientGapContributionPct,
  clientQuotaSharePct,
  clientsBilledByOthers,
  filterSellerClients,
  filterSellers,
  pctOfTotal,
  quotaGeometry,
  sellerBilling,
  sellerHistoryPoints,
  sellerInitials,
  tabRunRate,
} from './sellers-report';

function client(overrides: Partial<ForecastSellerClientRow> = {}): ForecastSellerClientRow {
  return {
    clientCode: 'C1',
    clientName: 'CLIENTE UNO',
    customerType: 'L2 DISTRIBUIDORES',
    assignedSellerCode: '012',
    assignedSellerName: 'LIZ ANTONELLA PEREZ BAEZ',
    otherSellerKg: 0,
    otherSellerNames: [],
    otherSellers: [],
    otherSellerExternalKg: 0,
    otherSellerInternalKg: 0,
    carteraHistoricalKg: 100,
    carteraCurrentKg: 100,
    carteraTargetKg: 300,
    carteraQuotaPct: 30,
    carteraShareOfSellerPct: 50,
    noteHistoricalKg: 100,
    noteCurrentKg: 100,
    noteTargetKg: 300,
    noteQuotaPct: 30,
    noteShareOfSellerPct: 50,
    historicalKg: 100,
    shareOfSellerPct: 50,
    quotaPct: 30,
    targetKg: 300,
    actualKg: 100,
    actualUnits: 100,
    invoiceCount: 2,
    carteraInvoiceCount: 2,
    noteInvoiceCount: 2,
    lastInvoiceDate: '2025-03-04',
    isNew: false,
    pendingKg: 0,
    expectedKg: 150,
    bestMonthKg: 200,
    capacityKg: 200,
    headroomKg: 50,
    closingPlanKg: 0,
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
    isInternal: false,
    carteraHistoricalKg: 200,
    carteraCurrentKg: 100,
    carteraQuotaPct: 60,
    carteraTargetKg: 600,
    noteHistoricalKg: 200,
    noteCurrentKg: 100,
    noteQuotaPct: 60,
    noteTargetKg: 600,
    billing: {
      facturadoKg: 100,
      facturadoOwnPortfolioKg: 100,
      facturadoOutsideKg: 0,
      carteraKg: 100,
      carteraByOthersKg: 0,
      carteraByOthersExternalKg: 0,
      carteraByOthersInternalKg: 0,
      carteraByOthersPct: 0,
      facturadoClients: 1,
      leakedClients: 0,
      internalClients: 0,
    },
    carteraHistory: [
      { year: 2025, month: 2, actualKg: 100 },
      { year: 2025, month: 3, actualKg: 100 },
    ],
    noteHistory: [
      { year: 2025, month: 2, actualKg: 100 },
      { year: 2025, month: 3, actualKg: 100 },
    ],
    carteraByOthersHistory: [],
    clientCount: 1,
    assignedClientCount: 1,
    windowClientCount: 1,
    activeClientCount: 1,
    invoiceCount: 2,
    executedKg: 100,
    executedHistoricalKg: 200,
    otherSellerKg: 0,
    pendingKg: 0,
    expectedKg: 200,
    closingPlanKg: 0,
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
    collection: {
      available: true,
      onTimePct: 75,
      onTimeAmountUsd: 750,
      lateAmountUsd: 250,
      collectedAmountUsd: 1000,
      averageDays: 12,
      averageLateDays: 4,
      paymentCount: 4,
      onTimePaymentCount: 3,
      latePaymentCount: 1,
      overdueUsd: 0,
    },
    activation: {
      available: true,
      assignedClients: 2,
      activeClients: 1,
      inertClients: 1,
      activationPct: 50,
      reactivatedClients: 0,
      newClients: 1,
    },
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
    scope: 'ALL',
    scopeSellerCode: null,
    basis: 'WORKING',
    status: 'CLOSED',
    salesAvailable: true,
    forecastAvailable: true,
    forecastSource: 'SNAPSHOT',
    forecastLiveKg: null,
    forecastCapturedKg: null,
    forecastCapturedAt: null,
    forecastDriftAt: null,
    attribution: 'PORTFOLIO',
    assignmentAvailable: true,
    allocationBasis: 'HISTORY',
    closingPlanAvailable: false,
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
      pendingKg: 0,
      expectedKg: 150,
      closingGapKg: 0,
      closingCoveredKg: 0,
      closingUncoveredKg: 0,
      invoiceCount: 3,
      lastInvoiceDate: '2025-03-05',
      sellerCount: 2,
      clientCount: 2,
      assignedClientCount: 2,
      windowClientCount: 2,
      activeClientCount: 2,
      billing: {
        facturadoKg: 100,
        facturadoOwnPortfolioKg: 100,
        facturadoOutsideKg: 0,
        carteraKg: 100,
        carteraByOthersKg: 0,
        carteraByOthersExternalKg: 0,
        carteraByOthersInternalKg: 0,
        carteraByOthersPct: 0,
        facturadoClients: 2,
        leakedClients: 0,
        internalClients: 0,
      },
      carteraByOthersHistory: [],
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
    const noSales = seller({
      actualKg: 0,
      noteCurrentKg: 0,
      billing: { ...seller().billing, facturadoKg: 0 },
    });
    expect(
      filterSellers([noSales], { search: '', onlyWithSales: true, onlyWithQuota: false }),
    ).toHaveLength(0);
    expect(
      filterSellers([seller({ targetKg: 0 })], { search: '', onlyWithSales: false, onlyWithQuota: true }),
    ).toHaveLength(0);
  });

  it('aplica el filtro de una KPI del encabezado', () => {
    const rows = report().sellers;
    expect(
      filterSellers(rows, {
        search: '',
        onlyWithSales: false,
        onlyWithQuota: false,
        metricFocus: 'facturado',
      }),
    ).toHaveLength(2);
    expect(
      filterSellers([seller({ targetKg: 0 })], {
        search: '',
        onlyWithSales: false,
        onlyWithQuota: false,
        metricFocus: 'meta',
      }),
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
    expect(text).toContain('2 vendedores');
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

describe('tabRunRate', () => {
  it('en un mes cerrado la proyección es la venta real', () => {
    const metrics = tabRunRate(100, 200, report());
    expect(metrics.projectedKg).toBe(100);
    expect(metrics.attainmentPct).toBe(50);
    expect(metrics.projectedAttainmentPct).toBe(50);
    expect(metrics.gapKg).toBe(-100);
    expect(metrics.requiredDailyKg).toBeNull();
  });

  it('en un mes abierto proyecta con los días hábiles y calcula el ritmo necesario', () => {
    const open = report({
      status: 'OPEN',
      days: {
        ...report().days,
        workingElapsed: 9,
        workingInMonth: 25,
        workingRemaining: 16,
      },
    });
    const metrics = tabRunRate(90, 250, open);
    expect(metrics.projectedKg).toBe(250);
    expect(metrics.attainmentPct).toBe(36);
    expect(metrics.projectedAttainmentPct).toBe(100);
    expect(metrics.gapKg).toBe(0);
    expect(metrics.requiredDailyKg).toBe(10);
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

describe('reparto de la cuota entre clientes', () => {
  it('calcula la porción de cada cliente sobre la cuota del vendedor', () => {
    expect(clientQuotaSharePct(300, 600)).toBe(50);
    expect(clientQuotaSharePct(300, 0)).toBeNull();
  });

  it('mide qué parte de la brecha explica cada cliente', () => {
    expect(clientGapContributionPct(-150, -400)).toBe(37.5);
    expect(clientGapContributionPct(50, -400)).toBe(-12.5);
    expect(clientGapContributionPct(-150, 20)).toBeNull();
    expect(clientGapContributionPct(null, -400)).toBeNull();
  });

  it('resume concentración y clientes en riesgo', () => {
    const risk = buildClientQuotaRisk(seller(), report());
    expect(risk.gapKg).toBe(-200);
    expect(risk.top3SharePct).toBe(50);
    expect(risk.atRisk.map((row) => row.clientCode)).toEqual(['C1']);
  });
});

describe('CSV', () => {
  it('incluye BOM, encabezados y totales', () => {
    const csv = buildSellersCsv(report());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Vendedor');
    expect(csv).toContain('TOTALES');
    expect(csv).toContain('LIZ ANTONELLA PEREZ BAEZ');
  });

  it('exporta los clientes de un vendedor', () => {
    const csv = buildSellerClientsCsv(seller());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('CLIENTE UNO');
    expect(csv).toContain('300');
  });

  it('exporta facturado y fuga con sus columnas', () => {
    const facturado = buildSellerFacturadoCsv(seller());
    expect(facturado).toContain('Facturado por él kg');
    expect(facturado).toContain('CLIENTE UNO');
    const leak = buildSellerLeakCsv(
      seller({
        clients: [
          client({
            otherSellerKg: 40,
            otherSellerNames: ['JUILIARD ANGULO'],
            otherSellers: [{ code: '031', name: 'JUILIARD ANGULO', internal: false }],
            otherSellerExternalKg: 40,
            otherSellerInternalKg: 0,
          }),
        ],
      }),
    );
    expect(leak).toContain('Otros vendedores');
    expect(leak).toContain('JUILIARD ANGULO');
  });
});

describe('facturación del vendedor', () => {
  it('usa el bloque billing del API y lo deriva si falta', () => {
    const withBilling = seller({
      billing: {
        facturadoKg: 80,
        facturadoOwnPortfolioKg: 60,
        facturadoOutsideKg: 20,
        carteraKg: 100,
        carteraByOthersKg: 40,
        carteraByOthersExternalKg: 40,
        carteraByOthersInternalKg: 0,
        carteraByOthersPct: 40,
        facturadoClients: 2,
        leakedClients: 1,
        internalClients: 0,
      },
    });
    expect(sellerBilling(withBilling).carteraByOthersKg).toBe(40);

    const legacy = seller({ noteCurrentKg: 80, carteraCurrentKg: 100, otherSellerKg: 40 });
    delete (legacy as { billing?: unknown }).billing;
    const derived = sellerBilling(legacy);
    expect(derived.facturadoKg).toBe(80);
    expect(derived.carteraByOthersKg).toBe(40);
    expect(derived.facturadoOwnPortfolioKg).toBe(60);
  });

  it('lista los clientes de la cartera facturados por otros y los ordena', () => {
    const rows = clientsBilledByOthers(
      seller({
        clients: [
          client({ clientCode: 'C1', otherSellerKg: 10, otherSellerExternalKg: 10 }),
          client({ clientCode: 'C2', clientName: 'CLIENTE DOS', otherSellerKg: 50, otherSellerExternalKg: 50 }),
          client({ clientCode: 'C3', clientName: 'CLIENTE TRES', otherSellerKg: 0 }),
        ],
      }),
    );
    expect(rows.map((row) => row.clientCode)).toEqual(['C2', 'C1']);
  });

  it('calcula porcentajes sin dividir por cero', () => {
    expect(pctOfTotal(25, 100)).toBe(25);
    expect(pctOfTotal(25, 0)).toBeNull();
  });
});

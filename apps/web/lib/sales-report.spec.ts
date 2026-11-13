import { describe, expect, it } from 'vitest';
import type {
  ForecastCustomerSalesResponse,
  ForecastCustomerSalesRow,
  ForecastSalesDayCustomer,
  ForecastSalesResponse,
  ForecastSalesRow,
} from '@nexo/contracts';
import {
  CUSTOMER_SALES_CSV_HEADERS,
  META_MARKER_PCT,
  SALES_CSV_HEADERS,
  buildCumulativeSeries,
  clientsForProduct,
  buildCustomerSalesCsv,
  buildDayBars,
  buildNarrative,
  buildSalesCsv,
  customerSalesCsvFileName,
  dailySalesScale,
  dayLabel,
  dayPendingSharePct,
  filterCustomerSalesRows,
  filterSalesRows,
  fmtPct,
  fmtSignedPct,
  fmtTonnes,
  monthLabel,
  monthOverMonthPct,
  pendingCoveragePct,
  productsForDay,
  salesCsvFileName,
  sharePct,
  salesDaysWithSales,
  salesDeviationGeometry,
  salesGap,
  salesTone,
} from './sales-report';

function row(overrides: Partial<ForecastSalesRow> = {}): ForecastSalesRow {
  return {
    productCode: 'ABAGP13',
    description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
    uom: 'SAC',
    kgPerUom: 40,
    forecastKg: 480_000,
    forecastCapturedKg: 480_000,
    forecastLiveKg: 480_000,
    forecastCapturedAt: '2026-10-01T00:00:00.000Z',
    forecastDriftAt: null,
    actualKg: 300_000,
    actualUnits: 7_500,
    actualSacks: 7_500,
    dailyAvgKg: 12_500,
    projectedKg: 337_500,
    attainmentPct: 62.5,
    projectedAttainmentPct: 70.3,
    gapKg: -142_500,
    requiredDailyKg: 60_000,
    historicalAvgKg: 420_000,
    vsHistoricalPct: -19.6,
    lastInvoiceDate: '2026-10-28',
    history: [],
    ...overrides,
  };
}

function report(overrides: Partial<ForecastSalesResponse> = {}): ForecastSalesResponse {
  return {
    year: 2026,
    month: 10,
    asOf: '2026-10-28',
    basis: 'WORKING',
    status: 'OPEN',
    salesAvailable: true,
    forecastAvailable: true,
    forecastSource: 'LIVE',
    days: {
      inMonth: 31,
      elapsed: 28,
      remaining: 3,
      workingInMonth: 27,
      workingElapsed: 24,
      workingRemaining: 3,
      today: '2026-10-29',
      cut: '2026-10-28',
    },
    totals: {
      forecastKg: 570_000,
      actualKg: 500_000,
      actualUnits: 13_214,
      pendingKg: 0,
      pendingOrders: 0,
      dailyAvgKg: 20_833.3,
      projectedKg: 562_500,
      attainmentPct: 87.7,
      projectedAttainmentPct: 98.7,
      gapKg: -7_500,
      requiredDailyKg: 23_333.3,
      historicalAvgKg: 490_000,
      vsHistoricalPct: 14.8,
      invoiceCount: 72,
      lastInvoiceDate: '2026-10-28',
    },
    daily: [
      { date: '2026-10-27', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, pendingKg: 0, pendingOrders: 0, products: [], cumulativeKg: 480_000, projectedCumulativeKg: 480_000, forecastCumulativeKg: 528_888.9 },
      { date: '2026-10-28', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, pendingKg: 0, pendingOrders: 0, products: [], cumulativeKg: 500_000, projectedCumulativeKg: 500_000, forecastCumulativeKg: 549_999.9 },
      { date: '2026-10-29', actualKg: 80, actualUnits: 2, invoiceCount: 1, pendingKg: 0, pendingOrders: 0, products: [], cumulativeKg: null, projectedCumulativeKg: 520_833.3, forecastCumulativeKg: 571_110.9 },
    ],
    history: [],
    rows: [row()],
    generatedAt: '2026-10-29T16:00:00.000Z',
    ...overrides,
  };
}

describe('salesTone — semáforo', () => {
  it('verde ≥ 100, ámbar 85–99,9, rojo < 85 y sin meta cuando falta el dato', () => {
    expect(salesTone(100)).toBe('good');
    expect(salesTone(120)).toBe('good');
    expect(salesTone(99.9)).toBe('warn');
    expect(salesTone(85)).toBe('warn');
    expect(salesTone(84.9)).toBe('bad');
    expect(salesTone(0)).toBe('bad');
    expect(salesTone(null)).toBe('none');
    expect(salesTone(Number.NaN)).toBe('none');
  });
});

describe('formatos', () => {
  it('porcentaje nulo no se inventa', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(83.685)).toMatch(/83,7/);
  });

  it('toneladas con un decimal', () => {
    expect(fmtTonnes(1_777_482)).toMatch(/1\.777,5/);
    expect(fmtTonnes(null)).toBe('—');
  });

  it('etiquetas de mes y día', () => {
    expect(monthLabel(2026, 10)).toBe('octubre 2026');
    expect(monthLabel(2026, 10, true)).toBe('oct 2026');
    expect(dayLabel('2026-10-28')).toContain('28');
  });

  it('porcentaje con signo explícito', () => {
    expect(fmtSignedPct(314.28)).toMatch(/^\+314,3/);
    expect(fmtSignedPct(-8)).toMatch(/^-8,0/);
    expect(fmtSignedPct(0)).toMatch(/^0,0/);
    expect(fmtSignedPct(null)).toBe('—');
  });
});

describe('variación mes a mes - línea roja', () => {
  it('compara cada mes contra el anterior e ignora el primero', () => {
    expect(monthOverMonthPct([20_000, 100_000, 70_000, 290_000])).toEqual([null, 400, -30, 314.3]);
  });

  it('no inventa variación cuando el mes previo no vendió', () => {
    // Un mes que cayó a 0 sí es -100 %: el que no tiene base es el siguiente.
    expect(monthOverMonthPct([0, 50_000, 0, 10_000])).toEqual([null, null, -100, null]);
  });

  it('incluye el mes en curso con su venta parcial', () => {
    // El último punto es el mes abierto: se compara igual, sin proyección.
    expect(monthOverMonthPct([10_000, 8_000, 12_000])).toEqual([null, -20, 50]);
  });

  it('tolera huecos y valores no finitos', () => {
    expect(monthOverMonthPct([10_000, null, 30_000, Number.NaN])).toEqual([null, null, null, null]);
    expect(monthOverMonthPct([])).toEqual([]);
  });
});

describe('filtros y orden', () => {
  const rows = [
    row({ productCode: 'ABAGP13', description: 'GALLINA', uom: 'SAC' }),
    row({ productCode: 'ABAKG01', description: 'GRANEL', uom: 'KG', forecastKg: 0, actualKg: 5_000 }),
    row({ productCode: 'ABABOV75', description: 'VACA', uom: 'SAC', forecastKg: 90_000, actualKg: 0 }),
  ];

  it('filtra por presentación, texto y presencia de venta/meta', () => {
    expect(
      filterSalesRows(rows, { unit: 'KG', search: '', onlyWithSales: false, onlyWithForecast: false, onlyWithData: false }),
    ).toHaveLength(1);
    expect(
      filterSalesRows(rows, { unit: 'ALL', search: 'vaca', onlyWithSales: false, onlyWithForecast: false, onlyWithData: false }).map(
        (r) => r.productCode,
      ),
    ).toEqual(['ABABOV75']);
    expect(
      filterSalesRows(rows, { unit: 'ALL', search: '', onlyWithSales: true, onlyWithForecast: false, onlyWithData: false }),
    ).toHaveLength(2);
    expect(
      filterSalesRows(rows, { unit: 'ALL', search: '', onlyWithSales: false, onlyWithForecast: true, onlyWithData: false }),
    ).toHaveLength(2);
  });

  it('«Solo con datos» oculta las filas sin meta, venta ni captura', () => {
    const withEmpty = [
      ...rows,
      row({ productCode: 'VACIO', forecastKg: 0, actualKg: 0, forecastCapturedKg: null, forecastLiveKg: 0 }),
      row({
        productCode: 'CAPTURADO',
        forecastKg: 0,
        actualKg: 0,
        forecastCapturedKg: 90_000,
        forecastLiveKg: 0,
      }),
    ];
    const result = filterSalesRows(withEmpty, {
      unit: 'ALL',
      search: '',
      onlyWithSales: false,
      onlyWithForecast: false,
      onlyWithData: true,
    });
    expect(result.map((r) => r.productCode)).toEqual(['ABAGP13', 'ABAKG01', 'ABABOV75', 'CAPTURADO']);
  });
});

describe('serie acumulada para la gráfica', () => {
  it('mantiene nulls: real se corta y proyección arranca en el corte', () => {
    const series = buildCumulativeSeries(report());
    expect(series.map((point) => point.label)).toEqual(['27', '28', '29']);
    expect(series[0]!.actual).toBe(480_000);
    expect(series[2]!.actual).toBeNull();
    expect(series[2]!.projected).toBeCloseTo(520_833.3, 1);
  });
});

describe('ventas del día — panel bajo la gráfica', () => {
  const data = report({
    rows: [row(), row({ productCode: 'ABAKG01', description: 'GRANEL', uom: 'KG', kgPerUom: null })],
    daily: [
      {
        date: '2026-10-27',
        actualKg: 20_000,
        actualUnits: 500,
        invoiceCount: 3,
        pendingKg: 0,
        pendingOrders: 0,
        products: [
          { productCode: 'ABAKG01', kg: 8_000, units: 8_000 },
          { productCode: 'ABAGP13', kg: 12_000, units: 300 },
        ],
        cumulativeKg: 480_000,
        projectedCumulativeKg: 480_000,
        forecastCumulativeKg: 528_888.9,
      },
      {
        date: '2026-10-28',
        actualKg: 0,
        actualUnits: 0,
        invoiceCount: 0,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: 480_000,
        projectedCumulativeKg: 500_000,
        forecastCumulativeKg: 549_999.9,
      },
      {
        date: '2026-10-29',
        actualKg: 80,
        actualUnits: 2,
        invoiceCount: 1,
        pendingKg: 0,
        pendingOrders: 0,
        products: [{ productCode: 'ABAGP13', kg: 80, units: 2 }],
        cumulativeKg: null,
        projectedCumulativeKg: 520_833.3,
        forecastCumulativeKg: 571_110.9,
      },
    ],
  });

  it('lista solo los días con venta y marca el día parcial', () => {
    const days = salesDaysWithSales(data);
    expect(days.map((day) => day.date)).toEqual(['2026-10-27', '2026-10-29']);
    expect(days[0]!.cumulativeKg).toBe(20_000);
    expect(days[0]!.partial).toBe(false);
    expect(days[1]!.partial).toBe(true);
    expect(days[1]!.cumulativeKg).toBe(20_080);
  });

  it('desglosa el día por producto con descripción, UOM y sacos', () => {
    const products = productsForDay(data, '2026-10-27');
    expect(products.map((line) => line.productCode)).toEqual(['ABAGP13', 'ABAKG01']);
    expect(products[0]).toMatchObject({ description: 'GALLINA PONEDORA PLUS 18% - 40 KG', uom: 'SAC', sacks: 300 });
    expect(products[1]).toMatchObject({ uom: 'KG', sacks: null });
  });

  it('un día sin desglose devuelve una lista vacía', () => {
    expect(productsForDay(data, '2026-10-28')).toEqual([]);
    expect(productsForDay(data, '2026-10-30')).toEqual([]);
  });
});

describe('detalle del día — participación de clientes', () => {
  const customers: ForecastSalesDayCustomer[] = [
    {
      customerCode: 'C1',
      customerName: 'CLIENTE UNO',
      kg: 6_000,
      units: 150,
      sharePct: 66.7,
      products: [
        { productCode: 'A', description: 'PRODUCTO A', uom: 'SAC', kgPerUom: 40, kg: 6_000, units: 150, sacks: 150 },
      ],
    },
    {
      customerCode: 'C2',
      customerName: 'CLIENTE DOS',
      kg: 3_000,
      units: 75,
      sharePct: 33.3,
      products: [
        { productCode: 'B', description: 'PRODUCTO B', uom: 'SAC', kgPerUom: 40, kg: 2_000, units: 50, sacks: 50 },
        { productCode: 'A', description: 'PRODUCTO A', uom: 'SAC', kgPerUom: 40, kg: 1_000, units: 25, sacks: 25 },
      ],
    },
  ];

  it('calcula la participación y tolera la base cero', () => {
    expect(sharePct(6_000, 9_000)).toBe(66.7);
    expect(sharePct(0, 9_000)).toBe(0);
    expect(sharePct(1, 0)).toBeNull();
    expect(sharePct(Number.NaN, 10)).toBeNull();
  });

  it('devuelve los clientes de un producto con su participación', () => {
    const clients = clientsForProduct(customers, 'A');

    expect(clients.map((client) => client.customerCode)).toEqual(['C1', 'C2']);
    expect(clients[0]).toMatchObject({ kg: 6_000, sharePct: 85.7 });
    expect(clients[1]).toMatchObject({ kg: 1_000, sharePct: 14.3 });
  });

  it('un producto sin clientes devuelve una lista vacía', () => {
    expect(clientsForProduct(customers, 'Z')).toEqual([]);
  });
});

describe('barras diarias — tira bajo el acumulado', () => {
  const data = report({
    daily: [
      {
        date: '2026-10-27',
        actualKg: 20_000,
        actualUnits: 500,
        invoiceCount: 3,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: 480_000,
        projectedCumulativeKg: 480_000,
        forecastCumulativeKg: 528_888.9,
      },
      {
        date: '2026-10-28',
        actualKg: 0,
        actualUnits: 0,
        invoiceCount: 0,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: 480_000,
        projectedCumulativeKg: 500_000,
        forecastCumulativeKg: 549_999.9,
      },
      {
        date: '2026-10-29',
        actualKg: 80,
        actualUnits: 2,
        invoiceCount: 1,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: null,
        projectedCumulativeKg: 520_833.3,
        forecastCumulativeKg: 571_110.9,
      },
      {
        date: '2026-10-30',
        actualKg: 0,
        actualUnits: 0,
        invoiceCount: 0,
        pendingKg: 0,
        pendingOrders: 0,
        products: [],
        cumulativeKg: null,
        projectedCumulativeKg: null,
        forecastCumulativeKg: 571_110.9,
      },
    ],
  });

  it('incluye todos los días y distingue corte, hoy y futuro', () => {
    const bars = buildDayBars(data);

    expect(bars.map((bar) => bar.dayNumber)).toEqual([27, 28, 29, 30]);
    expect(bars[0]).toMatchObject({ kg: 20_000, partial: false, future: false, isToday: false });
    expect(bars[1]).toMatchObject({ kg: 0, partial: false, future: false });
    expect(bars[2]).toMatchObject({ kg: 80, partial: true, future: false, isToday: true });
    expect(bars[3]).toMatchObject({ kg: 0, partial: false, future: true, isToday: false });
  });

  it('en un mes cerrado no quedan días parciales ni futuros', () => {
    const closed = report({
      asOf: '2026-10-31',
      status: 'CLOSED',
      days: {
        ...data.days,
        cut: '2026-10-31',
        today: '2026-11-03',
        elapsed: 31,
        remaining: 0,
      },
    });

    const bars = buildDayBars(closed);
    expect(bars.every((bar) => !bar.partial && !bar.future)).toBe(true);
  });

  it('la escala incluye la meta diaria y deja aire para el día más alto', () => {
    const scale = dailySalesScale(data, buildDayBars(data));

    expect(scale.goalKg).toBeCloseTo(570_000 / 27, 1);
    expect(scale.maxKg).toBe(25_000);
  });

  it('sin meta solo mide la venta real', () => {
    const noMeta = report({ totals: { ...data.totals, forecastKg: 0 } });
    const scale = dailySalesScale(noMeta, buildDayBars(noMeta));

    expect(scale.goalKg).toBeNull();
    expect(scale.maxKg).toBe(25_000);
  });

  it('apila en cada día los kg comprometidos en pedidos pendientes', () => {
    const withPending = report({
      daily: data.daily.map((day, index) => ({
        ...day,
        pendingKg: index === 0 ? 10_000 : index === 2 ? 5_000 : 0,
        pendingOrders: index === 0 ? 2 : index === 2 ? 1 : 0,
      })),
      totals: { ...data.totals, pendingKg: 15_000, pendingOrders: 3 },
    });

    const bars = buildDayBars(withPending);

    expect(bars[0]).toMatchObject({ pendingKg: 10_000, pendingOrders: 2 });
    expect(bars[1]).toMatchObject({ pendingKg: 0, pendingOrders: 0 });
    expect(pendingCoveragePct(withPending)).toBeCloseTo((15_000 / 570_000) * 100, 1);
    expect(dayPendingSharePct(bars[2]!)).toBeCloseTo((5_000 / 5_080) * 100, 1);
    // La barra apilada (real + pronóstico) manda en la escala.
    expect(dailySalesScale(withPending, bars).maxKg).toBe(40_000);
  });

  it('sin meta, los porcentajes de pedidos pendientes no se inventan', () => {
    expect(pendingCoveragePct(report({ totals: { ...data.totals, forecastKg: 0 } }))).toBeNull();
    expect(dayPendingSharePct(buildDayBars(data)[1]!)).toBeNull();
  });

  it('sin días ni meta la pista no queda en cero', () => {
    const empty = report({ daily: [], totals: { ...data.totals, forecastKg: 0 } });

    expect(dailySalesScale(empty, [])).toEqual({ maxKg: 1, goalKg: null });
  });
});

// ============================================================
// Brecha del mes y del día.
// ============================================================

describe('brecha del mes y del día', () => {
  it('el mes mide la venta acumulada y el día el ritmo necesario menos la venta de hoy', () => {
    const gap = salesGap(report());

    expect(gap.monthGapKg).toBe(-70_000);
    expect(gap.monthPct).toBe(87.7);
    expect(gap.dayGoalKg).toBeCloseTo(23_333.3, 1);
    expect(gap.todayKg).toBe(80);
    expect(gap.dayGapKg).toBeCloseTo(23_253.3, 1);
    expect(gap.dayPct).toBeCloseTo(0.3, 1);
  });

  it('si hoy ya superó el ritmo necesario el faltante queda negativo', () => {
    const data = report();
    const gap = salesGap(
      report({
        daily: data.daily.map((day) => (day.date === '2026-10-29' ? { ...day, actualKg: 30_000 } : day)),
      }),
    );

    expect(gap.todayKg).toBe(30_000);
    expect(gap.dayGapKg).toBeCloseTo(-6_666.7, 1);
    expect(gap.dayPct).toBeCloseTo(128.6, 1);
  });

  it('un mes cerrado no ofrece brecha del día', () => {
    const gap = salesGap(
      report({
        status: 'CLOSED',
        totals: { ...report().totals, requiredDailyKg: null },
        days: { ...report().days, today: '2026-11-03' },
      }),
    );

    expect(gap.monthGapKg).toBe(-70_000);
    expect(gap.dayGoalKg).toBeNull();
    expect(gap.todayKg).toBe(0);
    expect(gap.dayGapKg).toBeNull();
    expect(gap.dayPct).toBeNull();
  });

  it('sin meta no inventa brecha ni porcentajes', () => {
    const gap = salesGap(
      report({
        totals: { ...report().totals, forecastKg: 0, attainmentPct: null, requiredDailyKg: null },
      }),
    );

    expect(gap.monthGapKg).toBeNull();
    expect(gap.monthPct).toBeNull();
    expect(gap.dayGoalKg).toBeNull();
    expect(gap.dayGapKg).toBeNull();
    expect(gap.dayPct).toBeNull();
  });

  it('con la meta del mes ya cubierta el día cuenta como cumplido', () => {
    const gap = salesGap(report({ totals: { ...report().totals, requiredDailyKg: 0 } }));

    expect(gap.dayGoalKg).toBe(0);
    expect(gap.dayGapKg).toBe(-80);
    expect(gap.dayPct).toBe(100);
  });
});

describe('barras de desviación — escala por producto', () => {
  it('el marcador de meta siempre cae en el mismo punto de la pista', () => {
    const base = row({ forecastKg: 480_000, actualKg: 0, projectedKg: 0 });
    const small = salesDeviationGeometry(base);
    const large = salesDeviationGeometry(row({ forecastKg: 90_000, actualKg: 120_000, projectedKg: 150_000 }));
    expect(small.markerPct).toBe(META_MARKER_PCT);
    expect(large.markerPct).toBe(small.markerPct);
  });

  it('100 % de la meta coincide con el marcador', () => {
    const geometry = salesDeviationGeometry(row({ forecastKg: 100_000, actualKg: 100_000, projectedKg: 100_000 }));
    expect(geometry.actualWidthPct).toBeCloseTo(META_MARKER_PCT, 6);
    expect(geometry.projectedWidthPct).toBeCloseTo(META_MARKER_PCT, 6);
    expect(geometry.actualClipped).toBe(false);
  });

  it('proporción lineal por debajo de la meta y sin recorte', () => {
    const geometry = salesDeviationGeometry(row({ forecastKg: 480_000, actualKg: 300_000, projectedKg: 240_000 }));
    expect(geometry.actualPctOfMeta).toBeCloseTo(62.5, 6);
    expect(geometry.actualWidthPct).toBeCloseTo(META_MARKER_PCT * 0.625, 6);
    expect(geometry.projectedWidthPct).toBeCloseTo(META_MARKER_PCT * 0.5, 6);
    expect(geometry.actualClipped).toBe(false);
    expect(geometry.projectedClipped).toBe(false);
  });

  it('pasarse de la meta cruza el marcador y se recorta solo en el borde', () => {
    const passed = salesDeviationGeometry(row({ forecastKg: 100_000, actualKg: 120_000, projectedKg: 130_000 }));
    expect(passed.actualWidthPct).toBeGreaterThan(META_MARKER_PCT);
    expect(passed.projectedWidthPct).toBeGreaterThan(passed.actualWidthPct);
    expect(passed.actualClipped).toBe(false);

    // 143 % de la meta es el tope de la pista con el marcador al 70 %.
    const huge = salesDeviationGeometry(row({ forecastKg: 100_000, actualKg: 200_000, projectedKg: 140_000 }));
    expect(huge.actualWidthPct).toBe(100);
    expect(huge.actualClipped).toBe(true);
    expect(huge.projectedClipped).toBe(false);
  });

  it('sin meta no hay 100 % de referencia: ni barras ni marcador', () => {
    const geometry = salesDeviationGeometry(row({ forecastKg: 0, actualKg: 50_000, projectedKg: 50_000 }));
    expect(geometry.hasMeta).toBe(false);
    expect(geometry.actualWidthPct).toBe(0);
    expect(geometry.projectedWidthPct).toBe(0);
    expect(geometry.actualPctOfMeta).toBeNull();
    expect(geometry.projectedPctOfMeta).toBeNull();
  });

  it('mes futuro (proyección null) mide la venta real', () => {
    const geometry = salesDeviationGeometry(row({ forecastKg: 100_000, actualKg: 25_000, projectedKg: null }));
    expect(geometry.projectedPctOfMeta).toBeCloseTo(25, 6);
    expect(geometry.projectedWidthPct).toBe(geometry.actualWidthPct);
  });

  it('acepta otra posición de marcador', () => {
    const geometry = salesDeviationGeometry(row({ forecastKg: 100_000, actualKg: 100_000, projectedKg: 100_000 }), 50);
    expect(geometry.markerPct).toBe(50);
    expect(geometry.actualWidthPct).toBeCloseTo(50, 6);
  });
});

describe('CSV', () => {
  it('incluye BOM, encabezados, fila de datos y totales', () => {
    const csv = buildSalesCsv(report());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[0]).toBe(SALES_CSV_HEADERS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('ABAGP13,');
    expect(lines[1]).toContain('70.3');
    expect(lines[2]!.startsWith('TOTALES,')).toBe(true);
    // El total no suma sacos con kg: la columna 8 (índice 7) queda vacía.
    expect(lines[2]!.split(',')[7]).toBe('');
  });

  it('escapa comas y comillas en la descripción', () => {
    const csv = buildSalesCsv(report({ rows: [row({ description: 'SACO 40 KG, "ESPECIAL"' })] }));
    expect(csv).toContain('"SACO 40 KG, ""ESPECIAL"""');
  });

  it('nombre de archivo estable por año y mes', () => {
    expect(salesCsvFileName(report())).toBe('ventas-vs-forecast-2026-10.csv');
  });
});

// ============================================================
// Participación por cliente.
// ============================================================

function customerRow(overrides: Partial<ForecastCustomerSalesRow> = {}): ForecastCustomerSalesRow {
  return {
    customerCode: 'C1',
    customerName: 'CLIENTE UNO',
    customerType: 'L1 EXCLUSIVOS',
    vendor: 'VENDEDORA 1',
    actualKg: 230_000,
    actualUnits: 5_750,
    sharePct: 46,
    productCount: 2,
    lastInvoiceDate: '2026-10-27',
    products: [
      {
        productCode: 'ABAGP13',
        description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
        uom: 'SAC',
        kgPerUom: 40,
        kg: 180_000,
        units: 4_500,
        sacks: 4_500,
        shareOfCustomerPct: 78.3,
        shareOfProductPct: 60,
      },
      {
        productCode: 'ABABOV67',
        description: 'MULTIESPECIE LINEA NARANJA SACO 35 KG',
        uom: 'SAC',
        kgPerUom: 35,
        kg: 50_000,
        units: 1_428.6,
        sacks: 1_428.6,
        shareOfCustomerPct: 21.7,
        shareOfProductPct: 25,
      },
    ],
    ...overrides,
  };
}

function customerReport(overrides: Partial<ForecastCustomerSalesResponse> = {}): ForecastCustomerSalesResponse {
  return {
    year: 2026,
    month: 10,
    asOf: '2026-10-28',
    status: 'OPEN',
    salesAvailable: true,
    days: {
      inMonth: 31,
      elapsed: 28,
      remaining: 3,
      workingInMonth: 27,
      workingElapsed: 24,
      workingRemaining: 3,
      today: '2026-10-29',
      cut: '2026-10-28',
    },
    totals: {
      actualKg: 500_000,
      actualUnits: 13_214,
      customerCount: 2,
      activeCustomerCount: 1,
      productCount: 2,
      lastInvoiceDate: '2026-10-28',
    },
    customers: [customerRow()],
    truncated: false,
    generatedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  };
}

describe('filtros de participación por cliente', () => {
  it('busca por código o nombre', () => {
    const rows = [customerRow(), customerRow({ customerCode: 'C2', customerName: 'AGRO INVERSIONES' })];
    expect(filterCustomerSalesRows(rows, { search: 'agro', onlyWithSales: false })).toHaveLength(1);
    expect(filterCustomerSalesRows(rows, { search: 'c1', onlyWithSales: false })).toHaveLength(1);
  });

  it('oculta clientes sin venta con el filtro Con venta', () => {
    const sinVenta = customerRow({ customerCode: 'C0', actualKg: 0, sharePct: 0, productCount: 0, products: [] });
    const rows = [customerRow(), sinVenta];
    expect(filterCustomerSalesRows(rows, { search: '', onlyWithSales: true })).toEqual([customerRow()]);
    expect(filterCustomerSalesRows(rows, { search: '', onlyWithSales: false })).toHaveLength(2);
  });
});

describe('CSV de participación por cliente', () => {
  it('exporta filas de cliente y de producto con BOM', () => {
    const csv = buildCustomerSalesCsv(customerReport());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[0]).toBe(CUSTOMER_SALES_CSV_HEADERS.join(','));
    expect(lines[1]!.startsWith('CLIENTE,C1,')).toBe(true);
    expect(lines[2]!.startsWith('PRODUCTO,C1,')).toBe(true);
    expect(lines.some((line) => line.startsWith('TOTAL,'))).toBe(true);
    expect(lines.some((line) => line.startsWith('SIN ASIGNAR,'))).toBe(false);
  });

  it('nombre de archivo estable por año y mes', () => {
    expect(customerSalesCsvFileName(customerReport())).toBe('participacion-clientes-2026-10.csv');
  });
});

describe('buildNarrative — frase ejecutiva', () => {
  it('resume venta, meta, cierre y brecha con el formato local', () => {
    expect(buildNarrative(report())).toBe(
      'Llevamos 500.000 kg de una meta de 570.000 kg; al ritmo actual cerraríamos en ~562.500 kg (98,7 %), así que faltarían ~7.500 kg.',
    );
  });

  it('cambia «faltarían» por «iríamos por encima» cuando la brecha es positiva', () => {
    const base = report();
    const text = buildNarrative(report({ totals: { ...base.totals, gapKg: 7_500 } }));
    expect(text).toContain('iríamos ~7.500 kg por encima');
  });

  it('mes futuro: informa la meta y que aún no hay entregas', () => {
    const base = report();
    const text = buildNarrative(
      report({ status: 'FUTURE', totals: { ...base.totals, actualKg: 0, projectedKg: null, gapKg: null } }),
    );
    expect(text).toBe('Meta de 570.000 kg para octubre 2026. Todavía no hay entregas.');
  });

  it('sin meta: dice cuánto se lleva vendido y que falta la meta', () => {
    const base = report();
    const text = buildNarrative(
      report({
        totals: { ...base.totals, forecastKg: 0, projectedAttainmentPct: null, gapKg: null },
      }),
    );
    expect(text).toBe('Llevamos 500.000 kg vendidos; Profit no tiene meta cargada para octubre 2026.');
  });
});

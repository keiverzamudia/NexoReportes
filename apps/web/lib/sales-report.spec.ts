import { describe, expect, it } from 'vitest';
import type { ForecastSalesResponse, ForecastSalesRow } from '@nexo/contracts';
import {
  META_MARKER_PCT,
  SALES_CSV_HEADERS,
  buildCumulativeSeries,
  buildDayBars,
  buildNarrative,
  buildSalesCsv,
  dailySalesScale,
  dayLabel,
  filterSalesRows,
  fmtPct,
  fmtTonnes,
  monthLabel,
  productsForDay,
  salesCsvFileName,
  salesDaysWithSales,
  salesDeviationGeometry,
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
      { date: '2026-10-27', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, products: [], cumulativeKg: 480_000, projectedCumulativeKg: 480_000, forecastCumulativeKg: 528_888.9 },
      { date: '2026-10-28', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, products: [], cumulativeKg: 500_000, projectedCumulativeKg: 500_000, forecastCumulativeKg: 549_999.9 },
      { date: '2026-10-29', actualKg: 80, actualUnits: 2, invoiceCount: 1, products: [], cumulativeKg: null, projectedCumulativeKg: 520_833.3, forecastCumulativeKg: 571_110.9 },
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

describe('barras diarias — tira bajo el acumulado', () => {
  const data = report({
    daily: [
      {
        date: '2026-10-27',
        actualKg: 20_000,
        actualUnits: 500,
        invoiceCount: 3,
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

  it('sin días ni meta la pista no queda en cero', () => {
    const empty = report({ daily: [], totals: { ...data.totals, forecastKg: 0 } });

    expect(dailySalesScale(empty, [])).toEqual({ maxKg: 1, goalKg: null });
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

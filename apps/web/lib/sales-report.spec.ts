import { describe, expect, it } from 'vitest';
import type { ForecastSalesResponse, ForecastSalesRow } from '@nexo/contracts';
import {
  SALES_CSV_HEADERS,
  buildCumulativeSeries,
  buildNarrative,
  buildSalesCsv,
  dayLabel,
  filterSalesRows,
  fmtPct,
  fmtTonnes,
  monthLabel,
  salesCsvFileName,
  salesTone,
  topSalesRows,
} from './sales-report';

function row(overrides: Partial<ForecastSalesRow> = {}): ForecastSalesRow {
  return {
    productCode: 'ABAGP13',
    description: 'GALLINA PONEDORA PLUS 18% - 40 KG',
    uom: 'SAC',
    kgPerUom: 40,
    forecastKg: 480_000,
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
      { date: '2026-10-27', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, cumulativeKg: 480_000, projectedCumulativeKg: 480_000, forecastCumulativeKg: 528_888.9 },
      { date: '2026-10-28', actualKg: 20_000, actualUnits: 500, invoiceCount: 3, cumulativeKg: 500_000, projectedCumulativeKg: 500_000, forecastCumulativeKg: 549_999.9 },
      { date: '2026-10-29', actualKg: 80, actualUnits: 2, invoiceCount: 1, cumulativeKg: null, projectedCumulativeKg: 520_833.3, forecastCumulativeKg: 571_110.9 },
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
    expect(filterSalesRows(rows, { unit: 'KG', search: '', onlyWithSales: false, onlyWithForecast: false })).toHaveLength(1);
    expect(
      filterSalesRows(rows, { unit: 'ALL', search: 'vaca', onlyWithSales: false, onlyWithForecast: false }).map((r) => r.productCode),
    ).toEqual(['ABABOV75']);
    expect(filterSalesRows(rows, { unit: 'ALL', search: '', onlyWithSales: true, onlyWithForecast: false })).toHaveLength(2);
    expect(filterSalesRows(rows, { unit: 'ALL', search: '', onlyWithSales: false, onlyWithForecast: true })).toHaveLength(2);
  });

  it('top por meta y descarta filas sin meta ni venta', () => {
    const result = topSalesRows([...rows, row({ productCode: 'VACIO', forecastKg: 0, actualKg: 0 })], 2);
    expect(result.map((r) => r.productCode)).toEqual(['ABAGP13', 'ABABOV75']);
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

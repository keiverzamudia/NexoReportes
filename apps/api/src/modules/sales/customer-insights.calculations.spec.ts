import { describe, expect, it } from 'vitest';
import {
  buildCustomerInsights,
  buildInsightWindows,
  InsightBillingRow,
  InsightVolumeRow,
  monthKey,
} from './customer-insights.calculations';

const NOW = new Date();
const TODAY_KEY = NOW.toISOString().slice(0, 10);

function monthAgo(offset: number): { key: string; year: number; date: string } {
  const date = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - offset, 1));
  return {
    key: date.toISOString().slice(0, 7),
    year: date.getUTCFullYear(),
    date: date.toISOString().slice(0, 10),
  };
}

function row(
  offset: number,
  product: string,
  units: number,
  note: string,
  kgPerUom = 35,
  uom = 'SAC',
): InsightVolumeRow {
  const month = monthAgo(offset);
  return {
    month: month.key,
    year: month.year,
    note,
    productCode: product,
    description: `Producto ${product}`,
    uom,
    kgPerUom,
    units,
    kg: units * kgPerUom,
    date: month.date,
  };
}

function billing(offset: number, billed: number): InsightBillingRow {
  return { month: monthAgo(offset).key, billed, documents: 1, missingRate: 0 };
}

function baseInput() {
  const windows = buildInsightWindows(24, NOW);
  const rows: InsightVolumeRow[] = [
    // A: crece 17,5 t vs 8,75 t.
    ...[0, 2, 4, 6, 8].map((offset) => row(offset, 'A', 100, `A-${offset}`)),
    ...[12, 14, 16, 18, 20].map((offset) => row(offset, 'A', 50, `A-${offset}`)),
    // B: dejó de comprar; antes 7 t.
    ...[12, 14, 16, 18, 20].map((offset) => row(offset, 'B', 40, `B-${offset}`)),
    // C: cae 66,7 % (3,5 t vs 10,5 t).
    ...[1, 3, 5, 7, 9].map((offset) => row(offset, 'C', 20, `C-${offset}`)),
    ...[12, 14, 16, 18, 20].map((offset) => row(offset, 'C', 60, `C-${offset}`)),
    // D: nuevo, 0,7 t.
    ...[0, 1].map((offset) => row(offset, 'D', 10, `D-${offset}`)),
  ];
  const billingRows: InsightBillingRow[] = [
    ...Array.from({ length: 12 }, (_, offset) => billing(offset, 1000)),
    ...Array.from({ length: 12 }, (_, index) => billing(12 + index, 800)),
  ];
  return {
    windows,
    rows,
    billingRows,
    billingAvailable: true,
    billingPartial: false,
    account: {
      saldo: 1000,
      saldoVencido: 500,
      credito: 0,
      limiteCredito: 2000,
      documentos: 2,
      vencidos: 1,
    },
    similar: [
      {
        code: 'Z',
        description: 'Producto Z',
        uom: 'SAC',
        kgPerUom: 35,
        adopters: 20,
        adoptersPct: 40,
        avgTonnes: 2.5,
        totalTonnes: 50,
      },
    ],
    truncated: false,
  };
}

describe('buildInsightWindows', () => {
  it('24 meses separa la ventana actual de los 12 anteriores', () => {
    const windows = buildInsightWindows(24, new Date(Date.UTC(2026, 10, 3)));
    expect(windows.currentFromKey).toBe('2025-12');
    expect(windows.currentToKey).toBe('2026-11');
    expect(windows.previousFromKey).toBe('2024-12');
    expect(windows.previousToKey).toBe('2025-11');
    expect(windows.historyFromKey).toBe('2024-12');
  });

  it('12 meses no define ventana anterior', () => {
    const windows = buildInsightWindows(12, new Date(Date.UTC(2026, 10, 3)));
    expect(windows.currentFromKey).toBe('2025-12');
    expect(windows.previousFromKey).toBeNull();
  });
});

describe('buildCustomerInsights', () => {
  it('agrega volumen, facturación, años y tendencia', () => {
    const result = buildCustomerInsights(baseInput());

    expect(result.totals.sacks).toBe(620);
    expect(result.totals.kg).toBe(21_700);
    expect(result.totals.tonnes).toBe(21.7);
    expect(result.totals.notes).toBe(12);
    expect(result.totals.billed).toBe(12_000);
    expect(result.totals.products).toBe(3);

    expect(result.previousTotals?.sacks).toBe(750);
    expect(result.previousTotals?.kg).toBe(26_250);
    expect(result.previousTotals?.billed).toBe(9_600);
    expect(result.trend.volumePct).toBe(-17.3);
    expect(result.trend.billingPct).toBe(25);

    expect(result.monthly).toHaveLength(24);
    expect(result.annual.length).toBeGreaterThan(0);
  });

  it('marca como null el facturado de un mes sin documentos', () => {
    const input = baseInput();
    const monthWithoutBilling = monthAgo(3).key;
    input.billingRows = input.billingRows.filter((row) => row.month !== monthWithoutBilling);

    const result = buildCustomerInsights(input);

    expect(result.monthly.find((item) => item.month === monthWithoutBilling)?.billed).toBeNull();
    expect(result.monthly.find((item) => item.month === monthAgo(2).key)?.billed).toBe(1000);
    // El total del periodo sí descuenta el mes sin facturación.
    expect(result.totals.billed).toBe(11_000);
  });

  it('clasifica los productos y separa los perdidos', () => {
    const result = buildCustomerInsights(baseInput());
    const byCode = new Map(result.products.map((product) => [product.code, product]));

    expect(byCode.get('A')?.status).toBe('CRECIENDO');
    expect(byCode.get('A')?.sharePct).toBe(80.6);
    expect(byCode.get('B')?.status).toBe('PERDIDO');
    expect(byCode.get('C')?.status).toBe('CAYENDO');
    expect(byCode.get('D')?.status).toBe('NUEVO');
    expect(result.lostProducts.map((product) => product.code)).toEqual(['B']);
    expect(byCode.get('B')?.previous.billed).toBe(2560);
  });

  it('genera el diagnóstico de ataque', () => {
    const result = buildCustomerInsights(baseInput());
    const keys = result.alerts.map((alert) => alert.key);

    expect(keys).toContain('productos-perdidos');
    expect(keys).toContain('producto-caida');
    expect(keys).toContain('cobranza');
    expect(keys).toContain('mix');
    expect(result.alerts.length).toBeLessThanOrEqual(5);
  });

  it('marca el segmento ACTIVO cuando hay compras en la ventana actual', () => {
    const result = buildCustomerInsights(baseInput());
    expect(result.cadence.segment).toBe('ACTIVO');
    expect(result.cadence.daysSinceLastSale).not.toBeNull();
    expect(result.cadence.expectedNextDate).not.toBeNull();
  });

  it('sin facturación no inventa montos', () => {
    const result = buildCustomerInsights({
      ...baseInput(),
      billingAvailable: false,
      billingRows: [],
    });
    expect(result.totals.billed).toBeNull();
    expect(result.previousTotals?.billed).toBeNull();
    expect(result.products.every((product) => product.current.billed === null)).toBe(true);
    expect(result.alerts.some((alert) => alert.key === 'productos-perdidos')).toBe(true);
  });

  it('sin ventas deja el segmento SIN_DATOS', () => {
    const windows = buildInsightWindows(24, NOW);
    const result = buildCustomerInsights({
      windows,
      rows: [],
      billingRows: [],
      billingAvailable: true,
      billingPartial: false,
      account: null,
      similar: [],
      truncated: false,
    });
    expect(result.totals.kg).toBe(0);
    expect(result.cadence.segment).toBe('SIN_DATOS');
    expect(result.cadence.daysSinceLastSale).toBeNull();
  });

  it('la ventana de 12 meses no tiene comparación ni productos perdidos', () => {
    const windows = buildInsightWindows(12, NOW);
    const currentMonth = monthKey(NOW);
    const result = buildCustomerInsights({
      windows,
      rows: [
        {
          month: currentMonth,
          year: NOW.getUTCFullYear(),
          note: 'N1',
          productCode: 'A',
          description: 'A',
          uom: 'SAC',
          kgPerUom: 35,
          units: 10,
          kg: 350,
          date: TODAY_KEY,
        },
      ],
      billingRows: [],
      billingAvailable: true,
      billingPartial: false,
      account: null,
      similar: [],
      truncated: false,
    });
    expect(result.previousTotals).toBeNull();
    expect(result.lostProducts).toHaveLength(0);
  });
});

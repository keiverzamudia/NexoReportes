import { describe, expect, it } from 'vitest';
import * as echarts from 'echarts';
import { buildCoverageRows, coverageChartHeight, type CoverageProduct } from './coverage';

// ============================================================
// Pruebas de las filas de «Cobertura por producto».
//
// La regresión original: con 12 productos y el gráfico fijo en 220 px,
// ECharts ocultaba etiquetas alternas del eje Y. La altura ahora se calcula
// por filas y la página fuerza `axisLabel.interval: 0`.
// ============================================================

function product(code: string, demandKg: number, extra: Partial<CoverageProduct> = {}): CoverageProduct {
  return {
    code,
    description: `Producto ${code}`,
    stockUnits: 0,
    demandUnits: 10,
    demandKg,
    ...extra,
  };
}

describe('buildCoverageRows', () => {
  it('conserva el top 12 y agrega el resto en «Otros» sin perder kg', () => {
    const products = Array.from({ length: 15 }, (_, index) => product(`P${String(index + 1).padStart(2, '0')}`, (15 - index) * 100));
    const data = buildCoverageRows(products, []);

    expect(data.totalProducts).toBe(15);
    expect(data.omittedProducts).toBe(3);
    expect(data.rows).toHaveLength(13);
    expect(data.rows.some((row) => row.code === 'Otros (3)')).toBe(true);

    const chartedKg = data.rows.reduce((sum, row) => sum + row.totalKg, 0);
    const demandKg = products.reduce((sum, item) => sum + item.demandKg, 0);
    expect(chartedKg).toBe(demandKg);
  });

  it('expone el detalle de «Otros» para abrir el modal', () => {
    const products = Array.from({ length: 15 }, (_, index) => product(`P${String(index + 1).padStart(2, '0')}`, (15 - index) * 100));
    const data = buildCoverageRows(products, []);
    const others = data.rows.find((row) => row.kind === 'others');

    expect(others).toBeDefined();
    expect(data.rows.filter((row) => row.kind === 'others')).toHaveLength(1);
    // Los 3 de menor volumen, en orden descendente y sin la fila agregada.
    expect(data.omitted.map((row) => row.code)).toEqual(['P13', 'P14', 'P15']);
    expect(data.omitted).toHaveLength(data.omittedProducts);
    expect(data.omitted.every((row) => row.kind === 'product')).toBe(true);

    // El detalle suma exactamente lo que pinta la barra «Otros».
    for (const key of ['committedKg', 'availableKg', 'missingKg', 'totalKg'] as const) {
      const detail = data.omitted.reduce((sum, row) => sum + row[key], 0);
      expect(detail).toBe(others?.[key]);
    }
  });

  it('sin productos fuera del top no hay fila «Otros» ni detalle', () => {
    const data = buildCoverageRows([product('SOLO', 100)], []);
    expect(data.omitted).toEqual([]);
    expect(data.omittedProducts).toBe(0);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.kind).toBe('product');
  });

  it('nunca deja una etiqueta vacía', () => {
    const data = buildCoverageRows([{ ...product('', 50), code: '   ', description: '' }], []);
    expect(data.rows[0]?.code).toBe('S/C');
  });

  it('pinta el mayor arriba (el índice 0 del eje Y queda abajo)', () => {
    const data = buildCoverageRows([product('SMALL', 10), product('BIG', 100)], []);
    expect(data.rows[data.rows.length - 1]?.code).toBe('BIG');
  });

  it('resume productos suficientes, parciales y sin existencia', () => {
    const data = buildCoverageRows(
      [
        product('FULL', 100, { stockUnits: 10 }),
        product('PART', 100, { stockUnits: 4 }),
        product('NONE', 100, { stockUnits: 0 }),
      ],
      [],
    );
    expect(data.summary).toEqual({ sufficient: 1, partial: 1, none: 1 });
  });

  it('descuenta lo ya comprometido de la existencia libre', () => {
    const data = buildCoverageRows(
      [product('ABAPOR77', 1000, { stockUnits: 10, demandUnits: 10 })],
      [{ code: 'ABAPOR77', units: 4, pending: 4 }],
    );
    expect(data.rows[0]?.committedKg).toBe(400);
    expect(data.rows[0]?.availableKg).toBe(600);
    expect(data.rows[0]?.missingKg).toBe(0);
    expect(data.rows[0]?.coveragePct).toBe(100);
  });
});

describe('coverageChartHeight', () => {
  it('crece con las filas para que ECharts no oculte etiquetas', () => {
    expect(coverageChartHeight(2)).toBe(220);
    expect(coverageChartHeight(12)).toBe(320);
    expect(coverageChartHeight(13)).toBe(342);
    expect(coverageChartHeight(13)).toBeGreaterThan(13 * 20);
  });

  it('renderiza los 12 códigos con la altura calculada (regresión)', () => {
    const codes = Array.from({ length: 12 }, (_, index) => `ABAGP${String(index + 1).padStart(2, '0')}`);
    const chart = echarts.init(null, undefined, {
      renderer: 'svg',
      ssr: true,
      width: 520,
      height: coverageChartHeight(codes.length),
    });
    chart.setOption({
      animation: false,
      grid: { left: 4, right: 52, top: 8, bottom: 44, containLabel: true },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: codes, axisLabel: { fontSize: 11, fontFamily: 'monospace', interval: 0 } },
      series: [{ type: 'bar', data: codes.map(() => 10) }],
    });
    const svg = chart.renderToSVGString();
    chart.dispose();

    for (const code of codes) expect(svg).toContain(`>${code}<`);
  });
});

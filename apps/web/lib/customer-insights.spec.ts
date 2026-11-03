import { describe, expect, it } from 'vitest';
import type { CustomerInsightProduct } from '@nexo/contracts';
import {
  PRODUCT_STATUS_META,
  buildProductsCsv,
  formatSignedPct,
  formatTonnesValue,
  monthLabel,
  periodLabel,
  productsCsvFileName,
  topProducts,
} from './customer-insights';

function product(overrides: Partial<CustomerInsightProduct> = {}): CustomerInsightProduct {
  return {
    code: 'A',
    description: 'Producto A',
    uom: 'SAC',
    kgPerUom: 35,
    status: 'ESTABLE',
    sharePct: 50,
    deltaPct: 10,
    current: {
      sacks: 10,
      kg: 350,
      tonnes: 0.35,
      notes: 1,
      billed: 100,
      lastSaleDate: '2026-10-01',
    },
    previous: {
      sacks: 8,
      kg: 280,
      tonnes: 0.28,
      notes: 1,
      billed: 80,
      lastSaleDate: '2025-10-01',
    },
    ...overrides,
  };
}

describe('customer-insights lib', () => {
  it('etiqueta los estados de producto', () => {
    expect(PRODUCT_STATUS_META.PERDIDO.label).toBe('Perdido');
    expect(PRODUCT_STATUS_META.CAYENDO.tone).toBe('warning');
  });

  it('formatea meses y periodos', () => {
    expect(monthLabel('2026-01')).toBe('ene 26');
    expect(periodLabel('2025-12-01', '2026-11-03')).toBe('dic 2025 – nov 2026');
  });

  it('formatea toneladas y porcentajes con signo', () => {
    expect(formatTonnesValue(12.34)).toBe('12,3 t');
    expect(formatTonnesValue(null)).toBe('—');
    expect(formatSignedPct(12.34)).toBe('+12,3 %');
    expect(formatSignedPct(-5)).toBe('-5,0 %');
    expect(formatSignedPct(null)).toBe('—');
  });

  it('genera el CSV con encabezados y escape de comillas', () => {
    const csv = buildProductsCsv('USD', [product({ description: 'Saco "premium"' })]);
    expect(csv).toContain('"Código","Producto","Estado"');
    expect(csv).toContain('"Saco ""premium"""');
    expect(csv).toContain('"Estable"');
    expect(csv).toContain('"2026-10-01"');
  });

  it('nombre de archivo incluye cliente y ventana', () => {
    expect(productsCsvFileName('C1', 24)).toBe('clientes-C1-productos-24m.csv');
  });

  it('ordena los productos principales por volumen actual', () => {
    const rows = [
      product({ code: 'A', current: { ...product().current, kg: 100 } }),
      product({ code: 'B', current: { ...product().current, kg: 300 } }),
      product({ code: 'C', current: { ...product().current, kg: 200 } }),
    ];
    expect(topProducts(rows, 2).map((row) => row.code)).toEqual(['B', 'C']);
  });
});

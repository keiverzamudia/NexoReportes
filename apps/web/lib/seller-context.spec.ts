import { describe, expect, it } from 'vitest';
import type { ForecastSellerClientDetailResponse, ForecastSellerNoteRow } from '@nexo/contracts';
import {
  contextSummary,
  contextViewLabel,
  noteInView,
  notesInView,
  productInView,
  sellerPathCode,
} from './seller-context';

function note(overrides: Partial<ForecastSellerNoteRow> = {}): ForecastSellerNoteRow {
  return {
    number: 'N1',
    date: '2025-03-03',
    kg: 40,
    units: 40,
    lines: 1,
    noteSellerCode: '012',
    noteSellerName: 'LIZ PEREZ',
    portfolioSellerCode: '012',
    portfolioSellerName: 'LIZ PEREZ',
    noteSellerInternal: false,
    ...overrides,
  };
}

const CONTEXT = { sellerCode: '012', view: 'cartera' as const };

describe('contexto del expediente de vendedor', () => {
  it('usa un centinela en la ruta cuando no hay vendedor asignado', () => {
    expect(sellerPathCode('')).toBe('__sin_vendedor__');
    expect(sellerPathCode('012')).toBe('012');
    expect(contextViewLabel('otros')).toBe('Facturado por otros');
  });

  it('separa las notas por vista con los dos vendedores de cada nota', () => {
    const own = note({ number: 'N1' });
    const other = note({ number: 'N2', noteSellerCode: '025', noteSellerName: 'MEIDY ARIAS' });
    const outside = note({
      number: 'N3',
      portfolioSellerCode: '030',
      portfolioSellerName: 'OTRO',
    });

    expect(noteInView(own, CONTEXT)).toBe(true);
    expect(noteInView(other, CONTEXT)).toBe(true);
    expect(noteInView(outside, CONTEXT)).toBe(false);

    expect(noteInView(other, { sellerCode: '012', view: 'facturado' })).toBe(false);
    expect(noteInView(other, { sellerCode: '012', view: 'otros' })).toBe(true);
    expect(noteInView(own, { sellerCode: '012', view: 'otros' })).toBe(false);
  });

  it('ordena las notas de la vista por fecha descendente', () => {
    const rows = notesInView(
      [
        note({ number: 'N1', date: '2025-03-03' }),
        note({ number: 'N2', date: '2025-03-05' }),
        note({ number: 'N3', date: '2025-03-04', noteSellerCode: '025' }),
      ],
      CONTEXT,
    );
    expect(rows.map((row) => row.number)).toEqual(['N2', 'N3', 'N1']);
  });

  it('resuelve los totales de la vista sin recalcular la regla del API', () => {
    const data = {
      totals: {
        allKg: 75,
        allNotes: 4,
        ownKg: 50,
        ownNotes: 2,
        otherKg: 25,
        otherNotes: 2,
        otherExternalKg: 20,
        otherInternalKg: 5,
        lastInvoiceDate: '2025-03-06',
      },
    } as unknown as ForecastSellerClientDetailResponse;

    expect(contextSummary(data, 'facturado')).toMatchObject({ viewKg: 50, viewNotes: 2 });
    expect(contextSummary(data, 'cartera')).toMatchObject({ viewKg: 75, viewNotes: 4 });
    expect(contextSummary(data, 'otros')).toMatchObject({ viewKg: 25, viewNotes: 2 });
  });

  it('elige el tramo del producto según la vista', () => {
    const product = {
      productCode: 'P1',
      description: 'PRODUCTO UNO',
      uom: 'KG',
      kg: 65,
      notes: 3,
      ownKg: 40,
      ownNotes: 1,
      otherKg: 25,
      otherNotes: 2,
    };
    expect(productInView(product, 'facturado')).toEqual({ kg: 40, notes: 1 });
    expect(productInView(product, 'cartera')).toEqual({ kg: 65, notes: 3 });
    expect(productInView(product, 'otros')).toEqual({ kg: 25, notes: 2 });
  });
});

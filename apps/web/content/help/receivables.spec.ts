import { describe, expect, it } from 'vitest';
import {
  RECEIVABLES_COLUMN_HELP,
  RECEIVABLES_HELP_RULES,
  RECEIVABLES_HELP_TERMS,
} from './receivables';

// Columnas del resumen y del detalle de CxC que deben tener explicación.
const KEYS = [
  'cliente',
  'vendedor',
  'tipo',
  'zona',
  'cartera',
  'aFavor',
  'neto',
  'porVencer',
  'd1_30',
  'd31_60',
  'd61_90',
  'd91_120',
  'd121_150',
  'd150Desde2025',
  'd150Hasta2025',
  'vencido',
  'pctVencido',
  'documentos',
  'ultimoPago',
  'cobrado90',
  'cobrado12m',
  'pctCobranzaATiempo',
  'limite',
  'dias',
  'tramo',
  'montoOriginal',
  'tipoDoc',
  'nroDoc',
  'emision',
  'vencimiento',
];

describe('ayuda de Cuentas por cobrar', () => {
  it('cubre todas las columnas de la pantalla', () => {
    expect(Object.keys(RECEIVABLES_COLUMN_HELP).sort()).toEqual([...KEYS].sort());
  });

  it('cada término tiene id estable, título y explicación', () => {
    const ids = new Set<string>();
    for (const term of RECEIVABLES_HELP_TERMS) {
      expect(term.id).toBeTruthy();
      expect(term.title).toBeTruthy();
      expect(term.short.length).toBeGreaterThan(0);
      expect(term.short.length).toBeLessThanOrEqual(60);
      expect(term.what).toBeTruthy();
      expect(ids.has(term.id)).toBe(false);
      ids.add(term.id);
    }
  });

  it('las fórmulas son legibles, no SQL', () => {
    for (const term of RECEIVABLES_HELP_TERMS) {
      if (!term.formula) continue;
      const upper = term.formula.toUpperCase();
      expect(upper).not.toContain('SELECT');
      expect(upper).not.toContain('JOIN');
      expect(upper).not.toContain('WHERE');
    }
  });

  it('explica la separación entre deuda y saldo a favor', () => {
    expect(RECEIVABLES_HELP_RULES.length).toBeGreaterThanOrEqual(3);
    const rules = RECEIVABLES_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('débito');
    expect(rules).toContain('a favor');
    expect(rules).toContain('tasa');
    expect(rules).toContain('1–30');
    expect(rules).toContain('12 meses');
    expect(rules).toContain('a tiempo');
  });
});

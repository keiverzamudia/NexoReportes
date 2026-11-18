import { describe, expect, it } from 'vitest';
import { DISPO_COLUMN_HELP, DISPO_HELP_RULES, DISPO_HELP_TERMS } from './disponibilidad';

const EXPECTED = [
  'codigo',
  'descripcion',
  'unid',
  'stockPtp',
  'stock03',
  'stock9999',
  'stock68',
  'existencia',
  'stockDias',
  'solicitado',
  'despachable',
  'neto',
  'aProducir',
  'aProducirKg',
  'estado',
];

describe('ayuda de Disponibilidad por Producto', () => {
  it('cubre exactamente las columnas de la tabla', () => {
    expect(Object.keys(DISPO_COLUMN_HELP).sort()).toEqual([...EXPECTED].sort());
  });

  it('cada término explica en lenguaje llano y trae fórmula legible', () => {
    for (const term of DISPO_HELP_TERMS) {
      expect(term.what.length).toBeGreaterThan(15);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.formula).toBeTruthy();
      expect(term.formula!.toUpperCase()).not.toContain('SELECT');
    }
  });

  it('las reglas explican los almacenes y el cálculo de Stock/día', () => {
    const rules = DISPO_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('ptp');
    expect(rules).toContain('notas de entrega');
    expect(rules).toContain('90 días');
  });
});

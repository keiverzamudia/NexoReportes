import { describe, expect, it } from 'vitest';
import {
  SELLER_CLIENT_COLUMN_HELP,
  SELLER_COLUMN_HELP,
  SELLERS_HELP_RULES,
  SELLERS_HELP_TERMS,
} from './sellers';

// Columnas de las tablas de Vendedoras vs Forecast (mismo orden que la UI).
const SELLER_KEYS = [
  'vendedora',
  'clientes',
  'cuota',
  'meta',
  'venta',
  'cumplimiento',
  'proyeccion',
  'brecha',
  'ritmo',
  'reparto',
  'ultimaNota',
];

const CLIENT_KEYS = [
  'cliente',
  'metaCliente',
  'ventaCliente',
  'cumplimientoCliente',
  'proyeccionCliente',
  'brechaCliente',
];

describe('ayuda de Vendedoras vs Forecast', () => {
  it('cubre exactamente las columnas de la tabla de vendedoras', () => {
    expect(Object.keys(SELLER_COLUMN_HELP).sort()).toEqual([...SELLER_KEYS].sort());
  });

  it('cubre exactamente las columnas de la tabla de clientes', () => {
    expect(Object.keys(SELLER_CLIENT_COLUMN_HELP).sort()).toEqual([...CLIENT_KEYS].sort());
  });

  it('cada entrada explica la columna sin repetir el texto corto', () => {
    for (const term of SELLERS_HELP_TERMS) {
      expect(term.id.trim().length).toBeGreaterThan(0);
      expect(term.title.trim().length).toBeGreaterThan(2);
      expect(term.what.trim().length).toBeGreaterThan(15);
      expect(term.short.trim().length).toBeGreaterThan(4);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.what).not.toBe(term.short);
    }
  });

  it('los identificadores no se repiten entre las dos tablas', () => {
    const ids = SELLERS_HELP_TERMS.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('las fórmulas son legibles, no SQL', () => {
    for (const term of SELLERS_HELP_TERMS) {
      if (!term.formula) continue;
      const upper = term.formula.toUpperCase();
      expect(upper).not.toContain('SELECT');
      expect(upper).not.toContain('JOIN');
      expect(upper).not.toContain('WHERE');
    }
  });

  it('siempre hay reglas transversales con la fuente y la cuota', () => {
    expect(SELLERS_HELP_RULES.length).toBeGreaterThanOrEqual(3);
    const rules = SELLERS_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('nota de entrega');
    expect(rules).toContain('aba');
    expect(rules).toContain('cuota');
    expect(rules).toContain('participación');
  });
});

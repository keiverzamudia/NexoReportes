import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_SALES_COLUMN_HELP,
  CUSTOMER_SALES_HELP_TERMS,
  SALES_COLUMN_HELP,
  SALES_CUSTOMER_HELP_RULES,
  SALES_HELP_RULES,
  SALES_HELP_TERMS,
} from './forecast';

// Columnas de la tabla «Ventas vs Forecast» (mismo orden que `SalesReport`).
const EXPECTED_KEYS = [
  'codigo',
  'descripcion',
  'semaforo',
  'uom',
  'forecast',
  'ventaKg',
  'sacos',
  'avance',
  'promedio',
  'proyeccion',
  'proyectadoPct',
  'ritmo',
  'historico',
  'vsHistorico',
  'ultimaFactura',
];

describe('ayuda de Ventas vs Forecast', () => {
  it('cubre exactamente las columnas de la tabla', () => {
    expect(Object.keys(SALES_COLUMN_HELP).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('cada entrada explica la columna sin repetir el texto corto', () => {
    for (const term of SALES_HELP_TERMS) {
      expect(term.id.trim().length).toBeGreaterThan(0);
      expect(term.title.trim().length).toBeGreaterThan(2);
      expect(term.what.trim().length).toBeGreaterThan(15);
      expect(term.short.trim().length).toBeGreaterThan(4);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.what).not.toBe(term.short);
    }
  });

  it('los identificadores no se repiten', () => {
    const ids = SALES_HELP_TERMS.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('las fórmulas son legibles, no SQL', () => {
    for (const term of SALES_HELP_TERMS) {
      if (!term.formula) continue;
      const upper = term.formula.toUpperCase();
      expect(upper).not.toContain('SELECT');
      expect(upper).not.toContain('JOIN');
      expect(upper).not.toContain('WHERE');
    }
  });

  it('siempre hay reglas transversales para el cajón de ayuda', () => {
    expect(SALES_HELP_RULES.length).toBeGreaterThanOrEqual(3);
    const rules = SALES_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('nota de entrega');
    expect(rules).toContain('aba');
  });

  it('cubre las columnas de la desviación por cliente', () => {
    const expected = [
      'codigo',
      'cliente',
      'tipo',
      'venta',
      'participacion',
      'productos',
      'ultimaFactura',
    ];
    expect(Object.keys(CUSTOMER_SALES_COLUMN_HELP).sort()).toEqual([...expected].sort());
    for (const term of CUSTOMER_SALES_HELP_TERMS) {
      expect(term.id.trim().length).toBeGreaterThan(0);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.what.trim().length).toBeGreaterThan(15);
    }
  });

  it('explica que la participación se mide contra la venta real, no contra una meta', () => {
    const rules = SALES_CUSTOMER_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('venta aba del mes');
    expect(rules).toContain('no una meta ni un histórico');
    expect(rules).toContain('participación del cliente');
  });
});

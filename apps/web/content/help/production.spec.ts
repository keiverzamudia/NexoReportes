import { describe, expect, it } from 'vitest';
import {
  PROD_FORMULA_HELP,
  PROD_MATERIAL_HELP,
  PROD_NUTRITION_HELP,
  PROD_PLAN_HELP,
  PROD_SCENARIO_HELP,
  PROD_SELECTION_HELP,
  PROD_SUMMARY_HELP,
  PROD_TAB_HELP,
} from './production';

const PLAN_KEYS = [
  'forecast',
  'sold',
  'orders',
  'remaining',
  'stock',
  'safety',
  'demand',
  'required',
  'sacks',
  'batches',
  'formula',
  'cost',
  'totalCost',
  'status',
  'production',
  'overproduction',
];

const MATERIAL_KEYS = [
  'type',
  'required',
  'stock',
  'incoming',
  'purchase',
  'unitCost',
  'purchaseCost',
  'coverage',
  'supplier',
];

const FORMULA_KEYS = [
  'formula',
  'batch',
  'costKg',
  'costSack',
  'replacement',
  'count',
  'packaging',
  'alerts',
];
const SELECTION_KEYS = ['pending', 'stock', 'coverage', 'dispatch', 'risk'];
const NUTRITION_KEYS = ['coverage', 'status', 'nutrient'];
const SUMMARY_KEYS = ['forecast', 'sold', 'orders', 'demand', 'production', 'overproduction', 'cost', 'materials', 'riskLines'];
const SCENARIO_KEYS = ['scenario'];
const TAB_KEYS = ['summary', 'plan', 'selection', 'explosion', 'formulas', 'nutrition', 'scenarios'];

describe('ayuda de Producción', () => {
  it('cubre exactamente las columnas y conceptos del módulo', () => {
    expect(Object.keys(PROD_PLAN_HELP).sort()).toEqual([...PLAN_KEYS].sort());
    expect(Object.keys(PROD_MATERIAL_HELP).sort()).toEqual([...MATERIAL_KEYS].sort());
    expect(Object.keys(PROD_FORMULA_HELP).sort()).toEqual([...FORMULA_KEYS].sort());
    expect(Object.keys(PROD_SELECTION_HELP).sort()).toEqual([...SELECTION_KEYS].sort());
    expect(Object.keys(PROD_NUTRITION_HELP).sort()).toEqual([...NUTRITION_KEYS].sort());
    expect(Object.keys(PROD_SUMMARY_HELP).sort()).toEqual([...SUMMARY_KEYS].sort());
    expect(Object.keys(PROD_SCENARIO_HELP).sort()).toEqual([...SCENARIO_KEYS].sort());
  });

  it('cada término explica en lenguaje llano y trae fórmula legible', () => {
    for (const term of Object.values(PROD_TAB_HELP).flatMap((tab) => tab.terms)) {
      expect(term.what.length).toBeGreaterThan(15);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.formula).toBeTruthy();
      expect(term.formula!.toUpperCase()).not.toContain('SELECT');
    }
  });

  it('cada pestaña tiene su propia ayuda y no repite identificadores', () => {
    expect(Object.keys(PROD_TAB_HELP).sort()).toEqual([...TAB_KEYS].sort());
    for (const tab of Object.values(PROD_TAB_HELP)) {
      const ids = tab.terms.map((term) => term.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(tab.title.length).toBeGreaterThan(5);
      expect(tab.narrative.length).toBeGreaterThan(20);
      expect(tab.rules.length).toBeGreaterThan(0);
    }
  });

  it('las reglas clave hablan de Profit, lotes y riesgo', () => {
    const rules = Object.values(PROD_TAB_HELP)
      .flatMap((tab) => tab.rules)
      .join(' ')
      .toLowerCase();
    expect(rules).toContain('profit');
    expect(rules).toContain('lotes');
    expect(rules).toContain('riesgo');
  });
});

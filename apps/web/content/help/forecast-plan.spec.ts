import { describe, expect, it } from 'vitest';
import { CONTROL_COLUMN_HELP, CONTROL_HELP_RULES, CONTROL_HELP_TERMS } from './forecast-plan';

const EXPECTED = ['codigo', 'descripcion', 'forecast', 'solicitado', 'ventas', 'difVenta', 'difCobertura'];

describe('ayuda de Reporte → Control', () => {
  it('cubre exactamente las columnas de la tabla', () => {
    expect(Object.keys(CONTROL_COLUMN_HELP).sort()).toEqual([...EXPECTED].sort());
  });

  it('cada término explica y trae fórmula legible', () => {
    for (const term of CONTROL_HELP_TERMS) {
      expect(term.what.length).toBeGreaterThan(15);
      expect(term.short.length).toBeLessThanOrEqual(40);
      expect(term.formula).toBeTruthy();
      expect(term.formula!.toUpperCase()).not.toContain('SELECT');
    }
  });

  it('las reglas explican el signo y la fuente de venta', () => {
    const rules = CONTROL_HELP_RULES.join(' ').toLowerCase();
    expect(rules).toContain('positivo');
    expect(rules).toContain('notas de entrega');
  });
});

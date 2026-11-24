import { describe, expect, it } from 'vitest';
import { arrivalDateFilter } from './arrival-date-filter';

// ============================================================
// La pestaña «Hoy» de PCP debe incluir lo atrasado que sigue abierto:
// si no, los despachos de días anteriores nunca aparecen por ningún lado.
// ============================================================

describe('arrivalDateFilter', () => {
  it('sin fecha no filtra (histórico)', () => {
    expect(arrivalDateFilter(undefined, false)).toEqual({});
    expect(arrivalDateFilter(undefined, true)).toEqual({});
  });

  it('sin atrasados filtra por el día exacto', () => {
    expect(arrivalDateFilter('2026-11-23', false)).toEqual({ expectedDate: '2026-11-23' });
  });

  it('con atrasados suma lo anterior que sigue sin cerrar', () => {
    expect(arrivalDateFilter('2026-11-23', true)).toEqual({
      OR: [
        { expectedDate: '2026-11-23' },
        {
          expectedDate: { lt: '2026-11-23' },
          status: { notIn: ['ATENDIDO', 'AUSENTE', 'CANCELADO'] },
        },
      ],
    });
  });
});

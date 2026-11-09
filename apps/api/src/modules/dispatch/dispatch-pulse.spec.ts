import { describe, expect, it } from 'vitest';
import { buildDispatchPulse, effectiveDateKey, type PulseLineInput } from './dispatch-pulse';

// ============================================================
// Pulso de carga: solo lo que falta por cargar.
// Caracas es UTC-4; las fechas de entrega son fechas de negocio, no
// instantes, así que un ISO a medianoche UTC conserva su día.
// ============================================================

function line(overrides: Partial<PulseLineInput> = {}): PulseLineInput {
  return {
    orderNumber: '1001',
    uom: 'SAC',
    customerCode: 'C1',
    customerName: 'CLIENTE UNO',
    effectiveDate: '2026-11-09',
    plannedQty: 50,
    plannedKg: 2000,
    loadedQty: null,
    loadedKg: null,
    ...overrides,
  };
}

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('buildDispatchPulse', () => {
  it('suma SAC, granel y otras unidades por separado, y agrupa por pedido', () => {
    const pulse = buildDispatchPulse(
      [
        {
          lines: [
            line({ orderNumber: '1001', effectiveDate: '2026-11-02' }),
            line({
              orderNumber: '1002',
              uom: 'KG',
              customerCode: 'C2',
              customerName: 'CLIENTE DOS',
              effectiveDate: '2026-11-09',
              plannedQty: 1000,
              plannedKg: 1000,
              loadedQty: 0,
              loadedKg: 0,
            }),
            line({
              orderNumber: '1003',
              uom: 'BUL',
              customerCode: 'C3',
              customerName: 'CLIENTE TRES',
              effectiveDate: '2026-11-12',
              plannedQty: 10,
              plannedKg: 500,
            }),
            // Renglón ya cargado: no debe entrar al pulso.
            line({
              orderNumber: '1004',
              effectiveDate: '2026-11-01',
              plannedQty: 20,
              plannedKg: 700,
              loadedQty: 20,
              loadedKg: 700,
            }),
          ],
        },
        {
          lines: [
            line({
              orderNumber: '1005',
              effectiveDate: '2026-11-20',
              plannedQty: 30,
              plannedKg: 1050,
            }),
            line({
              orderNumber: '1006',
              customerCode: 'C4',
              customerName: 'CLIENTE CUATRO',
              effectiveDate: null,
              plannedQty: 10,
              plannedKg: 350,
            }),
            line({
              orderNumber: '1007',
              uom: 'KG',
              customerCode: 'C5',
              customerName: 'CLIENTE CINCO',
              effectiveDate: '2026-11-09T00:00:00.000Z',
              plannedQty: 200,
              plannedKg: 200,
            }),
          ],
        },
      ],
      NOW,
    );

    expect(pulse.sheets).toBe(2);
    expect(pulse.orders).toBe(6);
    expect(pulse.lines).toBe(6);
    expect(pulse.customers).toBe(5);
    expect(pulse.sacks).toBe(90);
    expect(pulse.sacksKg).toBe(3400);
    expect(pulse.bulkKg).toBe(1200);
    expect(pulse.otherKg).toBe(500);
    expect(pulse.totalKg).toBe(5100);
    expect(pulse.urgency).toEqual({ overdue: 1, today: 2, week: 1, later: 1, noDate: 1 });
  });

  it('clampa el pendiente a cero y prefiere la fecha más próxima del pedido', () => {
    const pulse = buildDispatchPulse(
      [
        {
          lines: [
            // La misma orden aparece en dos renglones: cuenta como un pedido
            // y se queda con la fecha más vieja.
            line({ orderNumber: '2001', effectiveDate: '2026-11-15' }),
            line({ orderNumber: '2001', effectiveDate: '2026-11-03' }),
            // Sobre-cargado: no aporta negativo.
            line({
              orderNumber: '2002',
              plannedQty: 10,
              plannedKg: 350,
              loadedQty: 15,
              loadedKg: 500,
            }),
          ],
        },
      ],
      NOW,
    );

    expect(pulse.sheets).toBe(1);
    expect(pulse.orders).toBe(1);
    expect(pulse.lines).toBe(2);
    expect(pulse.sacks).toBe(100);
    expect(pulse.sacksKg).toBe(4000);
    expect(pulse.urgency.overdue).toBe(1);
  });

  it('oculta pedidos sin fecha y devuelve ceros con la bandeja vacía', () => {
    const pulse = buildDispatchPulse([{ lines: [line({ orderNumber: '3001', effectiveDate: null })] }], NOW);
    expect(pulse.sheets).toBe(1);
    expect(pulse.orders).toBe(1);
    expect(pulse.urgency).toEqual({ overdue: 0, today: 0, week: 0, later: 0, noDate: 1 });

    expect(buildDispatchPulse([], NOW)).toMatchObject({
      sheets: 0,
      orders: 0,
      lines: 0,
      customers: 0,
      sacks: 0,
      totalKg: 0,
      urgency: { overdue: 0, today: 0, week: 0, later: 0, noDate: 0 },
    });
  });
});

describe('effectiveDateKey', () => {
  it('conserva el día de una fecha ISO a medianoche UTC', () => {
    expect(effectiveDateKey('2026-11-05T00:00:00.000Z')).toBe('2026-11-05');
  });

  it('acepta yyyy-MM-dd y rechaza textos inválidos', () => {
    expect(effectiveDateKey('2026-11-05')).toBe('2026-11-05');
    expect(effectiveDateKey('no-es-fecha')).toBeNull();
    expect(effectiveDateKey(null)).toBeNull();
  });
});

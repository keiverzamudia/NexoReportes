import { describe, expect, it } from 'vitest';
import type { ArrivalSummary } from '@nexo/contracts';
import {
  arrivalPulse,
  arrivalTimeLabel,
  businessDayLabel,
  businessToday,
  businessTomorrow,
  clockLabel,
  minutesOnSite,
  sortArrivals,
} from './arrival';

function arrival(overrides: Partial<ArrivalSummary> = {}): ArrivalSummary {
  return {
    id: 'a1',
    number: 'LLG-2026-0001',
    customerCode: 'C001',
    customerName: 'CLIENTE UNO',
    expectedDate: '2026-10-22',
    sheetId: 's1',
    sheetNumber: 'DSP-2026-0001',
    sheetTitle: 'Despacho lunes',
    status: 'ESPERADO',
    arrivedAt: null,
    arrivedById: null,
    arrivedByCode: null,
    arrivedByName: null,
    closedAt: null,
    note: null,
    orderNumbers: ['408251710'],
    lineCount: 1,
    plannedSacks: 10,
    plannedKg: 500,
    incidentCount: 0,
    openIncidentCount: 0,
    updatedAt: '2026-10-22T12:00:00.000Z',
    updatedByName: null,
    canCheckIn: true,
    canClose: true,
    canReportIncident: true,
    canEdit: false,
    ...overrides,
  };
}

describe('arrival helpers — fechas de negocio', () => {
  it('no desfasa el día (las fechas son texto, no instantes)', () => {
    expect(businessDayLabel('2026-10-22')).toMatch(/22/);
    expect(businessDayLabel(null)).toBe('sin fecha');
  });

  it('calcula hoy y mañana como yyyy-MM-dd', () => {
    const now = new Date(2026, 9, 22, 23, 30);
    expect(businessToday(now)).toBe('2026-10-22');
    expect(businessTomorrow(now)).toBe('2026-10-23');
  });

  it('cruza fin de mes al calcular mañana', () => {
    expect(businessTomorrow(new Date(2026, 9, 31, 10, 0))).toBe('2026-11-01');
  });
});

describe('arrival helpers — horas', () => {
  it('formatea la hora marcada y tolera vacíos', () => {
    const iso = new Date(2026, 9, 22, 14, 32).toISOString();
    expect(clockLabel(iso)).toBe('14:32');
    expect(clockLabel(null)).toBe('—');
  });

  it('minutos en planta nunca son negativos', () => {
    const arrived = new Date(2026, 9, 22, 14, 0).toISOString();
    const now = new Date(2026, 9, 22, 14, 12);
    expect(minutesOnSite(arrived, now)).toBe(12);
    expect(minutesOnSite(arrived, new Date(2026, 9, 22, 13, 0))).toBe(0);
    expect(minutesOnSite(null)).toBeNull();
  });

  it('prefiere la hora de llegada al texto de espera', () => {
    const arrived = new Date(2026, 9, 22, 14, 32).toISOString();
    expect(arrivalTimeLabel({ arrivedAt: arrived, expectedDate: '2026-10-22' })).toBe('Llegó 14:32');
    expect(arrivalTimeLabel({ arrivedAt: null, expectedDate: '2026-10-22' })).toContain('Esperado');
  });
});

describe('arrival helpers — bandeja', () => {
  it('pone primero lo que exige acción', () => {
    const items = [
      arrival({ id: 'atendido', status: 'ATENDIDO', arrivedAt: '2026-10-22T13:00:00.000Z' }),
      arrival({ id: 'esperado', status: 'ESPERADO' }),
      arrival({ id: 'incidencia', status: 'CON_INCIDENCIA', arrivedAt: '2026-10-22T14:00:00.000Z' }),
      arrival({ id: 'planta', status: 'EN_PLANTA', arrivedAt: '2026-10-22T15:00:00.000Z' }),
    ];
    expect(sortArrivals(items).map((item) => item.id)).toEqual(['incidencia', 'planta', 'esperado', 'atendido']);
  });

  it('ordena por hora de llegada dentro del mismo estado', () => {
    const items = [
      arrival({ id: 'tarde', status: 'EN_PLANTA', arrivedAt: '2026-10-22T15:30:00.000Z' }),
      arrival({ id: 'temprano', status: 'EN_PLANTA', arrivedAt: '2026-10-22T14:05:00.000Z' }),
    ];
    expect(sortArrivals(items).map((item) => item.id)).toEqual(['temprano', 'tarde']);
  });

  it('resume la jornada sin contar lo cerrado en los kg pendientes', () => {
    const pulse = arrivalPulse([
      arrival({ status: 'ESPERADO', plannedKg: 1000 }),
      arrival({ status: 'EN_PLANTA', plannedKg: 500 }),
      arrival({ status: 'CON_INCIDENCIA', plannedKg: 250 }),
      arrival({ status: 'ATENDIDO', plannedKg: 800 }),
      arrival({ status: 'AUSENTE', plannedKg: 300 }),
    ]);

    expect(pulse).toMatchObject({
      expected: 1,
      onSite: 1,
      attended: 1,
      withIncident: 1,
      missed: 1,
      waiting: 3,
      kgExpected: 1750,
    });
  });
});

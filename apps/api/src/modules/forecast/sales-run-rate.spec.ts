import { describe, expect, it } from 'vitest';
import {
  computeRunRate,
  countWorkingDays,
  isoDay,
  monthCalendar,
  previousMonths,
  todayInTimeZone,
  workingDayFlags,
} from './sales-run-rate';

// Octubre 2026: 31 días, domingos 4/11/18/25 → 27 hábiles (lun–sáb).
const OCTOBER_TODAY = '2026-10-29';

function octoberCalendar(overrides: Partial<Parameters<typeof monthCalendar>[0]> = {}) {
  return monthCalendar({
    year: 2026,
    month: 10,
    basis: 'WORKING',
    includeToday: false,
    today: OCTOBER_TODAY,
    ...overrides,
  });
}

describe('monthCalendar — días del mes y corte', () => {
  it('octubre 2026: 31 días, 27 hábiles y corte a ayer (28) con 24 hábiles', () => {
    const calendar = octoberCalendar();
    expect(calendar.status).toBe('OPEN');
    expect(calendar.inMonth).toBe(31);
    expect(calendar.workingInMonth).toBe(27);
    expect(calendar.elapsed).toBe(28);
    expect(calendar.cut).toBe('2026-10-28');
    expect(calendar.workingElapsed).toBe(24);
    expect(calendar.remaining).toBe(3);
    expect(calendar.workingRemaining).toBe(3);
  });

  it('includeToday=true suma el día en curso (29, jueves)', () => {
    const calendar = octoberCalendar({ includeToday: true });
    expect(calendar.elapsed).toBe(29);
    expect(calendar.cut).toBe('2026-10-29');
    expect(calendar.workingElapsed).toBe(25);
    expect(calendar.remaining).toBe(2);
  });

  it('día 1 sin incluir hoy: no hay días contados y no se divide por cero', () => {
    const calendar = monthCalendar({
      year: 2026,
      month: 10,
      basis: 'WORKING',
      includeToday: false,
      today: '2026-10-01',
    });
    expect(calendar.elapsed).toBe(0);
    expect(calendar.workingElapsed).toBe(0);
    expect(calendar.cut).toBeNull();

    const metrics = computeRunRate({ actualKg: 0, forecastKg: 1_888_000, calendar });
    expect(metrics.dailyAvgKg).toBe(0);
    expect(metrics.projectedKg).toBe(0);
    expect(metrics.projectedAttainmentPct).toBe(0);
    expect(Number.isFinite(metrics.projectedKg)).toBe(true);
  });

  it('mes cerrado: todos los días contados, sin días restantes', () => {
    const calendar = monthCalendar({
      year: 2026,
      month: 9,
      basis: 'WORKING',
      includeToday: false,
      today: OCTOBER_TODAY,
    });
    expect(calendar.status).toBe('CLOSED');
    expect(calendar.elapsed).toBe(30);
    expect(calendar.workingInMonth).toBe(26); // septiembre 2026: domingos 6/13/20/27
    expect(calendar.workingElapsed).toBe(26);
    expect(calendar.remaining).toBe(0);
    expect(calendar.cut).toBe('2026-09-30');
  });

  it('mes futuro: nada contado y corte nulo', () => {
    const calendar = monthCalendar({
      year: 2026,
      month: 11,
      basis: 'WORKING',
      includeToday: false,
      today: OCTOBER_TODAY,
    });
    expect(calendar.status).toBe('FUTURE');
    expect(calendar.elapsed).toBe(0);
    expect(calendar.workingElapsed).toBe(0);
    expect(calendar.remaining).toBe(30);
    expect(calendar.cut).toBeNull();
  });

  it('febrero bisiesto (2028): 29 días y 25 hábiles', () => {
    const calendar = monthCalendar({
      year: 2028,
      month: 2,
      basis: 'WORKING',
      includeToday: false,
      today: '2028-03-10',
    });
    expect(calendar.status).toBe('CLOSED');
    expect(calendar.inMonth).toBe(29);
    expect(calendar.workingInMonth).toBe(25);
  });
});

describe('días hábiles — lunes a sábado', () => {
  it('cuenta 24 hábiles del 1 al 28 de octubre 2026', () => {
    expect(countWorkingDays(2026, 10, 1, 28)).toBe(24);
  });

  it('marca el domingo como no hábil y el sábado como hábil', () => {
    const flags = workingDayFlags(2026, 10);
    expect(flags[3]).toBe(false); // domingo 4
    expect(flags[2]).toBe(true); // sábado 3
    expect(flags[29]).toBe(true); // jueves 30
  });
});

describe('computeRunRate — aceptación octubre 2026', () => {
  it('1.579.984 kg al corte / 24 hábiles → proyección 1.777.482 (94,1 % del forecast)', () => {
    const metrics = computeRunRate({
      actualKg: 1_579_984,
      forecastKg: 1_888_000,
      calendar: octoberCalendar(),
    });

    expect(metrics.dailyAvgKg).toBeCloseTo(65_832.667, 2);
    expect(metrics.projectedKg).toBeCloseTo(1_777_482, 0);
    expect(metrics.attainmentPct).toBeCloseTo(83.7, 1);
    expect(metrics.projectedAttainmentPct).toBeCloseTo(94.1, 1);
    // (1.888.000 − 1.579.984) / 3 días restantes
    expect(metrics.requiredDailyKg).toBeCloseTo(102_672, 0);
    expect(metrics.gapKg).toBeCloseTo(-110_518, 0);
  });

  it('incluir hoy hunde artificialmente la proyección (83,7 % → el error a evitar)', () => {
    const metrics = computeRunRate({
      actualKg: 1_580_064,
      forecastKg: 1_888_000,
      calendar: octoberCalendar({ includeToday: true }),
    });
    // 1.580.064 / 25 × 27 ≈ 1.706.469 → 90,4 %; muy por debajo del 94,1 % real.
    expect(metrics.projectedAttainmentPct).toBeLessThan(92);
    expect(metrics.projectedAttainmentPct).toBeGreaterThan(89);
  });

  it('base calendario usa días corridos (31) en lugar de hábiles (27)', () => {
    const metrics = computeRunRate({
      actualKg: 1_000,
      forecastKg: 2_000,
      calendar: octoberCalendar({ basis: 'CALENDAR' }),
    });
    expect(metrics.dailyAvgKg).toBeCloseTo(1_000 / 28, 3);
    // `dailyAvgKg` se redondea a 3 decimales antes de proyectar.
    expect(metrics.projectedKg).toBeCloseTo((1_000 / 28) * 31, 1);
  });

  it('sin meta (forecast 0): porcentajes y brecha nulos, nunca Infinity', () => {
    const metrics = computeRunRate({ actualKg: 5_000, forecastKg: 0, calendar: octoberCalendar() });
    expect(metrics.attainmentPct).toBeNull();
    expect(metrics.projectedAttainmentPct).toBeNull();
    expect(metrics.gapKg).toBeNull();
    expect(metrics.requiredDailyKg).toBeNull();
    expect(metrics.projectedKg).toBeGreaterThan(0);
  });

  it('mes cerrado: la proyección es la venta real y no hay ritmo necesario', () => {
    const calendar = monthCalendar({
      year: 2026,
      month: 9,
      basis: 'WORKING',
      includeToday: false,
      today: OCTOBER_TODAY,
    });
    const metrics = computeRunRate({ actualKg: 1_495_849, forecastKg: 1_500_000, calendar });
    expect(metrics.projectedKg).toBe(1_495_849);
    expect(metrics.requiredDailyKg).toBeNull();
    expect(metrics.projectedAttainmentPct).toBe(metrics.attainmentPct);
  });

  it('mes futuro: sin proyección ni porcentajes', () => {
    const calendar = monthCalendar({
      year: 2026,
      month: 11,
      basis: 'WORKING',
      includeToday: false,
      today: OCTOBER_TODAY,
    });
    const metrics = computeRunRate({ actualKg: 0, forecastKg: 1_900_000, calendar });
    expect(metrics.projectedKg).toBeNull();
    expect(metrics.attainmentPct).toBeNull();
    expect(metrics.requiredDailyKg).toBeNull();
  });

  it('compara la proyección contra el promedio histórico de los meses cerrados', () => {
    const metrics = computeRunRate({
      actualKg: 1_579_984,
      forecastKg: 1_888_000,
      calendar: octoberCalendar(),
      history: [1_455_015, 1_592_381, 1_453_990],
    });
    expect(metrics.historicalAvgKg).toBeCloseTo(1_500_462, 0);
    expect(metrics.vsHistoricalPct).toBeCloseTo(18.5, 1);
  });

  it('historial vacío: promedio nulo (sin comparación inventada)', () => {
    const metrics = computeRunRate({ actualKg: 100, forecastKg: 0, calendar: octoberCalendar(), history: [] });
    expect(metrics.historicalAvgKg).toBeNull();
    expect(metrics.vsHistoricalPct).toBeNull();
  });
});

describe('utilidades de fecha', () => {
  it('el día del negocio se calcula en America/Caracas, no en UTC', () => {
    // 29-oct-2026 02:30 UTC = 28-oct-2026 22:30 en Caracas (UTC−4).
    const now = new Date('2026-10-29T02:30:00.000Z');
    expect(todayInTimeZone('America/Caracas', now)).toBe('2026-10-28');
    expect(todayInTimeZone('UTC', now)).toBe('2026-10-29');
  });

  it('previousMonths cruza el cambio de año', () => {
    expect(previousMonths(2026, 2, 3)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it('isoDay rellena mes y día', () => {
    expect(isoDay(2026, 1, 5)).toBe('2026-01-05');
  });
});

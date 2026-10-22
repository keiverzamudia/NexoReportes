import { describe, expect, it } from 'vitest';
import {
  formatStatementMoney,
  statementBalanceLabel,
  statementDaysLabel,
  statementDaysTone,
  statementDaysTitle,
  statementDocTone,
  statementUpdatedAt,
} from './statement';

describe('formatStatementMoney', () => {
  it('formatea USD y Bs con separadores es-VE', () => {
    expect(formatStatementMoney(1234.5, 'USD')).toBe('$ 1.234,50');
    expect(formatStatementMoney(1234.5, 'BS')).toBe('Bs 1.234,50');
  });

  it('conserva el signo de los créditos y permite mostrarlos en absoluto', () => {
    expect(formatStatementMoney(-21017.5, 'USD')).toBe('-$ 21.017,50');
    expect(formatStatementMoney(-21017.5, 'USD', { absolute: true })).toBe('$ 21.017,50');
  });

  it('devuelve guion cuando no hay monto', () => {
    expect(formatStatementMoney(null, 'USD')).toBe('—');
    expect(formatStatementMoney(undefined, 'BS')).toBe('—');
  });
});

describe('statementDays*', () => {
  it('distingue vencido, hoy y por vencer', () => {
    expect(statementDaysLabel(16)).toBe('16 d');
    expect(statementDaysLabel(0)).toBe('Hoy');
    expect(statementDaysLabel(-5)).toBe('-5 d');
    expect(statementDaysLabel(null)).toBe('—');
  });

  it('asigna tono y explicación correctos', () => {
    expect(statementDaysTone(16)).toBe('danger');
    expect(statementDaysTone(0)).toBe('warning');
    expect(statementDaysTone(-5)).toBe('muted');
    expect(statementDaysTone(null)).toBe('muted');

    expect(statementDaysTitle(16)).toBe('Vencido hace 16 días');
    expect(statementDaysTitle(1)).toBe('Vencido hace 1 día');
    expect(statementDaysTitle(0)).toBe('Vence hoy');
    expect(statementDaysTitle(-5)).toBe('Vence en 5 días');
    expect(statementDaysTitle(null)).toBe('Sin fecha de vencimiento');
  });
});

describe('statementDocTone', () => {
  it('marca facturas y créditos', () => {
    expect(statementDocTone({ tipoDoc: 'FACT', esCredito: false })).toBe('primary');
    expect(statementDocTone({ tipoDoc: 'ADEL', esCredito: true })).toBe('success');
    expect(statementDocTone({ tipoDoc: 'GIRO', esCredito: false })).toBe('muted');
  });
});

describe('statementBalanceLabel', () => {
  it('resume el saldo del cliente', () => {
    expect(statementBalanceLabel(100)).toBe('Pendiente de cobro');
    expect(statementBalanceLabel(0)).toBe('Al día');
    expect(statementBalanceLabel(-10)).toBe('Saldo a favor');
  });
});

describe('statementUpdatedAt', () => {
  it('tolera valores ausentes o inválidos', () => {
    expect(statementUpdatedAt(null)).toBe('—');
    expect(statementUpdatedAt('no-es-fecha')).toBe('—');
  });
});

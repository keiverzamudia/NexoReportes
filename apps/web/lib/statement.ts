import type { CustomerStatementCurrency, CustomerStatementRow } from '@nexo/contracts';

// ============================================================
// Formato puro del estado de cuenta (sin React ni red).
// Se usa en el modal de Clientes y se prueba en statement.spec.ts.
// ============================================================

export type StatementTone = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted';

export function formatStatementMoney(
  value: number | null | undefined,
  currency: CustomerStatementCurrency,
  options: { absolute?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const n = options.absolute ? Math.abs(value) : value;
  const formatted = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  const sign = n < 0 ? '-' : '';
  return `${sign}${currency === 'USD' ? '$' : 'Bs'} ${formatted}`;
}

export function statementDaysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days === 0) return 'Hoy';
  return `${days} d`;
}

export function statementDaysTone(days: number | null | undefined): StatementTone {
  if (days === null || days === undefined) return 'muted';
  if (days > 0) return 'danger';
  if (days === 0) return 'warning';
  return 'muted';
}

export function statementDaysTitle(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'Sin fecha de vencimiento';
  if (days > 0) return `Vencido hace ${days} día${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoy';
  return `Vence en ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`;
}

export function statementDocTone(
  row: Pick<CustomerStatementRow, 'tipoDoc' | 'esCredito'>,
): StatementTone {
  if (row.esCredito) return 'success';
  if (row.tipoDoc === 'FACT') return 'primary';
  return 'muted';
}

export function statementBalanceLabel(saldo: number): string {
  if (saldo > 0) return 'Pendiente de cobro';
  if (saldo < 0) return 'Saldo a favor';
  return 'Al día';
}

export function statementUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

import type { Customer, CustomerStatementCurrency, CustomerStatementRow, OrderGroup } from '@nexo/contracts';

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

// Fechas completas (dd/mm/aaaa) como en la consulta de Profit.
export function formatStatementDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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

// Un crédito o un documento ya saldado no es una deuda vencida: se muestra
// con tono neutro aunque su fecha de emisión sea antigua.
export function statementRowDaysTone(
  row: Pick<CustomerStatementRow, 'diasVencimiento' | 'saldo' | 'esCredito'>,
): StatementTone {
  if (row.esCredito || (row.saldo ?? 0) === 0) return 'muted';
  return statementDaysTone(row.diasVencimiento);
}

export function statementRowDaysTitle(
  row: Pick<CustomerStatementRow, 'diasVencimiento' | 'saldo' | 'esCredito'>,
): string {
  const base = statementDaysTitle(row.diasVencimiento);
  if (row.esCredito) return `Crédito. ${base}`;
  if ((row.saldo ?? 0) === 0) return `Documento saldado. ${base}`;
  return base;
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

/**
 * Adapta un grupo de la cartera de Pedidos al cliente que espera el modal de
 * estado de cuenta. Devuelve null si el grupo no trae código de cliente.
 */
export function customerForStatement(
  group: Pick<OrderGroup, 'code' | 'label' | 'ordersCount'>,
): Customer | null {
  if (!group.code) return null;
  return {
    id: group.code,
    externalCode: group.code,
    name: group.label,
    customerType: null,
    vendor: null,
    isActive: true,
    ordersCount: group.ordersCount,
  };
}

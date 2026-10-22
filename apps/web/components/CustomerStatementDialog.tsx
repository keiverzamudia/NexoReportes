'use client';

// ============================================================
// Estado de cuenta de un cliente (cartera de Profit).
//
// Se abre desde la fila del cliente en Clientes. La consulta va al API en
// vivo (solo lectura) y reproduce la pantalla «Consulta Clientes» de Profit:
// documentos pendientes, fecha de vencimiento, días vencidos, saldo y monto
// neto, con los filtros de documentos pendientes y otra moneda.
//
// El saldo de la tabla viaja con signo desde el API; los créditos (ADEL,
// N/CR) se muestran en positivo como en Profit, pero restan del saldo total.
// ============================================================

import type {
  Customer,
  CustomerStatement,
  CustomerStatementCurrency,
  CustomerStatementRow,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Inbox,
  ListChecks,
  Receipt,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthRequiredError, apiFetch } from '../lib/api';
import {
  formatStatementDate,
  formatStatementMoney,
  statementBalanceLabel,
  statementDaysLabel,
  statementDocTone,
  statementRowDaysTitle,
  statementRowDaysTone,
  statementUpdatedAt,
} from '../lib/statement';
import type { Column } from './ui';
import { Badge, DataTable, EmptyState, Select, Skeleton, cx } from './ui';

export function CustomerStatementDialog({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [incluirSaldados, setIncluirSaldados] = useState(false);
  const [otraMoneda, setOtraMoneda] = useState(true);
  const [moneda, setMoneda] = useState<CustomerStatementCurrency>('USD');

  useEffect(() => {
    if (!open) return;
    setIncluirSaldados(false);
    setOtraMoneda(true);
    setMoneda('USD');
  }, [open, customer?.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const { data, error, isPending, isFetching, refetch } = useQuery<CustomerStatement>({
    queryKey: ['customer-statement', customer?.externalCode, incluirSaldados, moneda],
    queryFn: () => {
      const params = new URLSearchParams();
      if (incluirSaldados) params.set('incluirSaldados', 'true');
      params.set('moneda', moneda);
      return apiFetch<CustomerStatement>(
        `/customers/${encodeURIComponent(customer!.externalCode)}/statement?${params.toString()}`,
      );
    },
    enabled: open && customer !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const currency = data?.moneda ?? moneda;
  const displayName = data?.customer.name ?? customer?.name ?? '—';
  const displayCode = data?.customer.code ?? customer?.externalCode ?? '—';
  const displayMeta = [data?.customer.customerType ?? customer?.customerType, data?.customer.vendor ?? customer?.vendor]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  const columns = useMemo<Column<CustomerStatementRow>[]>(() => {
    const moneyHeader = currency === 'USD' ? '$' : 'Bs';
    return [
      {
        key: 'tipo',
        header: 'Doc.',
        kind: 'id',
        sortValue: (row) => row.tipoDoc,
        render: (row) => <Badge tone={statementDocTone(row)}>{row.tipoDoc}</Badge>,
      },
      {
        key: 'nro',
        header: 'Nº Doc.',
        kind: 'field',
        sortValue: (row) => row.nroDoc,
        render: (row) => <span className="font-semibold tabular-nums text-primary">{row.nroDoc}</span>,
      },
      {
        key: 'fecha',
        header: 'Fecha',
        kind: 'field',
        sortValue: (row) => row.fechaEmision ?? '',
        render: (row) => <span className="tabular-nums">{formatStatementDate(row.fechaEmision)}</span>,
      },
      {
        key: 'venc',
        header: 'Fecha Vec.',
        kind: 'field',
        sortValue: (row) => row.fechaVencimiento ?? '',
        render: (row) => <span className="tabular-nums">{formatStatementDate(row.fechaVencimiento)}</span>,
      },
      {
        key: 'dias',
        header: 'Días Venc.',
        kind: 'status',
        sortValue: (row) => row.diasVencimiento ?? -9999,
        render: (row) => (
          <span title={statementRowDaysTitle(row)}>
            <Badge tone={statementRowDaysTone(row)}>{statementDaysLabel(row.diasVencimiento)}</Badge>
          </span>
        ),
      },
      {
        key: 'saldo',
        header: `Saldo en ${moneyHeader}`,
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.saldo ?? 0,
        render: (row) => (
          <span
            className={cx(
              'font-bold tabular-nums',
              row.esCredito ? 'text-secondary' : 'text-on-surface',
            )}
            title={row.esCredito ? 'Crédito: se descuenta del saldo total' : undefined}
          >
            {formatStatementMoney(row.saldo, currency, { absolute: row.esCredito })}
          </span>
        ),
      },
      {
        key: 'neto',
        header: `Monto Neto en ${moneyHeader}`,
        align: 'right',
        kind: 'field',
        sortValue: (row) => row.montoNeto ?? 0,
        render: (row) => (
          <span
            className="tabular-nums text-on-surface-variant"
            title={row.esCredito ? 'Monto del crédito (se descuenta del saldo)' : undefined}
          >
            {formatStatementMoney(row.montoNeto, currency, { absolute: row.esCredito })}
          </span>
        ),
      },
    ];
  }, [currency]);

  if (!open || !customer) return null;

  const message =
    error instanceof AuthRequiredError
      ? 'Tu sesión expiró. Cierra el modal y vuelve a iniciar sesión.'
      : error instanceof Error
        ? error.message
        : 'No se pudo consultar la cartera del cliente.';

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-statement-title"
        className="animate-rise flex min-w-0 max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <Receipt aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Clientes · Cartera
              </p>
              <h2 id="customer-statement-title" className="truncate text-title-md text-primary">
                Estado de cuenta
              </h2>
              <p
                className="truncate text-label-md normal-case text-on-surface-variant"
                title={[displayName, displayCode, displayMeta].filter(Boolean).join(' · ')}
              >
                {displayName} · {displayCode}
                {displayMeta ? ` · ${displayMeta}` : ''}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar estado de cuenta"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          <div className="flex flex-col gap-space-md">
            {data && totals ? (
              <section aria-label="Resumen de la cartera" className="grid gap-space-sm sm:grid-cols-3">
                <div className="flex flex-col gap-space-2xs rounded-xl bg-primary-container p-space-md text-on-primary shadow-soft">
                  <div className="flex items-center justify-between gap-space-sm">
                    <span className="text-label-sm font-semibold uppercase tracking-[0.14em] text-on-primary/70">
                      Saldo cliente
                    </span>
                    <Wallet aria-hidden className="size-4 text-secondary-container" />
                  </div>
                  <span className="text-headline-lg font-extrabold tabular-nums text-on-primary">
                    {formatStatementMoney(totals.saldo, currency)}
                  </span>
                  <span className="text-label-sm normal-case text-on-primary/70">{statementBalanceLabel(totals.saldo)}</span>
                </div>

                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-space-md">
                  <div className="flex items-center justify-between gap-space-sm">
                    <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Vencido</span>
                    <CircleDollarSign aria-hidden className={cx('size-4', totals.saldoVencido > 0 ? 'text-error' : 'text-outline')} />
                  </div>
                  <p className={cx('mt-space-2xs text-title-md font-bold tabular-nums', totals.saldoVencido > 0 ? 'text-error' : 'text-on-surface')}>
                    {formatStatementMoney(totals.saldoVencido, currency)}
                  </p>
                  <p className="text-label-sm normal-case text-on-surface-variant">
                    {totals.vencidos} documento{totals.vencidos === 1 ? '' : 's'} vencido{totals.vencidos === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-space-md">
                  <div className="flex items-center justify-between gap-space-sm">
                    <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Documentos</span>
                    <ListChecks aria-hidden className="size-4 text-primary-container" />
                  </div>
                  <p className="mt-space-2xs text-title-md font-bold tabular-nums text-primary">{totals.documentos}</p>
                  <p className="flex items-center gap-space-2xs text-label-sm normal-case text-on-surface-variant">
                    <CalendarClock aria-hidden className="size-3.5" />
                    {totals.proximoVencimiento ? `Próximo: ${formatStatementDate(totals.proximoVencimiento)}` : 'Sin vencimientos próximos'}
                  </p>
                </div>
              </section>
            ) : !error ? (
              <div className="grid gap-space-sm sm:grid-cols-3" aria-hidden>
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
            ) : null}

            <div className="flex flex-col gap-space-sm rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-space-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-space-md">
                <label className="flex cursor-pointer items-center gap-space-xs text-label-md font-semibold normal-case text-on-surface">
                  <input
                    type="checkbox"
                    checked={!incluirSaldados}
                    onChange={(event) => setIncluirSaldados(!event.target.checked)}
                    className="size-4 rounded border-outline-variant accent-primary-container"
                  />
                  Documentos pendientes
                </label>

                <div className="flex flex-wrap items-center gap-space-xs">
                  <label className="flex cursor-pointer items-center gap-space-xs text-label-md font-semibold normal-case text-on-surface">
                    <input
                      type="checkbox"
                      checked={otraMoneda}
                      onChange={(event) => {
                        setOtraMoneda(event.target.checked);
                        setMoneda(event.target.checked ? 'USD' : 'BS');
                      }}
                      className="size-4 rounded border-outline-variant accent-primary-container"
                    />
                    Otra moneda
                  </label>
                  <Select
                    value={moneda}
                    onChange={(value) => setMoneda(value as CustomerStatementCurrency)}
                    ariaLabel="Moneda del estado de cuenta"
                    disabled={!otraMoneda}
                    options={[
                      { value: 'USD', label: 'USD · Dólares americanos' },
                      { value: 'BS', label: 'Bs · Bolívares' },
                    ]}
                    className="w-full sm:w-52"
                  />
                </div>
              </div>

              <div className="flex items-center gap-space-xs sm:justify-end">
                <Badge
                  tone={data?.source === 'fixtures' ? 'warning' : data ? 'success' : error ? 'danger' : 'muted'}
                  dot
                >
                  {data?.source === 'fixtures'
                    ? 'Datos de desarrollo'
                    : data
                      ? 'Profit en vivo'
                      : error
                        ? 'Sin conexión'
                        : 'Consultando'}
                </Badge>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  aria-label="Actualizar estado de cuenta"
                  title="Actualizar estado de cuenta"
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <RefreshCw aria-hidden className={cx('size-4', isFetching && 'animate-spin')} />
                </button>
              </div>
            </div>

            {error && !data && (
              <div className="flex flex-col items-center gap-space-sm rounded-xl border border-critical/40 bg-critical-container/30 p-space-lg text-center">
                <AlertTriangle aria-hidden className="size-6 text-error" />
                <p className="font-semibold text-title-md text-on-surface">No se pudo consultar la cartera</p>
                <p className="max-w-md text-body-md text-on-surface-variant">{message}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-space-xs flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
                >
                  <RefreshCw aria-hidden className="size-4" /> Reintentar
                </button>
              </div>
            )}

            {error && data && (
              <p role="alert" className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                No se pudo actualizar: {message}
              </p>
            )}

            {!error || data ? (
              <>
                <p className="text-label-sm normal-case text-on-surface-variant">
                  {incluirSaldados ? 'Incluye documentos saldados.' : 'Solo documentos con saldo pendiente.'}{' '}
                  Los adelantos y notas de crédito se descuentan del saldo cliente. Ordena por «Días Venc.» para
                  priorizar cobranza.
                </p>

                {data?.truncated && (
                  <p className="flex items-start gap-space-xs rounded-xl border border-warning/40 bg-warning/10 p-space-sm text-label-md text-on-surface">
                    <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    Se muestran los {totals?.documentos ?? 1000} documentos más recientes. Activa «Documentos
                    pendientes» para acotar la lista a los que tienen saldo.
                  </p>
                )}

                <div className="overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
                  <DataTable
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => `${row.tipoDoc}-${row.nroDoc}`}
                    loading={isPending}
                    defaultSortKey="fecha"
                    maxHeightClass="md:max-h-[min(46vh,520px)]"
                    empty={
                      <EmptyState
                        icon={incluirSaldados ? Inbox : CheckCircle2}
                        title={incluirSaldados ? 'Sin documentos en el historial' : 'Sin documentos pendientes'}
                        description={
                          incluirSaldados
                            ? 'Este cliente no tiene documentos registrados en Profit.'
                            : 'Este cliente no tiene deudas abiertas en Profit. Si esperas ver un documento saldado, desactiva «Documentos pendientes».'
                        }
                      />
                    }
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex flex-col">
            <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">Saldo cliente</span>
            <span className={cx('text-title-md font-bold tabular-nums', (totals?.saldo ?? 0) < 0 ? 'text-secondary' : 'text-primary')}>
              {totals ? formatStatementMoney(totals.saldo, currency) : '—'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <span className="text-label-sm normal-case text-on-surface-variant">
              {data
                ? `${totals?.documentos ?? 0} documento(s) · ${totals?.vencidos ?? 0} vencido(s) · ${statementUpdatedAt(data.asOf)}`
                : error
                  ? 'No se pudo consultar'
                  : 'Consultando cartera…'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              Cerrar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

'use client';

import {
  RECEIVABLES_BUCKETS,
  ReceivablesBucketKey,
  ReceivablesClientRow,
  ReceivablesCurrency,
  ReceivablesDocumentRow,
  ReceivablesResponse,
} from '@nexo/contracts';
import { ChevronDown, ChevronRight, AlertTriangle, ReceiptText } from 'lucide-react';
import { useMemo } from 'react';
import type { Column } from '../ui';
import { Badge, DataTable, EmptyState, cx } from '../ui';
import {
  BUCKET_COLORS,
  BUCKET_TEXT_COLORS,
  bucketAmount,
  bucketMeta,
  bucketTotalAmount,
  formatDays,
  formatPct,
  formatReceivablesMoney,
  formatStatementDate,
  paymentLabel,
} from '../../lib/receivables';

// ============================================================
// Tablas de CxC: resumen por cliente (con la matriz completa de tramos) y
// detalle por documento. La expansión del cliente reutiliza la misma
// respuesta del API, sin una consulta adicional por fila.
// ============================================================

export function BucketBadge({ bucket }: { bucket: ReceivablesBucketKey }) {
  const meta = bucketMeta(bucket);
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-pill px-2.5 py-1 text-label-sm font-bold"
      style={{ backgroundColor: `${BUCKET_COLORS[bucket]}18`, color: BUCKET_TEXT_COLORS[bucket] }}
    >
      {meta.label}
    </span>
  );
}

function MoneyCell({ value, currency, tone }: { value: number; currency: ReceivablesCurrency; tone?: 'danger' | 'success' | 'muted' }) {
  if (!value) return <span className="text-outline">—</span>;
  return (
    <span
      className={cx(
        'tabular-nums',
        tone === 'danger' && 'font-bold text-error',
        tone === 'success' && 'font-semibold text-secondary',
        tone === 'muted' ? 'text-on-surface-variant' : !tone && 'text-on-surface',
      )}
    >
      {formatReceivablesMoney(value, currency)}
    </span>
  );
}

function OverdueBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  const color = pct >= 80 ? '#dc2626' : pct >= 50 ? '#f59e0b' : '#10b981';
  return (
    <span className="flex min-w-[74px] flex-col gap-1">
      <span className="text-label-sm font-semibold tabular-nums text-on-surface-variant">{formatPct(pct)}</span>
      <span className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-container-high">
        <span className="block h-full rounded-pill" style={{ width: `${width}%`, backgroundColor: color }} />
      </span>
    </span>
  );
}

function OnTimeBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-outline">—</span>;
  const width = Math.max(0, Math.min(100, pct));
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#dc2626';
  return (
    <span className="flex min-w-[74px] flex-col gap-1">
      <span className="text-label-sm font-semibold tabular-nums text-on-surface-variant">{formatPct(pct)}</span>
      <span className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-container-high">
        <span className="block h-full rounded-pill" style={{ width: `${width}%`, backgroundColor: color }} />
      </span>
    </span>
  );
}

function clientTitle(row: ReceivablesClientRow): string {
  return `${row.nombre} (${row.codigo})…`;
}

function clientMeta(row: ReceivablesClientRow): string {
  return [row.codigo, row.zonaLabel || row.zona, row.tipoClienteLabel || row.tipoCliente]
    .filter(Boolean)
    .join(' · ');
}

function bucketColumns(currency: ReceivablesCurrency): Column<ReceivablesClientRow>[] {
  return RECEIVABLES_BUCKETS.map((bucket) => ({
    key: bucket.key,
    header: bucket.short,
    align: 'right',
    kind: 'detail',
    className: 'min-w-[92px]',
    sortValue: (row) => bucketAmount(row, bucket.key),
    help: {
      id: bucket.key,
      title: bucket.label,
      short: bucket.range,
      what: `Monto de los documentos débito en el tramo ${bucket.label.toLowerCase()}.`,
    },
    render: (row) => {
      const value = bucketAmount(row, bucket.key);
      return value > 0 ? (
        <span className="font-semibold tabular-nums text-on-surface">{formatReceivablesMoney(value, currency)}</span>
      ) : (
        <span className="text-outline">—</span>
      );
    },
  }));
}

export function ReceivablesSummaryTable({
  report,
  currency,
  expandedKey,
  onToggle,
  showHelpRow,
}: {
  report: ReceivablesResponse;
  currency: ReceivablesCurrency;
  expandedKey: string | null;
  onToggle: (code: string) => void;
  showHelpRow: boolean;
}) {
  const columns = useMemo<Column<ReceivablesClientRow>[]>(() => {
    const buckets = bucketColumns(currency);
    return [
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'id',
        sortValue: (row) => row.nombre,
        title: (row) => clientTitle(row),
        render: (row) => (
          <span className="flex min-w-[220px] max-w-[330px] flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-on-surface">{row.nombre}</span>
              {row.excedeLimite && (
                <span title="La cartera supera el límite de crédito" className="shrink-0 text-error">
                  <AlertTriangle aria-hidden className="size-3.5" />
                </span>
              )}
            </span>
            <span className="truncate text-label-sm normal-case text-on-surface-variant">{clientMeta(row)}</span>
          </span>
        ),
      },
      {
        key: 'vendedor',
        header: 'Vendedor',
        kind: 'field',
        sortValue: (row) => row.vendedor,
        title: (row) => row.vendedor,
        render: (row) => (
          <span className="block max-w-[150px] truncate text-on-surface-variant" title={row.vendedor}>
            {row.vendedor}
          </span>
        ),
      },
      {
        key: 'tipo',
        header: 'Tipo',
        kind: 'status',
        sortValue: (row) => row.tipoClienteLabel || row.tipoCliente,
        render: (row) =>
          row.tipoCliente ? (
            <Badge tone="primary">{row.tipoClienteLabel || row.tipoCliente}</Badge>
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      {
        key: 'cartera',
        header: 'Cartera bruta',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.cartera,
        help: {
          id: 'cartera',
          title: 'Cartera bruta',
          short: 'Deuda abierta',
          what: 'Saldo de documentos débito abiertos, sin descontar adelantos.',
        },
        render: (row) =>
          row.cartera > 0 ? (
            <span className="font-bold tabular-nums text-primary">{formatReceivablesMoney(row.cartera, currency)}</span>
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      ...buckets,
      {
        key: 'vencido',
        header: 'Vencido',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.vencido,
        help: {
          id: 'vencido',
          title: 'Vencido',
          short: 'Suma de los tramos',
          what: 'Suma de los tramos con días vencidos mayores que cero.',
        },
        render: (row) => (
          <span className={cx('font-bold tabular-nums', row.vencido > 0 ? 'text-error' : 'text-outline')}>
            {row.vencido > 0 ? formatReceivablesMoney(row.vencido, currency) : '—'}
          </span>
        ),
      },
      {
        key: 'aFavor',
        header: 'A favor',
        align: 'right',
        kind: 'metric',
        className: 'min-w-[112px]',
        sortValue: (row) => row.aFavor,
        help: {
          id: 'aFavor',
          title: 'A favor',
          short: 'Adelantos y notas de crédito',
          what: 'Saldo de adelantos y notas de crédito; se resta para la cartera neta.',
        },
        render: (row) => <MoneyCell value={row.aFavor} currency={currency} tone="success" />,
      },
      {
        key: 'pctVencido',
        header: '% vencido',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.pctVencido,
        help: {
          id: 'pctVencido',
          title: '% vencido',
          short: 'Participación de la mora',
          what: 'Porcentaje de la cartera bruta que está vencida.',
        },
        render: (row) => <OverdueBar pct={row.pctVencido} />,
      },
      {
        key: 'documentos',
        header: 'Docs',
        align: 'right',
        kind: 'field',
        sortValue: (row) => row.documentos,
        render: (row) => (
          <span className="flex flex-col text-right">
            <span className="font-semibold tabular-nums text-on-surface">{row.documentos}</span>
            {row.vencidos > 0 && (
              <span className="text-label-sm tabular-nums text-error">{row.vencidos} vencidos</span>
            )}
          </span>
        ),
      },
      {
        key: 'ultimoPago',
        header: 'Último pago',
        kind: 'field',
        sortValue: (row) => row.ultimoPago ?? '',
        help: {
          id: 'ultimoPago',
          title: 'Último pago',
          short: 'Último abono aplicado',
          what: 'Fecha del último recibo aplicado a una factura; los días son desde ese abono.',
        },
        render: (row) => (
          <span
            className={cx(
              'block max-w-[130px] truncate text-label-md',
              !row.ultimoPago || (row.diasSinPago ?? 0) > 30 ? 'font-semibold text-warning' : 'text-on-surface-variant',
            )}
          >
            {paymentLabel(row)}
          </span>
        ),
      },
      {
        key: 'cobrado90',
        header: 'Cobrado 90 d',
        align: 'right',
        kind: 'detail',
        sortValue: (row) => row.cobrado90,
        help: {
          id: 'cobrado90',
          title: 'Cobrado 90 días',
          short: 'Abonos recientes',
          what: 'Abonos aplicados a facturas en los últimos 90 días; no incluye adelantos.',
        },
        render: (row) => <MoneyCell value={row.cobrado90} currency={currency} tone="muted" />,
      },
      {
        key: 'cobrado12m',
        header: 'Cobrado 12 m',
        align: 'right',
        kind: 'detail',
        sortValue: (row) => row.cobrado12m,
        help: {
          id: 'cobrado12m',
          title: 'Cobrado 12 meses',
          short: 'Abonos de los últimos 12 meses',
          what: 'Abonos aplicados a facturas en los últimos 12 meses; no incluye adelantos ni notas de crédito.',
        },
        render: (row) => <MoneyCell value={row.cobrado12m} currency={currency} tone="muted" />,
      },
      {
        key: 'pctCobranzaATiempo',
        header: '% a tiempo',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.pctCobranzaATiempo ?? -1,
        help: {
          id: 'pctCobranzaATiempo',
          title: '% de cobranza a tiempo',
          short: 'Cobrado antes del vencimiento',
          what: 'Porcentaje del monto cobrado en 12 meses que se aplicó en la fecha de vencimiento o antes. Se pondera por monto.',
        },
        render: (row) => <OnTimeBar pct={row.pctCobranzaATiempo} />,
      },
      {
        key: 'accion',
        header: '',
        align: 'right',
        kind: 'action',
        render: (row) => (
          <button
            type="button"
            onClick={() => onToggle(row.codigo)}
            aria-expanded={expandedKey === row.codigo}
            className="inline-flex items-center gap-space-2xs whitespace-nowrap rounded-pill border border-outline-variant/50 px-2.5 py-1 text-label-md font-semibold text-primary-container transition-colors hover:bg-surface-container-low"
          >
            {expandedKey === row.codigo ? (
              <ChevronDown aria-hidden className="size-4" />
            ) : (
              <ChevronRight aria-hidden className="size-4" />
            )}
            {expandedKey === row.codigo ? 'Ocultar' : 'Documentos'}
          </button>
        ),
      },
    ];
  }, [currency, expandedKey, onToggle]);

  const totals = report.totals;
  const totalCols = columns.length;

  const footer = (
    <tr className="border-t border-outline-variant/40 bg-surface-container-low text-label-md font-bold">
      <td className="sticky left-0 z-[1] border-r border-outline-variant/25 bg-surface-container-low px-space-sm py-2.5 text-primary">
        Total · {totals.clientes} con saldo
      </td>
      <td className="px-space-sm py-2.5" />
      <td className="px-space-sm py-2.5" />
      <td className="px-space-sm py-2.5 text-right tabular-nums text-primary">{formatReceivablesMoney(totals.cartera, currency)}</td>
      {RECEIVABLES_BUCKETS.map((bucket) => {
        const value = bucketTotalAmount(totals, bucket.key);
        return (
          <td key={bucket.key} className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">
            {value > 0 ? formatReceivablesMoney(value, currency) : '—'}
          </td>
        );
      })}
      <td className="px-space-sm py-2.5 text-right tabular-nums text-error">{formatReceivablesMoney(totals.vencido, currency)}</td>
      <td className="whitespace-nowrap px-space-sm py-2.5 text-right tabular-nums text-secondary">{formatReceivablesMoney(totals.aFavor, currency)}</td>
      <td className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">{formatPct(totals.pctVencido)}</td>
      <td className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">{totals.documentos}</td>
      <td className="px-space-sm py-2.5" />
      <td className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">{formatReceivablesMoney(totals.cobrado90, currency)}</td>
      <td className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">{formatReceivablesMoney(totals.cobrado12m, currency)}</td>
      <td className="px-space-sm py-2.5 text-right tabular-nums text-on-surface-variant">
        {totals.pctCobranzaATiempo === null ? '—' : formatPct(totals.pctCobranzaATiempo)}
      </td>
      <td className="px-space-sm py-2.5" />
      {Array.from({ length: totalCols - (13 + RECEIVABLES_BUCKETS.length) }).map((_, index) => (
        <td key={`extra-${index}`} className="px-space-sm py-2.5" />
      ))}
    </tr>
  );

  return (
    <DataTable
      columns={columns}
      rows={report.clientes}
      rowKey={(row) => row.codigo}
      defaultSortKey="cartera"
      defaultSortDir="desc"
      maxHeightClass="md:max-h-[min(64vh,820px)]"
      expandedKey={expandedKey}
      onRowClick={(row) => onToggle(row.codigo)}
      renderExpanded={(row) => <ClientDocumentsPanel report={report} currency={currency} client={row} />}
      showHelpRow={showHelpRow}
      footer={footer}
      mobileSummary={
        <span>
          {totals.clientesConDeuda} con deuda · {formatReceivablesMoney(totals.cartera, currency)} bruto ·{' '}
          {formatReceivablesMoney(totals.vencido, currency)} vencido
        </span>
      }
      empty={
        <EmptyState
          icon={ReceiptText}
          title="Sin cartera para estos filtros"
          description="Prueba cambiando el cliente, el vendedor o la moneda; si desmarcas «Solo vencido» también aparecen los documentos por vencer."
        />
      }
    />
  );
}

function ClientDocumentsPanel({
  report,
  currency,
  client,
}: {
  report: ReceivablesResponse;
  currency: ReceivablesCurrency;
  client: ReceivablesClientRow;
}) {
  const docs = report.documentos.filter((doc) => doc.clienteCodigo === client.codigo);
  const meta = [
    `Cartera ${formatReceivablesMoney(client.cartera, currency)}`,
    `A favor ${formatReceivablesMoney(client.aFavor, currency)}`,
    `Neto ${formatReceivablesMoney(client.neto, currency)}`,
    `Cobrado 12 m ${formatReceivablesMoney(client.cobrado12m, currency)}`,
    client.pctCobranzaATiempo !== null ? `${formatPct(client.pctCobranzaATiempo)} a tiempo` : null,
    client.plazoPago !== null && client.plazoPago > 0 ? `Plazo ${client.plazoPago} d` : null,
    currency === 'USD' && client.limiteCredito !== null && client.limiteCredito > 0
      ? `Límite USD ${formatReceivablesMoney(client.limiteCredito, 'USD')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <p className="text-label-md font-semibold text-primary">
          {client.nombre} <span className="font-normal text-on-surface-variant">· {client.codigo}</span>
        </p>
        <p className="text-label-sm text-on-surface-variant">{meta}</p>
      </div>
      {docs.length === 0 ? (
        <p className="rounded-lg bg-surface-container px-space-md py-space-sm text-body-md text-on-surface-variant">
          No hay documentos débito en la lista actual. Si el cliente tiene adelantos, el saldo a favor está en el
          resumen.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
          <table className="w-full min-w-[720px] border-collapse text-label-md">
            <thead>
              <tr className="border-b border-outline-variant/30 text-left text-label-sm uppercase tracking-wide text-outline">
                <th className="px-space-sm py-2">Tipo</th>
                <th className="px-space-sm py-2">Nro doc</th>
                <th className="px-space-sm py-2">Emisión</th>
                <th className="px-space-sm py-2">Vencimiento</th>
                <th className="px-space-sm py-2 text-right">Días</th>
                <th className="px-space-sm py-2">Tramo</th>
                <th className="px-space-sm py-2 text-right">Saldo</th>
                <th className="px-space-sm py-2 text-right">Monto original</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {docs.map((doc) => (
                <tr key={`${doc.tipoDoc}-${doc.nroDoc}`}>
                  <td className="px-space-sm py-2">
                    <Badge tone={doc.esCredito ? 'success' : doc.tipoDoc === 'FACT' ? 'primary' : 'muted'}>
                      {doc.tipoDoc}
                    </Badge>
                  </td>
                  <td className="px-space-sm py-2 font-semibold tabular-nums text-primary">{doc.nroDoc}</td>
                  <td className="px-space-sm py-2 tabular-nums text-on-surface-variant">{formatStatementDate(doc.fechaEmision)}</td>
                  <td className="px-space-sm py-2 tabular-nums text-on-surface-variant">{formatStatementDate(doc.fechaVencimiento)}</td>
                  <td className="px-space-sm py-2 text-right tabular-nums">
                    {doc.esCredito ? '—' : formatDays(doc.diasVencimiento)}
                  </td>
                  <td className="px-space-sm py-2">
                    {doc.esCredito ? (
                      <Badge tone="success">A favor</Badge>
                    ) : doc.tramo ? (
                      <BucketBadge bucket={doc.tramo} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={cx('px-space-sm py-2 text-right font-semibold tabular-nums', doc.esCredito ? 'text-secondary' : 'text-on-surface')}>
                    {doc.esCredito ? '-' : ''}
                    {formatReceivablesMoney(doc.saldo, currency)}
                  </td>
                  <td className="px-space-sm py-2 text-right tabular-nums text-on-surface-variant">
                    {doc.montoOriginal === null ? '—' : formatReceivablesMoney(doc.montoOriginal, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReceivablesDocumentsTable({
  report,
  currency,
  showHelpRow,
}: {
  report: ReceivablesResponse;
  currency: ReceivablesCurrency;
  showHelpRow: boolean;
}) {
  const columns = useMemo<Column<ReceivablesDocumentRow>[]>(() => {
    const bucketCols: Column<ReceivablesDocumentRow>[] = RECEIVABLES_BUCKETS.map((bucket) => ({
      key: `doc-${bucket.key}`,
      header: bucket.short,
      align: 'right',
      kind: 'detail',
      className: 'min-w-[88px]',
      sortValue: (row) => (row.tramo === bucket.key ? row.saldo : 0),
      render: (row) =>
        row.tramo === bucket.key ? (
          <span className="font-semibold tabular-nums text-on-surface">{formatReceivablesMoney(row.saldo, currency)}</span>
        ) : (
          <span className="text-outline">—</span>
        ),
    }));

    return [
      {
        key: 'cliente',
        header: 'Cliente',
        kind: 'id',
        sortValue: (row) => row.clienteNombre,
        render: (row) => (
          <span className="flex min-w-[210px] max-w-[300px] flex-col gap-0.5">
            <span className="truncate font-semibold text-on-surface">{row.clienteNombre}</span>
            <span className="text-label-sm normal-case text-on-surface-variant">{row.clienteCodigo}</span>
          </span>
        ),
      },
      {
        key: 'tipoDoc',
        header: 'Tipo Doc',
        kind: 'status',
        sortValue: (row) => row.tipoDoc,
        render: (row) => (
          <Badge tone={row.esCredito ? 'success' : row.tipoDoc === 'FACT' ? 'primary' : 'muted'}>
            {row.tipoDoc}
          </Badge>
        ),
      },
      {
        key: 'nroDoc',
        header: 'Nº doc',
        kind: 'field',
        sortValue: (row) => row.nroDoc,
        render: (row) => <span className="font-semibold tabular-nums text-primary">{row.nroDoc}</span>,
      },
      {
        key: 'emision',
        header: 'Emisión',
        kind: 'field',
        sortValue: (row) => row.fechaEmision ?? '',
        render: (row) => <span className="tabular-nums">{formatStatementDate(row.fechaEmision)}</span>,
      },
      {
        key: 'vencimiento',
        header: 'Vencimiento',
        kind: 'field',
        sortValue: (row) => row.fechaVencimiento ?? '',
        render: (row) => <span className="tabular-nums">{formatStatementDate(row.fechaVencimiento)}</span>,
      },
      {
        key: 'dias',
        header: 'Días',
        align: 'right',
        kind: 'status',
        sortValue: (row) => (row.esCredito ? -99999 : row.diasVencimiento),
        render: (row) =>
          row.esCredito ? (
            <span className="text-outline">—</span>
          ) : (
            <span
              className={cx(
                'font-semibold tabular-nums',
                row.diasVencimiento > 0 ? 'text-error' : 'text-on-surface-variant',
              )}
            >
              {formatDays(row.diasVencimiento)}
            </span>
          ),
      },
      {
        key: 'saldo',
        header: 'Saldo',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => row.saldo,
        render: (row) => (
          <span className={cx('font-bold tabular-nums', row.esCredito ? 'text-secondary' : 'text-on-surface')}>
            {row.esCredito ? '-' : ''}
            {formatReceivablesMoney(row.saldo, currency)}
          </span>
        ),
      },
      {
        key: 'tramo',
        header: 'Tramo',
        kind: 'status',
        sortValue: (row) => (row.tramo ? bucketMeta(row.tramo).label : 'A favor'),
        render: (row) =>
          row.esCredito ? (
            <Badge tone="success">A favor</Badge>
          ) : row.tramo ? (
            <BucketBadge bucket={row.tramo} />
          ) : (
            <span className="text-outline">—</span>
          ),
      },
      ...bucketCols,
      {
        key: 'vencido',
        header: 'Vencido',
        align: 'right',
        kind: 'metric',
        sortValue: (row) => (row.esCredito || row.diasVencimiento <= 0 ? 0 : row.saldo),
        render: (row) =>
          row.esCredito || row.diasVencimiento <= 0 ? (
            <span className="text-outline">—</span>
          ) : (
            <span className="font-bold tabular-nums text-error">{formatReceivablesMoney(row.saldo, currency)}</span>
          ),
      },
      {
        key: 'montoOriginal',
        header: 'Monto original',
        align: 'right',
        kind: 'detail',
        sortValue: (row) => row.montoOriginal ?? 0,
        render: (row) => (
          <span className="tabular-nums text-on-surface-variant">
            {row.montoOriginal === null ? '—' : formatReceivablesMoney(row.montoOriginal, currency)}
          </span>
        ),
      },
      {
        key: 'vendedor',
        header: 'Vendedor',
        kind: 'field',
        sortValue: (row) => row.vendedor,
        render: (row) => (
          <span className="block max-w-[150px] truncate text-on-surface-variant" title={row.vendedor}>
            {row.vendedor || '—'}
          </span>
        ),
      },
    ];
  }, [currency]);

  return (
    <DataTable
      columns={columns}
      rows={report.documentos}
      rowKey={(row) => `${row.clienteCodigo}-${row.tipoDoc}-${row.nroDoc}`}
      defaultSortKey="dias"
      defaultSortDir="desc"
      maxHeightClass="md:max-h-[min(66vh,840px)]"
      showHelpRow={showHelpRow}
      mobileSummary={
        <span>
          {report.documentos.length} documento(s) · {formatReceivablesMoney(report.totals.cartera, currency)} cartera
        </span>
      }
      empty={
        <EmptyState
          icon={ReceiptText}
          title="Sin documentos para estos filtros"
          description="Cambia la búsqueda o el vendedor; si esperabas ver adelantos, activa «Incluir a favor»."
        />
      }
    />
  );
}

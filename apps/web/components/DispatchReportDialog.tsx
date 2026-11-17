'use client';

// ============================================================
// Reporte de la hoja de despacho (solo lectura).
//
// El proceso termina al entregar la última factura: la hoja se cierra sola y
// este reporte queda como respaldo exportable. Muestra los renglones por
// cliente y los cuatro tiempos del flujo.
// ============================================================

import type { DispatchSheetDetail } from '@nexo/contracts';
import { CheckCheck, Clock, Download, Play, Receipt, Timer, X } from 'lucide-react';
import type { DispatchReport } from '../lib/dispatch-sheet';
import { formatBusinessDate, formatDateTime, formatDurationBetween, formatNumber } from '../lib/dispatch-sheet';
import { LineStatusBadge } from './DispatchSheetParts';
import { Badge, cx } from './ui';

interface DispatchReportDialogProps {
  open: boolean;
  sheet: DispatchSheetDetail;
  report: DispatchReport;
  onClose: () => void;
  onExport: () => void;
}

export function DispatchReportDialog({ open, sheet, report, onClose, onExport }: DispatchReportDialogProps) {
  if (!open) return null;

  return (
    <div
      role="presentation"
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-primary/40 p-space-md backdrop-blur-sm sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-report-title"
        className="animate-rise flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div className="flex items-start justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 p-space-md">
          <div className="min-w-0">
            <p className="font-semibold uppercase tracking-wider text-label-md text-primary">Reporte de despacho</p>
            <h2 id="dispatch-report-title" className="truncate text-headline-md text-primary">
              {sheet.number} · {sheet.title}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {sheet.customers.join(' / ') || 'Sin clientes'} · {report.totals.lines} renglón(es) ·{' '}
              {formatNumber(report.totals.plannedSacks)} sacos · {formatNumber(report.totals.plannedKg)} kg plan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar reporte"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-space-md">
          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            <ReportKpi
              label="Cargados"
              value={`${report.completed.lines}/${report.totals.lines}`}
              hint={formatNumber(report.completed.kg) + ' kg'}
            />
            <ReportKpi
              label="Parciales"
              value={formatNumber(report.partial.lines)}
              hint={report.partial.lines > 0 ? formatNumber(report.partial.kg) + ' kg plan' : 'sin parciales'}
              tone={report.partial.lines > 0 ? 'primary' : 'muted'}
            />
            <ReportKpi
              label="No cargados"
              value={formatNumber(report.missing.lines)}
              hint={report.missing.lines > 0 ? formatNumber(report.missing.kg) + ' kg plan' : 'ninguno'}
              tone={report.missing.lines > 0 ? 'error' : 'muted'}
            />
            <ReportKpi
              label="Pendientes"
              value={formatNumber(report.pending.lines)}
              hint={
                report.pending.lines > 0
                  ? 'sin resolver'
                  : report.totals.differenceKg < 0
                    ? `faltan ${formatNumber(Math.abs(report.totals.differenceKg))} kg`
                    : 'sin diferencia'
              }
              tone={report.pending.lines > 0 ? 'error' : 'muted'}
            />
          </div>

          <div className="mt-space-md grid grid-cols-1 gap-space-sm rounded-xl border border-outline-variant/40 bg-surface-container-low/50 p-space-sm sm:grid-cols-2 lg:grid-cols-5">
            <ReportTime icon={Clock} label="Enviado" at={sheet.sentAt} />
            <ReportTime
              icon={Play}
              label="Inicio de carga"
              at={sheet.loadStartedAt}
              hint={
                sheet.loadStartedAt ? `T1 ${formatDurationBetween(sheet.sentAt, sheet.loadStartedAt)}` : 'sin iniciar'
              }
            />
            <ReportTime
              icon={CheckCheck}
              label="Último artículo"
              at={sheet.loadClosedAt}
              hint={sheet.loadClosedAt ? `T2 ${formatDurationBetween(sheet.loadStartedAt, sheet.loadClosedAt)}` : undefined}
            />
            <ReportTime
              icon={Receipt}
              label="Factura entregada"
              at={sheet.invoiceDeliveredAt}
              hint={
                sheet.invoiceDeliveredAt
                  ? `T3 ${formatDurationBetween(sheet.loadStartedAt, sheet.invoiceDeliveredAt)}`
                  : 'pendiente'
              }
            />
            <ReportTime
              icon={Timer}
              label="Total (T4)"
              at={sheet.invoiceDeliveredAt}
              hint={
                sheet.invoiceDeliveredAt
                  ? `desde la simulación: ${formatDurationBetween(sheet.scenarioCreatedAt, sheet.invoiceDeliveredAt)}`
                  : undefined
              }
            />
          </div>

          <div className="mt-space-md flex flex-col gap-space-md">
            {report.groups.map((group) => (
              <section key={group.key} className="overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low/70 px-space-sm py-1.5">
                  <span className="font-semibold text-on-surface">{group.name}</span>
                  <span className="flex flex-wrap items-center gap-space-sm text-label-sm tabular-nums text-on-surface-variant">
                    <span>{group.lines.length} renglón(es)</span>
                    <span>{formatNumber(group.plannedKg)} kg plan</span>
                    {group.pendingLines > 0 ? (
                      <Badge tone="warning">{group.pendingLines} por resolver</Badge>
                    ) : group.partialLines + group.missingLines > 0 ? (
                      <Badge tone="danger">
                        {group.partialLines} parcial(es) · {group.missingLines} no cargado(s)
                      </Badge>
                    ) : (
                      <Badge tone="success">cargado</Badge>
                    )}
                  </span>
                </header>
                <ul className="divide-y divide-outline-variant/25">
                  {group.lines.map((line) => (
                    <li key={line.id} className="grid grid-cols-1 gap-space-xs px-space-sm py-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,9rem)_8rem] sm:items-center">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-space-xs">
                          <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span>
                          <span className="text-label-sm text-outline">turno {line.position}</span>
                        </p>
                        <p className="truncate text-body-md text-on-surface-variant" title={line.description ?? ''}>
                          <span className="font-semibold text-on-surface">{line.productCode}</span> ·{' '}
                          {line.description ?? '—'}
                        </p>
                        {line.note && (
                          <p className="mt-space-2xs whitespace-pre-wrap rounded-lg bg-surface-container-low px-space-xs py-0.5 text-label-md text-on-surface-variant">
                            {line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD' ? (
                              <>
                                <span className="font-semibold text-error">Motivo: </span>
                                {line.note}
                              </>
                            ) : (
                              line.note
                            )}
                          </p>
                        )}
                      </div>
                      <div className="text-label-md tabular-nums text-on-surface-variant sm:text-right">
                        {formatBusinessDate(line.effectiveDate)}
                      </div>
                      <div className="flex flex-col text-label-md tabular-nums sm:items-end">
                        <span className="font-semibold text-primary">
                          {formatNumber(line.plannedQty)} {line.uom ?? ''}
                        </span>
                        <span className="text-label-sm text-outline">{formatNumber(line.plannedKg)} kg</span>
                        {line.loadedQty !== null && (
                          <span
                            className={cx(
                              'text-label-sm font-semibold',
                              line.status === 'CARGADO' ? 'text-secondary' : 'text-error',
                            )}
                          >
                            Real: {formatNumber(line.loadedQty)} {line.uom ?? ''}
                          </span>
                        )}
                      </div>
                      <div className="sm:text-right">
                        <LineStatusBadge status={line.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={onExport}
            className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <Download aria-hidden className="size-4" /> Exportar
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportTime({
  icon: Icon,
  label,
  at,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  at: string | null;
  hint?: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline">
        <Icon aria-hidden className="size-3.5" /> {label}
      </p>
      <p className="font-semibold text-primary">{formatDateTime(at)}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

function ReportKpi({
  label,
  value,
  hint,
  tone = 'primary',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'primary' | 'muted' | 'error';
}) {
  return (
    <div className="rounded-xl bg-surface-container-low/70 px-space-sm py-2">
      <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">{label}</p>
      <p
        className={cx(
          'text-data-tabular-lg font-bold tabular-nums',
          tone === 'error' ? 'text-error' : tone === 'muted' ? 'text-on-surface' : 'text-primary',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-label-sm normal-case text-on-surface-variant">{hint}</p>}
    </div>
  );
}

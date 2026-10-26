'use client';

// ============================================================
// Reporte de cierre del despacho.
//
// Se abre antes de cerrar (revisión + nota opcional) y después de cerrar
// (solo lectura + exportación). Muestra TODOS los renglones agrupados por
// cliente: es el «reporte de todo» que firma el almacén.
// ============================================================

import type { DispatchSheetDetail } from '@nexo/contracts';
import { CheckCheck, Download, Loader2, X } from 'lucide-react';
import type { DispatchReport } from '../lib/dispatch-sheet';
import { formatBusinessDate, formatNumber } from '../lib/dispatch-sheet';
import { LineStatusBadge } from './DispatchSheetParts';
import { Badge, cx } from './ui';

interface DispatchReportDialogProps {
  open: boolean;
  sheet: DispatchSheetDetail;
  report: DispatchReport;
  readOnly: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onExport: () => void;
  busy: boolean;
}

export function DispatchReportDialog({
  open,
  sheet,
  report,
  readOnly,
  note,
  onNoteChange,
  onClose,
  onConfirm,
  onExport,
  busy,
}: DispatchReportDialogProps) {
  if (!open) return null;

  const canClose = !readOnly && report.pending.lines === 0 && !busy;

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
            <p className="font-semibold uppercase tracking-wider text-label-md text-primary">
              {readOnly ? 'Reporte de cierre' : 'Reporte de despacho'}
            </p>
            <h2 id="dispatch-report-title" className="truncate text-headline-md text-primary">
              {sheet.number} · {sheet.title}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {sheet.customers.join(' / ') || 'Sin clientes'} · {report.totals.lines} renglón(es)
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
              label="Completados"
              value={`${report.completed.lines}/${report.totals.lines}`}
              hint={formatNumber(report.completed.kg) + ' kg'}
            />
            <ReportKpi label="Sacos plan" value={formatNumber(report.totals.plannedSacks)} />
            <ReportKpi label="Kg plan" value={formatNumber(report.totals.plannedKg)} />
            <ReportKpi
              label="Pendientes"
              value={formatNumber(report.pending.lines)}
              hint={report.pending.lines > 0 ? formatNumber(report.pending.kg) + ' kg' : 'todo listo'}
              tone={report.pending.lines > 0 ? 'error' : 'muted'}
            />
          </div>

          {!readOnly && report.pending.lines > 0 && (
            <p className="mt-space-md rounded-xl border border-warning/40 bg-warning/10 px-space-sm py-2 text-label-md font-semibold text-on-warning-container">
              Este reporte todavía tiene {report.pending.lines} renglón(es) sin completar. Vuelve a la hoja y
              márcalos para poder cerrar.
            </p>
          )}

          <div className="mt-space-md flex flex-col gap-space-md">
            {report.groups.map((group) => (
              <section key={group.key} className="overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low/70 px-space-sm py-1.5">
                  <span className="font-semibold text-on-surface">{group.name}</span>
                  <span className="flex flex-wrap items-center gap-space-sm text-label-sm tabular-nums text-on-surface-variant">
                    <span>{group.lines.length} renglón(es)</span>
                    <span>{formatNumber(group.plannedKg)} kg plan</span>
                    {group.pendingLines > 0 ? (
                      <Badge tone="warning">{group.pendingLines} por completar</Badge>
                    ) : (
                      <Badge tone="success">completo</Badge>
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
                      </div>
                      <div className="text-label-md tabular-nums text-on-surface-variant sm:text-right">
                        {formatBusinessDate(line.effectiveDate)}
                      </div>
                      <div className="flex flex-col text-label-md tabular-nums sm:items-end">
                        <span className="font-semibold text-primary">
                          {formatNumber(line.plannedQty)} {line.uom ?? ''}
                        </span>
                        <span className="text-label-sm text-outline">{formatNumber(line.plannedKg)} kg</span>
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

          {!readOnly && (
            <label className="mt-space-md flex flex-col gap-1">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                Nota de cierre (opcional)
              </span>
              <textarea
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ej. Se cargó todo en la puerta 2…"
                className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-lg py-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
          >
            {readOnly ? 'Cerrar' : 'Volver'}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <Download aria-hidden className="size-4" /> Exportar
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canClose}
              title={report.pending.lines > 0 ? 'Completa todos los renglones antes de cerrar' : undefined}
              className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CheckCheck aria-hidden className="size-4" />}
              Cerrar y generar reporte
            </button>
          )}
        </div>
      </div>
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


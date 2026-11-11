'use client';

// ============================================================
// Hoja de despacho para teléfono.
//
// Se monta solo cuando `useIsMobile()` detecta <768 px o pantalla táctil.
// La vista de PC no cambia. Optimizada para el piso: tarjetas por cliente,
// botones grandes, cronómetros vivos y barra inferior fija.
// ============================================================

import type { DispatchCustomerProgress, DispatchLineMark, DispatchSheetDetail, DispatchSheetLine } from '@nexo/contracts';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  PackageX,
  Pencil,
  Play,
  Receipt,
  RotateCcw,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import type { DispatchReport, CustomerGroup } from '../lib/dispatch-sheet';
import {
  formatBusinessDate,
  formatDateTime,
  formatDurationBetween,
  formatMinutes,
  formatNumber,
  lineEffectiveQty,
  minutesBetween,
} from '../lib/dispatch-sheet';
import { Elapsed, LineStatusBadge, SheetStatusBadge } from './DispatchSheetParts';
import { Badge, Card, cx } from './ui';

type LineResolution = { status: DispatchLineMark; loadedQty?: number; note?: string };

interface DispatchMobileViewProps {
  sheet: DispatchSheetDetail;
  report: DispatchReport;
  progressByKey: Map<string, DispatchCustomerProgress>;
  editable: boolean;
  closed: boolean;
  isAdmin: boolean;
  busy: string | null;
  savingLine: string | null;
  groupBusy: string | null;
  drafts: Record<string, string>;
  openGroup: string | null;
  canInvoiceAll: boolean;
  pendingInvoices: number;
  onOpenGroup: (key: string | null) => void;
  onStartGroup: (group: CustomerGroup) => void;
  onSetDraft: (lineId: string, value: string | null) => void;
  onCommitQuantity: (line: DispatchSheetLine) => void;
  onSaveLine: (line: DispatchSheetLine, resolution: LineResolution) => void;
  onOpenMissing: (line: DispatchSheetLine) => void;
  onEditNote: (line: DispatchSheetLine) => void;
  onOpenInvoice: (customerKey: string, customerName: string) => void;
  onReopenInvoice: (customerKey: string, customerName: string) => void;
  onOpenInvoiceAll: () => void;
  onOpenReport: (readOnly: boolean) => void;
  onOpenBitacora: () => void;
  onOpenCancel: () => void;
  onExport: () => void;
}

export function DispatchMobileView({
  sheet,
  report,
  progressByKey,
  editable,
  closed,
  isAdmin,
  busy,
  savingLine,
  groupBusy,
  drafts,
  openGroup,
  canInvoiceAll,
  pendingInvoices,
  onOpenGroup,
  onStartGroup,
  onSetDraft,
  onCommitQuantity,
  onSaveLine,
  onOpenMissing,
  onEditNote,
  onOpenInvoice,
  onReopenInvoice,
  onOpenInvoiceAll,
  onOpenReport,
  onOpenBitacora,
  onOpenCancel,
  onExport,
}: DispatchMobileViewProps) {
  const activeLines = sheet.lines.filter((line) => line.status !== 'ANULADO');
  const resolved = activeLines.filter((line) => line.status !== 'PENDIENTE').length;
  const percentage = activeLines.length > 0 ? Math.round((resolved / activeLines.length) * 100) : 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-space-md p-space-md pb-32">
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-space-sm">
        <Link
          href="/despacho"
          className="inline-flex h-11 items-center gap-1 rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-body-md text-on-surface-variant"
        >
          <ArrowLeft aria-hidden className="size-4" /> Tablero
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void onExport()}
            aria-label="Exportar hoja"
            className="grid size-11 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant"
          >
            <Download aria-hidden className="size-4" />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenBitacora}
              aria-label="Abrir bitácora"
              className="relative grid size-11 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant"
            >
              <MessageSquare aria-hidden className="size-4" />
              {sheet.events.length > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-pill bg-primary px-1 text-[10px] font-bold text-on-primary">
                  {sheet.events.length}
                </span>
              )}
            </button>
          )}
          {sheet.canCancel && (
            <button
              type="button"
              onClick={onOpenCancel}
              aria-label="Anular despacho"
              className="grid size-11 place-items-center rounded-full border border-critical/40 text-error"
            >
              <Ban aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Encabezado */}
      <div>
        <p className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline">
          <Truck aria-hidden className="size-3.5" /> {sheet.number}
        </p>
        <h1 className="text-headline-lg text-primary">{sheet.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-space-xs">
          <SheetStatusBadge status={sheet.status} />
          <span className="text-label-sm text-on-surface-variant">
            {sheet.createdByName ?? sheet.createdByCode ?? '—'} · {formatDateTime(sheet.sentAt)}
          </span>
        </div>
        {sheet.instructions && <p className="mt-1 text-body-md text-on-surface-variant">{sheet.instructions}</p>}
      </div>

      {/* Fases */}
      <Card className="p-space-md">
        <div className="grid grid-cols-2 gap-space-sm">
          <Phase
            icon={Clock}
            label="Inicio de carga"
            value={formatDateTime(sheet.loadStartedAt)}
            hint={sheet.loadStartedAt ? 'Reloj de carga y factura' : 'Sin iniciar'}
          />
          <Phase
            icon={CheckCheck}
            label="Carga cerrada"
            value={formatDateTime(sheet.loadClosedAt)}
            hint={formatDurationBetween(sheet.loadStartedAt, sheet.loadClosedAt)}
          />
          <Phase
            icon={Receipt}
            label="Factura entregada"
            value={formatDateTime(sheet.invoiceDeliveredAt)}
            hint={
              sheet.invoiceDeliveredAt
                ? formatDurationBetween(sheet.loadStartedAt, sheet.invoiceDeliveredAt)
                : `${pendingInvoices} pendiente(s)`
            }
          />
          <Phase
            icon={ClipboardCheck}
            label="Avance"
            value={`${resolved}/${activeLines.length}`}
            hint={`${percentage}% resuelto`}
          />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-pill bg-surface-container-high">
          <div
            className="h-full rounded-pill bg-secondary-container transition-[width] duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </Card>

      {/* Clientes */}
      <div className="flex flex-col gap-space-sm">
        {report.groups.map((group) => {
          const progress = progressByKey.get(group.key);
          const started = Boolean(progress?.loadStartedAt);
          const closedGroup = group.pendingLines === 0;
          const invoiced = Boolean(progress?.invoiceDeliveredAt);
          const isOpen = openGroup === group.key;
          const orderCount = new Set(group.lines.map((line) => line.orderNumber).filter(Boolean)).size;
          return (
            <Card key={group.key} className="overflow-hidden">
              <button
                type="button"
                onClick={() => onOpenGroup(isOpen ? null : group.key)}
                className="flex w-full items-start justify-between gap-space-sm p-space-md text-left"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-on-surface">{group.name}</p>
                  <p className="text-label-sm tabular-nums text-on-surface-variant">
                    {orderCount} pedido(s) · {group.lines.length} renglón(es) · {formatNumber(group.plannedKg)} kg
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {!started ? (
                      <Badge tone="muted" dot>
                        sin iniciar
                      </Badge>
                    ) : invoiced ? (
                      <Badge tone="success" dot>
                        facturada
                      </Badge>
                    ) : closedGroup ? (
                      <Badge tone="success" dot>
                        carga cerrada
                      </Badge>
                    ) : (
                      <Badge tone="primary" dot>
                        en carga
                      </Badge>
                    )}
                    {started && progress?.loadStartedAt && (
                      <span className="inline-flex items-center gap-1 text-label-sm text-outline">
                        <Clock aria-hidden className="size-3" />
                        {progress.loadClosedAt ? (
                          formatDurationBetween(progress.loadStartedAt, progress.loadClosedAt)
                        ) : (
                          <Elapsed since={progress.loadStartedAt} />
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
                ) : (
                  <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-outline" />
                )}
              </button>

              <div className="flex flex-wrap gap-space-xs px-space-md pb-space-md">
                {editable && !started && (
                  <button
                    type="button"
                    disabled={groupBusy !== null || savingLine !== null}
                    onClick={() => onStartGroup(group)}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill bg-secondary-container px-space-md font-bold text-label-md text-on-secondary disabled:opacity-40"
                  >
                    {groupBusy === group.key ? (
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                    ) : (
                      <Play aria-hidden className="size-4" />
                    )}
                    Iniciar carga
                  </button>
                )}
                {sheet.canInvoice && started && closedGroup && !invoiced && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onOpenInvoice(group.key, group.name)}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill bg-primary-container px-space-md font-bold text-label-md text-on-primary disabled:opacity-40"
                  >
                    <Receipt aria-hidden className="size-4" /> Factura entregada
                  </button>
                )}
                {invoiced && isAdmin && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onReopenInvoice(group.key, group.name)}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant disabled:opacity-40"
                  >
                    <RotateCcw aria-hidden className="size-4" /> Reabrir factura
                  </button>
                )}
              </div>

              {isOpen && (
                <ul className="divide-y divide-outline-variant/25 border-t border-outline-variant/25">
                  {group.lines.map((line) => {
                    const saving = savingLine === line.id;
                    const difference =
                      line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD';
                    const draftValue = drafts[line.id] ?? String(lineEffectiveQty(line));
                    return (
                      <li key={line.id} className={cx('p-space-md', difference && 'bg-warning-container/10')}>
                        <div className="flex items-start justify-between gap-space-sm">
                          <div className="min-w-0">
                            <p className="font-bold tabular-nums text-primary">{line.orderNumber}</p>
                            <p className="truncate text-body-md text-on-surface-variant">
                              <span className="font-semibold text-on-surface">{line.productCode}</span> ·{' '}
                              {line.description ?? '—'}
                            </p>
                            <p className="text-label-sm text-outline">
                              Entrega {formatBusinessDate(line.effectiveDate)} · plan {formatNumber(line.plannedQty)}{' '}
                              {line.uom ?? ''} / {formatNumber(line.plannedKg)} kg
                            </p>
                          </div>
                          <LineStatusBadge status={line.status} />
                        </div>

                        {line.note && (
                          <p
                            className={cx(
                              'mt-2 rounded-lg px-space-sm py-1 text-label-md',
                              difference ? 'bg-warning-container/30 text-on-surface' : 'bg-surface-container-low',
                            )}
                          >
                            {difference ? <span className="font-semibold">Motivo: </span> : null}
                            {line.note}
                            {difference && editable && !invoiced && (
                              <button
                                type="button"
                                onClick={() => onEditNote(line)}
                                className="ml-2 inline-flex items-center gap-1 font-semibold text-primary underline"
                              >
                                <Pencil aria-hidden className="size-3" /> Editar
                              </button>
                            )}
                          </p>
                        )}

                        {line.loadClosedAt && (
                          <p className="mt-1 text-label-sm text-outline">
                            Cerrado {formatDateTime(line.loadClosedAt)} ·{' '}
                            {formatMinutes(minutesBetween(line.loadStartedAt, line.loadClosedAt))}
                          </p>
                        )}

                        {editable && !invoiced && (
                          <div className="mt-2 flex items-end gap-2">
                            <label className="flex flex-1 flex-col gap-0.5">
                              <span className="text-label-sm font-semibold uppercase tracking-wider text-outline">
                                Cargado ({line.uom ?? 'unid.'})
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={line.plannedQty}
                                step={line.uom === 'SAC' ? 1 : 0.01}
                                value={draftValue}
                                disabled={saving || groupBusy !== null}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) => onSetDraft(line.id, event.target.value)}
                                onBlur={() => onCommitQuantity(line)}
                                onWheel={(event) => event.currentTarget.blur()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') event.currentTarget.blur();
                                  if (event.key === 'Escape') {
                                    onSetDraft(line.id, null);
                                    event.currentTarget.blur();
                                  }
                                }}
                                aria-label={`Cantidad cargada de ${line.productCode}`}
                                className="h-12 w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-right text-body-lg font-bold tabular-nums text-primary outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70 disabled:opacity-50"
                              />
                            </label>
                          </div>
                        )}

                        {editable && !invoiced && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {line.status === 'PENDIENTE' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={saving || groupBusy !== null}
                                  onClick={() => {
                                    onSetDraft(line.id, null);
                                    onSaveLine(line, { status: 'CARGADO' });
                                  }}
                                  className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill bg-secondary-container px-space-sm font-bold text-label-md text-on-secondary disabled:opacity-40"
                                >
                                  {saving ? (
                                    <Loader2 aria-hidden className="size-4 animate-spin" />
                                  ) : (
                                    <CheckCheck aria-hidden className="size-4" />
                                  )}
                                  Cerrar carga
                                </button>
                                <button
                                  type="button"
                                  disabled={saving || groupBusy !== null}
                                  onClick={() => {
                                    onSetDraft(line.id, null);
                                    onOpenMissing(line);
                                  }}
                                  className="inline-flex h-11 items-center justify-center gap-1 rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant disabled:opacity-40"
                                >
                                  <PackageX aria-hidden className="size-4" /> No cargado
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={groupBusy !== null}
                                onClick={() => {
                                  onSetDraft(line.id, null);
                                  onSaveLine(line, { status: 'PENDIENTE' });
                                }}
                                className="inline-flex h-11 items-center justify-center gap-1 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant disabled:opacity-40"
                              >
                                <RotateCcw aria-hidden className="size-4" /> Deshacer
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {sheet.status === 'CON_NOVEDAD' && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-container/30 p-space-sm text-label-md text-on-surface">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
          Hay diferencias registradas. Revisa los motivos antes de cerrar.
        </p>
      )}

      {closed && (
        <Card className="p-space-md">
          <p className="font-semibold text-primary">
            {sheet.status === 'DESPACHADO' ? 'Despacho cerrado' : 'Despacho anulado'}
          </p>
          <p className="text-label-sm text-on-surface-variant">
            {sheet.status === 'DESPACHADO'
              ? `${formatDateTime(sheet.completedAt)} · ${sheet.completedByName ?? 'almacén'}`
              : `${formatDateTime(sheet.canceledAt)} · ${sheet.canceledByName ?? '—'}`}
          </p>
          {pendingInvoices > 0 && (
            <p className="mt-2 text-label-md font-semibold text-warning">
              {pendingInvoices} cliente(s) con factura pendiente.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canInvoiceAll && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={onOpenInvoiceAll}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-pill bg-primary-container px-space-md font-bold text-label-md text-on-primary disabled:opacity-40"
              >
                <Receipt aria-hidden className="size-4" /> Facturar pendientes ({pendingInvoices})
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenReport(true)}
              className="inline-flex h-11 items-center justify-center gap-1 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-label-md text-on-surface-variant"
            >
              <ClipboardCheck aria-hidden className="size-4" /> Reporte
            </button>
          </div>
        </Card>
      )}

      {/* Barra inferior fija */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/40 bg-surface-container-lowest/95 p-space-sm pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lift backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-space-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-md font-semibold text-primary">
                {report.totals.done}/{report.totals.lines} productos cerrados
              </p>
              <p className="text-label-sm text-on-surface-variant">
                {pendingInvoices > 0 ? `${pendingInvoices} factura(s) pendiente(s)` : 'Carga y factura al día'}
              </p>
            </div>
            {canInvoiceAll && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={onOpenInvoiceAll}
                className="inline-flex h-11 items-center gap-1 rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant disabled:opacity-40"
              >
                <Receipt aria-hidden className="size-4" /> Facturar
              </button>
            )}
            <button
              type="button"
              disabled={report.pending.lines > 0 || busy !== null}
              onClick={() => onOpenReport(false)}
              className="inline-flex h-11 items-center gap-1 rounded-pill bg-primary-container px-space-md font-bold text-label-md text-on-primary disabled:opacity-40"
            >
              {busy === 'complete' ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <CheckCheck aria-hidden className="size-4" />
              )}
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Phase({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low/70 p-space-sm">
      <p className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wide text-outline">
        <Icon aria-hidden className="size-3.5" /> {label}
      </p>
      <p className="text-body-md font-bold text-primary">{value}</p>
      {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

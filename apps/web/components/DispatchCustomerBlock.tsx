'use client';

// ============================================================
// Bloque de carga de un cliente del despacho.
//
// Lo comparten la página del despacho y la expansión de la bandeja: misma
// cabecera con relojes, mismos renglones y mismos botones (Iniciar carga,
// Cargar, No cargado, Factura entregada). Así el operador ve lo mismo en los
// dos lugares, sin navegar a otra pantalla.
// ============================================================

import type {
  DispatchCustomerProgress,
  DispatchSheetDetail,
  DispatchSheetLine,
} from '@nexo/contracts';
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  PackageX,
  Pencil,
  Play,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import type { CustomerGroup, DispatchLineResolution } from '../lib/dispatch-sheet';
import {
  customerTimeline,
  formatBusinessDate,
  formatDateTime,
  formatDelta,
  formatNumber,
  formatTime,
  lineEffectiveQty,
  minutesBetween,
} from '../lib/dispatch-sheet';
import { DispatchCustomerTimeline } from './DispatchCustomerTimeline';
import { LineStatusBadge } from './DispatchSheetParts';
import { Badge, cx } from './ui';

export interface DispatchCustomerBlockProps {
  sheet: DispatchSheetDetail;
  group: CustomerGroup;
  progress?: DispatchCustomerProgress;
  editable: boolean;
  isAdmin: boolean;
  /** Acordeón de la página del despacho. En la bandeja el bloque va siempre abierto. */
  open: boolean;
  onToggle?: () => void;
  savingLine: string | null;
  groupBusy: string | null;
  drafts: Record<string, string>;
  invoiceBusy: boolean;
  onStart: () => void;
  onSetDraft: (lineId: string, value: string | null) => void;
  onCommitQuantity: (line: DispatchSheetLine) => void;
  onSaveLine: (line: DispatchSheetLine, resolution: DispatchLineResolution) => void;
  onOpenMissing: (line: DispatchSheetLine) => void;
  onEditNote: (line: DispatchSheetLine) => void;
  onOpenInvoice: () => void;
  onReopenInvoice: () => void;
}

/** Sello de cierre de un producto: hora real y tiempo desde el envío. */
function LineCloseStamp({ at, sentAt }: { at: string | null; sentAt: string | null }) {
  if (!at) return null;
  return (
    <span
      className="flex flex-col items-end leading-tight tabular-nums text-label-sm text-outline"
      title={`Cerrado ${formatDateTime(at)} · ${formatDelta(minutesBetween(sentAt, at))} desde el envío`}
    >
      <span>{formatTime(at)}</span>
      <span>{formatDelta(minutesBetween(sentAt, at))}</span>
    </span>
  );
}

/** Celda con etiqueta visible solo en móvil (la tabla de escritorio usa encabezados). */
function Cell({
  label,
  align = 'left',
  children,
}: {
  label: string;
  align?: 'left' | 'right' | 'center';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-0.5 lg:block',
        align === 'right' ? 'items-end lg:text-right' : align === 'center' ? 'items-end lg:text-center' : 'items-start',
      )}
    >
      <span className="font-semibold uppercase tracking-wider text-label-sm text-outline lg:hidden">{label}</span>
      {children}
    </div>
  );
}

export function DispatchCustomerBlock({
  sheet,
  group,
  progress,
  editable,
  isAdmin,
  open,
  onToggle,
  savingLine,
  groupBusy,
  drafts,
  invoiceBusy,
  onStart,
  onSetDraft,
  onCommitQuantity,
  onSaveLine,
  onOpenMissing,
  onEditNote,
  onOpenInvoice,
  onReopenInvoice,
}: DispatchCustomerBlockProps) {
  const started = Boolean(progress?.loadStartedAt);
  const loadClosed = Boolean(progress?.loadClosedAt);
  const invoiced = Boolean(progress?.invoiceDeliveredAt);
  const closedGroup = group.pendingLines === 0 && group.lines.length > 0;
  const timeline = customerTimeline(sheet.sentAt, progress, group.lines);
  const orderCount = new Set(group.lines.map((line) => line.orderNumber).filter(Boolean)).size;

  const summary = (
    <span className="min-w-0">
      <span className="block truncate font-semibold text-on-surface">{group.name}</span>
      <span className="block text-label-sm tabular-nums text-on-surface-variant">
        {orderCount} pedido(s) · {group.lines.length} renglón(es) · {formatNumber(group.plannedKg)} kg plan ·{' '}
        {group.completedLines} cargado(s)
        {group.partialLines > 0 ? ` · ${group.partialLines} parcial(es)` : ''}
        {group.missingLines > 0 ? ` · ${group.missingLines} no cargado(s)` : ''}
        {group.pendingLines > 0 ? ` · ${group.pendingLines} pendiente(s)` : ''}
      </span>
      <DispatchCustomerTimeline timeline={timeline} />
    </span>
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-space-sm gap-y-2 bg-surface-container-low/60 px-space-md py-space-sm">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-start gap-space-sm text-left"
          >
            {open ? (
              <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-outline" />
            )}
            {summary}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-space-sm">{summary}</div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-space-xs">
          {!started ? (
            <Badge tone="muted" dot>
              sin iniciar
            </Badge>
          ) : invoiced ? (
            <Badge tone="success" dot>
              facturada
            </Badge>
          ) : loadClosed || closedGroup ? (
            <Badge tone="success" dot>
              carga cerrada
            </Badge>
          ) : (
            <Badge tone="primary" dot>
              en carga
            </Badge>
          )}
          {editable && !started && (
            <button
              type="button"
              disabled={groupBusy !== null || savingLine !== null}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onStart}
              title={`Iniciar la carga de ${group.name} y arrancar sus relojes`}
              className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
            >
              {groupBusy === group.key ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Play aria-hidden className="size-3.5" />
              )}
              {groupBusy === group.key ? 'Iniciando…' : 'Iniciar carga'}
            </button>
          )}
          {sheet.canInvoice && started && closedGroup && !invoiced && (
            <button
              type="button"
              disabled={invoiceBusy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onOpenInvoice}
              title={`Marcar la factura de ${group.name} como entregada`}
              className="inline-flex h-8 items-center gap-space-xs rounded-pill bg-primary-container px-space-sm font-semibold text-label-md text-on-primary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
            >
              <Receipt aria-hidden className="size-3.5" />
              Factura entregada
            </button>
          )}
          {invoiced && isAdmin && (
            <button
              type="button"
              disabled={invoiceBusy}
              onClick={onReopenInvoice}
              title="Reabrir la factura (solo administración)"
              className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
            >
              <RotateCcw aria-hidden className="size-3.5" />
              Reabrir factura
            </button>
          )}
        </div>
      </div>

      <div hidden={!open}>
        <div className="hidden gap-space-sm border-b border-outline-variant/20 px-space-md py-1 font-semibold uppercase tracking-wider text-label-sm text-outline lg:grid lg:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_12.5rem]">
          <span>Pedido / artículo</span>
          <span className="text-right">Entrega</span>
          <span className="text-right">Cargado</span>
          <span className="text-right">Cantidad</span>
          <span className="text-right">Acción</span>
        </div>

        <ul>
          {group.lines.map((line) => {
            const completed = line.status === 'CARGADO';
            const difference =
              line.status === 'PARCIAL' || line.status === 'FALTANTE' || line.status === 'NOVEDAD';
            const saving = savingLine === line.id;
            const draftValue = drafts[line.id] ?? String(lineEffectiveQty(line));
            const parsedDraft = Number(draftValue.replace(',', '.'));
            const typedQty = Number.isFinite(parsedDraft)
              ? Math.min(Math.max(parsedDraft, 0), line.plannedQty)
              : 0;
            const typedKg = line.plannedQty > 0 ? (typedQty * line.plannedKg) / line.plannedQty : typedQty;
            return (
              <li
                key={line.id}
                className={cx(
                  'border-b border-outline-variant/15 px-space-md py-space-sm transition-colors',
                  completed && 'bg-success-container/25',
                  difference && 'bg-warning-container/15',
                )}
              >
                <div className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs lg:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_12.5rem] lg:items-center">
                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <p className="flex items-center gap-space-xs">
                      <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span>
                      <span className="text-label-sm text-outline">turno {line.position}</span>
                    </p>
                    <p className="truncate text-body-md text-on-surface-variant" title={line.description ?? ''}>
                      <span className="font-semibold text-on-surface">{line.productCode}</span> ·{' '}
                      {line.description ?? '—'}
                    </p>
                    {line.note && (
                      <p
                        className={cx(
                          'mt-space-2xs flex items-start gap-space-xs rounded-lg px-space-xs py-1 text-label-md text-on-surface',
                          difference ? 'bg-warning-container/30' : 'bg-secondary-container/15',
                        )}
                      >
                        {difference ? (
                          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-error" />
                        ) : (
                          <MessageSquare aria-hidden className="mt-0.5 size-3.5 shrink-0 text-secondary" />
                        )}
                        <span className="min-w-0 flex-1 whitespace-pre-wrap">
                          {difference ? <span className="font-semibold">Motivo: </span> : null}
                          {line.note}
                        </span>
                        {difference && editable && (
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onSetDraft(line.id, null);
                              onEditNote(line);
                            }}
                            title="Editar solo el motivo"
                            aria-label={`Editar el motivo de ${line.productCode} en el pedido ${line.orderNumber}`}
                            className="grid size-6 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                          >
                            <Pencil aria-hidden className="size-3" />
                          </button>
                        )}
                      </p>
                    )}
                  </div>

                  <Cell label="Entrega" align="right">
                    <span className="tabular-nums text-on-surface-variant">
                      {formatBusinessDate(line.effectiveDate)}
                    </span>
                  </Cell>

                  <Cell label="Cargado" align="right">
                    {editable && !invoiced ? (
                      <div className="flex w-full flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1">
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
                            aria-label={`Cantidad cargada de ${line.productCode} en el pedido ${line.orderNumber}`}
                            title="Cantidad real cargada. Si baja del plan se marca parcial; si es 0, no cargado."
                            className="h-9 w-[5.5rem] rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-right font-semibold tabular-nums text-primary outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70 disabled:opacity-50"
                          />
                          <span className="w-8 shrink-0 text-left text-label-sm font-semibold text-outline">
                            {line.uom ?? ''}
                          </span>
                        </div>
                        <span
                          className={cx(
                            'text-label-sm tabular-nums',
                            typedQty < line.plannedQty ? 'font-semibold text-error' : 'text-outline',
                          )}
                        >
                          {formatNumber(typedKg)} kg
                        </span>
                      </div>
                    ) : (
                      <span className="flex flex-col items-end leading-tight tabular-nums">
                        <span
                          className={cx(
                            'font-semibold',
                            line.status === 'PENDIENTE'
                              ? 'text-outline'
                              : difference
                                ? 'text-error'
                                : 'text-secondary',
                          )}
                        >
                          {line.status === 'PENDIENTE'
                            ? '—'
                            : `${formatNumber(lineEffectiveQty(line))} ${line.uom ?? ''}`}
                        </span>
                        {line.status !== 'PENDIENTE' && (
                          <span className="text-label-sm text-outline">{formatNumber(line.loadedKg ?? 0)} kg</span>
                        )}
                      </span>
                    )}
                  </Cell>

                  <Cell label="Cantidad" align="right">
                    <span className="flex flex-col items-end leading-tight tabular-nums">
                      <span className="font-semibold text-primary">
                        {formatNumber(line.plannedQty)} {line.uom ?? ''}
                      </span>
                      <span className="text-label-sm text-outline">{formatNumber(line.plannedKg)} kg</span>
                    </span>
                  </Cell>

                  <Cell label="Acción" align="right">
                    {editable && !invoiced ? (
                      <div className="flex flex-wrap items-center justify-end gap-space-xs">
                        {line.status === 'PENDIENTE' ? (
                          <>
                            <button
                              type="button"
                              disabled={saving || groupBusy !== null}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                onSetDraft(line.id, null);
                                onSaveLine(line, { status: 'CARGADO' });
                              }}
                              title="Cerrar la carga de este producto: detiene su reloj de carga"
                              className="inline-flex h-8 items-center justify-center gap-space-xs rounded-pill bg-secondary-container px-space-sm font-semibold text-label-md text-on-secondary transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                            >
                              {saving ? (
                                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                              ) : (
                                <CheckCheck aria-hidden className="size-3.5" />
                              )}
                              Cargar
                            </button>
                            <button
                              type="button"
                              disabled={saving || groupBusy !== null}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                onSetDraft(line.id, null);
                                onOpenMissing(line);
                              }}
                              title="Marcar el renglón como no cargado y pedir el motivo"
                              className="inline-flex h-8 items-center justify-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                            >
                              <PackageX aria-hidden className="size-3.5" />
                              No cargado
                            </button>
                          </>
                        ) : (
                          <>
                            <LineStatusBadge status={line.status} />
                            <LineCloseStamp at={line.loadClosedAt} sentAt={sheet.sentAt} />
                            {saving ? (
                              <Loader2 aria-hidden className="size-3.5 animate-spin text-secondary" />
                            ) : (
                              <button
                                type="button"
                                disabled={groupBusy !== null}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  onSetDraft(line.id, null);
                                  onSaveLine(line, { status: 'PENDIENTE' });
                                }}
                                title="Deshacer la marca y volver a pendiente"
                                aria-label={`Deshacer la marca de ${line.productCode} en el pedido ${line.orderNumber}`}
                                className="grid size-8 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                              >
                                <RotateCcw aria-hidden className="size-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="flex flex-wrap items-center justify-end gap-space-xs">
                        <LineStatusBadge status={line.status} />
                        <LineCloseStamp at={line.loadClosedAt} sentAt={sheet.sentAt} />
                      </span>
                    )}
                  </Cell>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

'use client';

// ============================================================
// Bitácora del despacho: solo ADMIN.
//
// La información se ordena en tres capas para que el cliente no tenga que
// leer el detalle técnico:
//   · Actividad: la historia operativa por hito (envío, cargas, facturas,
//     anulaciones y mensajes).
//   · Clientes: relojes por cliente y producto, plegados.
//   · Detalles: todos los eventos del sistema, filtros avanzados y CSV.
//
// El API no entrega los eventos a los demás roles; este drawer es la única
// superficie donde se leen. El mensaje también es exclusivo del administrador.
// ============================================================

import type { DispatchSheetDetail } from '@nexo/contracts';
import {
  Ban,
  CheckCheck,
  ChevronDown,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  Receipt,
  Search,
  Send,
  Timer,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACTIVITY_TYPES, EventTimeline, eventLabel, removalReasonLabel } from './DispatchSheetParts';
import { Badge, Segmented, TextInput, cx } from './ui';
import {
  annulledLines,
  formatDateTime,
  formatDurationBetween,
  formatMinutes,
  groupByCustomer,
  lineStatusMeta,
  minutesBetween,
} from '../lib/dispatch-sheet';

interface DispatchBitacoraDrawerProps {
  open: boolean;
  sheet: DispatchSheetDetail;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (event: React.FormEvent) => void;
  onClose: () => void;
  busy: boolean;
}

type Tab = 'activity' | 'customers' | 'details';
type Filter = 'all' | 'milestones' | 'messages' | 'differences' | 'invoice';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todo' },
  { value: 'milestones', label: 'Hitos' },
  { value: 'messages', label: 'Mensajes' },
  { value: 'differences', label: 'Diferencias' },
  { value: 'invoice', label: 'Facturación' },
];

const INVOICE_TYPES = new Set(['FACTURA_ENTREGADA', 'FACTURADO', 'FACTURA_REABIERTA']);

export function DispatchBitacoraDrawer({
  open,
  sheet,
  message,
  onMessageChange,
  onSend,
  onClose,
  busy,
}: DispatchBitacoraDrawerProps) {
  const [tab, setTab] = useState<Tab>('activity');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState('');

  const customers = useMemo(() => groupByCustomer(sheet.lines), [sheet.lines]);
  const annulled = useMemo(() => annulledLines(sheet.lines), [sheet.lines]);

  const progressStats = useMemo(() => {
    const rows = sheet.customerProgress;
    // Respuesta = envío → primer producto marcado (no «Iniciar carga»).
    const marks = sheet.lines
      .filter((line) => line.status !== 'ANULADO')
      .map((line) => line.checkedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    const invoices = rows
      .map((row) => row.invoiceDeliveredAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    return {
      firstMark: marks[0] ?? null,
      lastInvoice: invoices[invoices.length - 1] ?? null,
      closed: sheet.closedCustomers,
      invoiced: sheet.invoicedCustomers,
      total: sheet.totalCustomers,
    };
  }, [sheet]);

  const activityEvents = useMemo(
    () => sheet.events.filter((event) => ACTIVITY_TYPES.has(event.type) || event.kind === 'MESSAGE'),
    [sheet.events],
  );

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sheet.events.filter((event) => {
      if (filter === 'messages' && event.kind !== 'MESSAGE') return false;
      if (filter === 'differences' && event.type !== 'NOVEDAD' && event.type !== 'RENGLON_ANULADO') return false;
      if (filter === 'invoice' && !INVOICE_TYPES.has(event.type)) return false;
      if (filter === 'milestones' && event.kind === 'MESSAGE') return false;
      if (
        filter === 'milestones' &&
        (event.type === 'NOVEDAD' ||
          event.type === 'RENGLON_ANULADO' ||
          event.type === 'SIMULACION_ACTUALIZADA' ||
          INVOICE_TYPES.has(event.type))
      ) {
        return false;
      }
      if (customer && !(event.body ?? '').toLowerCase().includes(customer.toLowerCase())) return false;
      if (!needle) return true;
      return (
        (event.body ?? '').toLowerCase().includes(needle) ||
        (event.authorName ?? '').toLowerCase().includes(needle) ||
        eventLabel(event.type).toLowerCase().includes(needle)
      );
    });
  }, [sheet.events, filter, query, customer]);

  function exportCsv() {
    const rows: string[][] = [
      ['Fecha', 'Hito', 'Autor', 'Detalle'],
      ...filteredEvents.map((event) => [formatDateTime(event.createdAt), eventLabel(event.type), event.authorName ?? 'Sistema', event.body ?? '']),
    ];
    if (tab === 'customers') {
      rows.push([]);
      rows.push(['Cliente', 'Pedido', 'Producto', 'Estado', 'Enviado', 'Último producto', 'Min envío → cierre', 'Quién cerró', 'Motivo']);
      for (const group of customers) {
        for (const line of group.lines) {
          rows.push([
            group.name,
            line.orderNumber,
            `${line.productCode} · ${line.description ?? ''}`,
            lineStatusMeta(line.status).label,
            formatDateTime(sheet.sentAt),
            formatDateTime(line.loadClosedAt),
            formatMinutes(minutesBetween(sheet.sentAt, line.loadClosedAt)),
            line.loadClosedByName ?? '—',
            line.note ?? '',
          ]);
        }
      }
      if (annulled.length > 0) {
        rows.push([]);
        rows.push(['Cliente', 'Pedido', 'Producto', 'Anulado por', 'Cuándo', 'Motivo']);
        for (const line of annulled) {
          rows.push([
            line.customerName ?? '—',
            line.orderNumber,
            `${line.productCode} · ${line.description ?? ''}`,
            line.removedByName ?? '—',
            formatDateTime(line.removedAt),
            removalReasonLabel(line.removalReason),
          ]);
        }
      }
    }
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bitacora-${sheet.number}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  const loadHint =
    sheet.loadClosedAt
      ? `${progressStats.closed}/${progressStats.total} cliente(s) cerrados`
      : progressStats.firstMark
        ? `${progressStats.closed}/${progressStats.total} cliente(s) cerrados · en curso`
        : 'Sin movimientos';
  const loadValue =
    sheet.loadClosedAt
      ? formatDurationBetween(sheet.sentAt, sheet.loadClosedAt)
      : progressStats.firstMark
        ? formatMinutes(minutesBetween(sheet.sentAt, new Date().toISOString()))
        : '—';
  const invoiceValue =
    sheet.invoiceDeliveredAt
      ? formatDurationBetween(sheet.sentAt, sheet.invoiceDeliveredAt)
      : progressStats.lastInvoice
        ? formatMinutes(minutesBetween(sheet.sentAt, progressStats.lastInvoice))
        : '—';
  const invoiceHint =
    progressStats.total > 0
      ? `${progressStats.invoiced}/${progressStats.total} cliente(s) facturados`
      : 'Sin clientes';

  return (
    <div role="presentation" className="animate-fade fixed inset-0 z-50 flex justify-end bg-primary/30 backdrop-blur-sm">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-bitacora-title"
        className="animate-rise flex h-full w-full flex-col border-l border-outline-variant/40 bg-surface-container-lowest shadow-hero sm:max-w-xl"
      >
        <header className="flex items-start justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm">
          <div className="flex items-start gap-space-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-fixed text-primary">
              <MessageSquare aria-hidden className="size-4" />
            </span>
            <div>
              <h2 id="dispatch-bitacora-title" className="font-semibold text-primary">
                Bitácora
              </h2>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Solo administradores · {sheet.number}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-xs">
            <Badge tone="muted">{sheet.events.length}</Badge>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar bitácora"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        {/* Resumen: una sola lectura de los relojes importantes. */}
        <div className="grid grid-cols-2 gap-space-sm border-b border-outline-variant/30 p-space-md sm:grid-cols-4">
          <Summary
            label="Enviado"
            value={formatDateTime(sheet.sentAt)}
            hint={
              progressStats.firstMark
                ? `Respuesta ${formatMinutes(minutesBetween(sheet.sentAt, progressStats.firstMark))}`
                : 'Sin movimientos'
            }
          />
          <Summary
            label="Carga"
            value={loadValue}
            hint={loadHint}
            icon={<CheckCheck aria-hidden className="size-3" />}
          />
          <Summary
            label="Factura"
            value={invoiceValue}
            hint={invoiceHint}
            icon={<Receipt aria-hidden className="size-3" />}
          />
          <Summary
            label="Ciclo total"
            value={
              progressStats.lastInvoice
                ? formatDurationBetween(sheet.sentAt, progressStats.lastInvoice)
                : '—'
            }
            hint={
              progressStats.lastInvoice
                ? sheet.invoiceDeliveredAt
                  ? 'Envío → última factura'
                  : 'Envío → última factura registrada'
                : 'Sin facturas entregadas'
            }
            icon={<Timer aria-hidden className="size-3" />}
          />
        </div>

        <div className="border-b border-outline-variant/30 p-space-md">
          <Segmented
            ariaLabel="Vista de la bitácora"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: 'activity', label: 'Actividad' },
              { value: 'customers', label: 'Clientes' },
              { value: 'details', label: 'Detalles' },
            ]}
          />
          {tab === 'details' && (
            <>
              <div className="mt-space-sm flex flex-wrap items-center gap-space-xs">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    className={cx(
                      'h-7 rounded-pill border px-space-sm text-label-md font-semibold transition-colors',
                      filter === item.value
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
                <select
                  value={customer}
                  onChange={(event) => setCustomer(event.target.value)}
                  aria-label="Filtrar por cliente"
                  className="h-7 max-w-[12rem] rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-label-md text-on-surface-variant"
                >
                  <option value="">Todos los clientes</option>
                  {customers.map((group) => (
                    <option key={group.key} value={group.name}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-space-sm flex items-center gap-space-sm">
                <TextInput
                  className="flex-1"
                  icon={Search}
                  value={query}
                  onChange={setQuery}
                  placeholder="Buscar por texto o autor…"
                  ariaLabel="Buscar en la bitácora"
                />
                <button
                  type="button"
                  onClick={exportCsv}
                  className="flex h-9 shrink-0 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant hover:bg-surface-container-low"
                >
                  <Download aria-hidden className="size-4" /> CSV
                </button>
              </div>
            </>
          )}
          {tab === 'activity' && (
            <p className="mt-space-sm flex flex-wrap items-center gap-x-space-sm text-label-sm normal-case text-on-surface-variant">
              <span>{activityEvents.length} hito(s) y mensaje(s).</span>
              <span className="text-outline">
                Los cambios internos del plan están en «Detalles».
              </span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-space-md">
          {tab === 'activity' ? (
            activityEvents.length > 0 ? (
              <EventTimeline events={activityEvents} lines={sheet.lines} />
            ) : (
              <p className="text-body-md text-on-surface-variant">Todavía no hay hitos registrados.</p>
            )
          ) : tab === 'details' ? (
            filteredEvents.length > 0 ? (
              <EventTimeline events={filteredEvents} lines={sheet.lines} />
            ) : (
              <p className="text-body-md text-on-surface-variant">
                No hay movimientos para este filtro. Prueba con «Todo».
              </p>
            )
          ) : (
            <div className="flex flex-col gap-space-md">
              {customers.length === 0 && (
                <p className="text-body-md text-on-surface-variant">No hay clientes activos en el despacho.</p>
              )}
              {customers.map((group) => {
                const progress = sheet.customerProgress.find((row) => row.customerKey === group.key);
                return (
                  <details key={group.key} className="group overflow-hidden rounded-xl border border-outline-variant/40">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-space-xs bg-surface-container-low/70 px-space-sm py-2 marker:content-none">
                      <span className="flex min-w-0 items-center gap-space-xs">
                        <ChevronDown aria-hidden className="size-4 shrink-0 text-outline transition-transform group-open:rotate-180" />
                        <span className="truncate font-semibold text-on-surface">{group.name}</span>
                        <span className="text-label-sm text-outline">{group.lines.length} producto(s)</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
                        <span className="inline-flex items-center gap-1">
                          <Clock aria-hidden className="size-3" />
                          {progress?.loadClosedAt
                            ? formatDurationBetween(sheet.sentAt, progress.loadClosedAt)
                            : 'en carga'}
                        </span>
                        {progress?.invoiceDeliveredAt && (
                          <span className="inline-flex items-center gap-1 text-secondary">
                            <Receipt aria-hidden className="size-3" />
                            {formatDurationBetween(sheet.sentAt, progress.invoiceDeliveredAt)}
                          </span>
                        )}
                      </span>
                    </summary>
                    <ul className="divide-y divide-outline-variant/25">
                      {group.lines.map((line) => (
                        <li key={line.id} className="px-space-sm py-2">
                          <div className="flex flex-wrap items-center justify-between gap-space-xs">
                            <div className="min-w-0">
                              <p className="text-body-md text-on-surface">
                                <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span> ·{' '}
                                {line.productCode}
                              </p>
                              <p className="truncate text-label-sm text-on-surface-variant">{line.description ?? '—'}</p>
                            </div>
                            <Badge tone={lineStatusMeta(line.status).tone}>{lineStatusMeta(line.status).label}</Badge>
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-space-sm text-label-sm text-outline">
                            {line.loadClosedAt
                              ? `Cerrado ${formatDateTime(line.loadClosedAt)} · ${formatMinutes(
                                  minutesBetween(sheet.sentAt, line.loadClosedAt),
                                )} desde el envío`
                              : 'Pendiente de cierre'}
                            {line.loadClosedByName ? ` · ${line.loadClosedByName}` : ''}
                          </p>
                          {line.note && (
                            <p className="mt-1 rounded-lg bg-surface-container-low px-space-xs py-0.5 text-label-md text-on-surface-variant">
                              {line.status === 'CARGADO' ? line.note : <><span className="font-semibold text-error">Motivo: </span>{line.note}</>}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}

              {annulled.length > 0 && (
                <details className="group overflow-hidden rounded-xl border border-outline-variant/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-space-xs bg-surface-container-low/70 px-space-sm py-2 marker:content-none">
                    <span className="flex items-center gap-space-xs font-semibold text-on-surface">
                      <ChevronDown aria-hidden className="size-4 text-outline transition-transform group-open:rotate-180" />
                      <Ban aria-hidden className="size-4 text-error" />
                      Anulados ({annulled.length})
                    </span>
                    <span className="text-label-sm text-on-surface-variant">No cuentan en totales</span>
                  </summary>
                  <ul className="divide-y divide-outline-variant/25">
                    {annulled.map((line) => (
                      <li key={line.id} className="px-space-sm py-2">
                        <div className="flex flex-wrap items-center justify-between gap-space-xs">
                          <p className="text-body-md text-on-surface">
                            <span className="font-bold tabular-nums text-primary">{line.orderNumber}</span> · {line.productCode}
                          </p>
                          <Badge tone="muted">Anulado</Badge>
                        </div>
                        <p className="truncate text-label-sm text-on-surface-variant">
                          {line.customerName ?? '—'} · {line.description ?? '—'}
                        </p>
                        <p className="mt-0.5 text-label-sm text-outline">
                          {removalReasonLabel(line.removalReason)} · {line.removedByName ?? 'Sistema'} · {formatDateTime(line.removedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        {tab === 'activity' && (
          <form onSubmit={onSend} className="flex items-end gap-space-xs border-t border-outline-variant/30 bg-surface-container-low/50 p-space-sm">
            <label className="flex-1">
              <span className="sr-only">Mensaje para la contraparte</span>
              <textarea
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Escribe una nota en la bitácora…"
                className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-1 text-body-md outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
              />
            </label>
            <button
              type="submit"
              disabled={!message.trim() || busy}
              className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
              Enviar
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}

function Summary({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-container-low/70 px-space-sm py-1.5">
      <p className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline">
        {icon}
        {label}
      </p>
      <p className="text-body-md font-bold tabular-nums text-primary">{value}</p>
      {hint && <p className="truncate text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

'use client';

// ============================================================
// Bitácora del despacho: solo ADMIN.
//
// Mejoras sobre el drawer original:
//   · resumen de tiempos (carga y factura),
//   · filtros por hitos / mensajes / diferencias / facturación,
//   · búsqueda por texto o autor,
//   · pestaña «Carga por producto» con quién cerró y cuánto tardó,
//   · exportación CSV.
//
// El API no entrega los eventos a los demás roles; este drawer es la única
// superficie donde se leen. El mensaje también es exclusivo del administrador.
// ============================================================

import type { DispatchSheetDetail } from '@nexo/contracts';
import {
  CheckCheck,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  Receipt,
  Search,
  Send,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { EventTimeline } from './DispatchSheetParts';
import { Badge, Segmented, TextInput, cx } from './ui';
import {
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

type Tab = 'timeline' | 'products';
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
  const [tab, setTab] = useState<Tab>('timeline');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState('');

  const customers = useMemo(() => groupByCustomer(sheet.lines), [sheet.lines]);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sheet.events.filter((event) => {
      if (filter === 'messages' && event.kind !== 'MESSAGE') return false;
      if (filter === 'differences' && event.type !== 'NOVEDAD') return false;
      if (filter === 'invoice' && !INVOICE_TYPES.has(event.type)) return false;
      if (filter === 'milestones' && event.kind === 'MESSAGE') return false;
      if (filter === 'milestones' && (event.type === 'NOVEDAD' || INVOICE_TYPES.has(event.type))) return false;
      if (customer && !(event.body ?? '').toLowerCase().includes(customer.toLowerCase())) return false;
      if (!needle) return true;
      return (
        (event.body ?? '').toLowerCase().includes(needle) ||
        (event.authorName ?? '').toLowerCase().includes(needle) ||
        event.type.toLowerCase().includes(needle)
      );
    });
  }, [sheet.events, filter, query, customer]);

  const exportCsv = () => {
    const rows: string[][] = [
      ['Fecha', 'Tipo', 'Autor', 'Detalle'],
      ...filteredEvents.map((event) => [formatDateTime(event.createdAt), event.type, event.authorName ?? 'Sistema', event.body ?? '']),
    ];
    if (tab === 'products') {
      rows.push([]);
      rows.push(['Cliente', 'Pedido', 'Producto', 'Estado', 'Inicio carga', 'Cierre carga', 'Min carga', 'Quién cerró', 'Motivo']);
      for (const group of customers) {
        for (const line of group.lines) {
          rows.push([
            group.name,
            line.orderNumber,
            `${line.productCode} · ${line.description ?? ''}`,
            lineStatusMeta(line.status).label,
            formatDateTime(line.loadStartedAt),
            formatDateTime(line.loadClosedAt),
            formatMinutes(minutesBetween(line.loadStartedAt, line.loadClosedAt)),
            line.loadClosedByName ?? '—',
            line.note ?? '',
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
  };

  if (!open) return null;

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

        {/* Resumen de tiempos */}
        <div className="grid grid-cols-2 gap-space-sm border-b border-outline-variant/30 p-space-md sm:grid-cols-4">
          <Summary label="Inicio" value={formatDateTime(sheet.loadStartedAt)} />
          <Summary
            label="Carga"
            value={formatDurationBetween(sheet.loadStartedAt, sheet.loadClosedAt)}
            hint={formatDateTime(sheet.loadClosedAt)}
          />
          <Summary
            label="Factura"
            value={formatDurationBetween(sheet.loadStartedAt, sheet.invoiceDeliveredAt)}
            hint={formatDateTime(sheet.invoiceDeliveredAt)}
          />
          <Summary
            label="Pendientes"
            value={`${sheet.pendingInvoiceCustomers}`}
            hint={sheet.pendingInvoiceCustomers > 0 ? 'factura(s)' : 'todo facturado'}
          />
        </div>

        <div className="border-b border-outline-variant/30 p-space-md">
          <Segmented
            ariaLabel="Vista de la bitácora"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: 'timeline', label: 'Bitácora' },
              { value: 'products', label: 'Carga por producto' },
            ]}
          />
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
        </div>

        <div className="flex-1 overflow-y-auto p-space-md">
          {tab === 'timeline' ? (
            filteredEvents.length > 0 ? (
              <EventTimeline events={filteredEvents} />
            ) : (
              <p className="text-body-md text-on-surface-variant">
                No hay movimientos para este filtro. Prueba con «Todo».
              </p>
            )
          ) : (
            <div className="flex flex-col gap-space-md">
              {customers.map((group) => {
                const progress = sheet.customerProgress.find((row) => row.customerKey === group.key);
                return (
                  <section key={group.key} className="overflow-hidden rounded-xl border border-outline-variant/40">
                    <header className="flex flex-wrap items-center justify-between gap-space-xs bg-surface-container-low/70 px-space-sm py-1.5">
                      <span className="font-semibold text-on-surface">{group.name}</span>
                      <span className="flex flex-wrap items-center gap-space-xs text-label-sm text-on-surface-variant">
                        <Clock aria-hidden className="size-3" />
                        {progress?.loadStartedAt
                          ? formatDurationBetween(progress.loadStartedAt, progress.loadClosedAt)
                          : 'sin iniciar'}
                        {progress?.invoiceDeliveredAt && (
                          <>
                            <Receipt aria-hidden className="size-3" />
                            {formatDurationBetween(progress.loadStartedAt, progress.invoiceDeliveredAt)}
                          </>
                        )}
                      </span>
                    </header>
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
                            <Badge tone={line.status === 'CARGADO' ? 'success' : line.status === 'PENDIENTE' ? 'muted' : 'warning'}>
                              {lineStatusMeta(line.status).label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-space-sm text-label-sm text-outline">
                            {line.loadStartedAt ? `Inicio ${formatDateTime(line.loadStartedAt)}` : 'Sin iniciar'}
                            {line.loadClosedAt ? ` · Cierre ${formatDateTime(line.loadClosedAt)}` : ''}
                            {line.loadClosedAt
                              ? ` · ${formatMinutes(minutesBetween(line.loadStartedAt, line.loadClosedAt))}`
                              : ''}
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
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {tab === 'timeline' && (
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

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low/70 px-space-sm py-1.5">
      <p className="flex items-center gap-1 text-label-sm font-semibold uppercase tracking-wider text-outline">
        {label === 'Carga' ? <CheckCheck aria-hidden className="size-3" /> : null}
        {label === 'Factura' ? <Receipt aria-hidden className="size-3" /> : null}
        {label}
      </p>
      <p className="text-body-md font-bold tabular-nums text-primary">{value}</p>
      {hint && <p className="truncate text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

'use client';

// ============================================================
// Piezas compartidas del despacho: estado de la hoja, estado del renglón y
// bitácora. La cinta de acuses se retiró: el flujo va de enviado a carga.
// ============================================================

import type { DispatchEventProduct, DispatchLineStatus, DispatchSheetEvent, DispatchSheetLine, DispatchSheetStatus } from '@nexo/contracts';
import {
  AlertTriangle,
  Ban,
  CheckCheck,
  Clock,
  Inbox,
  Loader,
  MessageSquare,
  PackagePlus,
  Receipt,
  RotateCcw,
  Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, cx } from './ui';
import { formatDateTime, formatMinutes, formatNumber, minutesBetween, sheetStatusMeta, lineStatusMeta } from '../lib/dispatch-sheet';

export function SheetStatusBadge({ status }: { status: DispatchSheetStatus }) {
  const meta = sheetStatusMeta(status);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function LineStatusBadge({ status }: { status: DispatchLineStatus }) {
  const meta = lineStatusMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const EVENT_ICON: Record<string, LucideIcon> = {
  ENVIADO: Send,
  RECIBIDO: Inbox,
  EN_PROCESO: Loader,
  NOVEDAD: AlertTriangle,
  DESPACHADO: CheckCheck,
  CANCELADO: Ban,
  MENSAJE: MessageSquare,
  CARGA_INICIADA: Clock,
  CARGA_CERRADA: CheckCheck,
  CARGA_REABIERTA: RotateCcw,
  FACTURA_ENTREGADA: Receipt,
  FACTURADO: Receipt,
  FACTURA_REABIERTA: RotateCcw,
  SIMULACION_ACTUALIZADA: PackagePlus,
  RENGLON_ANULADO: Ban,
  RENGLON_REACTIVADO: RotateCcw,
  PLAN_VACIO: Ban,
};

// Etiqueta humana de cada hito. El código interno nunca se muestra al cliente.
export const EVENT_LABEL: Record<string, string> = {
  ENVIADO: 'Despacho enviado',
  RECIBIDO: 'Recibido',
  EN_PROCESO: 'En carga',
  NOVEDAD: 'Diferencia reportada',
  DESPACHADO: 'Despacho cerrado',
  CANCELADO: 'Despacho anulado',
  MENSAJE: 'Mensaje',
  CARGA_INICIADA: 'Inició carga',
  CARGA_CERRADA: 'Cerró carga',
  CARGA_REABIERTA: 'Reabrió carga',
  FACTURA_ENTREGADA: 'Factura entregada',
  FACTURADO: 'Facturación entregada',
  FACTURA_REABIERTA: 'Reabrió factura',
  SIMULACION_ACTUALIZADA: 'Cambió el plan',
  RENGLON_ANULADO: 'Renglón anulado',
  RENGLON_REACTIVADO: 'Renglón reactivado',
  PLAN_VACIO: 'Plan vacío',
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type;
}

// Hitos que forman la historia operativa. El resto (cambios del plan) vive en
// «Detalles» para no saturar la lectura del cliente.
export const ACTIVITY_TYPES = new Set([
  'ENVIADO',
  'CARGA_INICIADA',
  'CARGA_CERRADA',
  'CARGA_REABIERTA',
  'NOVEDAD',
  'FACTURA_ENTREGADA',
  'FACTURADO',
  'FACTURA_REABIERTA',
  'DESPACHADO',
  'CANCELADO',
  'RENGLON_ANULADO',
  'RENGLON_REACTIVADO',
  'PLAN_VACIO',
  'MENSAJE',
]);


const EVENT_TONE: Record<string, string> = {
  ENVIADO: 'bg-primary-fixed text-primary',
  RECIBIDO: 'bg-surface-container-high text-primary',
  EN_PROCESO: 'bg-primary-fixed text-primary',
  NOVEDAD: 'bg-warning-container text-on-warning-container',
  DESPACHADO: 'bg-success-container text-on-success-container',
  CANCELADO: 'bg-critical-container text-on-critical-container',
  MENSAJE: 'bg-secondary-container/40 text-secondary',
  CARGA_INICIADA: 'bg-primary-fixed text-primary',
  CARGA_CERRADA: 'bg-success-container text-on-success-container',
  CARGA_REABIERTA: 'bg-warning-container text-on-warning-container',
  FACTURA_ENTREGADA: 'bg-success-container text-on-success-container',
  FACTURADO: 'bg-success-container text-on-success-container',
  FACTURA_REABIERTA: 'bg-warning-container text-on-warning-container',
  SIMULACION_ACTUALIZADA: 'bg-surface-container-high text-primary',
};

/** Cronómetro vivo de un hito; se detiene al recibir `until`. */
export function Elapsed({ since, until }: { since: string | null | undefined; until?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!since || until) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since, until]);

  if (!since) return <span>—</span>;
  // Primer render (SSR y cliente) usa `since` para evitar desajustes de
  // hidratación; el intervalo actualiza el cronómetro después de montar.
  const end = until ? new Date(until).toISOString() : new Date(now ?? new Date(since).getTime()).toISOString();
  const minutes = minutesBetween(since, end);
  if (minutes === null) return <span>—</span>;
  if (!until && minutes < 60) {
    const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(since).getTime()) / 1000));
    return (
      <span className="tabular-nums">
        {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
      </span>
    );
  }
  return <span className="tabular-nums">{formatMinutes(minutes)}</span>;
}

const REMOVAL_LABEL: Record<string, string> = {
  RETIRADO_DEL_PLAN: 'Retirado del plan en Pedidos',
  PEDIDO_ANULADO_EN_PROFIT: 'Anulado en Profit',
  PEDIDO_CERRADO_EN_PROFIT: 'Cerrado por nota de entrega en Profit',
};

export function removalReasonLabel(reason: string | null): string {
  if (!reason) return 'Sin motivo registrado';
  return REMOVAL_LABEL[reason] ?? reason;
}

// Hitos que muestran pedido/código/producto en vez de repetir el título.
const STRUCTURED_TYPES = new Set([
  'CARGA_INICIADA',
  'CARGA_CERRADA',
  'CARGA_REABIERTA',
  'FACTURA_ENTREGADA',
  'FACTURADO',
  'FACTURA_REABIERTA',
  'RENGLON_ANULADO',
]);

interface StructuredEvent {
  customerName: string | null;
  invoiceRef: string | null;
  minutes: number | null;
  products: DispatchEventProduct[];
}

// Eventos históricos: el cliente está escrito en el body, no en `meta`.
const LEGACY_CUSTOMER: Record<string, RegExp> = {
  CARGA_CERRADA: /^Cerró la carga de (.+?): \d+ producto/,
  CARGA_INICIADA: /inició la carga de (.+?) \(\d+ producto/,
  CARGA_REABIERTA: /^Reabrió la carga de (.+?)\.?$/,
  FACTURA_ENTREGADA: /entregada a (.+?) en /,
  FACTURA_REABIERTA: /^Reabrió la factura de (.+?)\. Motivo:/,
};

function legacyCustomerName(type: string, body: string | null): string | null {
  const pattern = LEGACY_CUSTOMER[type];
  if (!pattern || !body) return null;
  return body.match(pattern)?.[1]?.trim() ?? null;
}

/** Convierte «1 h 20 min» / «2 d 3 h» del texto histórico a minutos. */
function parseDurationMinutes(label: string | null | undefined): number | null {
  if (!label) return null;
  const days = label.match(/(\d+)\s*d/);
  const hours = label.match(/(\d+)\s*h/);
  const minutes = label.match(/(\d+)\s*min/);
  if (!days && !hours && !minutes) return null;
  return Number(days?.[1] ?? 0) * 1440 + Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

function legacyMinutes(type: string, body: string | null): number | null {
  if (!body) return null;
  if (type === 'CARGA_CERRADA') return parseDurationMinutes(body.match(/ en ([^.]+)\.?$/)?.[1]);
  if (type === 'FACTURA_ENTREGADA') {
    return parseDurationMinutes(body.match(/ en (.+?) desde el inicio de carga/)?.[1]);
  }
  return null;
}

function productsForCustomer(
  lines: DispatchSheetLine[] | undefined,
  customerName: string | null,
): DispatchEventProduct[] {
  if (!lines || !customerName) return [];
  return lines
    .filter((line) => line.status !== 'ANULADO' && (line.customerName ?? '').trim() === customerName)
    .map((line) => ({
      orderNumber: line.orderNumber,
      productCode: line.productCode,
      description: line.description,
      qty: line.loadedQty ?? line.plannedQty ?? null,
      uom: line.uom,
      status: line.status,
    }));
}

/**
 * Resuelve el detalle del evento. Primero usa `meta` (congelado al momento del
 * hito); si es histórico y no lo tiene, lo deriva del cliente escrito en el
 * body y de los renglones vigentes. Sin coincidencia, se muestra el texto.
 */
function resolveStructuredEvent(
  event: DispatchSheetEvent,
  lines: DispatchSheetLine[] | undefined,
): StructuredEvent | null {
  if (event.meta) {
    if (event.meta.products.length === 0 && !event.meta.customerName && !event.meta.invoiceRef) return null;
    return {
      customerName: event.meta.customerName,
      invoiceRef: event.meta.invoiceRef,
      minutes: event.meta.minutes,
      products: event.meta.products,
    };
  }
  if (!STRUCTURED_TYPES.has(event.type)) return null;
  const customerName = legacyCustomerName(event.type, event.body);
  const products = productsForCustomer(lines, customerName);
  if (products.length === 0) return null;
  return { customerName, invoiceRef: null, minutes: legacyMinutes(event.type, event.body), products };
}

function ProductRow({ product }: { product: DispatchEventProduct }) {
  return (
    <li className="flex items-baseline justify-between gap-space-sm rounded-md bg-surface-container-low/60 px-space-xs py-0.5">
      <span className="flex min-w-0 items-baseline gap-space-sm">
        <span className="shrink-0 font-bold tabular-nums text-primary">{product.orderNumber}</span>
        <span className="min-w-0 truncate text-label-md text-on-surface-variant">
          <span className="font-semibold text-on-surface">{product.productCode}</span>
          {product.description ? ` · ${product.description}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums text-label-sm text-outline">
        {product.qty != null ? `${formatNumber(product.qty)}${product.uom ? ` ${product.uom}` : ''}` : '—'}
        {product.status === 'CARGADO' && <CheckCheck aria-hidden className="size-3 text-primary" />}
      </span>
    </li>
  );
}

function ProductList({ products }: { products: DispatchEventProduct[] }) {
  const visible = products.slice(0, 3);
  const rest = products.slice(3);
  return (
    <>
      <ul className="mt-1 flex flex-col gap-px">
        {visible.map((product, index) => (
          <ProductRow key={`${product.orderNumber}-${product.productCode}-${index}`} product={product} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-label-sm font-semibold text-secondary marker:content-none">
            ver {rest.length} más
          </summary>
          <ul className="mt-1 flex flex-col gap-px">
            {rest.map((product, index) => (
              <ProductRow key={`${product.orderNumber}-${product.productCode}-${index}`} product={product} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Bitácora: eventos de sistema + conversación entre las partes. */
export function EventTimeline({
  events,
  lines,
}: {
  events: DispatchSheetEvent[];
  lines?: DispatchSheetLine[];
}) {
  if (events.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Todavía no hay movimientos registrados.</p>;
  }
  return (
    <ol className="flex flex-col gap-space-sm" aria-label="Bitácora del despacho">
      {events.map((event, index) => {
        const Icon = EVENT_ICON[event.type] ?? PackagePlus;
        const isMessage = event.kind === 'MESSAGE';
        const previous = index > 0 ? events[index - 1] : null;
        const gap = previous ? minutesBetween(previous.createdAt, event.createdAt) : null;
        const structured = isMessage ? null : resolveStructuredEvent(event, lines);
        const removalReason =
          event.type === 'RENGLON_ANULADO' && structured
            ? lines?.find(
                (line) =>
                  line.removalReason &&
                  structured.products.some(
                    (product) => product.orderNumber === line.orderNumber && product.productCode === line.productCode,
                  ),
              )?.removalReason ?? null
            : null;
        return (
          <li key={event.id} className={cx('flex items-start gap-space-sm', isMessage && 'rounded-xl bg-surface-container-low/70 p-space-sm')}>
            <span className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', EVENT_TONE[event.type] ?? 'bg-surface-container text-on-surface-variant')}>
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-space-sm">
                <p className="text-label-sm font-semibold uppercase tracking-wide text-outline">
                  {eventLabel(event.type)}
                </p>
                {structured?.minutes != null && (
                  <span className="shrink-0 rounded-pill bg-surface-container px-space-sm text-label-sm normal-case tabular-nums text-on-surface-variant">
                    {formatMinutes(structured.minutes)}
                  </span>
                )}
              </div>
              {structured ? (
                <>
                  {(structured.customerName || structured.invoiceRef) && (
                    <p className="flex flex-wrap items-baseline gap-x-space-xs text-label-sm normal-case text-on-surface-variant">
                      {structured.customerName && (
                        <span className="font-semibold text-on-surface">{structured.customerName}</span>
                      )}
                      {structured.customerName && <span>· {structured.products.length} producto(s)</span>}
                      {structured.invoiceRef && <span>· ref. {structured.invoiceRef}</span>}
                    </p>
                  )}
                  <ProductList products={structured.products} />
                  {removalReason && (
                    <p className="mt-1 text-label-sm normal-case text-outline">{removalReasonLabel(removalReason)}</p>
                  )}
                </>
              ) : (
                <p className={cx('text-body-md', isMessage ? 'font-medium text-on-surface' : 'text-on-surface-variant')}>
                  {event.body ?? event.type}
                </p>
              )}
              <p className="text-label-sm normal-case text-outline">
                {event.authorName ?? 'Sistema'} · {formatDateTime(event.createdAt)}
                {gap !== null && gap > 0 ? ` · +${formatMinutes(gap)}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

'use client';

// ============================================================
// Editar la fecha de ENTREGA del pedido en Profit.
//
// La fecha vive en el encabezado (dbo.cotiz_c.fec_venc): se aplica al pedido
// completo, aunque se abra desde un renglón. Se escribe primero en Profit y
// solo si Profit confirma se refleja en la cartera local.
// ============================================================

import type {
  DeliveryChangeCause,
  DeliveryChangeReason,
  ProfitDeliveryDateApplyResponse,
} from '@nexo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, ShieldAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { DateInput, TextInput, cx, fmtDate } from './ui';

export interface DeliveryDateTargetItem {
  orderNumber: string;
  productCode: string;
  orderDate: string | null;
  requestedDate: string | null;
}

export interface DeliveryDateTarget {
  title: string;
  customerName: string;
  customerCode: string | null;
  /** Renglones que abrieron el editor; el API deduplica por pedido. */
  items: DeliveryDateTargetItem[];
}

export interface DeliveryDateOrderSummary {
  orderNumber: string;
  orderDate: string | null;
  requestedDate: string | null;
  firstProductCode: string;
  lines: number;
}

function inputDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/** Un pedido = una fecha: el editor trabaja sobre pedidos, no renglones. */
export function summarizeOrders(items: DeliveryDateTargetItem[]): DeliveryDateOrderSummary[] {
  const map = new Map<string, DeliveryDateOrderSummary>();
  for (const item of items) {
    const entry = map.get(item.orderNumber);
    if (!entry) {
      map.set(item.orderNumber, {
        orderNumber: item.orderNumber,
        orderDate: item.orderDate,
        requestedDate: item.requestedDate,
        firstProductCode: item.productCode,
        lines: 1,
      });
    } else {
      entry.lines += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, 'es'));
}

export function DeliveryDateDialog({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: DeliveryDateTarget | null;
  onClose: () => void;
  onSaved: (result: ProfitDeliveryDateApplyResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [cause, setCause] = useState<DeliveryChangeCause | null>(null);
  const [reason, setReason] = useState<DeliveryChangeReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const orders = useMemo(() => summarizeOrders(target?.items ?? []), [target]);
  const distinctDates = useMemo(
    () => [...new Set(orders.map((order) => order.requestedDate).filter((value): value is string => Boolean(value)))],
    [orders],
  );

  // Al abrir: si todos los pedidos comparten fecha, se precarga.
  useEffect(() => {
    if (!open || !target) return;
    setDate(distinctDates.length === 1 ? inputDate(distinctDates[0]!) : '');
    // Sin preselección: obliga a decidir quién originó el cambio.
    setCause(null);
    setReason(null);
    setNote('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: (value: {
      date: string;
      cause: DeliveryChangeCause;
      reason: DeliveryChangeReason | null;
      note?: string;
    }) => {
      const payload: Record<string, unknown> = {
        // Un ítem por pedido: la entrega es del encabezado.
        items: orders.map((order) => ({
          orderNumber: order.orderNumber,
          productCode: order.firstProductCode,
        })),
        date: value.date,
        cause: value.cause,
      };
      if (value.cause === 'CUSTOMER' && value.reason) payload.reason = value.reason;
      if (value.note) payload.note = value.note;
      return apiFetch<ProfitDeliveryDateApplyResponse>('/orders/delivery-date/profit', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['orders-grouped'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
      void queryClient.invalidateQueries({ queryKey: ['scenario-draft'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-insights'] });
      onSaved(result);
    },
    onError: (causeError) => {
      setError(causeError instanceof Error ? causeError.message : 'No se pudo guardar la fecha en Profit.');
    },
  });

  if (!open || !target) return null;

  const pending = mutation.isPending;
  // El motivo solo se exige cuando el cambio lo pidió el cliente.
  const canSave = Boolean(date) && cause !== null && (cause === 'COMPANY' || reason !== null);
  const apply = () => {
    if (!canSave || !cause) return;
    setError(null);
    mutation.mutate({
      date,
      cause,
      reason: cause === 'CUSTOMER' ? reason : null,
      note: note.trim() || undefined,
    });
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-date-title"
        className="flex min-w-0 max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-lift sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <CalendarCheck aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Entrega en Profit</p>
              <h2 id="delivery-date-title" className="truncate text-title-md text-primary">
                {target.title}
              </h2>
              <p className="text-label-md text-on-surface-variant">
                {target.customerName}
                {target.customerCode ? ` · ${target.customerCode}` : ''} · {orders.length} pedido(s)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:opacity-40"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          <div className="flex flex-col gap-space-md">
            <p className="flex items-start gap-space-xs rounded-xl border border-warning/35 bg-warning/10 p-space-sm text-label-md text-on-surface-variant">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                La fecha se guarda en <strong className="text-primary">Profit</strong> y aplica al pedido
                completo (todos sus renglones), no solo al artículo seleccionado.
              </span>
            </p>

            <div>
              <div className="flex items-center justify-between gap-space-sm">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                  Pedidos afectados
                </span>
                <span className="text-label-sm tabular-nums text-on-surface-variant">{orders.length}</span>
              </div>
              <ul className="mt-space-xs max-h-52 divide-y divide-outline-variant/20 overflow-y-auto rounded-xl border border-outline-variant/30">
                {orders.map((order) => (
                  <li key={order.orderNumber} className="flex items-center gap-space-sm px-space-sm py-2">
                    <span className="w-16 shrink-0 text-label-sm font-bold tabular-nums text-primary">
                      {order.orderNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-outline">
                        Emisión
                      </span>
                      <span className="block text-label-sm tabular-nums text-on-surface-variant">
                        {fmtDate(order.orderDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-outline">
                        Entrega actual
                      </span>
                      <span className="block text-label-sm font-semibold tabular-nums text-primary">
                        {fmtDate(order.requestedDate)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nueva entrega</span>
              <DateInput ariaLabel="Nueva fecha de entrega" value={date} onChange={setDate} className="w-full" autoFocus />
              {distinctDates.length > 1 && (
                <span className="text-label-sm text-on-surface-variant">
                  Los pedidos tienen fechas distintas; se aplicará esta a todos.
                </span>
              )}
            </label>

            {/* Causa y motivo alimentan la reputación de fechas del cliente. */}
            <div className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                ¿Quién origina el cambio?
              </span>
              <ChoiceRow
                ariaLabel="Origen del cambio de fecha"
                value={cause}
                onChange={(value) => {
                  setCause(value);
                  // La empresa no lleva motivo: se limpia al cambiar de origen.
                  if (value === 'COMPANY') setReason(null);
                }}
                options={[
                  { value: 'COMPANY', label: 'Empresa' },
                  { value: 'CUSTOMER', label: 'Cliente' },
                ]}
              />
            </div>

            {cause === 'CUSTOMER' && (
              <div className="flex flex-col gap-space-2xs">
                <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                  Motivo del cliente
                </span>
                <ChoiceRow
                  ariaLabel="Motivo del cliente"
                  value={reason}
                  onChange={setReason}
                  options={[
                    { value: 'FINANCIAL', label: 'Financiero' },
                    { value: 'LOGISTIC', label: 'Logístico' },
                  ]}
                />
                {!reason && (
                  <span className="text-label-sm text-on-surface-variant">
                    Indica si el cliente lo pidió por pago/crédito (financiero) o por transporte/agenda (logístico).
                  </span>
                )}
              </div>
            )}

            {cause === 'COMPANY' && (
              <p className="text-label-sm text-on-surface-variant">
                La empresa asume el cambio; no se pide motivo.
              </p>
            )}

            <label className="flex flex-col gap-space-2xs">
              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">
                Detalle (opcional)
              </span>
              <TextInput
                value={note}
                onChange={setNote}
                placeholder="Ej. el cliente pidió mover la entrega"
                ariaLabel="Detalle del cambio de fecha"
                maxLength={240}
              />
            </label>

            {date && !canSave && (
              <p className="text-label-sm text-on-surface-variant">
                Falta indicar {cause === null ? 'quién origina el cambio' : 'el motivo del cliente'} para guardar.
              </p>
            )}

            {error && (
              <p role="alert" className="flex items-start gap-space-xs rounded-xl bg-error-container/60 p-space-sm text-label-md text-error">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-space-xs border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 rounded-pill px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={pending || !canSave}
            className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
          >
            {pending ? 'Guardando en Profit…' : 'Guardar en Profit'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// Grupo de opciones sin preselección (a diferencia de `Segmented`, que
// siempre pinta la primera como activa).
function ChoiceRow<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-space-xs">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'h-9 rounded-pill border px-space-md text-label-md font-semibold transition-colors',
              active
                ? 'border-primary-container bg-primary-container text-on-primary shadow-soft'
                : 'border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low hover:text-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

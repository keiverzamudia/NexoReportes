'use client';

// ============================================================
// Modal «Solicitud de carga» (pedidos).
//
// Opcional: no ocupa espacio en la vista hasta que el usuario lo abre. El
// usuario define cuántos espacios tiene el camión (1–6) y ubica exactamente un
// pedido en cada uno. Nada se llena automáticamente.
//
// Interacción: arrastrar y soltar (escritorio) o tocar pedido → tocar espacio
// (teléfono). Al guardar se persiste el `LoadPlan` del escenario; si no hay
// pedidos ubicados, no se crea la solicitud.
// ============================================================

import type { LoadPlan } from '@nexo/contracts';
import { CheckCircle2, GripVertical, MessageSquare, Minus, Plus, Trash2, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { formatNumber } from '../lib/dispatch-sheet';
import {
  MAX_TRUCK_SPACES,
  assignOrder,
  clearSlot,
  fitPlanToOrders,
  ordersByNumber,
  ordersFromLines,
  placedTotals,
  planHasOrders,
  planTotals,
  resizePlan,
  segmentOrder,
  slotColor,
  slotLabel,
  unplacedOrders,
  type LoadPlanLine,
} from '../lib/truck-load-plan';
import { TruckFrame } from './TruckLoadPlan';
import { cx } from './ui';

export function TruckLoadDialog({
  open,
  lines,
  plan,
  onClose,
  onSave,
}: {
  open: boolean;
  lines: LoadPlanLine[];
  plan: LoadPlan | null;
  onClose: () => void;
  /** `null` retira la solicitud de carga del escenario. */
  onSave: (plan: LoadPlan | null) => void;
}) {
  const [draft, setDraft] = useState<LoadPlan>(() => fitPlanToOrders(null, []));
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const orders = useMemo(() => ordersFromLines(lines), [lines]);
  const byNumber = useMemo(() => ordersByNumber(orders), [orders]);
  const unplaced = useMemo(() => unplacedOrders(orders, draft), [orders, draft]);
  const placed = useMemo(() => placedTotals(orders, draft), [orders, draft]);
  const total = useMemo(() => planTotals(orders), [orders]);
  const placedCount = orders.length - unplaced.length;
  const slotCount = draft.segments.length;
  const progress = total.kg > 0 ? Math.min(1, placed.kg / total.kg) : 0;

  // Al abrir se parte del plan guardado (sin pedidos que ya no estén en el
  // plan) o de un camión nuevo de un espacio.
  useEffect(() => {
    if (!open) return;
    setDraft(fitPlanToOrders(plan, ordersFromLines(lines)));
    setSelected(null);
    setDragging(null);
    setOverSlot(null);
    setNotice(null);
    // Sólo al abrir: `lines`/`plan` son estables mientras el modal está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape, bloqueo del scroll de fondo y foco inicial.
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function changeSpaces(next: number) {
    setDraft((previous) => resizePlan(previous, next));
    setSelected(null);
  }

  function place(orderNumber: string, slotIndex: number) {
    const order = byNumber.get(orderNumber);
    if (!order) return;
    setDraft((previous) => assignOrder(previous, order, slotIndex));
    setSelected(null);
    setNotice(null);
  }

  function handleSlotClick(index: number, occupying?: string) {
    if (selected && selected !== occupying) {
      place(selected, index);
      return;
    }
    if (occupying) {
      setSelected((previous) => (previous === occupying ? null : occupying));
      return;
    }
    setNotice('Toca un pedido de la lista para ubicarlo en este espacio.');
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    const orderNumber = event.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    setOverSlot(null);
    if (orderNumber) place(orderNumber, index);
  }

  function save() {
    if (placedCount === 0) {
      // Sin pedidos ubicados no hay solicitud: si ya existía, se retira.
      if (plan) {
        onSave(null);
        return;
      }
      setNotice('Ubica al menos un pedido en el camión.');
      return;
    }
    onSave(draft);
  }

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="truck-load-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-lift sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <Truck aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Opcional</p>
              <h2 id="truck-load-title" className="text-title-md text-primary">
                Solicitud de carga
              </h2>
              <p className="text-label-md text-on-surface-variant">
                Define los espacios del vehículo y ubica un pedido en cada uno.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          <div className="flex flex-col gap-space-md">
            {/* Espacios y totales */}
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-space-sm">
              <div className="flex flex-wrap items-center justify-between gap-space-sm">
                <div className="flex items-center gap-space-sm">
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Espacios</span>
                  <div className="flex items-center rounded-pill border border-outline-variant/50 bg-surface-container-lowest">
                    <button
                      type="button"
                      onClick={() => changeSpaces(slotCount - 1)}
                      disabled={slotCount <= 1}
                      aria-label="Quitar un espacio"
                      className="grid size-8 place-items-center rounded-l-pill text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-30"
                    >
                      <Minus aria-hidden className="size-3.5" />
                    </button>
                    <span aria-live="polite" className="w-7 text-center text-body-md font-bold tabular-nums text-primary">
                      {slotCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeSpaces(slotCount + 1)}
                      disabled={slotCount >= MAX_TRUCK_SPACES}
                      aria-label="Agregar un espacio"
                      className="grid size-8 place-items-center rounded-r-pill text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-30"
                    >
                      <Plus aria-hidden className="size-3.5" />
                    </button>
                  </div>
                  <span className="text-label-sm text-on-surface-variant">máx. {MAX_TRUCK_SPACES}</span>
                </div>

                <div className="flex flex-wrap items-baseline gap-space-sm text-label-sm tabular-nums">
                  <span className="text-on-surface-variant">
                    <strong className="text-primary">{placedCount}</strong>/{orders.length} pedidos
                  </span>
                  <span aria-hidden className="text-outline-variant">·</span>
                  <span className="text-on-surface-variant">
                    <strong className="text-secondary">{formatNumber(placed.kg)}</strong> kg en camión
                  </span>
                  <span className="text-outline">de {formatNumber(total.kg)} kg</span>
                </div>
              </div>
              <div
                role="progressbar"
                aria-label="Peso ubicado en el camión"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="mt-space-sm h-1.5 w-full overflow-hidden rounded-pill bg-surface-container-high"
              >
                <div
                  className="h-full rounded-pill bg-secondary transition-[width] duration-500 ease-out"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>

            {/* Camión */}
            <TruckFrame
              slots={draft.segments.map((segment, index) => {
                const order = segmentOrder(segment, byNumber);
                const isOver = overSlot === index;
                const isSelected = Boolean(order && selected === order.orderNumber);
                return (
                  <div
                    key={segment.id || index}
                    className="flex min-w-[5.25rem] flex-1"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setOverSlot(index);
                    }}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && event.currentTarget.contains(next)) return;
                      setOverSlot((previous) => (previous === index ? null : previous));
                    }}
                    onDrop={(event) => handleDrop(event, index)}
                  >
                    <div
                      className={cx(
                        'relative flex h-full min-h-[6.5rem] w-full flex-col rounded-lg border-2 transition-all',
                        order
                          ? 'border-white/25 text-white shadow-sm'
                          : 'border-dashed border-outline-variant/60 bg-surface-container-low/60 text-outline hover:border-primary-container/50 hover:bg-primary-fixed/30',
                        isOver && 'scale-[1.02] ring-2 ring-secondary ring-offset-1',
                        isSelected && 'ring-2 ring-primary ring-offset-1',
                      )}
                      style={order ? { backgroundColor: segment.color ?? slotColor(index) } : undefined}
                    >
                      {order ? (
                        <>
                          <div
                            role="button"
                            tabIndex={0}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', order.orderNumber);
                              event.dataTransfer.effectAllowed = 'move';
                              setDragging(order.orderNumber);
                            }}
                            onDragEnd={() => setDragging(null)}
                            onClick={() => handleSlotClick(index, order.orderNumber)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleSlotClick(index, order.orderNumber);
                              }
                            }}
                            aria-pressed={isSelected}
                            aria-label={`${slotLabel(segment, index, byNumber)} · pedido ${order.orderNumber}. Toca para mover o seleccionar.`}
                            title={`Pedido ${order.orderNumber} · ${formatNumber(order.kg)} kg${order.comments.length > 0 ? ` · ${order.comments.join(' · ')}` : ''}`}
                            className="flex h-full cursor-grab flex-col justify-between px-1.5 py-1.5 text-left outline-none active:cursor-grabbing"
                          >
                            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-b from-white/10 via-transparent to-black/10" />
                            <span className="relative line-clamp-2 text-[10px] font-black uppercase leading-tight tracking-wide">
                              {slotLabel(segment, index, byNumber)}
                            </span>
                            <span className="relative mt-0.5 text-[10px] font-semibold tabular-nums text-white/80">
                              #{order.orderNumber}
                            </span>
                            <span className="relative mt-auto text-[10px] font-semibold tabular-nums text-white/85">
                              {formatNumber(order.kg)} kg
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDraft((previous) => clearSlot(previous, index));
                              setSelected(null);
                            }}
                            aria-label={`Quitar el pedido ${order.orderNumber} del espacio ${index + 1}`}
                            className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/25 text-white transition-colors hover:bg-black/45 focus-visible:bg-black/45"
                          >
                            <X aria-hidden className="size-3" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSlotClick(index)}
                          aria-label={`Espacio ${index + 1} vacío. Añadir un pedido.`}
                          className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md text-center"
                        >
                          <span className="grid size-6 place-items-center rounded-full border border-current">
                            <Plus aria-hidden className="size-3.5" />
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider">Espacio {index + 1}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            />

            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <p className="text-label-sm text-on-surface-variant">
                {selected ? (
                  <span className="font-semibold text-primary">
                    Toca el espacio donde va el pedido {selected}.
                  </span>
                ) : (
                  'Arrastra un pedido al espacio o tócalo y luego toca el espacio.'
                )}
              </p>
              {unplaced.length > 0 && placedCount > 0 && (
                <span className="text-label-sm font-semibold text-warning">
                  Quedan {unplaced.length} pedido(s) fuera del camión
                </span>
              )}
            </div>

            {/* Bandeja de pedidos sin ubicar */}
            <section aria-labelledby="truck-tray-title">
              <div className="mb-space-xs flex items-center justify-between gap-space-sm">
                <p
                  id="truck-tray-title"
                  className="flex items-center gap-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline"
                >
                  <GripVertical aria-hidden className="size-3.5" /> Pedidos sin ubicar
                </p>
                <span className="rounded-pill bg-surface-container px-2 py-0.5 text-label-sm font-bold tabular-nums text-on-surface-variant">
                  {unplaced.length}
                </span>
              </div>

              {unplaced.length === 0 ? (
                <p className="flex items-center gap-space-xs rounded-xl border border-dashed border-secondary/40 bg-secondary-container/10 px-space-sm py-space-md text-label-md font-semibold text-secondary">
                  <CheckCircle2 aria-hidden className="size-4" /> Todos los pedidos están ubicados en el camión.
                </p>
              ) : (
                <ul className="max-h-[13rem] divide-y divide-outline-variant/20 overflow-y-auto rounded-xl border border-outline-variant/35 bg-surface-container-lowest">
                  {unplaced.map((order) => {
                    const isSelected = selected === order.orderNumber;
                    const isDragging = dragging === order.orderNumber;
                    return (
                      <li key={order.orderNumber}>
                        <div
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', order.orderNumber);
                            event.dataTransfer.effectAllowed = 'move';
                            setDragging(order.orderNumber);
                          }}
                          onDragEnd={() => setDragging(null)}
                          className={cx(
                            'flex items-center gap-space-xs px-space-sm py-1.5 transition-colors',
                            isSelected ? 'bg-primary-fixed/45' : 'hover:bg-surface-container-low/70',
                            isDragging && 'opacity-50',
                          )}
                        >
                          <GripVertical aria-hidden className="size-3.5 shrink-0 cursor-grab text-outline" />
                          <button
                            type="button"
                            onClick={() => setSelected((previous) => (previous === order.orderNumber ? null : order.orderNumber))}
                            aria-pressed={isSelected}
                            className="flex min-w-0 flex-1 items-center gap-space-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-secondary-container/70"
                          >
                            <span className="w-10 shrink-0 text-label-sm font-bold tabular-nums text-primary">
                              {order.orderNumber}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-label-md font-semibold text-on-surface">
                              {order.customerName ?? '—'}
                            </span>
                            {order.comments.length > 0 && (
                              <span title={order.comments.join(' · ')} className="shrink-0">
                                <MessageSquare aria-hidden className="size-3.5 text-secondary" />
                              </span>
                            )}
                            <span className="shrink-0 text-label-sm tabular-nums text-on-surface-variant">
                              {formatNumber(order.sacks)} sac · {formatNumber(order.kg)} kg
                            </span>
                            {isSelected && <CheckCircle2 aria-hidden className="size-4 shrink-0 text-primary" />}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {notice && (
              <p role="status" className="rounded-xl bg-surface-container px-space-sm py-2 text-label-md font-semibold text-on-surface-variant">
                {notice}
              </p>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-md py-space-sm sm:px-space-lg">
          <div>
            {plan && planHasOrders(plan) && (
              <button
                type="button"
                onClick={() => onSave(null)}
                className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md text-label-md font-semibold text-error transition-colors hover:bg-error-container/40"
              >
                <Trash2 aria-hidden className="size-4" /> Quitar solicitud
              </button>
            )}
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-pill px-space-md font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-pill bg-primary-container px-space-lg font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              Guardar camión
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

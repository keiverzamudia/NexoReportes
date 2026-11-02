'use client';

// ============================================================
// Guía visual de carga del camión (SOLO LECTURA).
//
// El planificador define los espacios y ubica un pedido en cada uno desde el
// modal de pedidos (`TruckLoadDialog`). Aquí únicamente se muestra el camión
// guardado, sin sugerencias ni reparto automático.
//
// Es una guía operativa: no reserva stock ni escribe en Profit.
// ============================================================

import type { LoadPlan } from '@nexo/contracts';
import { Truck } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { formatNumber } from '../lib/dispatch-sheet';
import {
  LOAD_COLORS,
  ordersByNumber,
  ordersFromLines,
  placedTotals,
  planOrderNumbers,
  round2,
  segmentOrders,
  slotLabel,
  type LoadPlanLine,
} from '../lib/truck-load-plan';
import { Card, cx } from './ui';

// Reexportado para que pedidos y despacho compartan el mismo tipo de renglón.
export type { LoadPlanLine } from '../lib/truck-load-plan';

function TruckCab() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 140"
      className="hidden h-[6.5rem] w-[4.25rem] shrink-0 drop-shadow-sm sm:block"
    >
      <path d="M14 106h44V64c0-7 3-12 10-16l12-6 8 6v58H14Z" fill="#243746" />
      <path d="M46 66h24v20H46z" fill="#B9D9E8" opacity="0.9" />
      <path d="M20 84h20v11H20z" fill="#3E5568" />
      <rect x="8" y="106" width="84" height="12" rx="6" fill="#1B2A36" />
      <circle cx="30" cy="122" r="12" fill="#111C24" />
      <circle cx="30" cy="122" r="5" fill="#6B7C88" />
      <circle cx="72" cy="122" r="12" fill="#111C24" />
      <circle cx="72" cy="122" r="5" fill="#6B7C88" />
    </svg>
  );
}

function TrailerWheel() {
  return <span className="size-4 rounded-full border-2 border-[#243746] bg-[#111C24]" />;
}

/**
 * Marco del camión: cabina + tráiler con espacios iguales. Los hijos son los
 * espacios (uno por posición) y se reparten el ancho disponible.
 */
export function TruckFrame({ slots, className }: { slots: ReactNode[]; className?: string }) {
  return (
    <div className={cx('rounded-2xl border border-outline-variant/40 bg-surface-container-low p-2 sm:p-3', className)}>
      <div className="flex items-stretch">
        <TruckCab />
        <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto rounded-xl border-[3px] border-[#243746] bg-surface-container-lowest p-1.5 sm:rounded-l-none">
          {slots.map((slot, index) => (
            <div key={index} className="flex min-w-[5.25rem] flex-1">
              {slot}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-1 flex justify-end gap-8 pr-5">
        <TrailerWheel />
        <TrailerWheel />
        <TrailerWheel />
      </div>
    </div>
  );
}

export function TruckLoadPlan({
  lines,
  loadPlan,
  title = 'Ubicación de la carga',
  className,
}: {
  lines: LoadPlanLine[];
  loadPlan: LoadPlan | null | undefined;
  title?: string;
  className?: string;
}) {
  const orders = useMemo(() => ordersFromLines(lines), [lines]);
  const byNumber = useMemo(() => ordersByNumber(orders), [orders]);
  const placed = useMemo(() => (loadPlan ? planOrderNumbers(loadPlan) : new Set<string>()), [loadPlan]);
  const placedCount = orders.filter((order) => placed.has(order.orderNumber)).length;

  if (!loadPlan || placedCount === 0) return null;

  const totals = placedTotals(orders, loadPlan);

  return (
    <Card className={cx('overflow-hidden', className)}>
      <div aria-hidden className="h-1 w-full bg-secondary-container" />
      <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
        <p className="flex items-center gap-space-xs font-bold uppercase tracking-wider text-label-md text-primary">
          <Truck aria-hidden className="size-4" /> {title}
        </p>
        <p className="text-label-sm normal-case text-on-surface-variant">
          {placedCount} pedido(s) en {loadPlan.segments.length} espacio(s) · {formatNumber(totals.kg)} kg ·{' '}
          {formatNumber(totals.sacks)} sacos
        </p>
      </div>
      <div className="p-space-md">
        <TruckFrame
          slots={loadPlan.segments.map((segment, index) => {
            const located = segmentOrders(segment, byNumber);
            if (located.length === 0) {
              return (
                <div
                  key={segment.id || index}
                  className="flex h-full min-h-[6rem] w-full items-center justify-center rounded-lg border-2 border-dashed border-outline-variant/50 bg-surface-container-lowest/70 px-1.5 py-2"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-outline">Libre</span>
                </div>
              );
            }
            const color = segment.color ?? LOAD_COLORS[index % LOAD_COLORS.length] ?? LOAD_COLORS[0];
            const kg = round2(located.reduce((sum, order) => sum + order.kg, 0));
            return (
              <div
                key={segment.id || index}
                className="relative flex h-full min-h-[6rem] w-full flex-col justify-between overflow-hidden rounded-lg border border-white/30 px-1.5 py-1.5 text-white"
                style={{ backgroundColor: color }}
                title={`${slotLabel(segment, index, byNumber)} · ${formatNumber(kg)} kg`}
              >
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/10" />
                <span className="relative line-clamp-2 text-[10px] font-black uppercase leading-tight tracking-wide">
                  {slotLabel(segment, index, byNumber)}
                </span>
                <span className="relative mt-0.5 text-[10px] font-semibold tabular-nums text-white/80">
                  {located.length === 1 ? `#${located[0]!.orderNumber}` : `${located.length} pedidos`}
                </span>
                <span className="relative mt-auto text-[10px] font-semibold tabular-nums text-white/85">
                  {formatNumber(kg)} kg
                </span>
              </div>
            );
          })}
        />
      </div>
    </Card>
  );
}

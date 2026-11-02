'use client';

// ============================================================
// Guía de carga del camión: lógica PURA (sin React ni red).
//
// El usuario decide cuántos espacios tiene el vehículo (1–6) y ubica
// exactamente un pedido en cada uno. No hay reparto automático: el orden de
// los `segments` es la ubicación física dentro del tráiler.
//
// `orderNumbers` es la fuente de verdad; `label`, `kg` y `sacks` se derivan de
// los renglones del plan para que nunca queden desfasados.
// ============================================================

import type { LoadPlan, LoadPlanSegment } from '@nexo/contracts';

/** Espacios máximos que puede definir el usuario en el modal. */
export const MAX_TRUCK_SPACES = 6;

export const LOAD_COLORS = [
  '#0F4C5C',
  '#2D6A4F',
  '#E07A5F',
  '#3D5A80',
  '#8D6E63',
  '#6A4C93',
  '#2A9D8F',
  '#BC6C25',
] as const;

/** Un renglón del plan tal como llega desde pedidos o despacho. */
export interface LoadPlanLine {
  orderNumber: string;
  customerCode?: string | null;
  customerName?: string | null;
  productCode?: string;
  description?: string | null;
  kg: number;
  sacks?: number;
  uom?: string | null;
  effectiveDate?: string | null;
  comment?: string | null;
}

/** Un pedido del plan: todos sus renglones agrupados. */
export interface TruckOrder {
  orderNumber: string;
  customerCode: string | null;
  customerName: string | null;
  kg: number;
  sacks: number;
  comments: string[];
  dates: string[];
}

export interface TruckTotals {
  kg: number;
  sacks: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampSpaces(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_TRUCK_SPACES, Math.max(1, Math.round(value)));
}

export function slotColor(index: number): string {
  return LOAD_COLORS[index % LOAD_COLORS.length] ?? LOAD_COLORS[0];
}

/** Espacio en blanco, listo para recibir un pedido. */
export function emptySlot(index: number): LoadPlanSegment {
  return {
    id: `slot-${index + 1}`,
    label: `Espacio ${index + 1}`,
    customerCode: null,
    orderNumbers: [],
    kg: 0,
    sacks: 0,
    color: slotColor(index),
  };
}

/** Camión nuevo con `spaces` espacios vacíos. */
export function createPlan(spaces = 1): LoadPlan {
  const count = clampSpaces(spaces);
  return {
    grouping: 'cliente',
    segments: Array.from({ length: count }, (_, index) => emptySlot(index)),
    note: undefined,
  };
}

/** Agrupa los renglones por número de pedido y suma kg/sacos. */
export function ordersFromLines(lines: LoadPlanLine[]): TruckOrder[] {
  const map = new Map<string, TruckOrder>();
  for (const line of lines) {
    const orderNumber = line.orderNumber.trim();
    if (!orderNumber) continue;
    let order = map.get(orderNumber);
    if (!order) {
      order = {
        orderNumber,
        customerCode: line.customerCode ?? null,
        customerName: line.customerName ?? null,
        kg: 0,
        sacks: 0,
        comments: [],
        dates: [],
      };
      map.set(orderNumber, order);
    }
    order.kg += Number.isFinite(line.kg) ? line.kg : 0;
    order.sacks += Number.isFinite(line.sacks) ? (line.sacks ?? 0) : 0;
    const comment = line.comment?.trim();
    if (comment && !order.comments.includes(comment)) order.comments.push(comment);
    if (line.effectiveDate && !order.dates.includes(line.effectiveDate)) order.dates.push(line.effectiveDate);
  }
  return [...map.values()]
    .map((order) => ({ ...order, kg: round2(order.kg), sacks: round2(order.sacks) }))
    .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, 'es', { numeric: true }));
}

export function ordersByNumber(orders: TruckOrder[]): Map<string, TruckOrder> {
  return new Map(orders.map((order) => [order.orderNumber, order]));
}

export function planTotals(orders: TruckOrder[]): TruckTotals {
  return {
    kg: round2(orders.reduce((sum, order) => sum + order.kg, 0)),
    sacks: round2(orders.reduce((sum, order) => sum + order.sacks, 0)),
  };
}

/** Números de pedido que ya están ubicados en algún espacio. */
export function planOrderNumbers(plan: LoadPlan | null | undefined): Set<string> {
  const numbers = new Set<string>();
  for (const segment of plan?.segments ?? []) {
    for (const orderNumber of segment.orderNumbers) numbers.add(orderNumber);
  }
  return numbers;
}

export function planHasOrders(plan: LoadPlan | null | undefined): boolean {
  return Boolean(plan?.segments.some((segment) => segment.orderNumbers.length > 0));
}

/**
 * Pedidos de un espacio. Los planes nuevos guardan exactamente uno; los
 * históricos podían agrupar varios por bloque y se siguen mostrando.
 */
export function segmentOrders(
  segment: LoadPlanSegment,
  byNumber: Map<string, TruckOrder>,
): TruckOrder[] {
  const seen = new Set<string>();
  const result: TruckOrder[] = [];
  for (const orderNumber of segment.orderNumbers) {
    if (seen.has(orderNumber)) continue;
    seen.add(orderNumber);
    const order = byNumber.get(orderNumber);
    if (order) result.push(order);
  }
  return result;
}

export function placedTotals(orders: TruckOrder[], plan: LoadPlan): TruckTotals {
  const placed = planOrderNumbers(plan);
  return planTotals(orders.filter((order) => placed.has(order.orderNumber)));
}

export function unplacedOrders(orders: TruckOrder[], plan: LoadPlan): TruckOrder[] {
  const placed = planOrderNumbers(plan);
  return orders.filter((order) => !placed.has(order.orderNumber));
}

/** Pedido que ocupa un espacio (o `null` si está libre). */
export function segmentOrder(
  segment: LoadPlanSegment,
  byNumber: Map<string, TruckOrder>,
): TruckOrder | undefined {
  const orderNumber = segment.orderNumbers[0];
  return orderNumber ? byNumber.get(orderNumber) : undefined;
}

/** Etiqueta visible del espacio: cliente del pedido ubicado o «Espacio N». */
export function slotLabel(
  segment: LoadPlanSegment,
  index: number,
  byNumber: Map<string, TruckOrder>,
): string {
  const list = segmentOrders(segment, byNumber);
  if (list.length === 0) return `Espacio ${index + 1}`;
  const first = list[0]!;
  const base = first.customerName?.trim() || `Pedido ${first.orderNumber}`;
  return list.length > 1 ? `${base} +${list.length - 1}` : base;
}

function occupy(segment: LoadPlanSegment, index: number, order: TruckOrder): LoadPlanSegment {
  return {
    id: segment.id || `slot-${index + 1}`,
    label: order.customerName?.trim() || `Pedido ${order.orderNumber}`,
    customerCode: order.customerCode,
    orderNumbers: [order.orderNumber],
    kg: round2(order.kg),
    sacks: round2(order.sacks),
    color: segment.color ?? slotColor(index),
  };
}

/**
 * Ubica un pedido en un espacio. Si ya estaba en otro, se mueve. Si el espacio
 * destino estaba ocupado, el pedido anterior vuelve a la bandeja (sin ubicar).
 */
export function assignOrder(plan: LoadPlan, order: TruckOrder, slotIndex: number): LoadPlan {
  if (plan.segments.length === 0) return plan;
  const target = Math.min(plan.segments.length - 1, Math.max(0, slotIndex));
  const segments = plan.segments.map((segment, index) => {
    if (index !== target && segment.orderNumbers.includes(order.orderNumber)) return emptySlot(index);
    return segment;
  });
  const targetSegment = segments[target];
  if (!targetSegment) return plan;
  segments[target] = occupy(targetSegment, target, order);
  return { ...plan, segments };
}

/** Libera un espacio (el pedido vuelve a la bandeja). */
export function clearSlot(plan: LoadPlan, slotIndex: number): LoadPlan {
  if (!plan.segments[slotIndex]) return plan;
  return {
    ...plan,
    segments: plan.segments.map((segment, index) => (index === slotIndex ? emptySlot(index) : segment)),
  };
}

/** Quita un pedido de donde esté ubicado. */
export function removeOrder(plan: LoadPlan, orderNumber: string): LoadPlan {
  let changed = false;
  const segments = plan.segments.map((segment, index) => {
    if (!segment.orderNumbers.includes(orderNumber)) return segment;
    changed = true;
    return emptySlot(index);
  });
  return changed ? { ...plan, segments } : plan;
}

/**
 * Cambia la cantidad de espacios (1–6). Al reducir, los pedidos de los
 * espacios eliminados vuelven a la bandeja; al ampliar se agregan vacíos.
 */
export function resizePlan(plan: LoadPlan, spaces: number): LoadPlan {
  const count = clampSpaces(spaces);
  if (count === plan.segments.length) return plan;
  const segments = plan.segments.slice(0, count);
  while (segments.length < count) segments.push(emptySlot(segments.length));
  return {
    ...plan,
    segments: segments.map((segment, index) =>
      segment.orderNumbers.length === 0 ? emptySlot(index) : { ...segment, color: segment.color ?? slotColor(index) },
    ),
  };
}

/**
 * Quita de los espacios los pedidos que ya no están en el plan (p. ej. el
 * usuario liberó el renglón). Devuelve la misma referencia si no hubo cambios.
 */
export function prunePlan(plan: LoadPlan, validOrderNumbers: Set<string>): LoadPlan {
  let changed = false;
  const segments = plan.segments.map((segment, index) => {
    if (segment.orderNumbers.length === 0) return segment;
    const kept = segment.orderNumbers.filter((orderNumber) => validOrderNumbers.has(orderNumber));
    if (kept.length === segment.orderNumbers.length) return segment;
    changed = true;
    return kept.length === 0 ? emptySlot(index) : { ...segment, orderNumbers: kept };
  });
  return changed ? { ...plan, segments } : plan;
}

/**
 * Plan listo para editar: un pedido por espacio (los planes históricos podían
 * agrupar varios), sin pedidos que ya no existen y como máximo 6 espacios.
 */
export function fitPlanToOrders(plan: LoadPlan | null | undefined, orders: TruckOrder[]): LoadPlan {
  if (!plan) return createPlan(1);
  const byNumber = ordersByNumber(orders);
  const segments: LoadPlanSegment[] = [];

  for (const segment of plan.segments) {
    const located = segmentOrders(segment, byNumber);
    if (located.length === 0) {
      segments.push(emptySlot(segments.length));
      continue;
    }
    for (const order of located) {
      segments.push(occupy(emptySlot(segments.length), segments.length, order));
    }
  }

  if (segments.length === 0) return createPlan(1);
  return {
    grouping: plan.grouping,
    segments: segments.slice(0, MAX_TRUCK_SPACES),
    note: plan.note,
  };
}

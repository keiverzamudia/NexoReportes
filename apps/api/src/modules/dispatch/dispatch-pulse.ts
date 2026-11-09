import type { DispatchPulse, DispatchPulseSheet } from '@nexo/contracts';
import { businessDateKey } from './dispatch-metrics';

// ============================================================
// Pulso de carga de la bandeja: funciones PURAS.
//
// La bandeja de Despacho muestra hojas abiertas, pero una hoja abierta no
// significa que todo esté pendiente: los renglones ya cargados siguen ahí
// hasta que el operador cierra la hoja. El pulso mide SOLO lo que falta:
//
//   pendiente = max(0, plannedQty - loadedQty)  (y lo mismo en kg)
//
// Reglas de negocio:
//   · SAC  → sacos (unidades) + kg equivalentes.
//   · KG   → granel (solo kg).
//   · otra → «otras unidades» (solo kg); nunca se disfraza de granel.
//   · La urgencia se agrupa por PEDIDO usando su fecha de entrega más
//     próxima (la más vieja de sus renglones pendientes), en zona Caracas.
// ============================================================

export interface PulseLineInput {
  orderNumber: string;
  uom: string | null;
  customerCode: string | null;
  customerName: string | null;
  effectiveDate: string | null;
  plannedQty: unknown;
  plannedKg: unknown;
  loadedQty: unknown;
  loadedKg: unknown;
  /** ANULADO = retirado del plan: no debe contar como pendiente. */
  status?: string | null;
}

export interface PulseSheetInput {
  // Opcionales para no romper a los consumidores que solo necesitan totales;
  // el servicio de Despacho siempre los entrega.
  id?: string;
  number?: string;
  lines: PulseLineInput[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** yyyy-MM-dd de negocio a partir de un texto de fecha mixto. */
export function effectiveDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  // `effectiveDate` es una fecha de negocio, no un instante. Algunas filas
  // históricas llegan serializadas como ISO (`2026-11-05T00:00:00.000Z`);
  // se toma la parte de fecha para no correrla un día en Caracas.
  const datePart = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : businessDateKey(date);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Guarda la fecha de entrega más antigua de un pedido (mapa nº orden → fecha). */
function mergeOrderDate(orders: Map<string, string | null>, orderNumber: string, dateKey: string | null): void {
  if (!orders.has(orderNumber)) {
    orders.set(orderNumber, dateKey);
    return;
  }
  const current = orders.get(orderNumber) ?? null;
  if (dateKey && (current === null || dateKey < current)) {
    orders.set(orderNumber, dateKey);
  }
}

export function buildDispatchPulse(
  sheets: PulseSheetInput[],
  now: Date = new Date(),
): DispatchPulse {
  const todayKey = businessDateKey(now);
  // La semana operativa se mira a 7 días; el resto es «después».
  const weekEndKey = addDays(todayKey, 7);

  let lines = 0;
  let sheetsWithPending = 0;
  let sacks = 0;
  let sacksKg = 0;
  let bulkKg = 0;
  let otherKg = 0;
  let totalKg = 0;
  const orders = new Map<string, string | null>();
  // Cliente (código o nombre) → nombre visible, para el tooltip de la tarjeta.
  const customers = new Map<string, string | null>();
  const bySheet: DispatchPulseSheet[] = [];
  let oldestDue: string | null = null;

  for (const sheet of sheets) {
    let sheetHasPending = false;
    let sheetLines = 0;
    let sheetSacks = 0;
    let sheetKg = 0;
    const sheetOrders = new Map<string, string | null>();

    for (const line of sheet.lines) {
      // Un renglón anulado es historia: no suma al pendiente ni a los pedidos.
      if (line.status === 'ANULADO') continue;

      const pendingQty = Math.max(0, toNumber(line.plannedQty) - toNumber(line.loadedQty));
      const pendingKg = Math.max(0, toNumber(line.plannedKg) - toNumber(line.loadedKg));

      // Un renglón está pendiente si falta unidad o kg. Si ya se cargó todo,
      // no entra en el pulso aunque la hoja siga abierta.
      if (pendingQty <= 0 && pendingKg <= 0) continue;

      sheetHasPending = true;
      lines += 1;
      sheetLines += 1;

      const orderNumber = line.orderNumber?.trim();
      const dateKey = effectiveDateKey(line.effectiveDate);
      if (orderNumber) {
        mergeOrderDate(orders, orderNumber, dateKey);
        mergeOrderDate(sheetOrders, orderNumber, dateKey);
      }

      const customer = line.customerCode?.trim() || line.customerName?.trim();
      const customerName = line.customerName?.trim() || null;
      if (customer) {
        if (!customers.has(customer)) customers.set(customer, customerName);
        else if (!customers.get(customer) && customerName) customers.set(customer, customerName);
      }

      const uom = (line.uom ?? '').trim().toUpperCase();
      if (uom === 'SAC') {
        sacks += pendingQty;
        sacksKg += pendingKg;
        sheetSacks += pendingQty;
      } else if (uom === 'KG') {
        bulkKg += pendingKg;
      } else {
        otherKg += pendingKg;
      }
      totalKg += pendingKg;
      sheetKg += pendingKg;
    }

    if (sheetHasPending) {
      sheetsWithPending += 1;
      const sheetDates = [...sheetOrders.values()].filter((value): value is string => Boolean(value)).sort();
      const sheetOldest = sheetDates[0] ?? null;
      if (sheetOldest && (oldestDue === null || sheetOldest < oldestDue)) oldestDue = sheetOldest;
      bySheet.push({
        id: sheet.id ?? '',
        number: sheet.number ?? '',
        orders: sheetOrders.size,
        lines: sheetLines,
        sacks: round2(sheetSacks),
        kg: round2(sheetKg),
        oldestDue: sheetOldest,
      });
    }
  }

  const urgency = { overdue: 0, today: 0, week: 0, later: 0, noDate: 0 };
  for (const dateKey of orders.values()) {
    if (!dateKey) urgency.noDate += 1;
    else if (dateKey < todayKey) urgency.overdue += 1;
    else if (dateKey === todayKey) urgency.today += 1;
    else if (dateKey <= weekEndKey) urgency.week += 1;
    else urgency.later += 1;
  }

  const customerNames = [...new Set([...customers.values()].filter((name): name is string => Boolean(name)))].slice(0, 4);

  return {
    generatedAt: now.toISOString(),
    openSheets: sheets.length,
    sheets: sheetsWithPending,
    orders: orders.size,
    lines,
    customers: customers.size,
    sacks: round2(sacks),
    sacksKg: round2(sacksKg),
    bulkKg: round2(bulkKg),
    otherKg: round2(otherKg),
    totalKg: round2(totalKg),
    oldestDue,
    customerNames,
    urgency,
    bySheet,
  };
}

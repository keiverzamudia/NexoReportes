import type { DispatchPulse } from '@nexo/contracts';
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
}

export interface PulseSheetInput {
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
  const customers = new Set<string>();

  for (const sheet of sheets) {
    let sheetHasPending = false;
    for (const line of sheet.lines) {
      const pendingQty = Math.max(0, toNumber(line.plannedQty) - toNumber(line.loadedQty));
      const pendingKg = Math.max(0, toNumber(line.plannedKg) - toNumber(line.loadedKg));

      // Un renglón está pendiente si falta unidad o kg. Si ya se cargó todo,
      // no entra en el pulso aunque la hoja siga abierta.
      if (pendingQty <= 0 && pendingKg <= 0) continue;

      sheetHasPending = true;
      lines += 1;

      const orderNumber = line.orderNumber?.trim();
      if (orderNumber) {
        const dateKey = effectiveDateKey(line.effectiveDate);
        if (!orders.has(orderNumber)) {
          orders.set(orderNumber, dateKey);
        } else {
          const current = orders.get(orderNumber) ?? null;
          if (dateKey && (current === null || dateKey < current)) {
            orders.set(orderNumber, dateKey);
          }
        }
      }

      const customer = line.customerCode?.trim() || line.customerName?.trim();
      if (customer) customers.add(customer);

      const uom = (line.uom ?? '').trim().toUpperCase();
      if (uom === 'SAC') {
        sacks += pendingQty;
        sacksKg += pendingKg;
      } else if (uom === 'KG') {
        bulkKg += pendingKg;
      } else {
        otherKg += pendingKg;
      }
      totalKg += pendingKg;
    }
    if (sheetHasPending) sheetsWithPending += 1;
  }

  const urgency = { overdue: 0, today: 0, week: 0, later: 0, noDate: 0 };
  for (const dateKey of orders.values()) {
    if (!dateKey) urgency.noDate += 1;
    else if (dateKey < todayKey) urgency.overdue += 1;
    else if (dateKey === todayKey) urgency.today += 1;
    else if (dateKey <= weekEndKey) urgency.week += 1;
    else urgency.later += 1;
  }

  return {
    generatedAt: now.toISOString(),
    sheets: sheetsWithPending,
    orders: orders.size,
    lines,
    customers: customers.size,
    sacks: round2(sacks),
    sacksKg: round2(sacksKg),
    bulkKg: round2(bulkKg),
    otherKg: round2(otherKg),
    totalKg: round2(totalKg),
    urgency,
  };
}

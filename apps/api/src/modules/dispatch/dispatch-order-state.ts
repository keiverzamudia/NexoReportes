import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Estado de un pedido/renglón dentro de los despachos.
//
// Dos bloques distintos, por regla de negocio:
//   · `inDispatch` → el renglón ya vive en una hoja no anulada y esa hoja
//     sigue en operación (el cliente no ha cerrado su carga). No se puede
//     volver a enviar a despacho.
//   · `started`    → la carga ya arrancó (primer renglón, «Iniciar carga»,
//     factura o hoja DESPACHADA). La fecha de entrega queda bloqueada en
//     nuestro sistema y en Profit (`cotiz_c.aux01 = 1`); es del pedido
//     completo porque el bloqueo vive en el encabezado de Profit.
//
// El bloqueo es POR RENGLÓN (`pedido#artículo`), no por pedido: un pedido puede
// despacharse en tandas y sus artículos no despachados deben seguir libres.
//
// Las hojas CANCELADAS y los renglones ANULADOS no cuentan: el pedido volvió
// a la cartera.
//
// Cuando la hoja de un renglón ya se cerró para ese cliente, el renglón deja de
// bloquear y vuelve a la cartera SOLO por el saldo que no se cargó
// (`cantidad pedida − unidades ya cargadas`). Así un parcial puede reenviarse
// sin duplicar lo que Profit todavía no registra en la nota de entrega.
// ============================================================

export interface OrderDispatchState {
  sheetId: string;
  sheetNumber: string;
  inDispatch: boolean;
  started: boolean;
}

export interface LineDispatchState {
  /** Hoja abierta donde el renglón sigue en operación (null = libre). */
  openSheetId: string | null;
  openSheetNumber: string | null;
  /** Unidades ya cargadas del renglón en cualquier hoja no anulada. */
  loadedQty: number;
  /** La carga del pedido ya arrancó (bloquea la fecha de entrega). */
  started: boolean;
}

export interface DispatchStates {
  /** Clave `pedido#artículo` → estado del renglón. */
  lines: Map<string, LineDispatchState>;
  /** Clave = nº de pedido. */
  orders: Map<string, OrderDispatchState>;
}

/** Clave compartida por el simulador y los despachos (`pedido#artículo`). */
export function dispatchLineKey(line: { orderNumber: string | null; productCode?: string | null }): string {
  return `${(line.orderNumber ?? '').trim()}#${(line.productCode ?? '').trim()}`;
}

function customerKey(line: { customerCode: string | null; customerName: string | null }): string {
  return line.customerCode?.trim() || line.customerName?.trim() || 'SIN_CLIENTE';
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Estado por pedido y por renglón. Si un pedido aparece en varias hojas, manda
 * la más restrictiva (basta que una tenga la carga iniciada para bloquear la
 * fecha); para el renglón manda la primera hoja abierta que se encuentre.
 */
export async function loadDispatchStates(
  prisma: PrismaService,
  orderNumbers: string[],
): Promise<DispatchStates> {
  const numbers = [...new Set(orderNumbers.map((number) => number.trim()).filter(Boolean))];
  const lines = new Map<string, LineDispatchState>();
  const orders = new Map<string, OrderDispatchState>();
  if (numbers.length === 0) return { lines, orders };

  const rows = await prisma.dispatchSheetLine.findMany({
    where: {
      orderNumber: { in: numbers },
      status: { not: 'ANULADO' },
    },
    include: {
      sheet: { include: { customerProgress: true } },
    },
  });

  for (const row of rows) {
    const sheet = row.sheet;
    if (!sheet || sheet.status === 'CANCELADO' || row.status === 'ANULADO') continue;

    const progress = sheet.customerProgress.find(
      (item) => item.customerKey === customerKey(row),
    );
    const started =
      sheet.status === 'DESPACHADO' ||
      row.checkedAt !== null ||
      row.status !== 'PENDIENTE' ||
      Boolean(progress?.loadStartedAt) ||
      Boolean(progress?.invoiceDeliveredAt);
    // El cliente ya terminó su carga (o la hoja está despachada): el renglón
    // dejó de estar «en operación» y solo queda su saldo sin cargar.
    const customerClosed =
      sheet.status === 'DESPACHADO' ||
      Boolean(progress?.loadClosedAt) ||
      Boolean(progress?.invoiceDeliveredAt);
    const key = dispatchLineKey(row);
    const current = lines.get(key) ?? {
      openSheetId: null,
      openSheetNumber: null,
      loadedQty: 0,
      started: false,
    };
    current.loadedQty += toNumber(row.loadedQty);
    current.started = current.started || started;
    if (!customerClosed && !current.openSheetNumber) {
      current.openSheetId = sheet.id;
      current.openSheetNumber = sheet.number;
    }
    lines.set(key, current);

    const orderNumber = row.orderNumber.trim();
    const previous = orders.get(orderNumber);
    orders.set(orderNumber, {
      // Se conserva la hoja más antigua encontrada para el aviso.
      sheetId: previous?.sheetId ?? sheet.id,
      sheetNumber: previous?.sheetNumber ?? sheet.number,
      inDispatch: true,
      started: Boolean(previous?.started) || started,
    });
  }

  return { lines, orders };
}

/**
 * Estado por número de pedido. Lo usa el bloqueo de fecha en Profit, que vive
 * en el encabezado del pedido y por eso no se puede separar por artículo.
 */
export async function loadOrderDispatchStates(
  prisma: PrismaService,
  orderNumbers: string[],
): Promise<Map<string, OrderDispatchState>> {
  return (await loadDispatchStates(prisma, orderNumbers)).orders;
}

/** Estado por renglón (`pedido#artículo`). */
export async function loadLineDispatchStates(
  prisma: PrismaService,
  refs: Array<{ orderNumber: string; productCode: string }>,
): Promise<Map<string, LineDispatchState>> {
  return (await loadDispatchStates(prisma, refs.map((ref) => ref.orderNumber))).lines;
}

/**
 * Cantidad que todavía puede planificarse para un renglón:
 *   · sin despacho previo → todo el pendiente de Profit.
 *   · con despacho abierto → el pendiente (el renglón se filtra aparte).
 *   · con despacho ya cerrado → solo el saldo no cargado, nunca más que el
 *     pendiente de Profit (que sigue incluyendo lo que Profit no ha registrado).
 */
export function plannableQtyFor(
  state: LineDispatchState | undefined,
  line: { pendingQty: number; quantity: number | null },
): number {
  if (!state) return line.pendingQty;
  if (state.openSheetNumber) return line.pendingQty;
  if (line.pendingQty <= 0) return line.pendingQty;
  if (line.quantity === null) return line.pendingQty;
  const remaining = line.quantity - state.loadedQty;
  return Math.max(0, Math.min(line.pendingQty, remaining));
}

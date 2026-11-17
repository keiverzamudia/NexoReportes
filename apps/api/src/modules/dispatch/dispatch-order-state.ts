import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Estado de un pedido dentro de los despachos.
//
// Dos bloques distintos, por regla de negocio:
//   · `inDispatch` → el pedido ya vive en una hoja no anulada. No se puede
//     volver a enviar a despacho (ni siquiera después de despachado).
//   · `started`    → la carga ya arrancó (primer renglón, «Iniciar carga»,
//     factura o hoja DESPACHADA). La fecha de entrega queda bloqueada en
//     nuestro sistema y en Profit (`cotiz_c.aux01 = 1`).
//
// Las hojas CANCELADAS y los renglones ANULADOS no cuentan: el pedido volvió
// a la cartera.
// ============================================================

export interface OrderDispatchState {
  sheetId: string;
  sheetNumber: string;
  inDispatch: boolean;
  started: boolean;
}

function customerKey(line: { customerCode: string | null; customerName: string | null }): string {
  return line.customerCode?.trim() || line.customerName?.trim() || 'SIN_CLIENTE';
}

/**
 * Estado por número de pedido. Si aparece en varias hojas, manda la más
 * restrictiva (basta que una tenga la carga iniciada para bloquear la fecha).
 */
export async function loadOrderDispatchStates(
  prisma: PrismaService,
  orderNumbers: string[],
): Promise<Map<string, OrderDispatchState>> {
  const numbers = [...new Set(orderNumbers.map((number) => number.trim()).filter(Boolean))];
  if (numbers.length === 0) return new Map();

  const lines = await prisma.dispatchSheetLine.findMany({
    where: {
      orderNumber: { in: numbers },
      status: { not: 'ANULADO' },
    },
    include: {
      sheet: { include: { customerProgress: true } },
    },
  });

  const states = new Map<string, OrderDispatchState>();
  for (const line of lines) {
    const sheet = line.sheet;
    if (!sheet || sheet.status === 'CANCELADO') continue;

    const progress = sheet.customerProgress.find(
      (row) => row.customerKey === customerKey(line),
    );
    const started =
      sheet.status === 'DESPACHADO' ||
      line.checkedAt !== null ||
      line.status !== 'PENDIENTE' ||
      Boolean(progress?.loadStartedAt) ||
      Boolean(progress?.invoiceDeliveredAt);

    const previous = states.get(line.orderNumber);
    states.set(line.orderNumber, {
      // Se conserva la hoja más antigua encontrada para el aviso.
      sheetId: previous?.sheetId ?? sheet.id,
      sheetNumber: previous?.sheetNumber ?? sheet.number,
      inDispatch: true,
      started: Boolean(previous?.started) || started,
    });
  }

  return states;
}

/** Nº de pedido → nº de despacho donde ya vive. */
export async function loadOrdersInDispatch(
  prisma: PrismaService,
  orderNumbers: string[],
): Promise<Map<string, string>> {
  const states = await loadOrderDispatchStates(prisma, orderNumbers);
  return new Map(
    [...states.entries()]
      .filter(([, state]) => state.inDispatch)
      .map(([orderNumber, state]) => [orderNumber, state.sheetNumber]),
  );
}

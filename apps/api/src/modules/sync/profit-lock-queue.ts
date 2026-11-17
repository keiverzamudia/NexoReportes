import { PrismaService } from '../../common/prisma.module';

// ============================================================
// Cola de escritura del bloqueo de entrega en Profit (`cotiz_c.aux01`).
//
// El bloqueo local es inmediato; esta cola solo se encarga de que Profit se
// entere. Es idempotente: un pedido tiene un job por sentido (bloquear o
// liberar) y volver a encolarlo lo deja de nuevo pendiente con 0 intentos.
// ============================================================

const SAFE_ORDER_NUMBER = /^\d{1,12}$/;

export async function enqueueProfitLock(
  prisma: PrismaService,
  orderNumbers: string[],
  locked: boolean,
  actorCode: string | null,
): Promise<number> {
  const unique = [...new Set(orderNumbers.map((number) => number.trim()))].filter((number) =>
    SAFE_ORDER_NUMBER.test(number),
  );
  if (unique.length === 0) return 0;

  const code = actorCode?.trim().toUpperCase() || null;
  for (const orderNumber of unique) {
    await prisma.profitLockJob.upsert({
      where: { orderNumber_locked: { orderNumber, locked } },
      create: { orderNumber, locked, actorCode: code, status: 'PENDIENTE' },
      update: {
        status: 'PENDIENTE',
        attempts: 0,
        lastError: null,
        sentAt: null,
        actorCode: code,
      },
    });
  }
  return unique.length;
}

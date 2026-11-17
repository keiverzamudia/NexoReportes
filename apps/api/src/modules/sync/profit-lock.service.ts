import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.module';
import { PROFIT_WRITER } from './profit-writer.adapter';
import type { ProfitWriter } from './profit-writer.adapter';

// ============================================================
// Procesa la cola de bloqueo de entrega en Profit (`cotiz_c.aux01`).
//
// El bloqueo LOCAL es inmediato (la hoja ya no acepta cambios de fecha).
// Este servicio empuja los jobs a Profit al momento y el scheduler lo vuelve
// a llamar cada minuto: si Profit no responde, se sigue trabajando y el job
// queda en ERROR con el motivo para el siguiente intento.
// ============================================================

const MAX_ATTEMPTS = 30;

@Injectable()
export class ProfitLockService {
  private readonly logger = new Logger(ProfitLockService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_WRITER) private readonly writer: ProfitWriter,
  ) {}

  async processPending(limit = 20): Promise<{ sent: number; failed: number }> {
    if (this.running || !this.writer.enabled || this.writer.dryRun) return { sent: 0, failed: 0 };
    this.running = true;
    try {
      const jobs = await this.prisma.profitLockJob.findMany({
        where: {
          status: { in: ['PENDIENTE', 'ERROR'] },
          attempts: { lt: MAX_ATTEMPTS },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      let sent = 0;
      let failed = 0;
      for (const job of jobs) {
        try {
          const result = await this.writer.updateOrderDateLock(
            job.orderNumber,
            job.locked,
            job.actorCode || 'SYSTEM',
          );
          if (result.affected === 0) {
            failed += 1;
            await this.prisma.profitLockJob.update({
              where: { id: job.id },
              data: {
                status: 'ERROR',
                attempts: job.attempts + 1,
                lastError: 'Profit no modificó el pedido (¿anulado o sin permiso de UPDATE?).',
              },
            });
            continue;
          }
          sent += 1;
          await this.prisma.profitLockJob.update({
            where: { id: job.id },
            data: { status: 'ENVIADO', sentAt: new Date(), lastError: null },
          });
        } catch (error) {
          failed += 1;
          await this.prisma.profitLockJob.update({
            where: { id: job.id },
            data: {
              status: 'ERROR',
              attempts: job.attempts + 1,
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido',
            },
          });
        }
      }

      if (sent > 0 || failed > 0) {
        this.logger.log(`Bloqueo de entrega en Profit: ${sent} enviado(s), ${failed} con error.`);
      }
      return { sent, failed };
    } finally {
      this.running = false;
    }
  }
}

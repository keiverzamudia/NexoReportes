import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfitLockService } from './profit-lock.service';

// ============================================================
// Reloj de reintento de la cola de bloqueo de entrega en Profit.
//
// El envío inmediato lo hace `ProfitLockService` al iniciar la carga; este
// reloj solo vuelve a intentar lo que quedó pendiente o con error.
// ============================================================

@Injectable()
export class ProfitLockScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfitLockScheduler.name);
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly locks: ProfitLockService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>('profit.write.lockRetrySeconds') ?? 60;
    this.logger.log(`Reintento de bloqueo de entrega en Profit cada ${seconds}s.`);
    this.interval = setInterval(() => void this.tick(), seconds * 1000);
    this.interval.unref?.();
    setTimeout(() => void this.tick(), 15_000).unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.locks.processPending();
    } catch (error) {
      this.logger.warn(
        `Cola de bloqueo en Profit omitida: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

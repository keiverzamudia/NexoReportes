import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROMANA_LIMITS } from '@nexo/contracts';
import { RomanaService } from './romana.service';

// ============================================================
// Barrido de fotos de Romana.
//
// La validación ya borra las fotos; este reloj es la red de seguridad:
// reintenta borrados fallidos, expira fotos de llegadas que nunca se
// validaron y limpia carpetas huérfanas. `ROMANA_CLEANUP_DRY_RUN=true`
// deja el cálculo visible sin borrar.
// ============================================================

@Injectable()
export class RomanaCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RomanaCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly romana: RomanaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!(this.config.get<boolean>('romana.cleanup.enabled') ?? true)) {
      this.logger.log('Limpieza automática de fotos de Romana desactivada.');
      return;
    }
    const hours = this.config.get<number>('romana.cleanup.intervalHours') ?? 6;
    this.logger.log(`Limpieza de fotos de Romana cada ${hours} h.`);

    this.timer = setTimeout(() => {
      void this.tick();
      this.interval = setInterval(() => void this.tick(), hours * 60 * 60 * 1000);
      this.interval.unref?.();
    }, 120_000);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.romana.cleanup({
        retentionHours: this.config.get<number>('romana.retentionHours') ?? ROMANA_LIMITS.retentionHours,
        dryRun: this.config.get<boolean>('romana.cleanup.dryRun') ?? false,
      });
    } catch (error) {
      this.logger.warn(
        `Limpieza de Romana omitida: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SCENARIO_RETENTION_HOURS } from '@nexo/contracts';
import { ScenariosService } from './scenarios.service';

// ============================================================
// Barrido de simulaciones vencidas.
//
// Las simulaciones guardadas son fotos de vida corta: la hoja de despacho ya
// copió nombre, foto y receta. Cada N horas se borran las que llevan 72 h sin
// uso. `SCENARIO_CLEANUP_DRY_RUN=true` deja el cálculo visible sin borrar.
// ============================================================

@Injectable()
export class ScenariosCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScenariosCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly scenarios: ScenariosService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!(this.config.get<boolean>('scenarioCleanup.enabled') ?? true)) {
      this.logger.log('Limpieza automática de simulaciones desactivada.');
      return;
    }
    const hours = this.config.get<number>('scenarioCleanup.intervalHours') ?? 6;
    this.logger.log(`Limpieza de simulaciones cada ${hours} h.`);

    // Arranque escalonado para no competir con la primera sync al levantar.
    this.timer = setTimeout(() => {
      void this.tick();
      this.interval = setInterval(() => void this.tick(), hours * 60 * 60 * 1000);
      this.interval.unref?.();
    }, 90_000);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.scenarios.purgeExpired({
        hours: this.config.get<number>('scenarioCleanup.hours') ?? SCENARIO_RETENTION_HOURS,
        dryRun: this.config.get<boolean>('scenarioCleanup.dryRun') ?? false,
      });
    } catch (error) {
      // El servicio ya registra su resultado; aquí solo evitamos que el reloj
      // muera por un error inesperado.
      this.logger.warn(
        `Limpieza de simulaciones omitida: ${error instanceof Error ? error.message : 'Error desconocido'}`,
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

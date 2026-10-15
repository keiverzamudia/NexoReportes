import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncService } from './sync.service';

// Sincronización automática opcional (Fase 2).
// Si SYNC_INTERVAL_SECONDS > 0, corre una sincronización completa cada N
// segundos. Con 0 (por defecto) queda desactivada y sólo se sincroniza
// manualmente (botón "Sincronizar" en la interfaz o POST /api/sync/run-all).
@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sync: SyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>('sync.intervalSeconds') ?? 0;
    if (seconds <= 0) {
      this.logger.log('Sincronización automática desactivada (SYNC_INTERVAL_SECONDS=0).');
      return;
    }
    this.logger.log(`Sincronización automática activada: cada ${seconds}s.`);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    // No bloquear el cierre del proceso por el temporizador.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Corrida automática omitida: la anterior sigue en curso.');
      return;
    }
    this.running = true;
    try {
      const result = await this.sync.runAll({ email: 'scheduler@nexo.local' });
      const ok = result.domains.filter((d) => d.status === 'EXITOSA').length;
      this.logger.log(`Auto-sync: ${ok}/${result.domains.length} EXITOSA (leídas=${result.totalRead}, errores=${result.totalErrors}).`);
    } catch (error) {
      this.logger.error(`Auto-sync falló: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

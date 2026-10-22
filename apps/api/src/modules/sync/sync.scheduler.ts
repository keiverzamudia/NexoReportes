import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncDomain } from '@nexo/contracts';
import { parseSyncSchedule } from './sync.schedule';
import { SyncService } from './sync.service';

// ============================================================
// Sincronización automática (Fase 2, revisada).
//
// Dos modos, combinables:
//   · SYNC_INTERVAL_SECONDS > 0 → corrida COMPLETA cada N segundos.
//   · SYNC_SCHEDULE → reloj POR DOMINIO ("EXISTENCIAS=120,PEDIDOS=300").
//
// El reloj por dominio es la forma sostenible: lo volátil (existencias,
// pedidos) se refresca seguido y el catálogo (productos: ~17 s de lectura)
// solo unas pocas veces al día. Con ambos en 0 (por defecto) la sincronización
// es manual (botón «Sincronizar» o POST /api/sync/run-all).
//
// Cada dominio corre en su propio temporizador y nunca se solapa consigo mismo.
// ============================================================

@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  // Una sola corrida a la vez: todos los dominios leen la MISMA vista de
  // Profit y el pool de SQL Server no tolera dos lecturas concurrentes
  // («Connection is closed»). Se encolan, no se paralelizan.
  private queue: Promise<void> = Promise.resolve();
  private readonly busy = new Set<string>();

  constructor(
    private readonly sync: SyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const schedule = parseSyncSchedule(this.config.get<string>('sync.schedule'));
    const fullSeconds = this.config.get<number>('sync.intervalSeconds') ?? 0;

    if (fullSeconds > 0) {
      this.logger.log(`Sincronización completa automática: cada ${fullSeconds}s.`);
      this.addTimer(0, fullSeconds, () => this.runFull());
    }

    // Escalonado: los relojes no arrancan todos en el mismo segundo.
    let index = 1;
    for (const [domain, seconds] of schedule) {
      this.logger.log(`Sincronización de ${domain}: cada ${seconds}s.`);
      this.addTimer(index * 5_000, seconds, () => this.runDomain(domain));
      index += 1;
    }

    if (this.timers.length === 0) {
      this.logger.log(
        'Sincronización automática desactivada (SYNC_INTERVAL_SECONDS=0 y SYNC_SCHEDULE vacío): solo manual.',
      );
      return;
    }

    const summary = [...schedule.entries()].map(([domain, seconds]) => `${domain}=${seconds}s`).join(' · ');
    this.logger.log(`Relojes activos: ${this.timers.length}${summary ? ` (${summary})` : ''}`);
  }

  private addTimer(offsetMs: number, seconds: number, task: () => Promise<void>): void {
    const timer = setTimeout(() => {
      void task();
      const interval = setInterval(() => void task(), seconds * 1000);
      interval.unref?.();
      this.timers.push(interval);
    }, offsetMs);
    // No bloquear el cierre del proceso por los temporizadores.
    timer.unref?.();
    this.timers.push(timer);
  }

  // Encola una corrida; nunca hay dos dominios leyendo Profit a la vez.
  private enqueue(key: string, task: () => Promise<void>): void {
    if (this.busy.has(key)) {
      this.logger.warn(`Corrida de ${key} omitida: sigue en cola o en curso.`);
      return;
    }
    this.busy.add(key);
    this.queue = this.queue
      .then(task)
      .catch((error) => {
        this.logger.error(`Auto-sync ${key} falló: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      })
      .finally(() => this.busy.delete(key));
  }

  private async runFull(): Promise<void> {
    this.enqueue('__all__', async () => {
      const result = await this.sync.runAll({ email: 'scheduler@nexo.local' });
      const ok = result.domains.filter((d) => d.status === 'EXITOSA').length;
      this.logger.log(`Auto-sync: ${ok}/${result.domains.length} EXITOSA (leídas=${result.totalRead}, errores=${result.totalErrors}).`);
    });
  }

  private async runDomain(domain: SyncDomain): Promise<void> {
    this.enqueue(domain, async () => {
      const first = await this.sync.run(domain, { email: 'scheduler@nexo.local' });
      if (first.status !== 'ERROR') {
        this.logger.log(
          `Auto-sync ${domain}: ${first.status} (leídas=${first.recordsRead}, upsert=${first.recordsUpserted}, errores=${first.errorsCount}).`,
        );
        return;
      }
      // Un tropiezo de conexión no debe dejar el dato viejo: un reintento.
      this.logger.warn(`Auto-sync ${domain} falló (${first.errorDetail ?? 'sin detalle'}); reintentando…`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const second = await this.sync.run(domain, { email: 'scheduler@nexo.local' });
      this.logger.log(
        `Auto-sync ${domain} (reintento): ${second.status} (leídas=${second.recordsRead}, upsert=${second.recordsUpserted}, errores=${second.errorsCount}).`,
      );
    });
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
  }
}

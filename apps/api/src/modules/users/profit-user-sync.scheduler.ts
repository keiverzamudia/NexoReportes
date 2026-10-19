import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

// Sincronización diaria de usuarios de Profit (misma función que el botón
// manual, sin duplicar lógica). Nunca corre al arrancar: espera la hora
// configurada (PROFIT_USER_SYNC_HOUR, por defecto 3). Mientras está apagado
// el login sigue funcionando con el padrón ya sincronizado.
@Injectable()
export class ProfitUserSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfitUserSyncScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.config.get<boolean>('users.syncEnabled')) {
      this.logger.log('Sincronización automática de usuarios de Profit deshabilitada.');
      return;
    }
    // Bootstrap: una instalación nueva no tiene usuarios y el módulo que los
    // administra exige sesión de ADMIN. Si el padrón está vacío, se trae de
    // Profit al arrancar (una sola vez; después manda la programación diaria).
    try {
      if (await this.users.isEmpty()) {
        this.logger.log('Padrón de usuarios vacío: sincronizando desde Profit al arrancar…');
        const result = await this.users.synchronize();
        this.logger.log(
          `Bootstrap de usuarios: ${result.total} leídos, ${result.created} creados, ${result.admins} administradores.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo sincronizar usuarios al arrancar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.scheduleNext();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private syncHour(): number {
    const hour = Number(this.config.get<number>('users.syncHour') ?? 3);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3;
  }

  private msUntilNextRun(now = new Date()): number {
    const next = new Date(now);
    next.setHours(this.syncHour(), 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  private scheduleNext() {
    const ms = this.msUntilNextRun();
    this.logger.log(`Próxima sincronización de usuarios de Profit en ${Math.round(ms / 60000)} min.`);
    this.timer = setTimeout(() => void this.tick(), ms);
    if (this.timer.unref) this.timer.unref();
  }

  async tick(): Promise<'ok' | 'failed' | 'skipped-concurrent'> {
    if (this.running) {
      this.logger.warn('Sincronización de usuarios omitida: ya hay una en curso.');
      return 'skipped-concurrent';
    }
    this.running = true;
    try {
      await this.users.synchronize();
      return 'ok';
    } catch (error) {
      this.logger.error(
        `Sincronización de usuarios falló: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'failed';
    } finally {
      this.running = false;
      if (this.config.get<boolean>('users.syncEnabled')) this.scheduleNext();
    }
  }
}

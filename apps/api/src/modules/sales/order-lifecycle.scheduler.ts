import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderLifecycleService } from './order-lifecycle.service';

// ============================================================
// Reloj de reconciliación de pedidos.
//
// Cada N segundos revisa los pedidos abiertos contra Profit. No compite con
// el sync porque el servicio es single-flight y el adaptador serializa las
// lecturas; si una corrida falla, la siguiente vuelve a intentar.
// `ORDER_RECONCILE_DRY_RUN=true` deja el cálculo visible sin escribir.
// ============================================================

@Injectable()
export class OrderLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderLifecycleScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: OrderLifecycleService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!(this.config.get<boolean>('orderLifecycle.enabled') ?? true)) {
      this.logger.log('Reconciliación automática de pedidos desactivada.');
      return;
    }
    const seconds = this.config.get<number>('orderLifecycle.seconds') ?? 300;
    const dryRun = this.config.get<boolean>('orderLifecycle.dryRun') ?? false;
    this.logger.log(
      `Reconciliación de pedidos cada ${seconds}s${dryRun ? ' (DRY-RUN: no escribe)' : ''}.`,
    );

    // Arranque escalonado: no competir con el primer sync al levantar la API.
    this.timer = setTimeout(() => {
      void this.tick();
      this.interval = setInterval(() => void this.tick(), seconds * 1000);
      this.interval.unref?.();
    }, 45_000);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.service.reconcile({
        trigger: 'SCHEDULER',
      });
    } catch (error) {
      // El servicio ya registra la corrida; aquí solo evitamos que el reloj
      // muera por un error inesperado.
      this.logger.warn(
        `Reconciliación automática omitida: ${error instanceof Error ? error.message : 'Error desconocido'}`,
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

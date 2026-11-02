import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ForecastService } from './forecast.service';

// ============================================================
// Snapshot periódico de la meta (`xart_fore.kg_mes` → ForecastTarget).
//
// `xart_fore` solo existe para el mes en curso. Este reloj guarda la meta cada
// hora para que, cuando el mes cierre, el informe pueda comparar la venta real
// contra la meta histórica. Es una escritura LOCAL (SQLite/PostgreSQL de Nexo),
// nunca en Profit.
//
// Se puede desactivar con FORECAST_TARGET_INTERVAL_MINUTES=0 o vacío.
// ============================================================

@Injectable()
export class ForecastTargetScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForecastTargetScheduler.name);
  private interval: NodeJS.Timeout | null = null;
  private bootstrap: NodeJS.Timeout | null = null;

  constructor(private readonly forecast: ForecastService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const raw = process.env.FORECAST_TARGET_INTERVAL_MINUTES;
    const minutes = raw === undefined || raw.trim() === '' ? 60 : Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.logger.log('Snapshot de la meta (ForecastTarget) desactivado.');
      return;
    }

    // Primera captura poco después de arrancar, sin bloquear el bootstrap.
    this.bootstrap = setTimeout(() => void this.capture(), 15_000);
    this.bootstrap.unref();
    this.interval = setInterval(() => void this.capture(), minutes * 60_000);
    this.interval.unref();
    this.logger.log(`Snapshot de la meta (ForecastTarget): cada ${minutes} min.`);
  }

  onModuleDestroy(): void {
    if (this.bootstrap) clearTimeout(this.bootstrap);
    if (this.interval) clearInterval(this.interval);
  }

  private async capture(): Promise<void> {
    try {
      const result = await this.forecast.captureForecastTargets();
      if (!result.captured) {
        this.logger.warn('Snapshot de la meta omitido: xart_fore no respondió.');
        return;
      }
      this.logger.log(`Snapshot de la meta ${result.year}-${String(result.month).padStart(2, '0')}: ${result.products} artículos.`);
    } catch (error) {
      this.logger.warn(
        `Error al capturar la meta mensual: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    }
  }
}

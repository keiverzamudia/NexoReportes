import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FORECAST_WEEK_INDEXES,
  ForecastPlanResponse,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastSetMonthly,
  ForecastSetWeeks,
  ForecastWeekRange,
  ForecastWeekRow,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';

// ============================================================
// Forca (pronóstico de producción). Datos PROPIOS de Nexo Producción:
// NO se escribe nada en Profit (solo se lee para stock/pedidos/artículos).
//
//  · El FORCA MENSUAL por artículo se fija y queda BLOQUEADO; para
//    cambiarlo se exige la clave especial (FORECAST_UNLOCK_KEY).
//  · El reparto por semana (4 bloques) tiene un factor `pct` editable.
//  · Producción semanal = max(0, max(forca_sem, demanda_sem) − stock global).
// ============================================================

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Bloques fijos: 1-7, 8-14, 15-21, 22-fin.
export const WEEK_BOUNDS = [
  [1, 7],
  [8, 14],
  [15, 21],
  [22, 31],
] as const;

export function weekIndexOf(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function weekRanges(year: number, month: number): ForecastWeekRange[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return WEEK_BOUNDS.map(([from, to], i) => {
    const end = Math.min(to, daysInMonth);
    return { weekIndex: i + 1, label: `S${i + 1} (${from}-${end})`, from: isoDate(year, month, from), to: isoDate(year, month, end) };
  });
}

@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(year: number, month: number): Promise<ForecastResponse> {
    const products = await this.prisma.product.findMany({
      where: { isProduction: true, isActive: true },
      orderBy: { externalCode: 'asc' },
    });

    const [stockMap, demand] = await Promise.all([this.stockByProduct(), this.demandBuckets(year, month)]);
    const forecasts = await this.prisma.forecast.findMany({ where: { year, month }, include: { weeks: true } });
    const byCode = new Map(forecasts.map((f) => [f.productCode, f]));
    const ranges = weekRanges(year, month);

    const rows = products.map((p) => {
      const f = byCode.get(p.externalCode);
      const monthlyQty = f ? num(f.monthlyQty) : 0;
      const weeks = this.computeWeeks(monthlyQty, f?.weeks ?? []);
      const demandMonth = demand.byProduct.get(p.externalCode) ?? { qty: 0, kg: 0 };
      return {
        productCode: p.externalCode,
        description: p.description,
        uom: p.uom,
        category: p.category,
        kgPerUom: p.kgPerUom === null || p.kgPerUom === undefined ? null : num(p.kgPerUom),
        stockTotal: round3(stockMap.get(p.externalCode) ?? 0),
        demandMonthQty: round3(demandMonth.qty),
        demandMonthKg: round3(demandMonth.kg),
        monthlyQty: round3(monthlyQty),
        locked: f?.locked ?? false,
        weeks,
        weeksTotalQty: round3(weeks.reduce((acc, w) => acc + w.qty, 0)),
      };
    });

    return { year, month, weekRanges: ranges, rows, unlockProtected: true };
  }

  // Fija el forca mensual. Si ya estaba fijado, exige la clave especial.
  async setMonthly(productCode: string, dto: ForecastSetMonthly, actor?: { id?: string; email?: string }) {
    const existing = await this.prisma.forecast.findUnique({
      where: { productCode_year_month: { productCode, year: dto.year, month: dto.month } },
    });
    if (existing?.locked) {
      const key = this.config.get<string>('forecast.unlockKey');
      if (!dto.unlockKey || dto.unlockKey !== key) {
        throw new ForbiddenException('El forca de ese mes ya está fijado. Ingresa la clave especial para cambiarlo.');
      }
    }

    const saved = await this.prisma.forecast.upsert({
      where: { productCode_year_month: { productCode, year: dto.year, month: dto.month } },
      update: { monthlyQty: dto.monthlyQty, locked: true, lockedAt: new Date(), updatedBy: actor?.email ?? null },
      create: {
        productCode,
        year: dto.year,
        month: dto.month,
        monthlyQty: dto.monthlyQty,
        locked: true,
        lockedAt: new Date(),
        updatedBy: actor?.email ?? null,
      },
    });
    await this.ensureWeeks(saved.id);

    await this.audit.record({
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: 'FORECAST_SET_MONTHLY',
      entityType: 'Forecast',
      entityId: saved.id,
      context: { productCode, year: dto.year, month: dto.month, monthlyQty: dto.monthlyQty, unlocked: Boolean(existing?.locked) },
    });
    return { ok: true, productCode, year: dto.year, month: dto.month, monthlyQty: dto.monthlyQty, locked: true };
  }

  // Cambia SOLO el factor de reparto semanal (siempre permitido).
  async setWeeks(productCode: string, dto: ForecastSetWeeks) {
    const forecast = await this.ensureForecast(productCode, dto.year, dto.month);
    for (const w of dto.weeks) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId: forecast.id, weekIndex: w.weekIndex } },
        update: { pct: w.pct },
        create: { forecastId: forecast.id, weekIndex: w.weekIndex, pct: w.pct },
      });
    }
    await this.audit.record({
      action: 'FORECAST_SET_WEEKS',
      entityType: 'Forecast',
      entityId: forecast.id,
      context: { productCode, year: dto.year, month: dto.month, weeks: dto.weeks },
    });
    return { ok: true, productCode, year: dto.year, month: dto.month, weeks: dto.weeks };
  }

  // Reporte: plan de producción semanal por artículo.
  async plan(year: number, month: number): Promise<ForecastPlanResponse> {
    const list = await this.list(year, month);
    const demand = await this.demandBuckets(year, month);

    const rows = list.rows.map((r) => {
      const kgPerUnit = r.kgPerUom;
      const weeks: ForecastPlanWeek[] = list.weekRanges.map((range) => {
        const forcaQty = r.weeks.find((w) => w.weekIndex === range.weekIndex)?.qty ?? 0;
        const dem = demand.byProductWeek.get(`${r.productCode}#${range.weekIndex}`) ?? { qty: 0, kg: 0 };
        // Regla: se produce lo mayor entre el forca y la demanda, menos el stock.
        const target = Math.max(forcaQty, dem.qty);
        const productionQty = Math.max(0, target - r.stockTotal);
        const productionKg = kgPerUnit === null ? 0 : productionQty * kgPerUnit;
        return {
          weekIndex: range.weekIndex,
          forcaQty: round3(forcaQty),
          demandQty: round3(dem.qty),
          demandKg: round3(dem.kg),
          productionQty: round3(productionQty),
          productionKg: round3(productionKg),
        };
      });
      return {
        productCode: r.productCode,
        description: r.description,
        uom: r.uom,
        category: r.category,
        kgPerUom: r.kgPerUom,
        stockTotal: r.stockTotal,
        forcaMonthQty: r.monthlyQty,
        demandMonthQty: r.demandMonthQty,
        productionMonthQty: round3(weeks.reduce((acc, w) => acc + w.productionQty, 0)),
        productionMonthKg: round3(weeks.reduce((acc, w) => acc + w.productionKg, 0)),
        weeks,
      };
    });

    return {
      year,
      month,
      weekRanges: list.weekRanges,
      rows,
      totals: {
        forcaQty: round3(rows.reduce((acc, r) => acc + r.forcaMonthQty, 0)),
        demandQty: round3(rows.reduce((acc, r) => acc + r.demandMonthQty, 0)),
        productionQty: round3(rows.reduce((acc, r) => acc + r.productionMonthQty, 0)),
        productionKg: round3(rows.reduce((acc, r) => acc + r.productionMonthKg, 0)),
      },
    };
  }

  // ---------- auxiliares ----------

  private computeWeeks(monthlyQty: number, stored: { weekIndex: number; pct: unknown }[]): ForecastWeekRow[] {
    const share = monthlyQty / WEEK_BOUNDS.length;
    return FORECAST_WEEK_INDEXES.map((weekIndex) => {
      const found = stored.find((w) => w.weekIndex === weekIndex);
      const pct = found ? num(found.pct) : 100;
      return { weekIndex, pct, qty: round3(share * (pct / 100)) };
    });
  }

  private async ensureForecast(productCode: string, year: number, month: number) {
    const forecast = await this.prisma.forecast.upsert({
      where: { productCode_year_month: { productCode, year, month } },
      update: {},
      create: { productCode, year, month, monthlyQty: 0 },
    });
    await this.ensureWeeks(forecast.id);
    return forecast;
  }

  private async ensureWeeks(forecastId: string) {
    for (const weekIndex of FORECAST_WEEK_INDEXES) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId, weekIndex } },
        update: {},
        create: { forecastId, weekIndex, pct: 100 },
      });
    }
  }

  // Existencia combinada por artículo (última fotografía de inventario).
  private async stockByProduct(): Promise<Map<string, number>> {
    const snapshot = await this.prisma.inventorySnapshot.findFirst({ orderBy: { takenAt: 'desc' }, include: { lines: true } });
    const map = new Map<string, number>();
    for (const l of snapshot?.lines ?? []) {
      map.set(l.productCode, (map.get(l.productCode) ?? 0) + num(l.qty));
    }
    return map;
  }

  // Demanda de pedidos ACTIVOS del mes: total por artículo y por semana.
  private async demandBuckets(year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const lines = await this.prisma.salesOrderLine.findMany({
      where: { order: { isActive: true, requestedDate: { gte: from, lt: to } } },
      include: { order: { select: { requestedDate: true } } },
    });
    const byProduct = new Map<string, { qty: number; kg: number }>();
    const byProductWeek = new Map<string, { qty: number; kg: number }>();
    for (const l of lines) {
      const qty = num(l.pendingQty);
      const kg = l.pendingKg === null || l.pendingKg === undefined ? 0 : num(l.pendingKg);
      const total = byProduct.get(l.productCode) ?? { qty: 0, kg: 0 };
      total.qty += qty;
      total.kg += kg;
      byProduct.set(l.productCode, total);

      const date = l.order.requestedDate;
      const day = date ? date.getUTCDate() : 1;
      const key = `${l.productCode}#${weekIndexOf(day)}`;
      const bucket = byProductWeek.get(key) ?? { qty: 0, kg: 0 };
      bucket.qty += qty;
      bucket.kg += kg;
      byProductWeek.set(key, bucket);
    }
    return { byProduct, byProductWeek };
  }
}

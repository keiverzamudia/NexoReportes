import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  FORECAST_WEEK_INDEXES,
  ForecastPlanResponse,
  ForecastPlanRow,
  ForecastPlanWeek,
  ForecastResponse,
  ForecastRow,
  ForecastSetWeeks,
  ForecastWeekRange,
  ForecastWeekRow,
  InventoryByWarehouse,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { computeAvailability } from '../availability/availability.engine';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Forca (pronóstico de producción).
//
//  · El FORCA MENSUAL por artículo se lee de Profit (`dbo.xart_fore`) TAL
//    CUAL, sin conversión: producción mantiene ahí el valor en la unidad de
//    venta del artículo (saco/unidad). Es solo lectura; Nexo nunca lo escribe.
//  · `xart_fore` no tiene código ni mes: se cruza por descripción y aplica al
//    mes en curso.
//  · Cada semana (4 bloques) tiene una CANTIDAD editable. Por defecto se
//    llena con el PROMEDIO = forca mensual / 4; aquí solo se ajustan semanas.
//  · El Reporte reutiliza el MISMO motor de disponibilidad que la vista
//    «Disponibilidad por Producto», con la demanda OBJETIVO de la semana
//    (max(forca de la semana, demanda de la semana)).
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

// Almacenes reales de la compañía (mismos códigos que la vista de Disponibilidad).
const WAREHOUSE_03 = 'Stock 03';
const WAREHOUSE_68 = 'Stock 68';

// Forca mensual mantenido por producción en Profit (`COR_A3.dbo.xart_fore`).
// `kg_mes` se usa TAL CUAL (sin convertir): producción lo deja en la unidad de
// venta del artículo. `kg_sem` no se usa: las semanas se reparten en Nexo como
// mensual / 4 y se ajustan aquí. La tabla no tiene código ni mes, por eso se
// cruza por descripción (RTRIM) y se aplica solo al mes en curso.
const PROFIT_FORCA_SQL = `
SELECT RTRIM(a.co_art) AS co_art, f.kg_mes AS forca_mes
FROM dbo.xart_fore AS f
INNER JOIN dbo.art AS a
        ON RTRIM(LTRIM(a.art_des)) = RTRIM(LTRIM(f.nom))
       AND a.anulado = 0
`;

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

function warehouseQty(list: InventoryByWarehouse[], code: string): number {
  return round3(list.find((w) => w.warehouseCode === code)?.qty ?? 0);
}

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  async list(year: number, month: number): Promise<ForecastResponse> {
    const products = await this.prisma.product.findMany({
      where: { isProduction: true, isActive: true },
      orderBy: { externalCode: 'asc' },
    });

    const [stock, demand, forca] = await Promise.all([
      this.stockIndex(),
      this.demandBuckets(year, month),
      this.profitForcaIndex(year, month),
    ]);
    const forecasts = await this.prisma.forecast.findMany({ where: { year, month }, include: { weeks: true } });
    const byCode = new Map(forecasts.map((f) => [f.productCode, f]));
    const ranges = weekRanges(year, month);

    const rows: ForecastRow[] = products.map((p) => {
      const f = byCode.get(p.externalCode);
      // El mensual SIEMPRE manda desde Profit. El valor local sólo se usa para
      // saber si las semanas guardadas se editaron sobre este mismo mensual.
      const monthlyQty = forca.byCode.get(p.externalCode) ?? 0;
      const storedMonthly = f ? num(f.monthlyQty) : null;
      const useStoredWeeks = f !== undefined && storedMonthly === monthlyQty;
      const weeks = this.computeWeeks(monthlyQty, f?.weeks ?? [], useStoredWeeks);
      const demandMonth = demand.byProduct.get(p.externalCode) ?? { qty: 0, kg: 0 };
      return {
        productCode: p.externalCode,
        description: p.description,
        uom: p.uom,
        category: p.category,
        kgPerUom: p.kgPerUom === null || p.kgPerUom === undefined ? null : num(p.kgPerUom),
        stockTotal: round3(stock.get(p.externalCode)?.total ?? 0),
        demandMonthQty: round3(demandMonth.qty),
        demandMonthKg: round3(demandMonth.kg),
        monthlyQty: round3(monthlyQty),
        averageQty: round3(monthlyQty / WEEK_BOUNDS.length),
        weeks,
        weeksTotalQty: round3(weeks.reduce((acc, w) => acc + w.qty, 0)),
      };
    });

    return { year, month, weekRanges: ranges, rows, profitForcaAvailable: forca.available };
  }

  // Cambia SOLO las cantidades por semana. El forca mensual no se edita aquí:
  // se toma de Profit y se guarda como "snapshot" para detectar si cambió.
  async setWeeks(productCode: string, dto: ForecastSetWeeks) {
    const forca = await this.profitForcaIndex(dto.year, dto.month);
    if (!forca.available) {
      throw new ServiceUnavailableException('No se pudo leer el forca de Profit (xart_fore). Intenta de nuevo.');
    }
    const monthlyQty = forca.byCode.get(productCode) ?? 0;
    const forecast = await this.prisma.forecast.upsert({
      where: { productCode_year_month: { productCode, year: dto.year, month: dto.month } },
      update: { monthlyQty, locked: false, lockedAt: null },
      create: { productCode, year: dto.year, month: dto.month, monthlyQty, locked: false },
    });
    for (const w of dto.weeks) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId: forecast.id, weekIndex: w.weekIndex } },
        update: { qty: w.qty },
        create: { forecastId: forecast.id, weekIndex: w.weekIndex, qty: w.qty },
      });
    }
    // Crea las semanas que falten con el promedio (no pisa las recién guardadas).
    await this.ensureWeeks(forecast.id, monthlyQty, false);
    await this.audit.record({
      action: 'FORECAST_SET_WEEKS',
      entityType: 'Forecast',
      entityId: forecast.id,
      context: { productCode, year: dto.year, month: dto.month, monthlyQty, weeks: dto.weeks },
    });
    const weeks = await this.weeksOf(forecast.id, monthlyQty);
    return { ok: true, productCode, year: dto.year, month: dto.month, weeks };
  }

  // Reporte: plan de producción semanal por artículo, con los campos de la
  // tabla de Disponibilidad por Producto calculados sobre la demanda objetivo
  // de cada semana (max(forca, demanda)).
  async plan(year: number, month: number): Promise<ForecastPlanResponse> {
    const [list, stock, demand] = await Promise.all([this.list(year, month), this.stockIndex(), this.demandBuckets(year, month)]);

    const rows: ForecastPlanRow[] = list.rows.map((r) => {
      const stockInfo = stock.get(r.productCode) ?? { total: 0, byWarehouse: [] };
      const weeks: ForecastPlanWeek[] = list.weekRanges.map((range) => {
        const forcaQty = r.weeks.find((w) => w.weekIndex === range.weekIndex)?.qty ?? 0;
        const dem = demand.byProductWeek.get(`${r.productCode}#${range.weekIndex}`) ?? { qty: 0, kg: 0 };
        const objectiveQty = round3(Math.max(forcaQty, dem.qty));
        // Mismo motor que la vista «Disponibilidad por Producto».
        const availability = computeAvailability({
          productCode: r.productCode,
          description: r.description,
          uom: r.uom,
          kgPerUom: r.kgPerUom,
          stockByWarehouse: stockInfo.byWarehouse,
          demandQty: objectiveQty,
          demandKg: dem.kg,
        });
        return {
          weekIndex: range.weekIndex,
          forcaQty: round3(forcaQty),
          demandQty: round3(dem.qty),
          demandKg: round3(dem.kg),
          objectiveQty,
          availableQty: availability.availableQty,
          toProduceQty: availability.toProduceQty,
          toProduceKg: availability.toProduceKg,
          netQty: availability.netQty,
          status: availability.status,
        };
      });
      return {
        productCode: r.productCode,
        description: r.description,
        uom: r.uom,
        category: r.category,
        kgPerUom: r.kgPerUom,
        stockTotal: stockInfo.total,
        stock03: warehouseQty(stockInfo.byWarehouse, WAREHOUSE_03),
        stock68: warehouseQty(stockInfo.byWarehouse, WAREHOUSE_68),
        forcaMonthQty: r.monthlyQty,
        averageQty: r.averageQty,
        demandMonthQty: r.demandMonthQty,
        productionMonthQty: round3(weeks.reduce((acc, w) => acc + w.toProduceQty, 0)),
        productionMonthKg: round3(weeks.reduce((acc, w) => acc + (w.toProduceKg ?? 0), 0)),
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

  // Cantidades por semana. `useStored=false` (el forca de Profit cambió o no
  // hay fila local) devuelve el PROMEDIO del mes; si es true respeta lo editado.
  private computeWeeks(monthlyQty: number, stored: { weekIndex: number; qty: unknown }[], useStored: boolean): ForecastWeekRow[] {
    const average = monthlyQty / WEEK_BOUNDS.length;
    return FORECAST_WEEK_INDEXES.map((weekIndex) => {
      const found = stored.find((w) => w.weekIndex === weekIndex);
      return { weekIndex, qty: round3(useStored && found ? num(found.qty) : average) };
    });
  }

  private async weeksOf(forecastId: string, monthlyQty: number): Promise<ForecastWeekRow[]> {
    const stored = await this.prisma.forecastWeek.findMany({ where: { forecastId } });
    return this.computeWeeks(monthlyQty, stored, true);
  }

  // `xart_fore` es una foto del mes en curso (no tiene columna de mes). Para
  // cualquier otro mes se devuelve 0 sin consultar Profit.
  private isCurrentMonth(year: number, month: number): boolean {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month;
  }

  // Forca mensual por artículo desde Profit (`xart_fore.kg_mes`), SIN conversión.
  // Si la consulta falla, se devuelve el mapa vacío y `available=false` para que
  // la UI avise en lugar de mostrar valores inventados.
  private async profitForcaIndex(year: number, month: number): Promise<{ byCode: Map<string, number>; available: boolean }> {
    if (!this.isCurrentMonth(year, month)) {
      return { byCode: new Map(), available: true };
    }
    try {
      const rows = await this.profit.selectQuery(PROFIT_FORCA_SQL, 5000);
      const byCode = new Map<string, number>();
      for (const raw of rows) {
        const code = String(raw.co_art ?? '').trim();
        if (!code) continue;
        if (byCode.has(code)) {
          this.logger.warn(`xart_fore trae más de una fila para ${code}; se usa la última.`);
        }
        byCode.set(code, num(raw.forca_mes));
      }
      return { byCode, available: true };
    } catch (error) {
      this.logger.warn(`No se pudo leer el forca de Profit (xart_fore): ${error instanceof Error ? error.message : 'error desconocido'}`);
      return { byCode: new Map(), available: false };
    }
  }

  // Crea las 4 semanas. `reset=true` reescribe el promedio; `false` sólo crea
  // las que falten (sin pisar ajustes manuales del usuario).
  private async ensureWeeks(forecastId: string, monthlyQty: number, reset: boolean) {
    const average = round3(monthlyQty / WEEK_BOUNDS.length);
    for (const weekIndex of FORECAST_WEEK_INDEXES) {
      await this.prisma.forecastWeek.upsert({
        where: { forecastId_weekIndex: { forecastId, weekIndex } },
        update: reset ? { qty: average } : {},
        create: { forecastId, weekIndex, qty: average },
      });
    }
  }

  // Existencia por artículo (última fotografía de inventario): total y desglose.
  private async stockIndex(): Promise<Map<string, { total: number; byWarehouse: InventoryByWarehouse[] }>> {
    const snapshot = await this.prisma.inventorySnapshot.findFirst({
      orderBy: { takenAt: 'desc' },
      include: { lines: { include: { warehouse: true } } },
    });
    const map = new Map<string, { total: number; byWarehouse: InventoryByWarehouse[] }>();
    for (const l of snapshot?.lines ?? []) {
      const entry: InventoryByWarehouse = {
        warehouseCode: l.warehouseCode,
        warehouseName: l.warehouse?.name ?? null,
        qty: num(l.qty),
        reservedQty: num(l.reservedQty),
      };
      const bucket = map.get(l.productCode) ?? { total: 0, byWarehouse: [] };
      bucket.total += entry.qty;
      bucket.byWarehouse.push(entry);
      map.set(l.productCode, bucket);
    }
    for (const bucket of map.values()) bucket.total = round3(bucket.total);
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

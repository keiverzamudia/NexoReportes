import { Inject, Injectable, Logger } from '@nestjs/common';
import { CustomerSalesPeriod } from '@nexo/contracts';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Ventas por cliente (solo lectura, en vivo desde Profit).
//
// La venta se mide por NOTA DE ENTREGA, igual que el módulo Forecast:
// `dbo.not_ent` + `dbo.reng_nde`. En este Profit ambas tablas usan
// `fact_num` como llave del documento.
//
// La unidad manda: los renglones con `uni_venta = 'SAC'` se reportan en
// sacos; el resto (KG y otras unidades) se reporta en kg. `kg_total` es el
// equivalente total del periodo y solo sirve para ordenar/agregar.
//
// El resultado se cachea 5 minutos por periodo: la pantalla de Clientes
// consulta Profit en cada página/búsqueda y no conviene golpear la base.
// ============================================================

export const CUSTOMER_SALES_SQL = `
SELECT /* nexo:customer_sales */
  RTRIM(f.co_cli) AS co_cli,
  SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) = 'SAC' THEN r.total_art ELSE 0 END) AS sacos,
  SUM(CASE WHEN RTRIM(ISNULL(a.uni_venta, '')) <> 'SAC' THEN r.total_art * ISNULL(a.uni_relac, 1) ELSE 0 END) AS kg,
  SUM(r.total_art * ISNULL(a.uni_relac, 1)) AS kg_total,
  COUNT(DISTINCT f.fact_num) AS notas,
  MAX(f.fec_emis) AS ultima
FROM dbo.not_ent AS f
INNER JOIN dbo.reng_nde AS r ON r.fact_num = f.fact_num
INNER JOIN dbo.art AS a ON a.co_art = r.co_art
WHERE f.anulada = 0
  AND a.anulado = 0
  AND a.co_lin = 'ABA'
  AND f.fec_emis >= @desde
  AND f.fec_emis < @hasta
GROUP BY RTRIM(f.co_cli)
`;

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CustomerSalesAgg {
  sacks: number;
  kg: number;
  totalKg: number;
  notes: number;
  lastSaleDate: string | null;
}

export interface CustomerSalesResult {
  available: boolean;
  byCode: Map<string, CustomerSalesAgg>;
}

// Ventana [desde, hasta) de cada periodo. «mes» es el mes calendario en
// curso; «3m»/«6m»/«12m» incluyen el mes actual y los N-1 anteriores.
// El límite superior es mañana (exclusivo) para incluir las ventas de hoy.
export function salesPeriodRange(
  period: CustomerSalesPeriod,
  now: Date = new Date(),
): { from: Date; to: Date } | null {
  if (period === 'todos') return null;
  const months = period === 'mes' ? 0 : period === '3m' ? 2 : period === '6m' ? 5 : 11;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from, to };
}

function number(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

@Injectable()
export class CustomerSalesService {
  private readonly logger = new Logger(CustomerSalesService.name);
  private readonly cache = new Map<CustomerSalesPeriod, { at: number; result: CustomerSalesResult }>();

  constructor(@Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter) {}

  // Agregado del periodo. «todos» usa 12 meses (es el universo de actividad).
  async aggregate(period: CustomerSalesPeriod): Promise<CustomerSalesResult> {
    const effective: CustomerSalesPeriod = period === 'todos' ? '12m' : period;
    const cached = this.cache.get(effective);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

    const range = salesPeriodRange(effective);
    if (!range) return { available: true, byCode: new Map() };

    try {
      const rows = await this.profit.selectQuery(CUSTOMER_SALES_SQL, 20000, {
        desde: range.from,
        hasta: range.to,
      });
      const byCode = new Map<string, CustomerSalesAgg>();
      for (const raw of rows) {
        const code = String(raw.co_cli ?? '').trim();
        if (!code) continue;
        byCode.set(code, {
          sacks: round2(number(raw.sacos)),
          kg: round2(number(raw.kg)),
          totalKg: round2(number(raw.kg_total)),
          notes: Math.trunc(number(raw.notas)),
          lastSaleDate: day(raw.ultima),
        });
      }
      const result: CustomerSalesResult = { available: true, byCode };
      this.cache.set(effective, { at: Date.now(), result });
      return result;
    } catch (error) {
      // No se cachea el fallo: el siguiente request reintenta Profit.
      this.logger.error(
        `No se pudieron leer las ventas por cliente (not_ent/reng_nde): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { available: false, byCode: new Map() };
    }
  }

  // Solo para pruebas/operación: fuerza la próxima lectura desde Profit.
  invalidate(): void {
    this.cache.clear();
  }
}

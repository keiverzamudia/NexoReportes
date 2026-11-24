import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

// ============================================================
// Lectura de Profit para Producción (SOLO SELECT).
//
// Fuentes confirmadas en COR_A3:
//   spced      cabecera de cédula (maestras: dias=0 y horas>=2).
//   reng_mce   componentes de la cédula.
//   reng_ace   artículos (presentaciones) que usan una cédula base.
//   art        descripción, unidad, kg/saco, costos.
//   st_almac   existencias por almacén (MP 262/68/06 y PT 03/9999/6804/PTP).
//   ordenes + reng_ord  órdenes de compra pendientes (stock x llegar).
//   tasas      tipo de cambio US$.
//
// Nada de este archivo escribe en Profit. Si Profit no responde se devuelve
// `available=false` para que la UI avise y no pinte ceros inventados.
// ============================================================

export interface ProfitFormulaRow {
  formulaId: number;
  productCode: string;
  productDescription: string;
  formulaName: string;
  outputQty: number;
  outputUom: string;
  batchKg: number | null;
  hoursPerBatch: number | null;
  isStandard: boolean;
  updatedAt: string | null;
  productUom: string;
  productKgPerUom: number | null;
  productFamily: string | null;
  lineNumber: number;
  componentCode: string;
  componentDescription: string;
  componentType: string;
  componentUom: string;
  componentQty: number;
  componentKgPerUom: number | null;
  lastCost: number | null;
  avgCost: number | null;
  // Costos en dólares de Profit (`ult_cos_om` / `cos_pro_om`, columnas
  // «Último OM» / «Prom. OM»). Son la base canónica del módulo; el Bs se
  // obtiene multiplicando por la tasa del día.
  lastCostUsd: number | null;
  avgCostUsd: number | null;
  // Costo de reposición (`art.cos_merc`, fila «Reposición»). Solo existe en Bs.
  replacementCost: number | null;
  componentInactive: boolean;
}

export interface ProfitAceRow {
  productCode: string;
  productDescription: string;
  productUom: string;
  productKgPerUom: number | null;
  productFamily: string | null;
  formulaId: number;
  baseProductCode: string;
  baseProductDescription: string;
  baseUom: string;
  baseOutputQty: number;
  batchKg: number | null;
  hoursPerBatch: number | null;
  isStandard: boolean;
  updatedAt: string | null;
  variantQty: number;
  subFormulaId: number;
}

export interface ProfitPackagingRow {
  productCode: string;
  packagingCode: string;
  packagingDescription: string;
  lastCost: number | null;
  avgCost: number | null;
  lastCostUsd: number | null;
  avgCostUsd: number | null;
  replacementCost: number | null;
  uses: number;
}

export interface ProfitStockRow {
  articleCode: string;
  warehouseCode: string;
  qty: number;
}

export interface ProfitIncomingRow {
  supplierCode: string;
  articleCode: string;
  warehouseCode: string;
  uom: string;
  pendingQty: number;
  expectedDate: string | null;
}

export interface ProfitProductionData {
  available: boolean;
  alerts: string[];
  formulas: ProfitFormulaRow[];
  ace: ProfitAceRow[];
  packaging: ProfitPackagingRow[];
  stock: ProfitStockRow[];
  incoming: ProfitIncomingRow[];
  exchangeRate: number | null;
}

const FORMULA_SELECT = `
SELECT
  c.co_ced AS formula_id,
  RTRIM(c.co_art) AS product_code,
  RTRIM(p.art_des) AS product_description,
  RTRIM(c.ced_des) AS formula_name,
  c.cantidad AS output_qty,
  RTRIM(c.co_uni) AS output_uom,
  RTRIM(c.campo1) AS batch_kg_raw,
  c.horas AS hours_per_batch,
  c.estandar AS is_standard,
  c.dias AS is_batch_record,
  c.fe_us_mo AS updated_at,
  RTRIM(p.uni_venta) AS product_uom,
  p.uni_relac AS product_kg_per_uom,
  RTRIM(p.co_subl) AS product_family,
  m.reng_num AS line_number,
  RTRIM(m.co_art) AS component_code,
  RTRIM(a.art_des) AS component_description,
  RTRIM(a.co_subl) AS component_type,
  RTRIM(m.co_uni) AS component_uom,
  m.cantidad AS component_qty,
  a.uni_relac AS component_kg_per_uom,
  a.ult_cos_un AS last_cost,
  a.cos_pro_un AS avg_cost,
  a.ult_cos_om AS last_cost_usd,
  a.cos_pro_om AS avg_cost_usd,
  a.cos_merc AS replacement_cost,
  a.anulado AS component_inactive
FROM dbo.spced c
JOIN dbo.reng_mce m ON m.co_ced = c.co_ced
LEFT JOIN dbo.art p ON p.co_art = c.co_art
LEFT JOIN dbo.art a ON a.co_art = m.co_art
`;

const FORMULA_MASTERS_SQL = `${FORMULA_SELECT}
WHERE c.dias = 0 AND c.horas >= 2`;

const FORMULA_BATCHES_SQL = `${FORMULA_SELECT}
WHERE (c.dias = 1 OR c.horas < 2)
  AND c.co_ced IN (
    SELECT TOP (12) c2.co_ced
    FROM dbo.spced c2
    WHERE (c2.dias = 1 OR c2.horas < 2)
      AND RTRIM(c2.co_art) = @product
    ORDER BY c2.fe_us_mo DESC, c2.co_ced DESC
  )`;

const ACE_SQL = `
SELECT
  RTRIM(r.co_art) AS product_code,
  RTRIM(p.art_des) AS product_description,
  RTRIM(p.uni_venta) AS product_uom,
  p.uni_relac AS product_kg_per_uom,
  RTRIM(p.co_subl) AS product_family,
  r.co_ced AS formula_id,
  RTRIM(c.co_art) AS base_product_code,
  RTRIM(b.art_des) AS base_product_description,
  RTRIM(c.co_uni) AS base_uom,
  c.cantidad AS base_output_qty,
  RTRIM(c.campo1) AS batch_kg_raw,
  c.horas AS hours_per_batch,
  c.estandar AS is_standard,
  c.fe_us_mo AS updated_at,
  r.cant AS variant_qty,
  r.subced AS sub_formula_id
FROM dbo.reng_ace r
JOIN dbo.spced c ON c.co_ced = r.co_ced
LEFT JOIN dbo.art p ON p.co_art = r.co_art
LEFT JOIN dbo.art b ON b.co_art = c.co_art
WHERE c.dias = 0 AND c.horas >= 2`;

const PACKAGING_SQL = `
SELECT
  RTRIM(c.co_art) AS product_code,
  RTRIM(m.co_art) AS packaging_code,
  RTRIM(a.art_des) AS packaging_description,
  a.ult_cos_un AS last_cost,
  a.cos_pro_un AS avg_cost,
  a.ult_cos_om AS last_cost_usd,
  a.cos_pro_om AS avg_cost_usd,
  a.cos_merc AS replacement_cost,
  COUNT(*) AS uses
FROM dbo.spced c
JOIN dbo.reng_mce m ON m.co_ced = c.co_ced
JOIN dbo.art a ON a.co_art = m.co_art
WHERE (c.dias = 1 OR c.horas < 2)
  AND RTRIM(a.co_subl) = 'EMPAQ'
GROUP BY RTRIM(c.co_art), RTRIM(m.co_art), RTRIM(a.art_des), a.ult_cos_un, a.cos_pro_un, a.ult_cos_om, a.cos_pro_om, a.cos_merc`;

const STOCK_SQL = `
SELECT
  RTRIM(sa.co_art) AS article_code,
  RTRIM(sa.co_alma) AS warehouse_code,
  SUM(sa.stock_act) AS qty
FROM dbo.st_almac sa
WHERE RTRIM(sa.co_alma) IN ('262', '68', '06', '03', '9999', '6804', 'PTP')
GROUP BY RTRIM(sa.co_art), RTRIM(sa.co_alma)`;

const INCOMING_SQL = `
SELECT
  RTRIM(o.co_cli) AS supplier_code,
  RTRIM(r.co_art) AS article_code,
  RTRIM(r.co_alma) AS warehouse_code,
  RTRIM(r.uni_venta) AS uom,
  SUM(r.pendiente) AS pending_qty,
  MIN(o.fec_venc) AS expected_date
FROM dbo.ordenes o
JOIN dbo.reng_ord r ON r.fact_num = o.fact_num
WHERE o.anulada = 0
  AND r.anulado = 0
  AND r.pendiente > 0
  AND RTRIM(r.co_alma) IN ('262', '68', '06')
GROUP BY RTRIM(o.co_cli), RTRIM(r.co_art), RTRIM(r.co_alma), RTRIM(r.uni_venta)`;

const EXCHANGE_SQL = `
SELECT TOP (1)
  RTRIM(co_mone) AS currency,
  fecha,
  tasa_v AS tasa
FROM dbo.tasas
WHERE RTRIM(co_mone) = 'US$'
ORDER BY fecha DESC`;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formulaFromRow(row: Record<string, unknown>): ProfitFormulaRow {
  // El batch se guarda en spced.campo1 como texto ("3000", "2000").
  const batchRaw = text(row.batch_kg_raw);
  const batchKg = batchRaw ? numberOrNull(batchRaw.replace(',', '.')) : null;
  return {
    formulaId: numberOrZero(row.formula_id),
    productCode: text(row.product_code),
    productDescription: text(row.product_description),
    formulaName: text(row.formula_name),
    outputQty: numberOrZero(row.output_qty) || 1,
    outputUom: text(row.output_uom),
    batchKg: batchKg !== null && batchKg > 0 ? batchKg : null,
    hoursPerBatch: numberOrNull(row.hours_per_batch),
    isStandard: bool(row.is_standard),
    updatedAt: iso(row.updated_at),
    productUom: text(row.product_uom),
    productKgPerUom: numberOrNull(row.product_kg_per_uom),
    productFamily: text(row.product_family) || null,
    lineNumber: numberOrZero(row.line_number),
    componentCode: text(row.component_code),
    componentDescription: text(row.component_description),
    componentType: text(row.component_type) || 'MAT',
    componentUom: text(row.component_uom),
    componentQty: numberOrZero(row.component_qty),
    componentKgPerUom: numberOrNull(row.component_kg_per_uom),
    lastCost: numberOrNull(row.last_cost),
    avgCost: numberOrNull(row.avg_cost),
    lastCostUsd: numberOrNull(row.last_cost_usd),
    avgCostUsd: numberOrNull(row.avg_cost_usd),
    replacementCost: numberOrNull(row.replacement_cost),
    componentInactive: bool(row.component_inactive),
  };
}

function aceFromRow(row: Record<string, unknown>): ProfitAceRow {
  const batchRaw = text(row.batch_kg_raw);
  const batchKg = batchRaw ? numberOrNull(batchRaw.replace(',', '.')) : null;
  return {
    productCode: text(row.product_code),
    productDescription: text(row.product_description),
    productUom: text(row.product_uom),
    productKgPerUom: numberOrNull(row.product_kg_per_uom),
    productFamily: text(row.product_family) || null,
    formulaId: numberOrZero(row.formula_id),
    baseProductCode: text(row.base_product_code),
    baseProductDescription: text(row.base_product_description),
    baseUom: text(row.base_uom),
    baseOutputQty: numberOrZero(row.base_output_qty) || 1,
    batchKg: batchKg !== null && batchKg > 0 ? batchKg : null,
    hoursPerBatch: numberOrNull(row.hours_per_batch),
    isStandard: bool(row.is_standard),
    updatedAt: iso(row.updated_at),
    variantQty: numberOrZero(row.variant_qty) || 1,
    subFormulaId: numberOrZero(row.sub_formula_id),
  };
}

function packagingFromRow(row: Record<string, unknown>): ProfitPackagingRow {
  return {
    productCode: text(row.product_code),
    packagingCode: text(row.packaging_code),
    packagingDescription: text(row.packaging_description),
    lastCost: numberOrNull(row.last_cost),
    avgCost: numberOrNull(row.avg_cost),
    lastCostUsd: numberOrNull(row.last_cost_usd),
    avgCostUsd: numberOrNull(row.avg_cost_usd),
    replacementCost: numberOrNull(row.replacement_cost),
    uses: numberOrZero(row.uses),
  };
}

@Injectable()
export class ProductionProfit {
  private readonly logger = new Logger(ProductionProfit.name);
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
  private readonly ttlMs = 5 * 60_000;

  constructor(@Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter) {}

  /** Limpia la caché para el botón «Actualizar» de la UI. */
  refresh(): void {
    this.cache.clear();
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    const value = loader().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expiresAt: now + this.ttlMs, value });
    return value;
  }

  async load(): Promise<ProfitProductionData> {
    if (this.profit.dialect === 'fixtures') {
      return {
        available: false,
        alerts: ['Profit está en modo fixtures: las cédulas reales no están disponibles.'],
        formulas: [],
        ace: [],
        packaging: [],
        stock: [],
        incoming: [],
        exchangeRate: null,
      };
    }

    return this.cached('production:all', async () => {
      const alerts: string[] = [];

      // Las cédulas son la fuente crítica: si fallan, el módulo no puede
      // explosionar. El resto (stock, OC, empaque, tasa) degrada con aviso.
      let formulasRaw: Record<string, unknown>[] = [];
      try {
        formulasRaw = await this.profit.selectQuery(FORMULA_MASTERS_SQL, 50000);
      } catch (error) {
        this.logger.error(`No se pudieron leer las cédulas de Profit: ${(error as Error).message}`);
        return {
          available: false,
          alerts: ['No se pudieron leer las cédulas de Profit. Revisa la conexión y vuelve a intentar.'],
          formulas: [],
          ace: [],
          packaging: [],
          stock: [],
          incoming: [],
          exchangeRate: null,
        };
      }

      const safe = async <T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await loader();
        } catch (error) {
          this.logger.warn(`No se pudo leer ${label} de Profit: ${(error as Error).message}`);
          alerts.push(`No se pudo leer ${label} de Profit; se muestra el resto del plan.`);
          return fallback;
        }
      };

      // El adaptador serializa las lecturas; se piden en secuencia para no
      // competir por el pool de SQL Server.
      const aceRaw = await safe('las presentaciones', () => this.profit.selectQuery(ACE_SQL, 20000), []);
      const packagingRaw = await safe('el histórico de empaque', () => this.profit.selectQuery(PACKAGING_SQL, 20000), []);
      const stockRaw = await safe('el stock de materias primas', () => this.profit.selectQuery(STOCK_SQL, 50000), []);
      const incomingRaw = await safe('las órdenes de compra', () => this.profit.selectQuery(INCOMING_SQL, 20000), []);
      const exchangeRaw = await safe('el tipo de cambio', () => this.profit.selectQuery(EXCHANGE_SQL, 1), []);

      const formulas = formulasRaw.map(formulaFromRow).filter((row) => row.formulaId > 0 && row.componentCode);
      const ace = aceRaw.map(aceFromRow).filter((row) => row.formulaId > 0 && row.productCode);
      const packaging = packagingRaw.map(packagingFromRow).filter((row) => row.productCode && row.packagingCode);
      const stock = stockRaw.map((row) => ({
        articleCode: text(row.article_code),
        warehouseCode: text(row.warehouse_code),
        qty: numberOrZero(row.qty),
      }));
      const incoming = incomingRaw.map((row) => ({
        supplierCode: text(row.supplier_code),
        articleCode: text(row.article_code),
        warehouseCode: text(row.warehouse_code),
        uom: text(row.uom),
        pendingQty: numberOrZero(row.pending_qty),
        expectedDate: iso(row.expected_date),
      }));
      const exchangeRate = numberOrNull(exchangeRaw[0]?.tasa);

      return {
        available: true,
        alerts,
        formulas,
        ace,
        packaging,
        stock,
        incoming,
        exchangeRate,
      };
    });
  }

  async loadBatches(productCode: string): Promise<ProfitFormulaRow[]> {
    if (this.profit.dialect === 'fixtures') return [];
    try {
      return await this.cached(`production:batches:${productCode}`, async () => {
        const rows = await this.profit.selectQuery(FORMULA_BATCHES_SQL, 20000, { product: productCode });
        return rows.map(formulaFromRow).filter((row) => row.formulaId > 0 && row.componentCode);
      });
    } catch (error) {
      this.logger.warn(`No se pudieron leer los lotes de ${productCode}: ${(error as Error).message}`);
      return [];
    }
  }
}

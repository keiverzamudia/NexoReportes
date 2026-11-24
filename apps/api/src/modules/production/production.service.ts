import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  ForecastPlanResponse,
  ProductionCostBasis,
  ProductionExplosionProduct,
  ProductionExplosionResponse,
  ProductionFormula,
  ProductionFormulaDetailResponse,
  ProductionFormulaListResponse,
  ProductionFormulaSummary,
  ProductionFormulaSummaryLine,
  ProductionMaterialRow,
  ProductionMissingReplacement,
  ProductionNutritionCatalogResponse,
  ProductionNutritionUpdate,
  ProductionOrdersQuery,
  ProductionOrdersResponse,
  ProductionPackagingUpdate,
  ProductionPlanResponse,
  ProductionPlanRow,
  ProductionPolicy,
  ProductionQuery,
  ProductionScenario,
  ProductionScenarioCreate,
  ProductionSimulation,
  ProductionSimulationOverride,
  ProductionSimulationResponse,
  ProductionSpecUpdate,
} from '@nexo/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { ForecastService } from '../forecast/forecast.service';
import {
  buildBatchFormulas,
  buildFormulaCatalog,
  FormulaCatalog,
  resolveBatchKg,
  resolveMainFormula,
  sortFormulas,
} from './production.formulas';
import {
  computeFormulaNutrition,
  IngredientNutrientValue,
  NutrientDefinition,
  NutrientSpecification,
} from './nutrition.engine';
import { ProductionOrdersService } from './production.orders.service';
import { ProfitProductionData, ProductionProfit } from './production.profit';
import {
  componentCost,
  componentReplacementCost,
  computeDemand,
  displayCost,
  explode,
  Formula,
  formulaCostPerKg,
  formulaCostPerSack,
  formulaMissingReplacement,
  formulaReplacementCostPerKg,
  formulaReplacementCostPerSack,
  isBulkPresentation,
  resolveBatches,
  round,
  sackCostFromKg,
} from './production.types';

export interface ProductionActor {
  id?: string | null;
  code?: string | null;
}

interface PackagingInfo {
  code: string;
  description: string;
  lastCost: number | null;
  avgCost: number | null;
  lastCostUsd: number | null;
  avgCostUsd: number | null;
  replacementCost: number | null;
  qtyPerUnit: number;
}

interface IncomingInfo {
  qty: number;
  expectedDate: string | null;
  supplier: string | null;
}

interface InternalPlanRow extends ProductionPlanRow {
  formula: Formula | null;
}

interface PlanContext {
  response: ProductionPlanResponse;
  rows: InternalPlanRow[];
  catalog: FormulaCatalog;
  profit: ProfitProductionData;
  packagingByProduct: Map<string, PackagingInfo>;
  stockByArticle: Map<string, number>;
  incomingByArticle: Map<string, IncomingInfo>;
  exchangeRate: number | null;
}

const MP_WAREHOUSES = new Set(['262', '68', '06']);
const PT_WAREHOUSES = new Set(['Stock 03', 'Stock 9999', 'Stock 68', 'Stock PTP']);

const DEFAULT_NUTRIENTS: NutrientDefinition[] = [
  { code: 'PROTEIN', name: 'Proteína bruta', unit: '%', category: 'MACRO', sortOrder: 10 },
  { code: 'FAT', name: 'Grasa bruta', unit: '%', category: 'MACRO', sortOrder: 20 },
  { code: 'FIBER', name: 'Fibra bruta', unit: '%', category: 'MACRO', sortOrder: 30 },
  { code: 'ENERGY', name: 'Energía metabolizable', unit: 'kcal/kg', category: 'ENERGIA', sortOrder: 40 },
  { code: 'CALCIUM', name: 'Calcio', unit: '%', category: 'MINERAL', sortOrder: 50 },
  { code: 'PHOSPHORUS', name: 'Fósforo', unit: '%', category: 'MINERAL', sortOrder: 60 },
  { code: 'LYSINE', name: 'Lisina', unit: '%', category: 'AMINOACIDO', sortOrder: 70 },
  { code: 'METHIONINE', name: 'Metionina', unit: '%', category: 'AMINOACIDO', sortOrder: 80 },
  { code: 'MOISTURE', name: 'Humedad', unit: '%', category: 'CALIDAD', sortOrder: 90 },
];

function num(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(value: Prisma.Decimal | number | null | undefined): number {
  return num(value) ?? 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthEndIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}T00:00:00.000Z`;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

@Injectable()
export class ProductionService implements OnModuleInit {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profit: ProductionProfit,
    private readonly forecast: ForecastService,
    private readonly orderService: ProductionOrdersService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const nutrient of DEFAULT_NUTRIENTS) {
        await this.prisma.nutrient.upsert({
          where: { code: nutrient.code },
          update: {},
          create: {
            code: nutrient.code,
            name: nutrient.name,
            unit: nutrient.unit,
            category: nutrient.category,
            sortOrder: nutrient.sortOrder,
          },
        });
      }
    } catch (error) {
      this.logger.warn(`No se pudo sembrar el catálogo de nutrientes: ${(error as Error).message}`);
    }
  }

  refresh(): void {
    this.forecast.refreshCaches();
    this.profit.refresh();
  }

  async plan(query: ProductionQuery, permissions: string[]): Promise<ProductionPlanResponse> {
    const context = await this.buildPlan(query, permissions);
    return context.response;
  }

  async explosion(query: ProductionQuery, permissions: string[]): Promise<ProductionExplosionResponse> {
    const context = await this.buildPlan(query, permissions);
    return this.buildExplosion(context, query, permissions);
  }

  async orders(query: ProductionOrdersQuery): Promise<ProductionOrdersResponse> {
    return this.orderService.group(query);
  }

  async simulate(input: ProductionSimulation, permissions: string[]): Promise<ProductionSimulationResponse> {
    const { demandByProduct, selection } = await this.orderService.demandAndSelection(
      { ...input, by: 'producto' },
      input.selectedKeys,
    );
    // Sin pedidos seleccionados se conserva la demanda base (forecast +
    // cartera completa) y solo se aplican los ajustes de producción/lote.
    const hasSelection = input.selectedKeys.length > 0;
    const context = await this.buildPlan(input, permissions, {
      selectedDemand: hasSelection ? demandByProduct : undefined,
      overrides: input.overrides,
    });
    const explosion = this.buildExplosion(context, input, permissions);
    return { plan: context.response, explosion, selection };
  }

  async formulas(currency: 'BS' | 'USD', permissions: string[]): Promise<ProductionFormulaListResponse> {
    const canViewCosts = permissions.includes('produccion:view_costs');
    const [profit, preferences, packagingRules] = await Promise.all([
      this.profit.load(),
      this.prisma.formulaPreference.findMany(),
      this.prisma.packagingRule.findMany(),
    ]);
    const catalog = buildFormulaCatalog(profit);
    const preferenceByProduct = new Map(preferences.map((row) => [row.productCode, row.formulaExternalId]));
    const packagingByProduct = this.buildPackagingMap(profit, packagingRules);
    const products = new Set(catalog.all.map((formula) => formula.appliesToProductCode));
    const rows: ProductionFormulaSummary[] = [];
    // Materias primas sin la fila «Reposición» de Profit. Se deduplican por
    // código y se muestran como aviso arriba de la tabla.
    const missingByCode = new Map<string, ProductionMissingReplacement>();

    for (const productCode of products) {
      const candidates = catalog.byProduct.get(productCode) ?? [];
      if (candidates.length === 0) continue;
      const main = resolveMainFormula(candidates, preferenceByProduct.get(productCode));
      const batchKg = resolveBatchKg(candidates, main);
      const packaging = packagingByProduct.get(productCode) ?? null;
      const ordered = sortFormulas(candidates);
      const formulas = ordered.map((formula) =>
        this.formulaCostLine(formula, packaging, currency, profit.exchangeRate, canViewCosts),
      );
      const mainLine = main ? formulas.find((line) => line.id === main.id && line.kind === main.kind) ?? formulas[0] : null;
      const hasEmpaq = main?.components.some((component) => component.type === 'EMPAQ') ?? false;

      for (const formula of ordered) {
        for (const component of formulaMissingReplacement(formula, profit.exchangeRate)) {
          const key = component.code.toUpperCase();
          if (missingByCode.has(key)) continue;
          const { cost } = componentReplacementCost(component, profit.exchangeRate);
          missingByCode.set(key, {
            code: component.code,
            description: component.description,
            fallback: cost === null ? 'NONE' : 'LAST',
          });
        }
      }

      const alerts: string[] = [];
      if (!main) alerts.push('Sin cédula vinculada');
      if (
        main &&
        !main.components.some((component) => componentCost(component, 'LAST', profit.exchangeRate) !== null)
      ) {
        alerts.push('Sin costo de componentes');
      }
      if (main && batchKg === null) alerts.push('Sin lote configurado');
      if (main && main.appliesToUom === 'SAC' && !hasEmpaq && !packaging) alerts.push('Sin empaque configurado');

      rows.push({
        productCode,
        description: main?.appliesToDescription || candidates[0]?.appliesToDescription || productCode,
        uom: main?.appliesToUom || candidates[0]?.appliesToUom || 'KG',
        kgPerUom: main?.appliesToKgPerUom ?? candidates[0]?.appliesToKgPerUom ?? null,
        formulaCount: formulas.length,
        mainFormulaId: main?.id ?? null,
        mainFormulaName: main?.name ?? null,
        formulaKind: main?.kind ?? null,
        baseProductCode: main?.baseProductCode ?? null,
        batchKg,
        costPerKg: mainLine?.costPerKg ?? null,
        costPerSack: mainLine?.costPerSack ?? null,
        presentationKg: mainLine?.presentationKg ?? main?.appliesToKgPerUom ?? null,
        isBulk:
          mainLine?.isBulk ?? isBulkPresentation(main?.appliesToUom, main?.appliesToKgPerUom ?? null),
        replacementCostPerKg: mainLine?.replacementCostPerKg ?? null,
        isStandard: main?.isStandard ?? false,
        lastBatchAt: main?.updatedAt ?? null,
        packagingCode: packaging?.code ?? null,
        formulas,
        alerts,
      });
    }

    rows.sort((a, b) => a.productCode.localeCompare(b.productCode));
    const missingReplacement = Array.from(missingByCode.values()).sort((a, b) => a.code.localeCompare(b.code));
    return { rows, available: profit.available, alerts: profit.alerts, missingReplacement };
  }

  async formulaDetail(
    productCode: string,
    permissions: string[],
    currency: 'BS' | 'USD' = 'USD',
  ): Promise<ProductionFormulaDetailResponse> {
    const canViewCosts = permissions.includes('produccion:view_costs');
    const [profit, preferences, packagingRules, nutrientRows, ingredientRows, specRows, batches] = await Promise.all([
      this.profit.load(),
      this.prisma.formulaPreference.findMany(),
      this.prisma.packagingRule.findMany(),
      this.prisma.nutrient.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.ingredientNutrient.findMany(),
      this.prisma.nutritionalSpec.findMany({ where: { productCode } }),
      this.profit.loadBatches(productCode),
    ]);

    const catalog = buildFormulaCatalog(profit);
    const candidates = catalog.byProduct.get(productCode) ?? [];
    const batchFormulas = buildBatchFormulas(batches);
    const formulas = sortFormulas([...candidates, ...batchFormulas]);
    if (formulas.length === 0) {
      return {
        productCode,
        description: productCode,
        uom: 'KG',
        kgPerUom: null,
        selectedFormulaId: null,
        formulas: [],
        packagingCode: null,
        packagingDescription: null,
        packagingQtyPerUnit: null,
        packagingOptions: [],
        alerts: ['No hay cédulas maestras ni lotes para este producto en Profit.'],
      };
    }

    const packagingOptions = Array.from(
      new Map(
        profit.packaging.map((row) => [
          row.packagingCode.toUpperCase(),
          { code: row.packagingCode, description: row.packagingDescription },
        ]),
      ).values(),
    ).sort((a, b) => a.code.localeCompare(b.code));
    const packagingByProduct = this.buildPackagingMap(profit, packagingRules);
    const packaging = packagingByProduct.get(productCode) ?? null;
    const preference = preferences.find((row) => row.productCode === productCode)?.formulaExternalId ?? null;
    const selected = resolveMainFormula(formulas, preference);
    const stockByArticle = this.buildStockMap(profit);
    const incomingByArticle = this.buildIncomingMap(profit);
    const nutrients: NutrientDefinition[] = nutrientRows.map((row) => ({
      code: row.code,
      name: row.name,
      unit: row.unit,
      category: row.category,
      sortOrder: row.sortOrder,
    }));
    const ingredientValues: IngredientNutrientValue[] = ingredientRows.map((row) => ({
      ingredientCode: row.ingredientCode,
      nutrientCode: row.nutrientCode,
      value: numOrZero(row.value),
      basis: row.basis,
    }));
    const specs: NutrientSpecification[] = specRows.map((row) => ({
      productCode: row.productCode,
      nutrientCode: row.nutrientCode,
      minValue: num(row.minValue),
      maxValue: num(row.maxValue),
      targetValue: num(row.targetValue),
    }));

    const mapped: ProductionFormula[] = formulas.map((formula) => {
      const hasEmpaq = formula.components.some((component) => component.type === 'EMPAQ');
      const presentationKg = formula.appliesToKgPerUom;
      const isBulk = isBulkPresentation(formula.appliesToUom, presentationKg);
      const packagingForProduct = !isBulk && formula.appliesToUom === 'SAC' && !hasEmpaq ? packaging : null;
      const ingredientPerKgUsd = formulaCostPerKg(formula, presentationKg, 'LAST', profit.exchangeRate);
      let costPerKgUsd = ingredientPerKgUsd;
      let replacementPerKgUsd = formulaReplacementCostPerKg(formula, presentationKg, profit.exchangeRate);
      let packagingPerKgUsd = 0;
      let packagingPerSackUsd = 0;
      let hasPackagingCost = false;
      if (packagingForProduct && presentationKg !== null && presentationKg > 1) {
        const packagingCost = this.packagingUnitCost(packagingForProduct, 'LAST', profit.exchangeRate);
        const packagingReplacement = this.packagingReplacementCost(packagingForProduct, profit.exchangeRate);
        if (packagingCost !== null) {
          hasPackagingCost = true;
          packagingPerKgUsd = (packagingCost * packagingForProduct.qtyPerUnit) / presentationKg;
          packagingPerSackUsd = packagingCost * packagingForProduct.qtyPerUnit;
        }
        if (costPerKgUsd !== null && packagingCost !== null) {
          costPerKgUsd = round(costPerKgUsd + packagingPerKgUsd, 6);
        }
        if (replacementPerKgUsd !== null && packagingReplacement !== null) {
          replacementPerKgUsd = round(
            replacementPerKgUsd + (packagingReplacement * packagingForProduct.qtyPerUnit) / presentationKg,
            6,
          );
        }
      }
      const costPerSackUsd = isBulk ? null : sackCostFromKg(costPerKgUsd, presentationKg);
      const replacementPerSackUsd = isBulk ? null : sackCostFromKg(replacementPerKgUsd, presentationKg);

      const formulaTotalCostUsd = formula.components.reduce((acc, component) => {
        const unit = componentCost(component, 'LAST', profit.exchangeRate);
        return unit === null ? acc : acc + component.qty * unit;
      }, 0);

      const components = formula.components.map((component) => {
        const unit = componentCost(component, 'LAST', profit.exchangeRate);
        const total = unit === null ? null : round(component.qty * unit, 6);
        const replacement = componentReplacementCost(component, profit.exchangeRate);
        const replacementTotal =
          replacement.cost === null ? null : round(component.qty * replacement.cost, 6);
        return {
          line: component.line,
          code: component.code,
          description: component.description,
          type: component.type,
          uom: component.uom,
          qty: component.qty,
          unitCost: canViewCosts ? displayCost(unit, currency, profit.exchangeRate) : null,
          totalCost: canViewCosts ? displayCost(total, currency, profit.exchangeRate) : null,
          costSharePct:
            total !== null && formulaTotalCostUsd > 0 ? round((total / formulaTotalCostUsd) * 100, 1) : null,
          stockQty: round(stockByArticle.get(component.code) ?? 0),
          incomingQty: round(incomingByArticle.get(component.code)?.qty ?? 0),
          replacementUnitCost: canViewCosts
            ? displayCost(replacement.cost, currency, profit.exchangeRate)
            : null,
          replacementTotalCost: canViewCosts
            ? displayCost(replacementTotal, currency, profit.exchangeRate)
            : null,
          replacementFallback: replacement.cost === null ? true : replacement.fallback,
        };
      });

      const outputKg =
        formula.outputUom === 'SAC'
          ? formula.outputQty * (presentationKg ?? 0)
          : formula.outputUom === 'KG'
            ? formula.outputQty
            : presentationKg ?? formula.outputQty;

      return {
        id: formula.id,
        kind: formula.kind,
        name: formula.name,
        appliesToProductCode: formula.appliesToProductCode,
        productCode: formula.productCode,
        productDescription: formula.productDescription,
        baseProductCode: formula.baseProductCode,
        baseProductDescription: formula.baseProductDescription,
        outputQty: formula.outputQty,
        outputUom: formula.outputUom,
        batchKg: formula.batchKg,
        hoursPerBatch: formula.hoursPerBatch,
        isStandard: formula.isStandard,
        updatedAt: formula.updatedAt,
        components,
        costPerKg: canViewCosts ? displayCost(costPerKgUsd, currency, profit.exchangeRate) : null,
        costPerSack: canViewCosts ? displayCost(costPerSackUsd, currency, profit.exchangeRate) : null,
        ingredientCostPerKg: canViewCosts
          ? displayCost(ingredientPerKgUsd, currency, profit.exchangeRate)
          : null,
        packagingCostPerKg:
          canViewCosts && hasPackagingCost
            ? displayCost(packagingPerKgUsd, currency, profit.exchangeRate)
            : null,
        packagingCostPerSack:
          canViewCosts && hasPackagingCost
            ? displayCost(packagingPerSackUsd, currency, profit.exchangeRate)
            : null,
        totalCost:
          canViewCosts && costPerKgUsd !== null
            ? displayCost(round(costPerKgUsd * outputKg, 6), currency, profit.exchangeRate)
            : null,
        replacementCostPerKg: canViewCosts
          ? displayCost(replacementPerKgUsd, currency, profit.exchangeRate)
          : null,
        replacementCostPerSack: canViewCosts
          ? displayCost(replacementPerSackUsd, currency, profit.exchangeRate)
          : null,
        replacementTotalCost:
          canViewCosts && replacementPerKgUsd !== null
            ? displayCost(round(replacementPerKgUsd * outputKg, 6), currency, profit.exchangeRate)
            : null,
        nutrition: computeFormulaNutrition(
          formula,
          formula.appliesToKgPerUom,
          nutrients,
          ingredientValues,
          specs,
        ),
      };
    });

    const alerts: string[] = [...profit.alerts];
    if (preference !== null && !formulas.some((formula) => formula.id === preference)) {
      alerts.push('La cédula principal guardada ya no existe en Profit; se usa la estándar.');
    }
    if (packaging === null && (selected?.appliesToUom ?? 'KG') === 'SAC') alerts.push('Sin empaque configurado para este producto.');

    return {
      productCode,
      description: selected?.appliesToDescription || formulas[0]?.appliesToDescription || productCode,
      uom: selected?.appliesToUom || formulas[0]?.appliesToUom || 'KG',
      kgPerUom: selected?.appliesToKgPerUom ?? formulas[0]?.appliesToKgPerUom ?? null,
      selectedFormulaId: selected?.id ?? null,
      formulas: mapped,
      packagingCode: packaging?.code ?? null,
      packagingDescription: packaging?.description ?? null,
      packagingQtyPerUnit: packaging?.qtyPerUnit ?? null,
      packagingOptions,
      alerts,
    };
  }

  async nutritionCatalog(
    productCode: string,
    permissions: string[],
    currency: 'BS' | 'USD' = 'USD',
    formulaId?: number | null,
  ): Promise<ProductionNutritionCatalogResponse> {
    const detail = await this.formulaDetail(productCode, permissions, currency);
    // La UI puede fijar la cédula: se valida contra las del producto para no
    // calcular la nutrición de una receta ajena. Sin elección, la principal.
    const selected =
      (formulaId ? detail.formulas.find((formula) => formula.id === formulaId) : undefined) ??
      detail.formulas.find((formula) => formula.id === detail.selectedFormulaId) ??
      detail.formulas[0] ??
      null;
    const [nutrientRows, ingredientRows, specRows] = await Promise.all([
      this.prisma.nutrient.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.ingredientNutrient.findMany(),
      this.prisma.nutritionalSpec.findMany({ where: { productCode } }),
    ]);
    const nutrients = nutrientRows.map((row) => ({
      code: row.code,
      name: row.name,
      unit: row.unit,
      category: row.category,
      sortOrder: row.sortOrder,
    }));
    const valuesByIngredient = new Map<string, Map<string, { value: number; basis: string }>>();
    for (const row of ingredientRows) {
      if (!valuesByIngredient.has(row.ingredientCode)) valuesByIngredient.set(row.ingredientCode, new Map());
      valuesByIngredient.get(row.ingredientCode)!.set(row.nutrientCode, {
        value: numOrZero(row.value),
        basis: row.basis,
      });
    }

    const ingredients = (selected?.components ?? []).map((component) => {
      const kg =
        component.uom === 'KG'
          ? component.qty
          : component.uom === 'SAC' && detail.kgPerUom !== null
            ? component.qty * detail.kgPerUom
            : null;
      return {
        code: component.code,
        description: component.description,
        uom: component.uom,
        qty: component.qty,
        kg,
        values: nutrients.map((nutrient) => {
          const entry = valuesByIngredient.get(component.code)?.get(nutrient.code);
          return {
            nutrientCode: nutrient.code,
            value: entry?.value ?? null,
            basis: entry?.basis ?? 'AS_FED',
          };
        }),
      };
    });

    return {
      productCode,
      formulaId: selected?.id ?? null,
      formulaName: selected?.name ?? null,
      nutrients,
      ingredients,
      specs: specRows.map((row) => ({
        nutrientCode: row.nutrientCode,
        min: num(row.minValue),
        max: num(row.maxValue),
        target: num(row.targetValue),
      })),
      nutrition: selected?.nutrition ?? { available: false, coveragePct: 0, nutrients: [] },
      available: detail.formulas.length > 0,
      alerts: detail.alerts,
    };
  }

  async setFormulaPreference(productCode: string, formulaId: number | null, actor?: ProductionActor) {
    if (formulaId !== null) {
      const profit = await this.profit.load();
      const catalog = buildFormulaCatalog(profit);
      const candidates = catalog.byProduct.get(productCode) ?? [];
      if (!candidates.some((formula) => formula.id === formulaId)) {
        throw new BadRequestException('La cédula indicada no es una maestra/base de este producto.');
      }
    }
    if (formulaId === null) {
      await this.prisma.formulaPreference.deleteMany({ where: { productCode } });
    } else {
      await this.prisma.formulaPreference.upsert({
        where: { productCode },
        update: { formulaExternalId: formulaId, updatedById: actor?.id ?? null, updatedByCode: actor?.code ?? null },
        create: {
          productCode,
          formulaExternalId: formulaId,
          updatedById: actor?.id ?? null,
          updatedByCode: actor?.code ?? null,
        },
      });
    }
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_FORMULA_PREFERENCE_SET',
      entityType: 'Product',
      entityId: productCode,
      context: { formulaId },
    });
    return { ok: true };
  }

  async setPackagingRule(productCode: string, dto: ProductionPackagingUpdate, actor?: ProductionActor) {
    await this.prisma.packagingRule.upsert({
      where: { productCode },
      update: {
        materialCode: dto.materialCode,
        qtyPerUnit: dto.qtyPerUnit,
        source: 'MANUAL',
        updatedById: actor?.id ?? null,
        updatedByCode: actor?.code ?? null,
      },
      create: {
        productCode,
        materialCode: dto.materialCode,
        qtyPerUnit: dto.qtyPerUnit,
        source: 'MANUAL',
        updatedById: actor?.id ?? null,
        updatedByCode: actor?.code ?? null,
      },
    });
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_PACKAGING_SET',
      entityType: 'Product',
      entityId: productCode,
      context: { materialCode: dto.materialCode, qtyPerUnit: dto.qtyPerUnit },
    });
    return { ok: true };
  }

  async updateIngredientNutrition(code: string, dto: ProductionNutritionUpdate, actor?: ProductionActor) {
    let updated = 0;
    for (const entry of dto.values) {
      if (entry.value === null) {
        await this.prisma.ingredientNutrient.deleteMany({
          where: { ingredientCode: code, nutrientCode: entry.nutrientCode },
        });
        continue;
      }
      await this.prisma.ingredientNutrient.upsert({
        where: { ingredientCode_nutrientCode: { ingredientCode: code, nutrientCode: entry.nutrientCode } },
        update: {
          value: entry.value,
          basis: entry.basis,
          updatedById: actor?.id ?? null,
          updatedByCode: actor?.code ?? null,
        },
        create: {
          ingredientCode: code,
          nutrientCode: entry.nutrientCode,
          value: entry.value,
          basis: entry.basis,
          updatedById: actor?.id ?? null,
          updatedByCode: actor?.code ?? null,
        },
      });
      updated += 1;
    }
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_NUTRITION_UPDATE',
      entityType: 'Article',
      entityId: code,
      context: { values: dto.values.length, updated },
    });
    return { ok: true, updated };
  }

  async updateProductSpecs(productCode: string, dto: ProductionSpecUpdate, actor?: ProductionActor) {
    let updated = 0;
    for (const entry of dto.values) {
      await this.prisma.nutritionalSpec.upsert({
        where: { productCode_nutrientCode: { productCode, nutrientCode: entry.nutrientCode } },
        update: {
          minValue: entry.min,
          maxValue: entry.max,
          targetValue: entry.target,
          updatedById: actor?.id ?? null,
          updatedByCode: actor?.code ?? null,
        },
        create: {
          productCode,
          nutrientCode: entry.nutrientCode,
          minValue: entry.min,
          maxValue: entry.max,
          targetValue: entry.target,
          updatedById: actor?.id ?? null,
          updatedByCode: actor?.code ?? null,
        },
      });
      updated += 1;
    }
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_SPEC_UPDATE',
      entityType: 'Product',
      entityId: productCode,
      context: { values: dto.values.length, updated },
    });
    return { ok: true, updated };
  }

  async listScenarios(): Promise<ProductionScenario[]> {
    const rows = await this.prisma.productionScenario.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.scenarioFromRow(row));
  }

  async createScenario(dto: ProductionScenarioCreate, actor?: ProductionActor): Promise<ProductionScenario> {
    const totals = this.extractTotals(dto.payload);
    const row = await this.prisma.productionScenario.create({
      data: {
        name: dto.name,
        year: dto.year,
        month: dto.month,
        week: dto.week,
        policy: dto.policy,
        currency: dto.currency,
        payload: JSON.stringify(dto.payload ?? {}),
        totalsJson: JSON.stringify(totals),
        createdById: actor?.id ?? null,
        createdByCode: actor?.code ?? null,
      },
    });
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_SCENARIO_CREATE',
      entityType: 'ProductionScenario',
      entityId: row.id,
      context: { name: dto.name, year: dto.year, month: dto.month, week: dto.week },
    });
    return this.scenarioFromRow(row);
  }

  async deleteScenario(id: string, actor?: ProductionActor): Promise<{ ok: true }> {
    const row = await this.prisma.productionScenario.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Escenario de producción no encontrado');
    await this.prisma.productionScenario.delete({ where: { id } });
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PRODUCTION_SCENARIO_DELETE',
      entityType: 'ProductionScenario',
      entityId: id,
      context: { name: row.name },
    });
    return { ok: true };
  }

  // ----------------------------------------------------------
  // Construcción del plan (compartida por /plan y /explosion).
  // ----------------------------------------------------------

  private async buildPlan(
    query: ProductionQuery,
    permissions: string[],
    options?: { selectedDemand?: Map<string, number>; overrides?: ProductionSimulationOverride[] },
  ): Promise<PlanContext> {
    const canViewCosts = permissions.includes('produccion:view_costs');
    let forecastError: string | null = null;
    const forecastPromise: Promise<ForecastPlanResponse | null> = this.forecast
      .plan(query.year, query.month)
      .catch((error: unknown) => {
        forecastError = (error as Error).message;
        return null;
      });

    const [profit, forecastPlan, preferences, packagingRules, safetyPolicies, snapshot] = await Promise.all([
      this.profit.load(),
      forecastPromise,
      this.prisma.formulaPreference.findMany(),
      this.prisma.packagingRule.findMany(),
      this.prisma.safetyStockPolicy.findMany(),
      this.prisma.inventorySnapshot.findFirst({
        orderBy: { takenAt: 'desc' },
        include: { lines: { include: { warehouse: true } } },
      }),
    ]);

    const catalog = buildFormulaCatalog(profit);
    const packagingByProduct = this.buildPackagingMap(profit, packagingRules);
    const stockByArticle = this.buildStockMap(profit);
    const incomingByArticle = this.buildIncomingMap(profit);
    const preferenceByProduct = new Map(preferences.map((row) => [row.productCode, row.formulaExternalId]));
    const safetyByProduct = new Map(safetyPolicies.map((row) => [row.productCode, row]));
    const ptpByProduct = new Map<string, number>();
    for (const line of snapshot?.lines ?? []) {
      if (line.warehouseCode !== 'Stock PTP') continue;
      ptpByProduct.set(line.productCode, (ptpByProduct.get(line.productCode) ?? 0) + numOrZero(line.qty));
    }

    const exchangeRate = profit.exchangeRate;
    const days = query.week > 0 ? 7 : daysInMonth(query.year, query.month);
    const weekRange = query.week > 0 ? forecastPlan?.weekRanges.find((range) => range.weekIndex === query.week) ?? null : null;
    const riskDate = weekRange?.to ?? monthEndIso(query.year, query.month);
    // Un mes cerrado tiene asOf (último día) pero no semana en curso. Un mes
    // futuro tiene ambos en null y sí debe planificarse.
    const monthClosed =
      query.week === 0 && forecastPlan !== null && forecastPlan.currentWeekIndex === null && forecastPlan.asOf !== null;
    const rows: InternalPlanRow[] = [];

    for (const forecastRow of forecastPlan?.rows ?? []) {
      const weekData = query.week > 0 ? forecastRow.weeks.find((week) => week.weekIndex === query.week) ?? null : null;
      const closed = weekData?.closed ?? false;
      const forecastKg = weekData ? weekData.forecastKg : sum(forecastRow.weeks.map((week) => week.forecastKg));
      const soldKg = weekData ? weekData.soldKg : sum(forecastRow.weeks.map((week) => week.soldKg));
      // Si hay una selección explícita, un producto sin pedidos seleccionados
      // vale 0 (no debe caer al total de la cartera).
      const ordersKg =
        options?.selectedDemand !== undefined
          ? options.selectedDemand.get(forecastRow.productCode) ?? 0
          : weekData
            ? weekData.demandKg
            : sum(forecastRow.weeks.map((week) => week.demandKg));

      const ptpQty = ptpByProduct.get(forecastRow.productCode) ?? 0;
      const stockKgBase = weekData ? weekData.stockKg : forecastRow.stockKg;
      const stockQtyBase = weekData
        ? forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0
          ? stockKgBase / forecastRow.kgPerUom
          : stockKgBase
        : forecastRow.stockTotal;
      const stockKg =
        stockKgBase +
        (forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0 ? ptpQty * forecastRow.kgPerUom : ptpQty);
      const stockQty = stockQtyBase + ptpQty;

      const baseDemand = computeDemand({
        forecastKg,
        soldKg,
        ordersKg,
        safetyKg: 0,
        availableKg: 0,
        policy: query.policy,
      }).demandKg;
      const safetyKg = this.safetyFor(safetyByProduct.get(forecastRow.productCode), baseDemand, days);
      const demand = computeDemand({
        forecastKg,
        soldKg,
        ordersKg,
        safetyKg,
        availableKg: stockKg,
        policy: query.policy,
      });
      const requiredKg = closed || monthClosed ? 0 : demand.requiredKg;

      const candidates = catalog.byProduct.get(forecastRow.productCode) ?? [];
      const formula = resolveMainFormula(candidates, preferenceByProduct.get(forecastRow.productCode));
      const baseBatchKg = resolveBatchKg(candidates, formula);
      const override = options?.overrides?.find(
        (item) => item.productCode === forecastRow.productCode,
      );
      const batchKg =
        override?.batchKg !== undefined && override.batchKg > 0
          ? override.batchKg
          : baseBatchKg;
      let batchResult = resolveBatches(requiredKg, batchKg, forecastRow.kgPerUom);
      if (override?.productionKg !== undefined) {
        const productionKg = round(override.productionKg);
        const batches =
          batchKg !== null && batchKg > 0
            ? Math.ceil(productionKg / batchKg)
            : productionKg > 0
              ? 1
              : 0;
        batchResult = {
          batches,
          productionKg,
          productionSacks:
            forecastRow.uom === 'SAC' && forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0
              ? round(productionKg / forecastRow.kgPerUom, 0)
              : null,
        };
      }
      const productionSacks =
        forecastRow.uom === 'SAC' && forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0
          ? round(batchResult.productionKg / forecastRow.kgPerUom, 0)
          : null;

      const packaging = packagingByProduct.get(forecastRow.productCode) ?? null;
      const hasEmpaq = formula?.components.some((component) => component.type === 'EMPAQ') ?? false;
      const packagingForProduct = forecastRow.uom === 'SAC' && !hasEmpaq ? packaging : null;
      let costPerKgUsd = formula
        ? formulaCostPerKg(formula, forecastRow.kgPerUom, query.costBasis, exchangeRate)
        : null;
      let costPerSackUsd =
        formula && forecastRow.uom === 'SAC'
          ? formulaCostPerSack(formula, forecastRow.kgPerUom, query.costBasis, exchangeRate)
          : null;
      if (packagingForProduct) {
        const packagingCost = this.packagingUnitCost(packagingForProduct, query.costBasis, exchangeRate);
        if (costPerSackUsd !== null && packagingCost !== null) {
          costPerSackUsd = round(costPerSackUsd + packagingCost * packagingForProduct.qtyPerUnit, 6);
          if (forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0) {
            costPerKgUsd = round(costPerSackUsd / forecastRow.kgPerUom, 6);
          }
        }
      }
      const costPerKg = canViewCosts ? displayCost(costPerKgUsd, query.currency, exchangeRate) : null;
      const costPerSack = canViewCosts ? displayCost(costPerSackUsd, query.currency, exchangeRate) : null;
      const totalCost =
        canViewCosts && costPerKg !== null
          ? round(costPerKg * batchResult.productionKg)
          : canViewCosts && costPerSack !== null && productionSacks !== null
            ? round(costPerSack * productionSacks)
            : null;

      const alerts: string[] = [];
      if (override?.productionKg !== undefined && batchResult.productionKg < requiredKg) {
        alerts.push('Ajuste por debajo del faltante: hay riesgo de stockout');
      }
      if (requiredKg > 0 && !formula) alerts.push('Sin cédula vinculada');
      if (requiredKg > 0 && formula && costPerKgUsd === null && costPerSackUsd === null)
        alerts.push('Sin costo de componentes');
      if (requiredKg > 0 && formula && batchKg === null) alerts.push('Sin lote configurado');
      if (requiredKg > 0 && forecastRow.uom === 'SAC' && !hasEmpaq && !packaging) alerts.push('Sin empaque configurado');
      if (closed) alerts.push('Semana cerrada: no sugiere producción');

      const status: ProductionPlanRow['status'] =
        requiredKg <= 0
          ? 'CUBIERTO'
          : !formula
            ? 'SIN_FORMULA'
            : costPerKg === null && costPerSack === null
              ? 'SIN_COSTO'
              : 'PRODUCIR';

      rows.push({
        productCode: forecastRow.productCode,
        description: forecastRow.description,
        uom: forecastRow.uom,
        kgPerUom: forecastRow.kgPerUom,
        category: forecastRow.category,
        stockQty: round(stockQty),
        stockKg: round(stockKg),
        stockByWarehouse: [
          { warehouseCode: 'Stock 03', qty: forecastRow.stock03 },
          { warehouseCode: 'Stock 9999', qty: forecastRow.stock9999 },
          { warehouseCode: 'Stock 68', qty: forecastRow.stock68 },
          { warehouseCode: 'Stock PTP', qty: round(ptpQty) },
        ],
        forecastKg: round(forecastKg),
        soldKg: round(soldKg),
        ordersKg: round(ordersKg),
        forecastRemainingKg: demand.forecastRemainingKg,
        safetyKg: round(safetyKg),
        availableKg: round(stockKg),
        demandKg: demand.demandKg,
        toProduceKg: batchResult.productionKg > 0 ? round(requiredKg) : 0,
        toProduceSacks:
          forecastRow.uom === 'SAC' && forecastRow.kgPerUom !== null && forecastRow.kgPerUom > 0
            ? round(requiredKg / forecastRow.kgPerUom, 0)
            : null,
        formulaId: formula?.id ?? null,
        formulaName: formula?.name ?? null,
        formulaKind: formula?.kind ?? null,
        baseProductCode: formula?.baseProductCode ?? null,
        baseProductDescription: formula?.baseProductDescription ?? null,
        batchKg,
        batches: batchResult.batches,
        productionKg: batchResult.productionKg,
        productionSacks,
        costPerKg,
        costPerSack,
        totalCost,
        packagingCode: packagingForProduct?.code ?? null,
        packagingQty:
          packagingForProduct && productionSacks !== null
            ? round(productionSacks * packagingForProduct.qtyPerUnit)
            : null,
        status,
        riskDate: requiredKg > 0 ? riskDate : null,
        alerts,
        closed: closed || monthClosed,
        formula,
      });
    }

    const costedRows = rows.filter((row) => row.totalCost !== null);
    const totals = {
      products: rows.length,
      forecastKg: round(sum(rows.map((row) => row.forecastKg))),
      soldKg: round(sum(rows.map((row) => row.soldKg))),
      ordersKg: round(sum(rows.map((row) => row.ordersKg))),
      demandKg: round(sum(rows.map((row) => row.demandKg))),
      toProduceKg: round(sum(rows.map((row) => row.toProduceKg))),
      productionKg: round(sum(rows.map((row) => row.productionKg))),
      totalCost: canViewCosts && costedRows.length > 0 ? round(sum(costedRows.map((row) => row.totalCost ?? 0))) : null,
      missingFormula: rows.filter((row) => row.formula === null && row.toProduceKg > 0).length,
      shortages: rows.filter((row) => row.status === 'PRODUCIR').length,
    };

    const alerts: string[] = [...profit.alerts];
    if (forecastError) alerts.push(`No se pudo leer el forecast: ${forecastError}`);
    if (query.currency === 'USD' && exchangeRate === null) {
      alerts.push('No se pudo leer el tipo de cambio US$: los costos quedan sin convertir.');
    }
    if (monthClosed) alerts.push('Mes cerrado: el plan no sugiere producción.');
    if (totals.missingFormula > 0) alerts.push(`${totals.missingFormula} producto(s) con demanda y sin cédula vinculada.`);
    if (rows.some((row) => row.alerts.includes('Sin costo de componentes'))) {
      alerts.push('Hay cédulas con componentes sin costo: revisa los costos en Profit.');
    }

    const response: ProductionPlanResponse = {
      year: query.year,
      month: query.month,
      week: query.week,
      asOf: forecastPlan?.asOf ?? null,
      policy: query.policy,
      costBasis: query.costBasis,
      currency: query.currency,
      exchangeRate,
      available: profit.available && forecastPlan !== null,
      rows: rows.map(({ formula: _formula, ...row }) => row),
      totals,
      alerts,
    };

    return {
      response,
      rows,
      catalog,
      profit,
      packagingByProduct,
      stockByArticle,
      incomingByArticle,
      exchangeRate,
    };
  }

  private buildExplosion(
    context: PlanContext,
    query: ProductionQuery,
    permissions: string[],
  ): ProductionExplosionResponse {
    const canViewCosts = permissions.includes('produccion:view_costs');
    const days = query.week > 0 ? 7 : daysInMonth(query.year, query.month);
    const materials = new Map<
      string,
      {
        code: string;
        description: string;
        type: string;
        uom: string;
        requiredQty: number;
        unitCostUsd: number | null;
        requiredCostUsd: number;
        isReprocess: boolean;
        products: Map<string, { productCode: string; description: string; qty: number }>;
      }
    >();

    const addMaterial = (
      code: string,
      description: string,
      type: string,
      uom: string,
      requiredQty: number,
      unitCostUsd: number | null,
      productCode: string,
      productDescription: string,
    ) => {
      if (!code || requiredQty <= 0) return;
      const key = code.trim().toUpperCase();
      const isReprocess = type === 'REP' || key.startsWith('REP');
      const current = materials.get(key) ?? {
        code,
        description,
        type,
        uom,
        requiredQty: 0,
        unitCostUsd: null,
        requiredCostUsd: 0,
        isReprocess,
        products: new Map(),
      };
      current.isReprocess = current.isReprocess || isReprocess;
      current.requiredQty += requiredQty;
      if (current.unitCostUsd === null && unitCostUsd !== null) current.unitCostUsd = unitCostUsd;
      if (unitCostUsd !== null) current.requiredCostUsd += requiredQty * unitCostUsd;
      const product = current.products.get(productCode) ?? {
        productCode,
        description: productDescription,
        qty: 0,
      };
      product.qty += requiredQty;
      current.products.set(productCode, product);
      materials.set(key, current);
    };

    const products: ProductionExplosionProduct[] = [];

    for (const row of context.rows) {
      if (!row.formula || row.productionKg <= 0) continue;
      const exploded = explode(
        row.formula,
        row.productionKg,
        row.productionSacks,
        row.kgPerUom,
        query.costBasis,
        context.exchangeRate,
      );
      for (const component of exploded) {
        addMaterial(
          component.component.code,
          component.component.description,
          component.component.type,
          component.component.uom,
          component.requiredQty,
          component.unitCost,
          row.productCode,
          row.description,
        );
      }

      const hasEmpaq = row.formula.components.some((component) => component.type === 'EMPAQ');
      const packaging = context.packagingByProduct.get(row.productCode) ?? null;
      if (row.uom === 'SAC' && !hasEmpaq && packaging && row.productionSacks !== null) {
        addMaterial(
          packaging.code,
          packaging.description,
          'EMPAQ',
          'SAC',
          row.productionSacks * packaging.qtyPerUnit,
          this.packagingUnitCost(packaging, query.costBasis, context.exchangeRate),
          row.productCode,
          row.description,
        );
      }

      products.push({
        productCode: row.productCode,
        description: row.description,
        productionKg: row.productionKg,
        productionSacks: row.productionSacks,
        formulaId: row.formula.id,
        formulaName: row.formula.name,
        baseProductCode: row.baseProductCode,
        costPerKg: row.costPerKg,
        totalCost: row.totalCost,
        packagingCode: packaging?.code ?? null,
        packagingQty:
          packaging && row.uom === 'SAC' && !hasEmpaq && row.productionSacks !== null
            ? round(row.productionSacks * packaging.qtyPerUnit)
            : null,
      });
    }

    const rows: ProductionMaterialRow[] = [];
    for (const material of materials.values()) {
      const stockQty = context.stockByArticle.get(material.code.toUpperCase()) ?? 0;
      const incoming = context.incomingByArticle.get(material.code.toUpperCase());
      const incomingQty = incoming?.qty ?? 0;
      const availableQty = stockQty + incomingQty;
      const rawPurchaseQty = round(Math.max(0, material.requiredQty - availableQty), 3);
      // Los reprocesos (REP...) no se compran: se generan en planta. Se
      // muestran con su requerimiento y una alerta, pero sin orden de compra.
      const purchaseQty = material.isReprocess ? 0 : rawPurchaseQty;
      const unitCost = canViewCosts
        ? displayCost(material.unitCostUsd, query.currency, context.exchangeRate)
        : null;
      const requiredCost = canViewCosts && unitCost !== null ? round(material.requiredQty * unitCost) : null;
      const purchaseCost = canViewCosts && unitCost !== null ? round(purchaseQty * unitCost) : null;
      const dailyUsage = days > 0 ? material.requiredQty / days : 0;
      const coverageDays = dailyUsage > 0 ? round(stockQty / dailyUsage, 1) : null;
      const alerts: string[] = [];
      if (material.isReprocess && rawPurchaseQty > 0) {
        alerts.push('Reproceso: cubrir con producción interna, no con compra');
      } else if (purchaseQty > 0) {
        alerts.push(`Comprar ${round(purchaseQty, 3)} ${material.uom}`);
        if (incoming?.expectedDate && incoming.expectedDate.slice(0, 10) < new Date().toISOString().slice(0, 10)) {
          alerts.push('OC pendiente con fecha vencida');
        }
      }
      if (canViewCosts && material.unitCostUsd === null) alerts.push('Sin costo unitario');

      rows.push({
        code: material.code,
        description: material.description,
        type: material.type,
        uom: material.uom,
        requiredQty: round(material.requiredQty, 3),
        stockQty: round(stockQty, 3),
        incomingQty: round(incomingQty, 3),
        availableQty: round(availableQty, 3),
        purchaseQty,
        unitCost,
        requiredCost,
        purchaseCost,
        coverageDays,
        expectedDate: incoming?.expectedDate ?? null,
        supplier: incoming?.supplier ?? null,
        products: Array.from(material.products.values())
          .map((product) => ({ ...product, qty: round(product.qty, 3) }))
          .sort((a, b) => b.qty - a.qty),
        alerts,
      });
    }

    rows.sort((a, b) => {
      if (a.purchaseQty !== b.purchaseQty) return b.purchaseQty - a.purchaseQty;
      return a.code.localeCompare(b.code);
    });

    const costedMaterials = rows.filter((row) => row.requiredCost !== null);
    const purchaseRows = rows.filter((row) => row.purchaseQty > 0);
    const costedPurchases = purchaseRows.filter((row) => row.purchaseCost !== null);
    const totals = {
      materials: rows.length,
      requiredCost: canViewCosts && costedMaterials.length > 0 ? round(sum(costedMaterials.map((row) => row.requiredCost ?? 0))) : null,
      purchaseCost: canViewCosts
        ? purchaseRows.length === 0
          ? 0
          : costedPurchases.length > 0
            ? round(sum(costedPurchases.map((row) => row.purchaseCost ?? 0)))
            : null
        : null,
      shortages: purchaseRows.length,
    };

    const alerts = [...context.response.alerts];
    if (totals.shortages > 0) alerts.push(`${totals.shortages} material(es) requieren compra para cubrir el plan.`);

    return {
      year: query.year,
      month: query.month,
      week: query.week,
      asOf: context.response.asOf,
      costBasis: query.costBasis,
      currency: query.currency,
      exchangeRate: context.exchangeRate,
      available: context.response.available,
      materials: rows,
      products: products.sort((a, b) => a.productCode.localeCompare(b.productCode)),
      totals,
      alerts,
    };
  }

  private buildPackagingMap(
    profit: ProfitProductionData,
    rules: Array<{ productCode: string; materialCode: string; qtyPerUnit: Prisma.Decimal; source: string }>,
  ): Map<string, PackagingInfo> {
    const historyByProduct = new Map<
      string,
      {
        code: string;
        description: string;
        lastCost: number | null;
        avgCost: number | null;
        lastCostUsd: number | null;
        avgCostUsd: number | null;
        replacementCost: number | null;
        uses: number;
      }
    >();
    const costByCode = new Map<
      string,
      {
        lastCost: number | null;
        avgCost: number | null;
        lastCostUsd: number | null;
        avgCostUsd: number | null;
        replacementCost: number | null;
        description: string;
      }
    >();
    for (const row of profit.packaging) {
      const key = row.productCode.toUpperCase();
      const current = historyByProduct.get(key);
      if (!current || row.uses > current.uses) {
        historyByProduct.set(key, {
          code: row.packagingCode,
          description: row.packagingDescription,
          lastCost: row.lastCost,
          avgCost: row.avgCost,
          lastCostUsd: row.lastCostUsd,
          avgCostUsd: row.avgCostUsd,
          replacementCost: row.replacementCost,
          uses: row.uses,
        });
      }
      if (!costByCode.has(row.packagingCode.toUpperCase())) {
        costByCode.set(row.packagingCode.toUpperCase(), {
          lastCost: row.lastCost,
          avgCost: row.avgCost,
          lastCostUsd: row.lastCostUsd,
          avgCostUsd: row.avgCostUsd,
          replacementCost: row.replacementCost,
          description: row.packagingDescription,
        });
      }
    }

    const result = new Map<string, PackagingInfo>();
    for (const [productCode, history] of historyByProduct) {
      result.set(productCode, {
        code: history.code,
        description: history.description,
        lastCost: history.lastCost,
        avgCost: history.avgCost,
        lastCostUsd: history.lastCostUsd,
        avgCostUsd: history.avgCostUsd,
        replacementCost: history.replacementCost,
        qtyPerUnit: 1,
      });
    }
    for (const rule of rules) {
      const key = rule.productCode.toUpperCase();
      const cost = costByCode.get(rule.materialCode.toUpperCase());
      result.set(key, {
        code: rule.materialCode,
        description: cost?.description ?? '',
        lastCost: cost?.lastCost ?? null,
        avgCost: cost?.avgCost ?? null,
        lastCostUsd: cost?.lastCostUsd ?? null,
        avgCostUsd: cost?.avgCostUsd ?? null,
        replacementCost: cost?.replacementCost ?? null,
        qtyPerUnit: numOrZero(rule.qtyPerUnit) || 1,
      });
    }

    // Fallback por color de la línea: hay presentaciones nuevas (p. ej.
    // ABABOV85) que todavía no tienen un lote con empaque en Profit. Si la
    // descripción dice NARANJA/VERDE/AZUL, se propone la bolsa correspondiente
    // y el usuario puede corregirla en la ficha.
    const descriptionByProduct = new Map<string, string>();
    for (const row of profit.formulas) {
      if (row.productDescription) descriptionByProduct.set(row.productCode.toUpperCase(), row.productDescription);
    }
    for (const row of profit.ace) {
      if (row.productDescription) descriptionByProduct.set(row.productCode.toUpperCase(), row.productDescription);
    }
    for (const [productCode, description] of descriptionByProduct) {
      if (result.has(productCode)) continue;
      const code = this.inferPackagingCode(description);
      if (!code) continue;
      const cost = costByCode.get(code);
      result.set(productCode, {
        code,
        description: cost?.description ?? '',
        lastCost: cost?.lastCost ?? null,
        avgCost: cost?.avgCost ?? null,
        lastCostUsd: cost?.lastCostUsd ?? null,
        avgCostUsd: cost?.avgCostUsd ?? null,
        replacementCost: cost?.replacementCost ?? null,
        qtyPerUnit: 1,
      });
    }
    return result;
  }

  private inferPackagingCode(description: string): string | null {
    const text = description.toUpperCase();
    if (text.includes('NARANJA')) return 'MATPRI72';
    if (text.includes('AZUL')) return 'MATPRI79';
    if (text.includes('VERDE')) return 'MATPRI76';
    return null;
  }

  private buildStockMap(profit: ProfitProductionData): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of profit.stock) {
      if (!MP_WAREHOUSES.has(row.warehouseCode)) continue;
      const key = row.articleCode.toUpperCase();
      map.set(key, (map.get(key) ?? 0) + row.qty);
    }
    return map;
  }

  private buildIncomingMap(profit: ProfitProductionData): Map<string, IncomingInfo> {
    const map = new Map<string, IncomingInfo>();
    for (const row of profit.incoming) {
      if (!MP_WAREHOUSES.has(row.warehouseCode)) continue;
      const key = row.articleCode.toUpperCase();
      const current = map.get(key);
      map.set(key, {
        qty: (current?.qty ?? 0) + row.pendingQty,
        expectedDate:
          current?.expectedDate && row.expectedDate
            ? current.expectedDate < row.expectedDate
              ? current.expectedDate
              : row.expectedDate
            : current?.expectedDate ?? row.expectedDate,
        supplier: current?.supplier ?? row.supplierCode ?? null,
      });
    }
    return map;
  }

  /** Costo y costo de reposición de una cédula, con empaque y por saco. */
  private formulaCostLine(
    formula: Formula,
    packaging: PackagingInfo | null,
    currency: 'BS' | 'USD',
    exchangeRate: number | null,
    canViewCosts: boolean,
  ): ProductionFormulaSummaryLine {
    const presentationKg = formula.appliesToKgPerUom;
    const isBulk = isBulkPresentation(formula.appliesToUom, presentationKg);
    const hasEmpaq = formula.components.some((component) => component.type === 'EMPAQ');
    let costPerKgUsd = formulaCostPerKg(formula, presentationKg, 'LAST', exchangeRate);
    let replacementPerKgUsd = formulaReplacementCostPerKg(formula, presentationKg, exchangeRate);

    if (!isBulk && formula.appliesToUom === 'SAC' && !hasEmpaq && packaging) {
      const lastPackUsd = this.packagingUnitCost(packaging, 'LAST', exchangeRate);
      const replacementPackUsd = this.packagingReplacementCost(packaging, exchangeRate);
      const sackKg = presentationKg ?? 0;
      if (costPerKgUsd !== null && lastPackUsd !== null && sackKg > 1) {
        costPerKgUsd = round(costPerKgUsd + (lastPackUsd * packaging.qtyPerUnit) / sackKg, 6);
      }
      if (replacementPerKgUsd !== null && replacementPackUsd !== null && sackKg > 1) {
        replacementPerKgUsd = round(
          replacementPerKgUsd + (replacementPackUsd * packaging.qtyPerUnit) / sackKg,
          6,
        );
      }
    }

    const costPerSackUsd = isBulk ? null : sackCostFromKg(costPerKgUsd, presentationKg);
    const replacementPerSackUsd = isBulk ? null : sackCostFromKg(replacementPerKgUsd, presentationKg);

    return {
      id: formula.id,
      kind: formula.kind,
      name: formula.name,
      isStandard: formula.isStandard,
      batchKg: formula.batchKg,
      outputQty: formula.outputQty,
      outputUom: formula.outputUom,
      presentationKg,
      isBulk,
      costPerKg: canViewCosts ? displayCost(costPerKgUsd, currency, exchangeRate) : null,
      costPerSack: canViewCosts ? displayCost(costPerSackUsd, currency, exchangeRate) : null,
      replacementCostPerKg: canViewCosts
        ? displayCost(replacementPerKgUsd, currency, exchangeRate)
        : null,
      replacementCostPerSack: canViewCosts
        ? displayCost(replacementPerSackUsd, currency, exchangeRate)
        : null,
      missingReplacement: formulaMissingReplacement(formula, exchangeRate).length,
      updatedAt: formula.updatedAt,
    };
  }

  private packagingUnitCost(
    packaging: PackagingInfo,
    basis: ProductionCostBasis,
    exchangeRate: number | null,
  ): number | null {
    const usd = basis === 'AVG' ? packaging.avgCostUsd : packaging.lastCostUsd;
    if (usd !== null && Number.isFinite(usd) && usd > 0) return usd;
    const bs = basis === 'AVG' ? packaging.avgCost : packaging.lastCost;
    if (bs !== null && Number.isFinite(bs) && bs > 0 && exchangeRate !== null && exchangeRate > 0) {
      return bs / exchangeRate;
    }
    return null;
  }

  /** Empaque con reposición de Profit y fallback al último costo. */
  private packagingReplacementCost(packaging: PackagingInfo, exchangeRate: number | null): number | null {
    const cost = packaging.replacementCost;
    if (cost !== null && Number.isFinite(cost) && cost > 0 && exchangeRate !== null && exchangeRate > 0) {
      return cost / exchangeRate;
    }
    return this.packagingUnitCost(packaging, 'LAST', exchangeRate);
  }

  private safetyFor(
    policy: { method: string; value: Prisma.Decimal } | undefined,
    demandKg: number,
    days: number,
  ): number {
    if (!policy) return 0;
    const value = numOrZero(policy.value);
    if (value <= 0) return 0;
    if (policy.method === 'PERCENT') return round((demandKg * value) / 100);
    if (policy.method === 'DAYS') return round((demandKg / Math.max(1, days)) * value);
    return round(value);
  }

  private scenarioFromRow(row: {
    id: string;
    name: string;
    year: number;
    month: number;
    week: number;
    policy: string;
    currency: string;
    createdAt: Date;
    createdByCode: string | null;
    totalsJson: string | null;
  }): ProductionScenario {
    let totals: Record<string, number | null> = {};
    if (row.totalsJson) {
      try {
        const parsed = JSON.parse(row.totalsJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          totals = parsed as Record<string, number | null>;
        }
      } catch {
        totals = {};
      }
    }
    return {
      id: row.id,
      name: row.name,
      year: row.year,
      month: row.month,
      week: row.week,
      policy: row.policy as ProductionPolicy,
      currency: row.currency as 'BS' | 'USD',
      createdAt: row.createdAt.toISOString(),
      createdByCode: row.createdByCode,
      totals,
    };
  }

  private extractTotals(payload: unknown): Record<string, number | null> {
    if (!payload || typeof payload !== 'object') return {};
    const totals = (payload as { totals?: unknown }).totals;
    if (!totals || typeof totals !== 'object' || Array.isArray(totals)) return {};
    const result: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(totals as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      else if (value === null) result[key] = null;
    }
    return result;
  }
}

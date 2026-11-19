import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ProductionCurrencyQuery,
  ProductionFormulaDetailResponse,
  ProductionFormulaListResponse,
  ProductionFormulaPreference,
  ProductionNutritionCatalogResponse,
  ProductionNutritionQuery,
  ProductionNutritionUpdate,
  ProductionOrdersQuery,
  ProductionOrdersResponse,
  ProductionPackagingUpdate,
  ProductionPlanResponse,
  ProductionQuery,
  ProductionScenario,
  ProductionScenarioCreate,
  ProductionSimulation,
  ProductionSimulationResponse,
  ProductionSpecUpdate,
  ProductionExplosionResponse,
  zProductionCurrencyQuery,
  zProductionFormulaPreference,
  zProductionNutritionQuery,
  zProductionNutritionUpdate,
  zProductionOrdersQuery,
  zProductionPackagingUpdate,
  zProductionQuery,
  zProductionScenarioCreate,
  zProductionSimulation,
  zProductionSpecUpdate,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ProductionActor, ProductionService } from './production.service';

// Producción: plan semanal/mensual, explosión de materiales, fórmulas,
// nutrición y escenarios. Profit se lee en vivo y NUNCA se escribe.
@ApiTags('production')
@ApiBearerAuth()
@Controller('production')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  private actor(request: AuthenticatedRequest): ProductionActor {
    return {
      id: request.access?.userId ?? request.user?.sub,
      code: request.user?.code,
    };
  }

  @Get('plan')
  @RequirePermission('produccion:read')
  plan(
    @Query(new ZodValidationPipe(zProductionQuery)) query: ProductionQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionPlanResponse> {
    return this.production.plan(query, request.access?.permissions ?? []);
  }

  @Get('explosion')
  @RequirePermission('produccion:read')
  explosion(
    @Query(new ZodValidationPipe(zProductionQuery)) query: ProductionQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionExplosionResponse> {
    return this.production.explosion(query, request.access?.permissions ?? []);
  }

  @Get('orders')
  @RequirePermission('produccion:read')
  orders(
    @Query(new ZodValidationPipe(zProductionOrdersQuery)) query: ProductionOrdersQuery,
  ): Promise<ProductionOrdersResponse> {
    return this.production.orders(query);
  }

  @Post('simulate')
  @RequirePermission('produccion:read')
  simulate(
    @Body(new ZodValidationPipe(zProductionSimulation)) dto: ProductionSimulation,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionSimulationResponse> {
    return this.production.simulate(dto, request.access?.permissions ?? []);
  }

  @Get('formulas')
  @RequirePermission('produccion:read')
  formulas(
    @Query(new ZodValidationPipe(zProductionCurrencyQuery)) query: ProductionCurrencyQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionFormulaListResponse> {
    return this.production.formulas(query.currency, request.access?.permissions ?? []);
  }

  @Get('formulas/:code')
  @RequirePermission('produccion:read')
  formulaDetail(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zProductionCurrencyQuery)) query: ProductionCurrencyQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionFormulaDetailResponse> {
    return this.production.formulaDetail(code, request.access?.permissions ?? [], query.currency);
  }

  @Put('formulas/:code/preference')
  @RequirePermission('produccion:update')
  setFormulaPreference(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(zProductionFormulaPreference)) dto: ProductionFormulaPreference,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.setFormulaPreference(code, dto.formulaId, this.actor(request));
  }

  @Put('packaging/:product')
  @RequirePermission('produccion:update')
  setPackagingRule(
    @Param('product') product: string,
    @Body(new ZodValidationPipe(zProductionPackagingUpdate)) dto: ProductionPackagingUpdate,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.setPackagingRule(product, dto, this.actor(request));
  }

  @Get('formulas/:code/nutrition')
  @RequirePermission('produccion:read')
  nutrition(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zProductionNutritionQuery)) query: ProductionNutritionQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionNutritionCatalogResponse> {
    return this.production.nutritionCatalog(code, request.access?.permissions ?? [], query.currency, query.formulaId);
  }

  @Put('nutrition/ingredients/:code')
  @RequirePermission('produccion:nutrition')
  updateIngredientNutrition(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(zProductionNutritionUpdate)) dto: ProductionNutritionUpdate,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.updateIngredientNutrition(code, dto, this.actor(request));
  }

  @Put('nutrition/specs/:product')
  @RequirePermission('produccion:nutrition')
  updateProductSpecs(
    @Param('product') product: string,
    @Body(new ZodValidationPipe(zProductionSpecUpdate)) dto: ProductionSpecUpdate,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.production.updateProductSpecs(product, dto, this.actor(request));
  }

  @Get('scenarios')
  @RequirePermission('produccion:read')
  listScenarios(): Promise<ProductionScenario[]> {
    return this.production.listScenarios();
  }

  @Post('scenarios')
  @RequirePermission('produccion:update')
  createScenario(
    @Body(new ZodValidationPipe(zProductionScenarioCreate)) dto: ProductionScenarioCreate,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductionScenario> {
    return this.production.createScenario(dto, this.actor(request));
  }

  @Delete('scenarios/:id')
  @RequirePermission('produccion:update')
  deleteScenario(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.production.deleteScenario(id, this.actor(request));
  }

  @Post('refresh')
  @RequirePermission('produccion:update')
  refresh() {
    this.production.refresh();
    return { ok: true };
  }
}

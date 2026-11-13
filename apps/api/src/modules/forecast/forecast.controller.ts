import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ForecastQuery,
  ForecastSalesDayQuery,
  ForecastSalesQuery,
  ForecastSellersQuery,
  ForecastSetWeeks,
  zForecastQuery,
  zForecastSalesDayQuery,
  zForecastSalesQuery,
  zForecastSellersQuery,
  zForecastSetWeeks,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ForecastService } from './forecast.service';
import { SellersService } from './sellers.service';

// Forecast (pronóstico de producción): el mensual se lee de Profit (solo lectura)
// y en Nexo solo se capturan las cantidades por semana. Nunca escribe en Profit.
@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ForecastController {
  constructor(
    private readonly forecast: ForecastService,
    private readonly sellers: SellersService,
  ) {}

  // Desglose por producto de un vendedor: cartera, firmado por él y firmado
  // por otros. Se pide al abrir la pestaña Productos del expediente.
  @Get('sellers/:sellerCode/products')
  @RequirePermission('vendedor:read')
  sellerProducts(
    @Param('sellerCode') sellerCode: string,
    @Query(new ZodValidationPipe(zForecastSellersQuery)) query: ForecastSellersQuery,
  ) {
    return this.sellers.sellerProducts(sellerCode, query);
  }

  // Vendedor vs Forecast: misma meta que «Ventas vs Forecast», repartida por
  // participación histórica. El criterio por defecto es la cartera asignada en
  // Profit; `attribution=NOTE` conserva la lectura por nota de entrega. El
  // permiso es del módulo `vendedor`, no del forecast de producción.
  @Get('sellers')
  @RequirePermission('vendedor:read')
  sellersReport(@Query(new ZodValidationPipe(zForecastSellersQuery)) query: ForecastSellersQuery) {
    return this.sellers.sellersReport(query);
  }

  @Get('plan')
  @RequirePermission('forecast:read')
  plan(@Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery) {
    return this.forecast.plan(query.year, query.month);
  }

  // Desviación por cliente: reparte la meta de cada producto entre los
  // clientes con historial de compra. Solo lectura.
  @Get('sales/customers')
  @RequirePermission('forecast:read')
  customerSales(@Query(new ZodValidationPipe(zForecastSalesQuery)) query: ForecastSalesQuery) {
    return this.forecast.customerSalesReport(query);
  }

  // Detalle de un día (modal «Desglose del día»): productos y clientes con
  // cantidades y participación sobre el total del día. Se pide solo al abrir
  // el modal, no en la carga del informe mensual.
  @Get('sales/day')
  @RequirePermission('forecast:read')
  salesDay(@Query(new ZodValidationPipe(zForecastSalesDayQuery)) query: ForecastSalesDayQuery) {
    return this.forecast.salesDayDetail(query.date);
  }

  // Ventas reales vs forecast: facturación de Profit (solo lectura) contra la
  // meta mensual, con proyección de cierre por días hábiles.
  @Get('sales')
  @RequirePermission('forecast:read')
  sales(@Query(new ZodValidationPipe(zForecastSalesQuery)) query: ForecastSalesQuery) {
    return this.forecast.salesReport(query);
  }

  // Fuerza el snapshot de la meta del mes en curso (por si el scheduler está
  // desactivado). Solo escribe en la BD local, nunca en Profit.
  @Post('sales/capture')
  @RequirePermission('forecast:update')
  captureSalesTarget() {
    return this.forecast.captureForecastTargets();
  }

  // Acepta un cambio de Profit sobre una meta ya congelada. Solo mes en curso
  // y con permiso de edición; queda registrado en la bitácora.
  @Post('targets/:code/accept')
  @RequirePermission('forecast:update')
  acceptTarget(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery,
  ) {
    return this.forecast.acceptTargetDrift(query.year, query.month, code);
  }

  @Get()
  @RequirePermission('forecast:read')
  list(@Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery) {
    return this.forecast.list(query.year, query.month);
  }

  @Patch(':code/weeks')
  @RequirePermission('forecast:update')
  setWeeks(@Param('code') code: string, @Body(new ZodValidationPipe(zForecastSetWeeks)) dto: ForecastSetWeeks) {
    return this.forecast.setWeeks(code, dto);
  }
}

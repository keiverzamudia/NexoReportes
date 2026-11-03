import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ForecastQuery,
  ForecastSalesQuery,
  ForecastSetWeeks,
  zForecastQuery,
  zForecastSalesQuery,
  zForecastSetWeeks,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ForecastService } from './forecast.service';

// Forecast (pronóstico de producción): el mensual se lee de Profit (solo lectura)
// y en Nexo solo se capturan las cantidades por semana. Nunca escribe en Profit.
@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  @Get('plan')
  @RequirePermission('forecast:read')
  plan(@Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery) {
    return this.forecast.plan(query.year, query.month);
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

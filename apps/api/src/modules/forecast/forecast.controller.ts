import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ForecastQuery,
  ForecastSetWeeks,
  zForecastQuery,
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

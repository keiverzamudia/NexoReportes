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
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ForecastService } from './forecast.service';

// Forecast (pronóstico de producción): el mensual se lee de Profit (solo lectura)
// y en Nexo solo se capturan las cantidades por semana. Nunca escribe en Profit.
@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  @Get('plan')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  plan(@Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery) {
    return this.forecast.plan(query.year, query.month);
  }

  @Get()
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  list(@Query(new ZodValidationPipe(zForecastQuery)) query: ForecastQuery) {
    return this.forecast.list(query.year, query.month);
  }

  @Patch(':code/weeks')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN')
  setWeeks(@Param('code') code: string, @Body(new ZodValidationPipe(zForecastSetWeeks)) dto: ForecastSetWeeks) {
    return this.forecast.setWeeks(code, dto);
  }
}

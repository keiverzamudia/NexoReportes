import { Body, Controller, Get, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrivalCheckInInput,
  ArrivalCloseInput,
  ArrivalEditInput,
  ArrivalIncidentInput,
  ArrivalIncidentResolveInput,
  ArrivalMessageInput,
  ArrivalQuery,
  zArrivalCheckInInput,
  zArrivalCloseInput,
  zArrivalEditInput,
  zArrivalIncidentInput,
  zArrivalIncidentResolveInput,
  zArrivalMessageInput,
  zArrivalQuery,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ArrivalsService, ArrivalViewer } from './arrivals.service';

// ============================================================
// Llegadas de clientes (PCP).
//
// Las crea el despacho al publicarse; aquí PCP marca la llegada, reporta
// incidencias y cierra la atención. Corregir un registro ya hecho exige
// «Corregir registros» (jefe de PCP / administrador) y motivo.
// ============================================================
@ApiTags('arrivals')
@ApiBearerAuth()
@Controller('arrivals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ArrivalsController {
  constructor(private readonly arrivals: ArrivalsService) {}

  @Get()
  @RequirePermission('llegadas:read')
  @ApiOperation({ summary: 'Clientes esperados en planta (bandeja de PCP)' })
  list(@Query(new ZodValidationPipe(zArrivalQuery)) query: ArrivalQuery, @Req() request: AuthenticatedRequest) {
    return this.arrivals.list(this.viewer(request), query);
  }

  @Get(':id')
  @RequirePermission('llegadas:read')
  @ApiOperation({ summary: 'Detalle con incidencias y bitácora' })
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.arrivals.detail(this.viewer(request), id);
  }

  @Post(':id/check-in')
  @RequirePermission('llegadas:create')
  @ApiOperation({ summary: 'Marca la llegada del cliente (hora del servidor)' })
  checkIn(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalCheckInInput)) body: ArrivalCheckInInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.checkIn(this.viewer(request), id, body);
  }

  @Post(':id/close')
  @RequirePermission('llegadas:update')
  @ApiOperation({ summary: 'Cierra la atención: atendido o no presentado' })
  close(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalCloseInput)) body: ArrivalCloseInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.close(this.viewer(request), id, body);
  }

  @Patch(':id')
  @RequirePermission('llegadas:delete')
  @ApiOperation({ summary: 'Corrige un registro ya hecho (exige motivo y deja rastro)' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalEditInput)) body: ArrivalEditInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.update(this.viewer(request), id, body);
  }

  @Post(':id/incidents')
  @RequirePermission('llegadas:create')
  @ApiOperation({ summary: 'Reporta una incidencia del cliente' })
  addIncident(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalIncidentInput)) body: ArrivalIncidentInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.addIncident(this.viewer(request), id, body);
  }

  @Patch(':id/incidents/:incidentId')
  @RequirePermission('llegadas:update')
  @ApiOperation({ summary: 'Resuelve una incidencia con su explicación' })
  resolveIncident(
    @Param('id') id: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(zArrivalIncidentResolveInput)) body: ArrivalIncidentResolveInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.resolveIncident(this.viewer(request), id, incidentId, body);
  }

  @Post(':id/messages')
  @RequirePermission('llegadas:read')
  @ApiOperation({ summary: 'Nota libre en la bitácora del cliente' })
  message(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalMessageInput)) body: ArrivalMessageInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arrivals.message(this.viewer(request), id, body);
  }

  private viewer(request: AuthenticatedRequest): ArrivalViewer {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return {
      id,
      code: request.user?.code ?? null,
      permissions: request.access?.permissions ?? [],
    };
  }
}

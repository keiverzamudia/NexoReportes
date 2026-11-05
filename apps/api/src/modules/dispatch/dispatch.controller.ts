import { Body, Controller, Get, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DispatchCancelInput,
  DispatchCompleteInput,
  DispatchCustomerInvoiceInput,
  DispatchCustomerKeyInput,
  DispatchCustomerReopenInput,
  DispatchInvoiceInput,
  DispatchLineInput,
  DispatchMessageInput,
  DispatchMetricsQuery,
  DispatchReopenInvoiceInput,
  DispatchSheetCreateInput,
  DispatchSheetQuery,
  NotificationQuery,
  NotificationReadInput,
  zDispatchCancelInput,
  zDispatchCompleteInput,
  zDispatchCustomerInvoiceInput,
  zDispatchCustomerKeyInput,
  zDispatchCustomerReopenInput,
  zDispatchInvoiceInput,
  zDispatchLineInput,
  zDispatchMessageInput,
  zDispatchMetricsQuery,
  zDispatchReopenInvoiceInput,
  zDispatchSheetCreateInput,
  zDispatchSheetQuery,
  zNotificationQuery,
  zNotificationReadInput,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { DispatchService, DispatchViewer } from './dispatch.service';

// ============================================================
// Despacho de almacén (Fase 6b).
//   · Planificación publica desde un escenario guardado.
//   · Almacén recibe, carga y cierra; cada paso notifica al planificador.
// El servidor resuelve los permisos (`canOperate`/`canCancel`) para que el web
// no duplique reglas de negocio.
// ============================================================
@ApiTags('dispatch')
@ApiBearerAuth()
@Controller('dispatch-sheets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @RequirePermission('despacho:read')
  @ApiOperation({ summary: 'Bandeja de despachos visible para el usuario' })
  list(
    @Query(new ZodValidationPipe(zDispatchSheetQuery)) query: DispatchSheetQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.list(this.viewer(request), query);
  }

  // Antes de ':id' para que no lo capture el parámetro.
  @Get('assignees')
  @RequirePermission('despacho:create')
  @ApiOperation({ summary: 'Operadores de almacén a los que se puede asignar' })
  assignees() {
    return this.dispatch.assignees();
  }

  @Post()
  @RequirePermission('despacho:create')
  @ApiOperation({ summary: 'Publica un despacho desde un escenario guardado' })
  create(
    @Body(new ZodValidationPipe(zDispatchSheetCreateInput)) body: DispatchSheetCreateInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.create(this.viewer(request), body);
  }

  // Antes de ':id' para que no lo capture el parámetro.
  @Get('metrics')
  @RequirePermission('despacho:read')
  @ApiOperation({ summary: 'Tiempos de carga y facturación por día/mes/cliente' })
  metrics(
    @Query(new ZodValidationPipe(zDispatchMetricsQuery)) query: DispatchMetricsQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.metrics(this.viewer(request), query);
  }

  @Get(':id')
  @RequirePermission('despacho:read')
  @ApiOperation({ summary: 'Detalle con renglones y bitácora' })
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.dispatch.detail(this.viewer(request), id);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Resuelve un renglón: cargado, parcial o no cargado' })
  updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(zDispatchLineInput)) body: DispatchLineInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.updateLine(this.viewer(request), id, lineId, body);
  }

  @Post(':id/customers/start')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Inicia la carga de un cliente y arranca sus relojes' })
  startLoad(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchCustomerKeyInput)) body: DispatchCustomerKeyInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.startLoad(this.viewer(request), id, body);
  }

  @Post(':id/customers/invoice')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Marca la factura entregada de un cliente' })
  deliverInvoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchCustomerInvoiceInput)) body: DispatchCustomerInvoiceInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.deliverInvoice(this.viewer(request), id, body);
  }

  @Post(':id/customers/reopen-invoice')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Reabre una factura entregada (solo administración)' })
  reopenInvoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchCustomerReopenInput)) body: DispatchCustomerReopenInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.reopenInvoice(this.viewer(request), id, body);
  }

  @Post(':id/invoice')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Marca la factura entregada de todos los clientes pendientes' })
  deliverAllInvoices(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchInvoiceInput)) body: DispatchInvoiceInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.deliverAllInvoices(this.viewer(request), id, body);
  }

  @Post(':id/complete')
  @RequirePermission('despacho:update')
  @ApiOperation({ summary: 'Cierra el despacho con los totales reales' })
  complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchCompleteInput)) body: DispatchCompleteInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.complete(this.viewer(request), id, body);
  }

  @Post(':id/cancel')
  @RequirePermission('despacho:delete')
  @ApiOperation({ summary: 'Anula el despacho con motivo' })
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchCancelInput)) body: DispatchCancelInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.cancel(this.viewer(request), id, body);
  }

  @Post(':id/messages')
  @RequirePermission('despacho:read')
  @ApiOperation({ summary: 'Mensaje libre en la bitácora (avisa a la contraparte)' })
  message(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zDispatchMessageInput)) body: DispatchMessageInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.message(this.viewer(request), id, body);
  }

  private viewer(request: AuthenticatedRequest): DispatchViewer {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    // La plantilla del rol conserva la semántica del despacho (bandeja,
    // reclamo y propiedad); la matriz de permisos gobierna el acceso.
    return {
      id,
      role: request.access?.baseRole ?? 'CONSULTA',
      isAdmin: request.access?.isAdmin ?? false,
      canPublish: request.access?.permissions.includes('despacho:create') ?? false,
      canViewAll: request.access?.permissions.includes('despacho:view_all') ?? false,
      canUpdate: request.access?.permissions.includes('despacho:update') ?? false,
      canDelete: request.access?.permissions.includes('despacho:delete') ?? false,
      code: request.user?.code ?? null,
    };
  }
}

// Notificaciones del usuario: campana del shell y acuses del túnel. No se
// gatean por módulo: cualquier sesión autenticada ve las suyas.
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @ApiOperation({ summary: 'Notificaciones del usuario (con contador de no leídas)' })
  list(
    @Query(new ZodValidationPipe(zNotificationQuery)) query: NotificationQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.listNotifications(this.viewer(request), query.limit);
  }

  @Post('read')
  @ApiOperation({ summary: 'Marca notificaciones como leídas (ids o todas)' })
  markRead(
    @Body(new ZodValidationPipe(zNotificationReadInput)) body: NotificationReadInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dispatch.markNotificationsRead(this.viewer(request), body);
  }

  private viewer(request: AuthenticatedRequest): DispatchViewer {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return {
      id,
      role: request.access?.baseRole ?? 'CONSULTA',
      isAdmin: request.access?.isAdmin ?? false,
      canPublish: request.access?.permissions.includes('despacho:create') ?? false,
      canViewAll: request.access?.permissions.includes('despacho:view_all') ?? false,
      canUpdate: request.access?.permissions.includes('despacho:update') ?? false,
      canDelete: request.access?.permissions.includes('despacho:delete') ?? false,
      code: request.user?.code ?? null,
    };
  }
}

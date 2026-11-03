import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DraftReleaseInput,
  ScenarioDraftInput,
  ScenarioLockInput,
  ScenarioRestoreInput,
  ScenarioSaveInput,
  ScenarioSendDispatchInput,
  ScenarioUpdateInput,
  zDraftReleaseInput,
  zScenarioDraftInput,
  zScenarioLockInput,
  zScenarioRestoreInput,
  zScenarioSaveInput,
  zScenarioSendDispatchInput,
  zScenarioUpdateInput,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyPermission, RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { DispatchService, DispatchViewer } from '../dispatch/dispatch.service';
import { ScenariosService } from './scenarios.service';

// Simulador de despacho: plan GLOBAL del equipo + escenarios guardados.
// Solo persiste receta + foto; nunca escribe en Profit.
@ApiTags('scenarios')
@ApiBearerAuth()
@Controller('scenarios')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ScenariosController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly dispatch: DispatchService,
  ) {}

  @Get()
  @RequirePermission('pedidos:read')
  list(@Req() request: AuthenticatedRequest) {
    return this.scenarios.list(this.viewerOf(request));
  }

  // Rutas del borrador ANTES de ':id' para que no las capture el parámetro.
  @Get('draft')
  @RequirePermission('pedidos:read')
  getDraft(@Req() request: AuthenticatedRequest) {
    return this.scenarios.getDraft(this.viewerOf(request));
  }

  @Put('draft')
  @RequireAnyPermission('pedidos:create', 'pedidos:override')
  putDraft(
    @Body(new ZodValidationPipe(zScenarioDraftInput)) body: ScenarioDraftInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.saveDraft(this.actorOf(request), body, this.viewerOf(request));
  }

  // Liberar selecciones (las mías, unas concretas o todo con `override`).
  @Delete('draft/lines')
  @RequireAnyPermission('pedidos:create', 'pedidos:override')
  releaseLines(
    @Body(new ZodValidationPipe(zDraftReleaseInput)) body: DraftReleaseInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.releaseDraftLines(this.actorOf(request), body, this.viewerOf(request));
  }

  // Enviar la simulación VIVA al almacén. Debe ir antes de ':id/send-dispatch'
  // para que Nest no la capture como un id.
  @Post('draft/send-dispatch')
  @RequirePermission('despacho:create')
  sendDraftToDispatch(
    @Body(new ZodValidationPipe(zScenarioSendDispatchInput)) body: ScenarioSendDispatchInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.sendDraftToDispatch(
      this.viewerOf(request),
      this.actorOf(request),
      this.dispatchViewerOf(request),
      body,
    );
  }

  // El lock es lo que permite que el plan sea global sin que dos personas se
  // pisen: solo el titular autoguarda; el resto puede «tomar control».
  @Post('draft/lock')
  @RequirePermission('pedidos:create')
  acquireLock(
    @Body(new ZodValidationPipe(zScenarioLockInput)) body: ScenarioLockInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.acquireLock(this.actorOf(request), this.viewerOf(request), body);
  }

  @Delete('draft/lock')
  @RequirePermission('pedidos:create')
  releaseLock(@Req() request: AuthenticatedRequest) {
    return this.scenarios.releaseLock(this.actorOf(request));
  }

  @Post()
  @RequirePermission('pedidos:create')
  create(
    @Body(new ZodValidationPipe(zScenarioSaveInput)) body: ScenarioSaveInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.create(this.viewerOf(request), body, this.actorOf(request));
  }

  // Enviar una simulación guardada al almacén. Es el permiso «Armar y enviar
  // simulación» de Despacho; no basta con guardar simulaciones en Pedidos.
  @Post(':id/send-dispatch')
  @RequirePermission('despacho:create')
  async sendToDispatch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScenarioSendDispatchInput)) body: ScenarioSendDispatchInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const scenario = await this.scenarios.detail(this.viewerOf(request), id);
    if (!scenario.canRestore) {
      throw new ForbiddenException('Solo quien creó la simulación o un administrador puede enviarla a despacho.');
    }
    return this.dispatch.create(this.dispatchViewerOf(request), {
      scenarioId: scenario.id,
      title: body.title?.trim() || scenario.name,
      instructions: body.instructions,
      assignedToId: body.assignedToId ?? null,
    });
  }

  @Get(':id')
  @RequirePermission('pedidos:read')
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.scenarios.detail(this.viewerOf(request), id);
  }

  @Patch(':id')
  @RequirePermission('pedidos:update')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScenarioUpdateInput)) body: ScenarioUpdateInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.update(this.viewerOf(request), id, body, this.actorOf(request));
  }

  @Delete(':id')
  @RequirePermission('pedidos:delete')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.scenarios.remove(this.viewerOf(request), id, this.actorOf(request));
  }

  @Post(':id/restore')
  @RequirePermission('pedidos:update')
  restore(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScenarioRestoreInput)) body: ScenarioRestoreInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.markRestored(this.viewerOf(request), id, body, this.actorOf(request));
  }

  private viewerOf(request: AuthenticatedRequest) {
    return {
      id: this.requireUser(request),
      isAdmin: request.access?.isAdmin ?? false,
      canOverride: request.access?.permissions.includes('pedidos:override') ?? false,
    };
  }

  private requireUser(request: AuthenticatedRequest): string {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return id;
  }

  private actorOf(request: AuthenticatedRequest) {
    return { id: request.user?.sub ?? null, code: request.user?.code ?? null };
  }

  private dispatchViewerOf(request: AuthenticatedRequest): DispatchViewer {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return {
      id,
      role: request.access?.baseRole ?? 'CONSULTA',
      isAdmin: request.access?.isAdmin ?? false,
      canPublish: request.access?.permissions.includes('despacho:create') ?? false,
      canViewAll: request.access?.permissions.includes('despacho:view_all') ?? false,
      code: request.user?.code ?? null,
    };
  }
}

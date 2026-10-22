import {
  Body,
  Controller,
  Delete,
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
  ScenarioDraftInput,
  ScenarioRestoreInput,
  ScenarioSaveInput,
  ScenarioUpdateInput,
  zScenarioDraftInput,
  zScenarioRestoreInput,
  zScenarioSaveInput,
  zScenarioUpdateInput,
} from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ScenariosService } from './scenarios.service';

// Simulador de despacho (Fase 6): escenarios guardados por usuario.
// Solo persiste receta + foto; nunca escribe en Profit.
@ApiTags('scenarios')
@ApiBearerAuth()
@Controller('scenarios')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @RequirePermission('pedidos:read')
  list(@Req() request: AuthenticatedRequest) {
    return this.scenarios.list(this.ownerOf(request));
  }

  // Rutas del borrador ANTES de ':id' para que no las capture el parámetro.
  @Get('draft')
  @RequirePermission('pedidos:read')
  getDraft(@Req() request: AuthenticatedRequest) {
    return this.scenarios.getDraft(this.ownerOf(request));
  }

  @Put('draft')
  @RequirePermission('pedidos:create')
  putDraft(
    @Body(new ZodValidationPipe(zScenarioDraftInput)) body: ScenarioDraftInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.saveDraft(this.ownerOf(request), body);
  }

  @Post()
  @RequirePermission('pedidos:create')
  create(
    @Body(new ZodValidationPipe(zScenarioSaveInput)) body: ScenarioSaveInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.create(this.ownerOf(request), body, this.actorOf(request));
  }

  @Get(':id')
  @RequirePermission('pedidos:read')
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.scenarios.detail(this.ownerOf(request), id);
  }

  @Patch(':id')
  @RequirePermission('pedidos:update')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScenarioUpdateInput)) body: ScenarioUpdateInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.update(this.ownerOf(request), id, body, this.actorOf(request));
  }

  @Delete(':id')
  @RequirePermission('pedidos:delete')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.scenarios.remove(this.ownerOf(request), id, this.actorOf(request));
  }

  @Post(':id/restore')
  @RequirePermission('pedidos:update')
  restore(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScenarioRestoreInput)) body: ScenarioRestoreInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.scenarios.markRestored(this.ownerOf(request), id, body, this.actorOf(request));
  }

  private ownerOf(request: AuthenticatedRequest): string {
    const ownerId = request.user?.sub;
    if (!ownerId) throw new UnauthorizedException('Sesión requerida');
    return ownerId;
  }

  private actorOf(request: AuthenticatedRequest) {
    return { id: request.user?.sub ?? null, code: request.user?.code ?? null };
  }
}

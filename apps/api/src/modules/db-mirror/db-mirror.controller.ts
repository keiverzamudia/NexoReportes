import { Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DbMirrorRestoreResult, DbMirrorStatus } from '@nexo/contracts';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { DbMirrorService } from './db-mirror.service';

// ============================================================
// Endpoints de desarrollo para el espejo de la BD (main → pruebas).
// Solo existen si DB_MIRROR_ENABLED=1 y NODE_ENV != production.
// Además del permiso de administración, se exige `isAdmin` explícito.
// ============================================================
@ApiTags('dev')
@ApiBearerAuth()
@Controller('dev/db-mirror')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DbMirrorController {
  constructor(private readonly mirror: DbMirrorService) {}

  @Get()
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Estado del espejo de la BD local (solo desarrollo)' })
  status(@Req() request: AuthenticatedRequest): Promise<DbMirrorStatus> {
    this.assertAdmin(request);
    return this.mirror.status();
  }

  @Post('restore')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Restaura la BD local desde el worktree main (solo desarrollo)' })
  restore(@Req() request: AuthenticatedRequest): Promise<DbMirrorRestoreResult> {
    this.assertAdmin(request);
    return this.mirror.restore(request.user?.code ?? null);
  }

  private assertAdmin(request: AuthenticatedRequest): void {
    if (!request.access?.isAdmin) {
      throw new ForbiddenException('Solo un administrador puede restaurar la base de datos.');
    }
  }
}

import { Controller, ForbiddenException, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditQuery, zAuditQuery } from '@nexo/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { AuditService } from './audit.service';

// ============================================================
// Bitácora (Usuarios → Bitácoras).
//
// Solo administradores: además del permiso `auditoria:read` se exige la
// plantilla ADMIN. Es el registro de «quién cambió qué, cuándo y desde
// dónde»; no se expone a gerencia ni a otros roles.
// ============================================================
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('export')
  @RequirePermission('auditoria:read')
  @ApiOperation({ summary: 'Exporta la bitácora filtrada a CSV' })
  async export(
    @Query(new ZodValidationPipe(zAuditQuery)) query: AuditQuery,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    this.assertAdmin(request);
    const csv = await this.audit.exportCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="bitacora-${stamp}.csv"`);
    // BOM: Excel abre el archivo en UTF-8 con tildes correctas.
    response.send(`\ufeff${csv}`);
  }

  @Get()
  @RequirePermission('auditoria:read')
  @ApiOperation({ summary: 'Bitácora unificada con filtros, facetas y métricas' })
  list(@Query(new ZodValidationPipe(zAuditQuery)) query: AuditQuery, @Req() request: AuthenticatedRequest) {
    this.assertAdmin(request);
    return this.audit.feed(query);
  }

  private assertAdmin(request: AuthenticatedRequest): void {
    if (!request.access?.isAdmin) {
      throw new ForbiddenException('La bitácora es solo para administradores.');
    }
  }
}

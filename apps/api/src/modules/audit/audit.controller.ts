import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { zPaginationQuery } from '@nexo/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { AuditService } from './audit.service';

const zAuditQuery = zPaginationQuery.extend({
  entityType: z.string().min(1).optional(),
});

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('auditoria:read')
  list(@Query(new ZodValidationPipe(zAuditQuery)) query: { page: number; pageSize: number; entityType?: string }) {
    return this.audit.list(query);
  }
}

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SYNC_DOMAINS, zPaginationQuery } from '@nexo/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { SyncService } from './sync.service';

const zDomain = z.object({ domain: z.enum(SYNC_DOMAINS) });

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  // La frescura del dato la ve cualquier sesión (chip del shell).
  @Get('status')
  status() {
    return this.sync.status();
  }

  @Get('views')
  @RequirePermission('sincronizacion:update')
  views() {
    return this.sync.views();
  }

  @Get('describe')
  @RequirePermission('sincronizacion:update')
  describe() {
    return this.sync.describe();
  }

  @Post('test-connection')
  @RequirePermission('sincronizacion:update')
  testConnection() {
    return this.sync.testConnection();
  }

  @Post('run-all')
  @RequirePermission('sincronizacion:update')
  runAll(@Req() request: AuthenticatedRequest) {
    return this.sync.runAll({ id: request.user?.sub, email: request.user?.code });
  }

  @Post('run/:domain')
  @RequirePermission('sincronizacion:update')
  run(@Param(new ZodValidationPipe(zDomain)) params: { domain: (typeof SYNC_DOMAINS)[number] }, @Req() request: AuthenticatedRequest) {
    return this.sync.run(params.domain, { id: request.user?.sub, email: request.user?.code });
  }

  @Get('runs')
  @RequirePermission('sincronizacion:update')
  runs(@Query(new ZodValidationPipe(zPaginationQuery)) query: { page: number; pageSize: number }) {
    return this.sync.listRuns(query.page, query.pageSize);
  }
}

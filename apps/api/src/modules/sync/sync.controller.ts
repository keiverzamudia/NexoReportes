import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SYNC_DOMAINS, zPaginationQuery } from '@nexo/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SyncService } from './sync.service';

const zDomain = z.object({ domain: z.enum(SYNC_DOMAINS) });

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('status')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  status() {
    return this.sync.status();
  }

  @Get('views')
  @Roles('ADMIN', 'PLANIFICADOR')
  views() {
    return this.sync.views();
  }

  @Post('test-connection')
  @Roles('ADMIN', 'PLANIFICADOR')
  testConnection() {
    return this.sync.testConnection();
  }

  @Post('run/:domain')
  @Roles('ADMIN', 'PLANIFICADOR')
  run(@Param(new ZodValidationPipe(zDomain)) params: { domain: (typeof SYNC_DOMAINS)[number] }, @Req() request: AuthenticatedRequest) {
    return this.sync.run(params.domain, { id: request.user?.sub, email: request.user?.email });
  }

  @Get('runs')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR')
  runs(@Query(new ZodValidationPipe(zPaginationQuery)) query: { page: number; pageSize: number }) {
    return this.sync.listRuns(query.page, query.pageSize);
  }
}

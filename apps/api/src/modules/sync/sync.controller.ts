import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SyncService } from './sync.service';

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
}

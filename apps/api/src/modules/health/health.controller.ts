import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { ProfitAdapter, PROFIT_ADAPTER } from '../sync/profit.adapter';

const startedAt = Date.now();

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    let profitStatus: HealthResponse['profit'] = 'not_configured';
    if (this.profit.dialect === 'fixtures') {
      profitStatus = 'fixtures';
    } else {
      try {
        const result = await this.profit.testConnection();
        profitStatus = result.connected ? 'connected' : 'unreachable';
      } catch {
        profitStatus = 'unreachable';
      }
    }

    return {
      status: database === 'up' && profitStatus !== 'unreachable' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database,
      profit: profitStatus,
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}

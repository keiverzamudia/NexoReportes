import { Inject, Injectable } from '@nestjs/common';
import { SYNC_DOMAINS, SyncDomain, SyncRun, SyncStatusResponse } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { ProfitAdapter, PROFIT_ADAPTER } from './profit.adapter';

@Injectable()
export class SyncService {
  constructor(
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<SyncStatusResponse> {
    const lastRun = await this.prisma.syncRun.findFirst({
      where: { status: 'EXITOSA' },
      orderBy: { finishedAt: 'desc' },
    });

    const successfulDomains = new Set(
      (await this.prisma.syncRun.findMany({ where: { status: 'EXITOSA' }, select: { domain: true } })).map((r) => r.domain),
    );
    const pendingDomains = SYNC_DOMAINS.filter((domain) => !successfulDomains.has(domain));

    let connected = false;
    let message: string | null = null;
    if (this.profit.dialect === 'fixtures') {
      message = 'Modo fixtures: los datos mostrados en desarrollo no provienen de Profit.';
    }
    try {
      const test = await this.profit.testConnection();
      connected = test.connected;
      message = test.message ?? message;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Error desconocido';
    }

    return {
      dialect: this.profit.dialect,
      connected,
      lastSuccessfulRun: lastRun ? this.toSyncRun(lastRun) : null,
      pendingDomains,
      message,
    };
  }

  async views(): Promise<{ views: string[]; dialect: 'mssql' | 'fixtures' }> {
    const views = await this.profit.listViews();
    return { views, dialect: this.profit.dialect };
  }

  async testConnection() {
    const result = await this.profit.testConnection();
    await this.audit.record({
      action: 'SYNC_TEST_CONNECTION',
      entityType: 'SyncRun',
      context: { dialect: this.profit.dialect, connected: result.connected },
    });
    return { ...result, dialect: this.profit.dialect };
  }

  private toSyncRun(run: {
    id: string;
    domain: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    recordsRead: number;
    recordsUpserted: number;
    errorsCount: number;
    errorDetail: string | null;
    sourceRef: string | null;
  }): SyncRun {
    return {
      id: run.id,
      domain: run.domain as SyncDomain,
      status: run.status as SyncRun['status'],
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      recordsRead: run.recordsRead,
      recordsUpserted: run.recordsUpserted,
      errorsCount: run.errorsCount,
      errorDetail: run.errorDetail,
      sourceRef: run.sourceRef,
    };
  }
}

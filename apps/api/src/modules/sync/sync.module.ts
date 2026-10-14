import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { FixturesProfitAdapter } from './fixtures.adapter';
import { MssqlProfitAdapter } from './mssql.adapter';
import { PROFIT_ADAPTER } from './profit.adapter';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

// El proveedor del adaptador se elige según PROFIT_DB_DIALECT:
//  - 'mssql'    → conexión real de solo lectura a SQL Server (Profit)
//  - 'fixtures' → datos de desarrollo deterministas (nunca en producción)
const adapterFactory = {
  provide: PROFIT_ADAPTER,
  useFactory: (config: ConfigService) => {
    const dialect = config.get<string>('profit.dialect') ?? 'fixtures';
    return dialect === 'mssql' ? new MssqlProfitAdapter(config) : new FixturesProfitAdapter();
  },
  inject: [ConfigService],
};

@Module({
  imports: [AuditModule],
  controllers: [SyncController],
  providers: [SyncService, adapterFactory],
  exports: [PROFIT_ADAPTER, SyncService],
})
export class SyncModule {}

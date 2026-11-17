import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { FixturesProfitAdapter } from './fixtures.adapter';
import { FixturesProfitWriter } from './fixtures-profit-writer';
import { MssqlProfitAdapter } from './mssql.adapter';
import { MssqlProfitWriter } from './mssql-profit-writer';
import { PROFIT_ADAPTER } from './profit.adapter';
import { PROFIT_WRITER } from './profit-writer.adapter';
import { ProfitLockScheduler } from './profit-lock.scheduler';
import { ProfitLockService } from './profit-lock.service';
import { SyncController } from './sync.controller';
import { SyncScheduler } from './sync.scheduler';
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

// Escritura puntual: en fixtures siempre disponible (desarrollo/tests); en
// mssql depende del flag y de credenciales separadas de las de lectura.
const writerFactory = {
  provide: PROFIT_WRITER,
  useFactory: (config: ConfigService) => {
    const dialect = config.get<string>('profit.dialect') ?? 'fixtures';
    return dialect === 'mssql' ? new MssqlProfitWriter(config) : new FixturesProfitWriter();
  },
  inject: [ConfigService],
};

@Module({
  imports: [AuditModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler, ProfitLockScheduler, ProfitLockService, adapterFactory, writerFactory],
  exports: [PROFIT_ADAPTER, PROFIT_WRITER, SyncService, ProfitLockService],
})
export class SyncModule {}

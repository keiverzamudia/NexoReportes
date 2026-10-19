import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { ProfitUserSyncScheduler } from './profit-user-sync.scheduler';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // SyncModule presta el adaptador de Profit (mssql o fixtures según el entorno).
  imports: [AuditModule, SyncModule],
  controllers: [UsersController],
  providers: [UsersService, ProfitUserSyncScheduler],
  exports: [UsersService],
})
export class UsersModule {}

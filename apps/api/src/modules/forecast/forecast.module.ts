import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';

@Module({
  imports: [AuditModule, SyncModule],
  controllers: [ForecastController],
  providers: [ForecastService],
})
export class ForecastModule {}

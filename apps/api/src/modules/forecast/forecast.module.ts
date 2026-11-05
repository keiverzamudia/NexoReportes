import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';
import { ForecastTargetScheduler } from './forecast-target.scheduler';
import { SellersService } from './sellers.service';

@Module({
  imports: [AuditModule, SyncModule],
  controllers: [ForecastController],
  providers: [ForecastService, ForecastTargetScheduler, SellersService],
})
export class ForecastModule {}

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ForecastModule } from '../forecast/forecast.module';
import { SyncModule } from '../sync/sync.module';
import { ProductionController } from './production.controller';
import { ProductionOrdersService } from './production.orders.service';
import { ProductionProfit } from './production.profit';
import { ProductionService } from './production.service';

@Module({
  imports: [SyncModule, AuditModule, ForecastModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionProfit, ProductionOrdersService],
})
export class ProductionModule {}

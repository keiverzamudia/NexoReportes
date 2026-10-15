import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';

@Module({
  imports: [AuditModule],
  controllers: [ForecastController],
  providers: [ForecastService],
})
export class ForecastModule {}

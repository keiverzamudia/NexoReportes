import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { HealthController } from './health.controller';

@Module({
  imports: [SyncModule],
  controllers: [HealthController],
})
export class HealthModule {}

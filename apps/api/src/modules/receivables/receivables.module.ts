import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

// La cartera se lee en vivo del adaptador de Profit (solo lectura).
@Module({
  imports: [SyncModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}

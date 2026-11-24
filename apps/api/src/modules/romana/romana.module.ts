import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RomanaCleanupScheduler } from './romana-cleanup.scheduler';
import { RomanaController } from './romana.controller';
import { RomanaService } from './romana.service';
import { RomanaStorageService } from './romana-storage.service';

// Romana reutiliza CustomerArrival: no tiene tabla propia. Este módulo añade
// los documentos por pedido, su almacenamiento y el barrido de fotos.
@Module({
  imports: [AuditModule],
  controllers: [RomanaController],
  providers: [RomanaService, RomanaStorageService, RomanaCleanupScheduler],
  exports: [RomanaService, RomanaStorageService],
})
export class RomanaModule {}

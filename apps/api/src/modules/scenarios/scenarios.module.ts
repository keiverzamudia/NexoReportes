import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { ScenariosCleanupScheduler } from './scenarios-cleanup.scheduler';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

// Fase 6: escenarios del simulador de despacho (por usuario).
// Importa DispatchModule para enviar la simulación completa al almacén.
@Module({
  imports: [AuditModule, DispatchModule],
  controllers: [ScenariosController],
  providers: [ScenariosService, ScenariosCleanupScheduler],
  exports: [ScenariosService],
})
export class ScenariosModule {}

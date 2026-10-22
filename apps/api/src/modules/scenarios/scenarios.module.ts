import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

// Fase 6: escenarios del simulador de despacho (por usuario).
@Module({
  imports: [AuditModule],
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}

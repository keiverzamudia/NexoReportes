import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ArrivalsController } from './arrivals.controller';
import { ArrivalsService } from './arrivals.service';

// PCP: llegadas de clientes generadas por los despachos publicados.
// Exporta el servicio para que DispatchService cree los registros al publicar.
@Module({
  imports: [AuditModule],
  controllers: [ArrivalsController],
  providers: [ArrivalsService],
  exports: [ArrivalsService],
})
export class ArrivalsModule {}

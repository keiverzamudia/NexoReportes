import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ArrivalsModule } from '../arrivals/arrivals.module';
import { SyncModule } from '../sync/sync.module';
import { DispatchController, NotificationsController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

// Fase 6b: hoja de despacho del almacén + túnel de acuses y notificaciones.
// Al publicar, crea las llegadas de PCP (ArrivalsModule). SyncModule aporta la
// cola que bloquea la fecha de entrega en Profit al iniciar la carga.
@Module({
  imports: [AuditModule, ArrivalsModule, SyncModule],
  controllers: [DispatchController, NotificationsController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ArrivalsModule } from '../arrivals/arrivals.module';
import { DispatchController, NotificationsController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

// Fase 6b: hoja de despacho del almacén + túnel de acuses y notificaciones.
// Al publicar, crea las llegadas de PCP (ArrivalsModule).
@Module({
  imports: [AuditModule, ArrivalsModule],
  controllers: [DispatchController, NotificationsController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DispatchController, NotificationsController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

// Fase 6b: hoja de despacho del almacén + túnel de acuses y notificaciones.
@Module({
  imports: [AuditModule],
  controllers: [DispatchController, NotificationsController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}

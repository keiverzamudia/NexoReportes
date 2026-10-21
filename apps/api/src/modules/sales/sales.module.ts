import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeliveryDatesService } from './delivery-dates.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// Fase 4: consulta de pedidos/clientes sincronizados desde Profit y capa local
// de fecha de entrega tentativa (sin escribir en Profit).
@Module({
  imports: [AuditModule],
  controllers: [SalesController],
  providers: [SalesService, DeliveryDatesService],
  exports: [SalesService, DeliveryDatesService],
})
export class SalesModule {}

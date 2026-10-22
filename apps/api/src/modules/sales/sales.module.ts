import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { CustomerStatementService } from './customer-statement.service';
import { DeliveryDatesService } from './delivery-dates.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// Fase 4: consulta de pedidos/clientes sincronizados desde Profit y capa local
// de fecha de entrega tentativa (sin escribir en Profit).
// El estado de cuenta usa el adaptador de Profit (solo lectura) vía SyncModule.
@Module({
  imports: [AuditModule, SyncModule],
  controllers: [SalesController],
  providers: [SalesService, DeliveryDatesService, CustomerStatementService],
  exports: [SalesService, DeliveryDatesService, CustomerStatementService],
})
export class SalesModule {}

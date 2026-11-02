import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { SyncModule } from '../sync/sync.module';
import { CustomerStatementService } from './customer-statement.service';
import { DeliveryDatesService } from './delivery-dates.service';
import { OrderLifecycleScheduler } from './order-lifecycle.scheduler';
import { OrderLifecycleService } from './order-lifecycle.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// Fase 4: consulta de pedidos/clientes sincronizados desde Profit y capa local
// de fecha de entrega tentativa (sin escribir en Profit).
// El estado de cuenta usa el adaptador de Profit (solo lectura) vía SyncModule.
// El ciclo de vida cierra pedidos por nota de entrega y limpia el plan global.
@Module({
  imports: [AuditModule, SyncModule, ScenariosModule],
  controllers: [SalesController],
  providers: [SalesService, DeliveryDatesService, CustomerStatementService, OrderLifecycleService, OrderLifecycleScheduler],
  exports: [SalesService, DeliveryDatesService, CustomerStatementService, OrderLifecycleService],
})
export class SalesModule {}

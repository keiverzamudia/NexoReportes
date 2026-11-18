import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

// Fase 3: catálogo de productos, existencias por almacén y disponibilidad neta.
// Importa SyncModule para reutilizar el adaptador de solo lectura de Profit
// (ventas de 90 días para Stock/día).
@Module({
  imports: [SyncModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}

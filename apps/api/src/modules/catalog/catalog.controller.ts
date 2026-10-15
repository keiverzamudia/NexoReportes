import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { zProductQuery, ProductQuery } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CatalogService } from './catalog.service';

// Catálogo, inventario y disponibilidad (Fase 3).
// Lectura de lo sincronizado desde Profit; nunca escribe en Profit.
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  listProducts(@Query(new ZodValidationPipe(zProductQuery)) query: ProductQuery) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:code')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  productDetail(@Param('code') code: string) {
    return this.catalog.productDetail(code);
  }

  @Get('availability')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  availability() {
    return this.catalog.availability();
  }

  @Get('inventory/snapshots/latest')
  @Roles('ADMIN', 'GERENCIA', 'PLANIFICADOR', 'ALMACEN', 'CONSULTA')
  latestSnapshot() {
    return this.catalog.latestSnapshotSummary();
  }
}

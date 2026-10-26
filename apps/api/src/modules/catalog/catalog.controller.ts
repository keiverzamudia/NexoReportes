import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { zProductQuery, ProductQuery } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyPermission, RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { CatalogService } from './catalog.service';

// Catálogo, inventario y disponibilidad (Fase 3).
// Lectura de lo sincronizado desde Profit; nunca escribe en Profit.
// Son endpoints compartidos: basta con ver cualquiera de estos módulos.
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAnyPermission(
  'disponibilidad:read',
  'forecast:read',
  'pedidos:read',
  'despacho:read',
)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  listProducts(@Query(new ZodValidationPipe(zProductQuery)) query: ProductQuery) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:code')
  productDetail(@Param('code') code: string) {
    return this.catalog.productDetail(code);
  }

  @Get('availability')
  // El resto del catálogo es compartido, pero esta vista es del módulo
  // Disponibilidad: sin `disponibilidad:read` no se entrega ni por URL.
  @RequirePermission('disponibilidad:read')
  availability() {
    return this.catalog.availability();
  }

  @Get('inventory/snapshots/latest')
  latestSnapshot() {
    return this.catalog.latestSnapshotSummary();
  }
}

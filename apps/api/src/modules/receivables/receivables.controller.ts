import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReceivablesQuery, zReceivablesQuery } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { ReceivablesService } from './receivables.service';

// Cuentas por cobrar: cartera viva de Profit por cliente, con tramos de
// vencimiento, saldo a favor, concentración y cobranza reciente.
@ApiTags('receivables')
@ApiBearerAuth()
@Controller('receivables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @RequirePermission('cxc:read')
  report(@Query(new ZodValidationPipe(zReceivablesQuery)) query: ReceivablesQuery) {
    return this.receivables.report(query);
  }
}

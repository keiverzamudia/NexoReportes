import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { zUpdateUserInput } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

// Administración de usuarios de Profit. Solo ADMIN:
// los usuarios NO se crean aquí (vienen de Profit), se administran rol y acceso.
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Usuarios sincronizados desde Profit (filtrables)' })
  list(@Query() query: { q?: string; role?: string; active?: 'true' | 'false' }) {
    return this.users.list(query);
  }

  @Post('sync')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Sincroniza los usuarios desde Profit (solo lectura)' })
  sync(@Req() request: AuthenticatedRequest) {
    return this.users.synchronize({ id: request.user?.sub });
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cambia el rol o el acceso de un usuario' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateUserInput)) body: { role?: string; isActive?: boolean },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, body, { id: request.user?.sub });
  }
}

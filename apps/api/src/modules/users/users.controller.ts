import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserPermissionsInput, zUpdateUserInput, zUserPermissionsInput } from '@nexo/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { UsersService } from './users.service';

// Administración de usuarios de Profit y de sus permisos. Los usuarios NO se
// crean aquí (vienen de Profit); se administran rol, acceso y excepciones de
// la matriz de permisos. Todo bajo el módulo `usuarios`.
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('usuarios:read')
  @ApiOperation({ summary: 'Usuarios sincronizados desde Profit (filtrables)' })
  list(@Query() query: { q?: string; role?: string; active?: 'true' | 'false' }) {
    return this.users.list(query);
  }

  @Post('sync')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Sincroniza los usuarios desde Profit (solo lectura)' })
  sync(@Req() request: AuthenticatedRequest) {
    return this.users.synchronize({ id: request.user?.sub });
  }

  @Get(':id/permissions')
  @RequirePermission('usuarios:read')
  @ApiOperation({ summary: 'Permisos del rol + excepciones + efectivos de un usuario' })
  permissions(@Param('id') id: string) {
    return this.users.userPermissions(id);
  }

  @Put(':id/permissions')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Reemplaza las excepciones de permisos del usuario' })
  setPermissions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUserPermissionsInput)) body: UserPermissionsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.setUserPermissions(id, body.overrides, { id: request.user?.sub });
  }

  @Delete(':id/permissions')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Elimina las excepciones: vuelve a heredar del rol' })
  clearPermissions(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.users.clearUserPermissions(id, { id: request.user?.sub });
  }

  @Patch(':id')
  @RequirePermission('usuarios:update')
  @ApiOperation({ summary: 'Cambia el rol o el acceso de un usuario' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateUserInput)) body: { role?: string; isActive?: boolean },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, body, { id: request.user?.sub });
  }
}

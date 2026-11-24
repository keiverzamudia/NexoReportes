import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SystemAnnouncementInput,
  SystemVersionInput,
  zSystemAnnouncementInput,
  zSystemVersionInput,
} from '@nexo/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { SystemService } from './system.service';

const zToggleActiveInput = z.object({ active: z.boolean() });

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('meta')
  @ApiOperation({ summary: 'Versión actual del sistema y avisos activos vigentes' })
  meta() {
    return this.system.getMeta();
  }

  @Put('version')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Actualiza la versión visible del sistema (solo ADMIN)' })
  setVersion(
    @Body(new ZodValidationPipe(zSystemVersionInput)) body: SystemVersionInput,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAdmin(request);
    return this.system.setVersion(body.version);
  }

  @Get('announcements')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Lista todos los avisos del sistema (solo ADMIN)' })
  listAnnouncements(@Req() request: AuthenticatedRequest) {
    this.assertAdmin(request);
    return this.system.listAnnouncements();
  }

  @Post('announcements')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Crea un aviso global en modal (solo ADMIN)' })
  createAnnouncement(
    @Body(new ZodValidationPipe(zSystemAnnouncementInput)) body: SystemAnnouncementInput,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAdmin(request);
    return this.system.createAnnouncement(body, request.user?.sub);
  }

  @Patch('announcements/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Activa o desactiva un aviso global (solo ADMIN)' })
  toggleAnnouncement(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zToggleActiveInput)) body: { active: boolean },
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAdmin(request);
    return this.system.setAnnouncementActive(id, body.active);
  }

  @Delete('announcements/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Elimina un aviso global (solo ADMIN)' })
  deleteAnnouncement(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    this.assertAdmin(request);
    return this.system.deleteAnnouncement(id);
  }

  private assertAdmin(request: AuthenticatedRequest): void {
    if (!request.access?.isAdmin) {
      throw new ForbiddenException('Esta acción es exclusiva para administradores.');
    }
  }
}

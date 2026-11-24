import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ROMANA_LIMITS,
  ArrivalCloseInput,
  ArrivalIncidentInput,
  ArrivalIncidentResolveInput,
  ArrivalMessageInput,
  RomanaCheckInInput,
  RomanaDocKind,
  RomanaQuery,
  RomanaValidateInput,
  zArrivalCloseInput,
  zArrivalIncidentInput,
  zArrivalIncidentResolveInput,
  zArrivalMessageInput,
  zRomanaCheckInInput,
  zRomanaDocKind,
  zRomanaQuery,
  zRomanaValidateInput,
} from '@nexo/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermission } from '../permissions/permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RomanaService, RomanaViewer } from './romana.service';

// ============================================================
// Romana (báscula): llegadas del despacho con cédula y carnet por pedido.
// Las fotos bloquean el marcado; al validar se borran del volumen.
// ============================================================

type UploadedImage = { buffer?: Buffer; size?: number };

@ApiTags('romana')
@ApiBearerAuth()
@Controller('romana')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RomanaController {
  constructor(private readonly romana: RomanaService) {}

  @Get('arrivals')
  @RequirePermission('pcp:read')
  @ApiOperation({ summary: 'Bandeja de Romana con progreso de documentos' })
  list(@Query(new ZodValidationPipe(zRomanaQuery)) query: RomanaQuery, @Req() request: AuthenticatedRequest) {
    return this.romana.list(this.viewer(request), query);
  }

  @Get('arrivals/:id')
  @RequirePermission('pcp:read')
  @ApiOperation({ summary: 'Detalle con documentos, incidencias y bitácora' })
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.romana.detail(this.viewer(request), id);
  }

  @Put('arrivals/:id/orders/:orderNumber/documents/:kind')
  @RequirePermission('pcp:upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ROMANA_LIMITS.maxUploadBytes } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube (o reemplaza) una foto: cédula o carnet de un pedido' })
  upload(
    @Param('id') id: string,
    @Param('orderNumber') orderNumber: string,
    @Param('kind', new ZodValidationPipe(zRomanaDocKind)) kind: RomanaDocKind,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Adjunta una foto en el campo «file».');
    }
    return this.romana.saveDocument(this.viewer(request), id, orderNumber, kind, file.buffer);
  }

  @Delete('arrivals/:id/orders/:orderNumber/documents/:kind')
  @RequirePermission('pcp:upload')
  @ApiOperation({ summary: 'Quita una foto antes de validar' })
  deleteDocument(
    @Param('id') id: string,
    @Param('orderNumber') orderNumber: string,
    @Param('kind', new ZodValidationPipe(zRomanaDocKind)) kind: RomanaDocKind,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.deleteDocument(this.viewer(request), id, orderNumber, kind);
  }

  @Get('arrivals/:id/documents/:docId')
  @RequirePermission('pcp:read')
  @ApiOperation({ summary: 'Stream autenticado de una foto (o su miniatura)' })
  async stream(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Query('variant') variant: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.romana.stream(id, docId, variant === 'thumb');
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.bytes),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }

  @Post('arrivals/:id/check-in')
  @RequirePermission('pcp:upload')
  @ApiOperation({ summary: 'Marca la llegada en Romana (exige las 2 fotos por pedido)' })
  checkIn(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zRomanaCheckInInput)) body: RomanaCheckInInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.checkIn(this.viewer(request), id, body);
  }

  @Post('arrivals/:id/validate')
  @RequirePermission('pcp:validate')
  @ApiOperation({ summary: 'Valida los documentos y borra las fotos del volumen' })
  validate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zRomanaValidateInput)) body: RomanaValidateInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.validate(this.viewer(request), id, body);
  }

  @Post('arrivals/:id/close')
  @RequirePermission('pcp:update')
  @ApiOperation({ summary: 'Cierra la atención: atendido o no presentado' })
  close(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalCloseInput)) body: ArrivalCloseInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.close(this.viewer(request), id, body);
  }

  @Post('arrivals/:id/incidents')
  @RequirePermission('pcp:upload')
  @ApiOperation({ summary: 'Reporta una incidencia del cliente' })
  addIncident(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalIncidentInput)) body: ArrivalIncidentInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.addIncident(this.viewer(request), id, body);
  }

  @Patch('arrivals/:id/incidents/:incidentId')
  @RequirePermission('pcp:update')
  @ApiOperation({ summary: 'Resuelve una incidencia con su explicación' })
  resolveIncident(
    @Param('id') id: string,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(zArrivalIncidentResolveInput)) body: ArrivalIncidentResolveInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.resolveIncident(this.viewer(request), id, incidentId, body);
  }

  @Post('arrivals/:id/messages')
  @RequirePermission('pcp:read')
  @ApiOperation({ summary: 'Nota libre en la bitácora del cliente' })
  message(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zArrivalMessageInput)) body: ArrivalMessageInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.romana.message(this.viewer(request), id, body);
  }

  private viewer(request: AuthenticatedRequest): RomanaViewer {
    const id = request.user?.sub;
    if (!id) throw new UnauthorizedException('Sesión requerida');
    return {
      id,
      code: request.user?.code ?? null,
      permissions: request.access?.permissions ?? [],
    };
  }
}

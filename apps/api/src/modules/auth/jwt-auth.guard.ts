import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { EffectiveAccess } from '../permissions/permissions.service';
import { AccessTokenPayload } from './auth.service';
import { readCookie } from './cookies';

export type AuthenticatedRequest = Request & {
  user?: AccessTokenPayload;
  /** Lo adjunta PermissionsGuard (rol, plantilla y permisos efectivos). */
  access?: EffectiveAccess;
};

// La sesión del navegador viaja en una cookie HttpOnly. Se mantiene el header
// `Authorization: Bearer` como alternativa para consumidores de la API
// (Swagger/curl); el web app nunca guarda tokens.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = this.config.get<string>('auth.accessCookie') ?? 'nexo_at';
    const cookieToken = readCookie(request, cookieName);
    const header = request.headers.authorization;
    const token = cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (!token) {
      throw new UnauthorizedException('Token de acceso requerido');
    }
    try {
      request.user = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}

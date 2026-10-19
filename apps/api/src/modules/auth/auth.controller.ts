import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { zLoginInput } from '@nexo/contracts';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UsersService } from '../users/users.service';
import { AuthService, IssuedSession } from './auth.service';
import { clearSessionCookie, readCookie, setSessionCookie } from './cookies';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private names() {
    return {
      access: this.config.get<string>('auth.accessCookie') ?? 'nexo_at',
      refresh: this.config.get<string>('auth.refreshCookie') ?? 'nexo_rt',
    };
  }

  private secure(): boolean {
    return this.config.get<boolean>('auth.cookieSecure') ?? false;
  }

  // La sesión vive en cookies HttpOnly: el cliente no ve ningún token.
  // El access token dura lo que el JWT (15 min por defecto) y el refresh 7 días.
  private writeSession(response: Response, session: IssuedSession): void {
    const { access, refresh } = this.names();
    setSessionCookie(response, access, session.accessToken, { path: '/', secure: this.secure() });
    setSessionCookie(response, refresh, session.refreshToken, {
      path: '/api/auth',
      secure: this.secure(),
      expires: session.refreshTokenExpiresAt,
    });
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login con usuario de Profit (contraseña validada en Profit)' })
  async login(
    @Body(new ZodValidationPipe(zLoginInput)) body: { userId: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(
      body.userId,
      body.password,
      request.ip,
      request.headers['user-agent'] ?? undefined,
    );
    this.writeSession(response, session);
    return { user: session.user };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renueva la sesión con la cookie de refresco' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(readCookie(request, this.names().refresh));
    this.writeSession(response, session);
    return { user: session.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(readCookie(request, this.names().refresh));
    clearSessionCookie(response, this.names().access, { path: '/', secure: this.secure() });
    clearSessionCookie(response, this.names().refresh, { path: '/api/auth', secure: this.secure() });
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Usuario autenticado (rol incluido) para la navegación' })
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.user!.sub);
  }

  // Público a propósito: el formulario de login necesita buscar el usuario.
  // Solo devuelve id, código y nombre de usuarios activos.
  @Get('usuarios')
  @ApiOperation({ summary: 'Autocompletado del login (usuarios activos)' })
  candidates(@Query('q') q?: string) {
    return this.users.loginCandidates(q);
  }
}

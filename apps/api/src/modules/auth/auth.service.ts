import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { PROFIT_ADAPTER, ProfitAdapter } from '../sync/profit.adapter';

// ============================================================
// Autenticación con usuario de Profit.
//
// · No existen contraseñas locales: la contraseña se valida contra
//   Profit (`MasterProfit.dbo.autenticar`) y se descarta.
// · Solo entra si el id que devuelve Profit coincide con el `profitCode`
//   guardado en la base (nunca se confía en lo que venga del navegador).
// · La sesión viaja en cookies HttpOnly (el JavaScript no ve ningún token).
// ============================================================

export interface AccessTokenPayload {
  sub: string;
  /** Código de Profit del usuario (trazabilidad en auditoría). */
  code: string;
  role: string;
}

export interface IssuedSession {
  user: {
    id: string;
    profitCode: string;
    displayName: string;
    role: string;
    isActive: boolean;
  };
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 60_000;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Intentos fallidos por (ip, usuario). Un solo proceso atiende la app.
  private readonly failures = new Map<string, { count: number; blockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  private rateKey(ip: string | undefined, userId: string): string {
    return `${ip ?? 'sin-ip'}:${userId}`;
  }

  private assertNotBlocked(ip: string | undefined, userId: string): void {
    const entry = this.failures.get(this.rateKey(ip, userId));
    if (entry && entry.blockedUntil > Date.now()) {
      const seconds = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
      throw new HttpException(
        `Demasiados intentos fallidos. Espera ${seconds} s e intenta de nuevo.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private registerFailure(ip: string | undefined, userId: string): void {
    if (this.failures.size > 5000) this.failures.clear();
    const key = this.rateKey(ip, userId);
    const entry = this.failures.get(key) ?? { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_FAILURES) {
      entry.count = 0;
      entry.blockedUntil = Date.now() + LOGIN_WINDOW_MS;
    }
    this.failures.set(key, entry);
  }

  private summary(user: User) {
    return {
      id: user.id,
      profitCode: user.profitCode,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
    };
  }

  /**
   * Login: usuario local (elegido en el autocompletado) + contraseña de Profit.
   * El `userId` viene del cliente, pero el `profitCode` que se usa para
   * autenticar sale SIEMPRE de la base.
   */
  async login(
    userId: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ): Promise<IssuedSession> {
    this.assertNotBlocked(ip, userId);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        context: { reason: user ? 'inactive' : 'unknown_user', userId, userAgent: userAgent ?? null },
      });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const expected = user.profitCode.trim();
    if (!expected) {
      await this.audit.record({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        context: { reason: 'no_profit_code', userId },
      });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    let returned: string | null;
    try {
      returned = await this.profit.authenticateUser(expected, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profit no disponible';
      await this.audit.record({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        context: { reason: 'profit_unavailable', message, dialect: this.profit.dialect },
      });
      this.logger.warn(`Login sin validar (Profit no disponible): ${message}`);
      throw new ServiceUnavailableException(
        'No se pudo validar la contraseña con Profit. Intenta de nuevo en un momento.',
      );
    }

    // Solo vale si Profit devuelve exactamente el código del usuario local.
    if (!returned || returned.trim().toUpperCase() !== expected.toUpperCase()) {
      this.registerFailure(ip, userId);
      await this.audit.record({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'Auth',
        context: { reason: 'bad_password', profitCode: expected },
      });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    this.failures.delete(this.rateKey(ip, userId));
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const session = await this.issueTokens(updated);
    await this.audit.record({
      actorId: user.id,
      action: 'LOGIN_OK',
      entityType: 'Auth',
      entityId: user.id,
      context: { profitCode: expected, ip: ip ?? null, userAgent: userAgent ?? null },
    });
    return session;
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) {
      throw new UnauthorizedException('Sesión requerida');
    }
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException('Usuario desactivado');
    }
    // Rotación: el refresh token anterior se revoca y se emite uno nuevo.
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = sha256(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Datos del usuario autenticado (para la navegación y el módulo Usuarios). */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Sesión inválida');
    }
    return { ...this.summary(user), lastLoginAt: user.lastLoginAt };
  }

  private async issueTokens(user: User): Promise<IssuedSession> {
    const payload: AccessTokenPayload = { sub: user.id, code: user.profitCode, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        userId: user.id,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return { user: this.summary(user), accessToken, refreshToken, refreshTokenExpiresAt };
  }
}

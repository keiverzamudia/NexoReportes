import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { zRole } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { PROFIT_ADAPTER, ProfitAdapter, ProfitUserRef } from '../sync/profit.adapter';

// ============================================================
// Usuarios: NO se crean aquí. Se sincronizan desde Profit
// (`MasterProfit.dbo.VUSUARIOS`) y la contraseña se valida en Profit
// (`MasterProfit.dbo.autenticar`). En la aplicación solo se administran
// el rol y si el usuario puede entrar.
// ============================================================

export interface UserSyncResult {
  total: number;
  created: number;
  updated: number;
  admins: number;
}

export interface ListUsersQuery {
  q?: string;
  role?: string;
  active?: 'true' | 'false';
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
  ) {}

  private adminCodes(): Set<string> {
    const codes = this.config.get<string[]>('users.adminCodes') ?? [];
    return new Set(codes.map((code) => code.trim().toUpperCase()));
  }

  private defaultRole(): string {
    return this.config.get<string>('users.defaultRole') ?? 'CONSULTA';
  }

  /**
   * Sincroniza los usuarios de Profit.
   *
   * · Nuevo en Profit → se crea (rol por defecto, o ADMIN si su código está
   *   entre los administradores declarados en `ADMIN_PROFIT_CODES`).
   * · Existente → solo se actualiza el nombre; el rol y el estado que haya
   *   fijado un administrador NO se pisan (así un bloqueo deliberado sobrevive
   *   a la sincronización).
   * · Un usuario que desaparece de Profit no se toca: se revisa a mano.
   *
   * Si Profit no responde, no se modifica nada.
   */
  async synchronize(actor?: { id?: string }): Promise<UserSyncResult> {
    let profitUsers: ProfitUserRef[];
    try {
      profitUsers = await this.profit.listUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profit no disponible';
      await this.audit.record({
        actorId: actor?.id ?? null,
        action: 'PROFIT_USERS_SYNC_FAILED',
        entityType: 'User',
        context: { message, dialect: this.profit.dialect },
      });
      throw new ServiceUnavailableException(`No se pudieron leer los usuarios de Profit: ${message}`);
    }

    const adminCodes = this.adminCodes();
    const defaultRole = this.defaultRole();
    const local = await this.prisma.user.findMany({
      select: { id: true, profitCode: true, displayName: true, role: true },
    });
    const byCode = new Map(local.map((user) => [user.profitCode.toUpperCase(), user]));

    let created = 0;
    let updated = 0;
    let admins = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const profitUser of profitUsers) {
        const code = profitUser.code.trim();
        if (!code) continue;
        const key = code.toUpperCase();
        const isAdmin = adminCodes.has(key);
        if (isAdmin) admins += 1;
        const existing = byCode.get(key);

        if (!existing) {
          await tx.user.create({
            data: {
              profitCode: code,
              displayName: profitUser.name,
              role: isAdmin ? 'ADMIN' : defaultRole,
            },
          });
          created += 1;
          continue;
        }

        const patch: Record<string, unknown> = {};
        if (existing.displayName !== profitUser.name) patch.displayName = profitUser.name;
        // El administrador declarado por entorno siempre es ADMIN.
        if (isAdmin && existing.role !== 'ADMIN') patch.role = 'ADMIN';
        if (Object.keys(patch).length > 0) {
          await tx.user.update({ where: { id: existing.id }, data: patch });
          updated += 1;
        }
      }
    });

    const result: UserSyncResult = { total: profitUsers.length, created, updated, admins };
    this.logger.log(
      `Sync usuarios Profit: leídos=${result.total} nuevos=${created} actualizados=${updated} admins=${admins}`,
    );
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'PROFIT_USERS_SYNCED',
      entityType: 'User',
      context: { ...result, dialect: this.profit.dialect },
    });
    return result;
  }

  /** true si todavía no hay ningún usuario local (instalación nueva). */
  async isEmpty(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /**
   * Listado para el módulo de administración. El filtro se aplica en memoria
   * sobre el padrón completo (son cientos de filas) para que la búsqueda no
   * distinga mayúsculas y acentos de escritura.
   */
  async list(query: ListUsersQuery) {
    const items = await this.prisma.user.findMany({ orderBy: { displayName: 'asc' } });
    const needle = (query.q ?? '').trim().toLowerCase();
    const role = query.role?.trim();
    const filtered = items.filter((user) => {
      if (needle) {
        const haystack = `${user.profitCode} ${user.displayName}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (role && user.role !== role) return false;
      if (query.active === 'true' && !user.isActive) return false;
      if (query.active === 'false' && user.isActive) return false;
      return true;
    });
    const adminCodes = this.adminCodes();
    return {
      items: filtered.map((user) => ({
        ...user,
        // Administrador declarado por entorno: la UI deshabilita sus controles.
        protected: adminCodes.has(user.profitCode.toUpperCase()),
      })),
      total: filtered.length,
    };
  }

  /** Rol y acceso. Los cambios quedan auditados con el usuario que los hizo. */
  async update(
    id: string,
    data: { role?: string; isActive?: boolean },
    actor?: { id?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (data.role) {
      zRole.parse(data.role);
    }
    // El administrador declarado por entorno no se puede degradar ni bloquear
    // desde la aplicación: si no, se podría dejar el sistema sin ADMIN.
    const isProtectedAdmin = this.adminCodes().has(user.profitCode.toUpperCase());
    if (isProtectedAdmin && ((data.role !== undefined && data.role !== 'ADMIN') || data.isActive === false)) {
      throw new ForbiddenException(
        'Ese usuario es administrador por configuración (ADMIN_PROFIT_CODES): no se puede degradar ni desactivar.',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: id,
      context: {
        profitCode: updated.profitCode,
        role: data.role ?? null,
        isActive: data.isActive ?? null,
      },
    });
    return updated;
  }

  /** Usuarios activos para el autocompletado del login (solo id, código y nombre). */
  async loginCandidates(search?: string) {
    const needle = (search ?? '').trim().toLowerCase();
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, profitCode: true, displayName: true },
    });
    if (!needle) return users.slice(0, 20);
    return users
      .filter((user) => `${user.profitCode} ${user.displayName}`.toLowerCase().includes(needle))
      .slice(0, 20);
  }
}

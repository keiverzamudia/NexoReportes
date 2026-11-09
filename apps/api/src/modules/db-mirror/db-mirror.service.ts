import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DbMirrorRestoreResult, DbMirrorStatus } from '@nexo/contracts';
import { statSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import {
  assertMirrorAllowed,
  compareSchemas,
  dbMirrorStatus,
  disposeSnapshot,
  resolveSourceDb,
  resolveTargetDb,
  restoreFromSnapshot,
  snapshotDatabase,
} from './db-mirror.core';

// ============================================================
// Espejo de la BD local desde el worktree main (solo desarrollo).
//
// El módulo ni siquiera se registra si `DB_MIRROR_ENABLED` no está en 1,
// así que en producción estas rutas no existen. Aun así se revalida aquí:
// defensa en profundidad barata.
// ============================================================

function mirrorEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DB_MIRROR_ENABLED === '1';
}

@Injectable()
export class DbMirrorService {
  private readonly logger = new Logger(DbMirrorService.name);
  private restoring = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertEnabled(): void {
    if (!mirrorEnabled()) {
      // 404: no revelamos que la capacidad existe si está apagada.
      throw new NotFoundException('No encontrado');
    }
  }

  async status(): Promise<DbMirrorStatus> {
    this.assertEnabled();
    return dbMirrorStatus(this.restoring);
  }

  /**
   * Reemplaza la BD de este worktree por una foto de main. Unidireccional y
   * atómico: si algo falla, la BD local queda como estaba.
   */
  async restore(actorCode: string | null): Promise<DbMirrorRestoreResult> {
    this.assertEnabled();
    if (this.restoring) {
      throw new ConflictException('Ya hay una restauración de la base de datos en curso.');
    }
    this.restoring = true;

    try {
      assertMirrorAllowed();

      const sourcePath = resolveSourceDb();
      const targetPath = resolveTargetDb();
      if (path.resolve(sourcePath) === path.resolve(targetPath)) {
        throw new BadRequestException('La BD de main y la local apuntan al mismo archivo.');
      }

      const { issues } = await compareSchemas(sourcePath, targetPath);
      if (issues.length > 0) {
        throw new BadRequestException({
          message: 'El esquema de main y el local no coinciden; no se tocó nada.',
          issues,
        });
      }

      const sourceModifiedAt = statSync(sourcePath).mtime.toISOString();
      const snapshot = await snapshotDatabase(sourcePath);
      try {
        const outcome = await restoreFromSnapshot(targetPath, snapshot.path);
        this.logger.warn(
          `BD restaurada desde main: ${outcome.tables} tablas, ${outcome.rows} filas en ${outcome.durationMs} ms.`,
        );
        await this.recordAudit(actorCode, { ...outcome, sourceModifiedAt });
        return { ok: true, ...outcome, sourceModifiedAt };
      } finally {
        disposeSnapshot(snapshot);
      }
    } finally {
      this.restoring = false;
    }
  }

  /**
   * La bitácora se escribe DESPUÉS del volcado, así que el actor puede no
   * existir en la BD de main. Se busca por código de Profit y, si no está,
   * el evento queda atribuido al sistema (nunca rompe la restauración).
   */
  private async recordAudit(
    actorCode: string | null,
    outcome: { tables: number; rows: number; durationMs: number; sourceModifiedAt: string },
  ): Promise<void> {
    try {
      const actor = actorCode
        ? await this.prisma.user.findUnique({ where: { profitCode: actorCode }, select: { id: true } })
        : null;
      await this.audit.record({
        actorId: actor?.id ?? null,
        actorEmail: actorCode,
        action: 'DB_MIRROR_RESTORE',
        entityType: 'SystemSetting',
        entityId: 'db-mirror',
        context: {
          sourceModifiedAt: outcome.sourceModifiedAt,
          tables: outcome.tables,
          rows: outcome.rows,
          durationMs: outcome.durationMs,
        },
      });
    } catch (error) {
      this.logger.error('No se pudo registrar la restauración en la bitácora', error as Error);
    }
  }
}

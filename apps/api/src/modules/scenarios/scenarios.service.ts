import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MAX_SCENARIOS,
  ScenarioDetail,
  ScenarioDraftInput,
  ScenarioListItem,
  ScenarioListResponse,
  ScenarioPayload,
  ScenarioRestoreInput,
  ScenarioRestoreLog,
  ScenarioSaveInput,
  ScenarioUpdateInput,
  zScenarioPayload,
} from '@nexo/contracts';
import { DispatchScenario, DispatchScenarioRestore } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';

// ============================================================
// Simulador de despacho: escenarios guardados por usuario.
//
// La receta (agrupación, modo, orden, filtros y renglones marcados) se
// re-ejecuta en el cliente con los datos de HOY. La foto (payload.snapshot)
// es solo para comparar y mostrar el diff: nunca se usa para escribir en
// Profit ni para alterar pedidos.
//
// El servidor NO recalcula asignaciones: eso vive en el motor puro del web
// (`lib/dispatch.ts`). Aquí solo se persiste y se derivan totales de la foto.
// ============================================================

export interface ScenarioActor {
  id?: string | null;
  code?: string | null;
}

// Fila con el conteo de restauraciones (include de Prisma).
type ScenarioRow = DispatchScenario & { _count?: { restores: number } };

// Últimas restauraciones que se muestran en el detalle.
const RESTORE_HISTORY = 20;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Prisma Decimal → number (SQLite/PostgreSQL devuelven Decimal en runtime).
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lectura ----------

  async list(ownerId: string): Promise<ScenarioListResponse> {
    const dataVersion = await this.currentDataVersion();
    const [draft, items] = await Promise.all([
      this.prisma.dispatchScenario.findFirst({
        where: { ownerId, kind: 'DRAFT' },
        include: { _count: { select: { restores: true } } },
      }),
      this.prisma.dispatchScenario.findMany({
        where: { ownerId, kind: 'SAVED' },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { restores: true } } },
      }),
    ]);
    return {
      draft: draft ? this.toListItem(draft, dataVersion) : null,
      items: items.map((row) => this.toListItem(row, dataVersion)),
      limit: MAX_SCENARIOS,
      dataVersion,
    };
  }

  // Borrador del usuario (o null). Es la sesión de trabajo que sobrevive al
  // cierre de sesión y al cambio de equipo.
  async getDraft(ownerId: string): Promise<{ scenario: ScenarioDetail | null }> {
    const row = await this.prisma.dispatchScenario.findFirst({
      where: { ownerId, kind: 'DRAFT' },
      include: {
        _count: { select: { restores: true } },
        restores: { orderBy: [{ restoredAt: 'desc' }, { id: 'desc' }], take: RESTORE_HISTORY },
      },
    });
    if (!row) return { scenario: null };
    const dataVersion = await this.currentDataVersion();
    return {
      scenario: {
        ...this.toListItem(row, dataVersion),
        payload: this.parsePayload(row),
        restores: row.restores.map((restore) => this.toRestoreLog(restore)),
      },
    };
  }

  async detail(ownerId: string, id: string): Promise<ScenarioDetail> {
    const row = await this.prisma.dispatchScenario.findFirst({
      where: { id, ownerId },
      include: {
        _count: { select: { restores: true } },
        restores: { orderBy: [{ restoredAt: 'desc' }, { id: 'desc' }], take: RESTORE_HISTORY },
      },
    });
    if (!row) throw new NotFoundException('Simulación no encontrada.');
    const dataVersion = await this.currentDataVersion();
    return {
      ...this.toListItem(row, dataVersion),
      payload: this.parsePayload(row),
      restores: row.restores.map((restore) => this.toRestoreLog(restore)),
    };
  }

  // ---------- Escritura ----------

  // Autoguardado del borrador: last-write-wins (el versionado optimista se
  // reserva para los guardados con nombre, donde pisar sí molesta).
  async saveDraft(ownerId: string, input: ScenarioDraftInput): Promise<ScenarioListItem> {
    const payload: ScenarioPayload = {
      recipe: input.recipe,
      selected: input.selected,
      snapshot: null,
    };
    const dataVersion = await this.currentDataVersion();
    const data = {
      name: '',
      kind: 'DRAFT',
      payload: JSON.stringify(payload),
      dataVersion,
      ...this.derive(payload),
    };

    const existing = await this.prisma.dispatchScenario.findFirst({
      where: { ownerId, kind: 'DRAFT' },
    });
    const row = existing
      ? await this.prisma.dispatchScenario.update({ where: { id: existing.id }, data })
      : await this.prisma.dispatchScenario.create({ data: { ...data, ownerId } });
    return this.toListItem(row, dataVersion);
  }

  async create(ownerId: string, input: ScenarioSaveInput, actor: ScenarioActor): Promise<ScenarioDetail> {
    const saved = await this.prisma.dispatchScenario.count({ where: { ownerId, kind: 'SAVED' } });
    if (saved >= MAX_SCENARIOS) {
      throw new ConflictException(
        `Llegaste al límite de ${MAX_SCENARIOS} simulaciones guardadas. Borra una para guardar otra.`,
      );
    }

    const payload: ScenarioPayload = {
      recipe: input.recipe,
      selected: input.selected,
      snapshot: input.snapshot,
    };
    const dataVersion = await this.currentDataVersion();
    const data = {
      ownerId,
      name: input.name,
      kind: 'SAVED',
      payload: JSON.stringify(payload),
      dataVersion,
      ...this.derive(payload),
    };

    try {
      const row = await this.prisma.dispatchScenario.create({ data });
      await this.audit.record({
        actorId: actor.id ?? null,
        actorEmail: actor.code ?? null,
        action: 'SCENARIO_SAVE',
        entityType: 'DispatchScenario',
        entityId: row.id,
        context: { name: row.name, lines: row.lineCount, coverage: row.coverage },
      });
      return this.detail(ownerId, row.id);
    } catch (error) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  async update(ownerId: string, id: string, input: ScenarioUpdateInput, actor: ScenarioActor): Promise<ScenarioDetail> {
    const row = await this.findOwned(ownerId, id);
    if (input.version !== undefined && input.version !== row.version) {
      throw new ConflictException(
        'Esta simulación cambió en otra pestaña. Recarga la lista e intenta de nuevo.',
      );
    }

    const data: {
      name?: string;
      payload?: string;
      lineCount?: number;
      sacks?: number;
      assignedKg?: number;
      missingKg?: number;
      coverage?: number;
    } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.payload !== undefined) {
      data.payload = JSON.stringify(input.payload);
      Object.assign(data, this.derive(input.payload));
    }
    // Las ediciones vuelven a tomar la foto como referencia de frescura.
    const dataVersion = input.payload !== undefined ? await this.currentDataVersion() : row.dataVersion;

    try {
      const updated = await this.prisma.dispatchScenario.update({
        where: { id: row.id },
        data: { ...data, dataVersion, version: { increment: 1 } },
      });
      await this.audit.record({
        actorId: actor.id ?? null,
        actorEmail: actor.code ?? null,
        action: 'SCENARIO_UPDATE',
        entityType: 'DispatchScenario',
        entityId: updated.id,
        context: { name: updated.name, fields: Object.keys(input) },
      });
      return this.detail(ownerId, updated.id);
    } catch (error) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  async remove(ownerId: string, id: string, actor: ScenarioActor): Promise<{ deleted: true }> {
    const row = await this.findOwned(ownerId, id);
    await this.prisma.dispatchScenario.delete({ where: { id: row.id } });
    await this.audit.record({
      actorId: actor.id ?? null,
      actorEmail: actor.code ?? null,
      action: 'SCENARIO_DELETE',
      entityType: 'DispatchScenario',
      entityId: row.id,
      context: { name: row.name, kind: row.kind, lines: row.lineCount },
    });
    return { deleted: true };
  }

  // Registra una restauración (la aplica el cliente) con el diff que calculó:
  // queda en el historial visible del escenario, en la lista y en auditoría.
  // No toca la foto ni incrementa la versión.
  async markRestored(
    ownerId: string,
    id: string,
    input: ScenarioRestoreInput,
    actor: ScenarioActor,
  ): Promise<{ restoredAt: string; restoreCount: number }> {
    const row = await this.findOwned(ownerId, id);
    const restoredAt = new Date();
    const user = actor.id
      ? await this.prisma.user.findUnique({ where: { id: actor.id }, select: { displayName: true } })
      : null;

    const [updated] = await this.prisma.$transaction([
      this.prisma.dispatchScenario.update({ where: { id: row.id }, data: { restoredAt } }),
      this.prisma.dispatchScenarioRestore.create({
        data: {
          scenarioId: row.id,
          restoredById: actor.id ?? null,
          restoredByCode: actor.code ?? null,
          restoredByName: user?.displayName ?? null,
          restoredAt,
          restored: input.restored,
          missing: input.missing,
          pendingChanges: input.pendingChanges,
          stockChanges: input.stockChanges,
          dateChanges: input.dateChanges,
          carteraBefore: input.carteraBefore,
          carteraAfter: input.carteraAfter,
          beforeKg: input.beforeKg,
          afterKg: input.afterKg,
          beforeCoverage: input.beforeCoverage,
          afterCoverage: input.afterCoverage,
        },
      }),
    ]);

    const restoreCount = await this.prisma.dispatchScenarioRestore.count({ where: { scenarioId: row.id } });

    await this.audit.record({
      actorId: actor.id ?? null,
      actorEmail: actor.code ?? null,
      action: 'SCENARIO_RESTORE',
      entityType: 'DispatchScenario',
      entityId: row.id,
      context: {
        name: row.name,
        restored: input.restored,
        missing: input.missing,
        pendingChanges: input.pendingChanges,
        stockChanges: input.stockChanges,
        dateChanges: input.dateChanges,
        restoreCount,
      },
    });
    return { restoredAt: updated.restoredAt!.toISOString(), restoreCount };
  }

  // ---------- Internos ----------

  private async findOwned(ownerId: string, id: string): Promise<DispatchScenario> {
    // Un escenario ajeno responde 404: no se filtra su existencia.
    const row = await this.prisma.dispatchScenario.findFirst({ where: { id, ownerId } });
    if (!row) throw new NotFoundException('Simulación no encontrada.');
    return row;
  }

  // Fingerprint de frescura: últimas syncs exitosas de pedidos y existencias.
  private async currentDataVersion(): Promise<string | null> {
    const runs = await this.prisma.syncRun.findMany({
      where: {
        domain: { in: ['PEDIDOS', 'EXISTENCIAS'] },
        status: { in: ['EXITOSA', 'PARCIAL'] },
      },
      orderBy: { finishedAt: 'desc' },
      distinct: ['domain'],
      select: { domain: true, id: true },
    });
    if (runs.length === 0) return null;
    return runs
      .map((run) => `${run.domain}:${run.id}`)
      .sort()
      .join('|');
  }

  private toListItem(row: ScenarioRow, dataVersion: string | null): ScenarioListItem {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === 'DRAFT' ? 'DRAFT' : 'SAVED',
      lineCount: row.lineCount,
      sacks: toNumber(row.sacks),
      assignedKg: toNumber(row.assignedKg),
      missingKg: toNumber(row.missingKg),
      coverage: row.coverage,
      stale: Boolean(row.dataVersion && dataVersion && row.dataVersion !== dataVersion),
      version: row.version,
      restoredAt: row.restoredAt ? row.restoredAt.toISOString() : null,
      restoreCount: row._count?.restores ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRestoreLog(row: DispatchScenarioRestore): ScenarioRestoreLog {
    return {
      id: row.id,
      restoredAt: row.restoredAt.toISOString(),
      restoredById: row.restoredById,
      restoredByName: row.restoredByName,
      restored: row.restored,
      missing: row.missing,
      pendingChanges: row.pendingChanges,
      stockChanges: row.stockChanges,
      dateChanges: row.dateChanges,
      carteraBefore: row.carteraBefore,
      carteraAfter: row.carteraAfter,
      beforeKg: toNumber(row.beforeKg),
      afterKg: toNumber(row.afterKg),
      beforeCoverage: toNumber(row.beforeCoverage),
      afterCoverage: toNumber(row.afterCoverage),
    };
  }

  private parsePayload(row: DispatchScenario): ScenarioPayload {
    return zScenarioPayload.parse(JSON.parse(row.payload) as unknown);
  }

  // Totales derivados de la foto (no se confía en los del cliente).
  private derive(payload: ScenarioPayload) {
    const snapshot = payload.snapshot;
    if (!snapshot) {
      return { lineCount: payload.selected.length, sacks: 0, assignedKg: 0, missingKg: 0, coverage: 0 };
    }
    let sacks = 0;
    let assignedKg = 0;
    let missingKg = 0;
    for (const line of snapshot.lines) {
      if (line.uom === 'SAC') sacks += line.assignedQty;
      assignedKg += line.assignedKg;
      missingKg += line.missingKg;
    }
    const totalKg = assignedKg + missingKg;
    return {
      lineCount: snapshot.lines.length,
      sacks: round2(sacks),
      assignedKg: round2(assignedKg),
      missingKg: round2(missingKg),
      coverage: totalKg > 0 ? Math.round((assignedKg / totalKg) * 100) : 100,
    };
  }

  private rethrowNameConflict(error: unknown): void {
    if ((error as { code?: string })?.code === 'P2002') {
      throw new ConflictException('Ya tienes una simulación guardada con ese nombre.');
    }
  }
}

import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MAX_SCENARIOS,
  ScenarioDetail,
  ScenarioDraftInput,
  ScenarioListItem,
  ScenarioListResponse,
  ScenarioLock,
  ScenarioLockResponse,
  ScenarioPayload,
  ScenarioRestoreInput,
  ScenarioRestoreLog,
  ScenarioSaveInput,
  ScenarioUpdateInput,
  SCENARIO_LOCK_SECONDS,
  zScenarioPayload,
} from '@nexo/contracts';
import { DispatchDraft, DispatchScenario, DispatchScenarioRestore } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';

// ============================================================
// Simulador de despacho: plan GLOBAL compartido + escenarios guardados.
//
// · `DispatchDraft` es el plan vivo del equipo (una sola fila GLOBAL). Tiene
//   lock de edición con TTL corto: solo el titular autoguarda; los demás ven
//   el plan en modo lectura hasta «tomar control».
// · `DispatchScenario` son fotos con nombre (receta + renglones + foto). Las
//   ve todo el equipo. Solo el creador o un ADMIN puede renombrarlas/borrarlas;
//   restaurarlas lo puede hacer cualquiera con permiso de edición.
//
// Nada de esto escribe en Profit. El servidor no recalcula asignaciones: eso
// vive en el motor puro del web (`lib/dispatch.ts`).
// ============================================================

export interface ScenarioActor {
  id?: string | null;
  code?: string | null;
  name?: string | null;
}

export interface ScenarioViewer {
  id: string;
  isAdmin: boolean;
}

export type ScenarioViewerInput = string | ScenarioViewer;
export type ScenarioActorInput = string | ScenarioActor;

function asViewer(input: ScenarioViewerInput): ScenarioViewer {
  return typeof input === 'string' ? { id: input, isAdmin: false } : input;
}

function asActor(input: ScenarioActorInput): ScenarioActor {
  return typeof input === 'string' ? { id: input } : input;
}

// Fila con el conteo de restauraciones (include de Prisma).
type ScenarioRow = DispatchScenario & {
  _count?: { restores: number };
  owner?: { profitCode: string; displayName: string } | null;
};

const RESTORE_HISTORY = 20;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Prisma Decimal → number (SQLite/PostgreSQL devuelven Decimal en runtime).
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyPayload(): ScenarioPayload {
  return zScenarioPayload.parse({
    recipe: { by: 'cliente', mode: 'disponible', sort: 'cobertura', filters: {} },
    selected: [],
    snapshot: null,
    loadPlan: null,
  });
}

function lockIsActive(row: { lockedUntil: Date | null }): boolean {
  return Boolean(row.lockedUntil && row.lockedUntil.getTime() > Date.now());
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

@Injectable()
export class ScenariosService implements OnModuleInit {
  private readonly logger = new Logger(ScenariosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Migración de los borradores por usuario al plan global. Se ejecuta una
  // vez al arrancar y es idempotente: convierte los DRAFT viejos en SAVED y
  // toma el más reciente como plan global si todavía no existe.
  async onModuleInit(): Promise<void> {
    try {
      await this.migrateLegacyDrafts();
    } catch (error) {
      this.logger.warn(
        `No se pudieron migrar los borradores antiguos: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async migrateLegacyDrafts(): Promise<void> {
    const legacy = await this.prisma.dispatchScenario.findMany({
      where: { kind: 'DRAFT' },
      include: { owner: { select: { profitCode: true, displayName: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (legacy.length === 0) return;

    const existing = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!existing) {
      const source = legacy[0]!;
      try {
        zScenarioPayload.parse(JSON.parse(source.payload) as unknown);
        await this.prisma.dispatchDraft.create({
          data: {
            id: 'GLOBAL',
            payload: source.payload,
            lineCount: source.lineCount,
            sacks: source.sacks,
            assignedKg: source.assignedKg,
            missingKg: source.missingKg,
            coverage: source.coverage,
            dataVersion: source.dataVersion,
            version: Math.max(1, source.version),
            updatedById: source.ownerId,
            updatedByCode: source.owner?.profitCode ?? null,
            updatedByName: source.owner?.displayName ?? null,
          },
        });
      } catch {
        // Payload corrupto: no se toma como plan global; igual se archiva.
      }
    }

    for (const row of legacy) {
      const base = `Borrador de ${row.owner?.displayName ?? row.owner?.profitCode ?? 'usuario'} (migrado)`;
      let name = base;
      let suffix = 1;
      while (
        await this.prisma.dispatchScenario.findFirst({
          where: { ownerId: row.ownerId, kind: 'SAVED', name },
          select: { id: true },
        })
      ) {
        name = `${base} ${suffix}`;
        suffix += 1;
      }
      await this.prisma.dispatchScenario.update({
        where: { id: row.id },
        data: { kind: 'SAVED', name },
      });
    }
    this.logger.log(`Migrados ${legacy.length} borrador(es) por usuario al plan global.`);
  }

  // ---------- Lectura ----------

  // Lista global: borrador compartido + todos los guardados del equipo.
  async list(viewerInput: ScenarioViewerInput, _options: { allOwners?: boolean } = {}): Promise<ScenarioListResponse> {
    const viewer = asViewer(viewerInput);
    const dataVersion = await this.currentDataVersion();
    const [draft, rows] = await Promise.all([
      this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } }),
      this.prisma.dispatchScenario.findMany({
        where: { kind: 'SAVED' },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { restores: true } },
          owner: { select: { profitCode: true, displayName: true } },
        },
      }),
    ]);

    const closed = await this.closedLinesMap(rows);
    return {
      draft: draft ? this.toDraftDetail(draft, viewer, dataVersion) : null,
      items: rows.map((row) => this.toListItem(row, viewer, dataVersion, closed.get(row.id) ?? 0)),
      limit: MAX_SCENARIOS,
      allOwners: true,
      dataVersion,
    };
  }

  // Plan global (o null si nadie lo ha guardado todavía).
  async getDraft(viewerInput: ScenarioViewerInput): Promise<{ scenario: ScenarioDetail | null }> {
    const viewer = asViewer(viewerInput);
    const row = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!row) return { scenario: null };
    const dataVersion = await this.currentDataVersion();
    return { scenario: this.toDraftDetail(row, viewer, dataVersion) };
  }

  // Detalle de un escenario guardado. No filtra por dueño: el equipo entero
  // puede consultarlo. Editar/borrar sí queda restringido.
  async detail(viewerInput: ScenarioViewerInput, id: string): Promise<ScenarioDetail> {
    const viewer = asViewer(viewerInput);
    const row = await this.prisma.dispatchScenario.findFirst({
      where: { id, kind: 'SAVED' },
      include: {
        _count: { select: { restores: true } },
        owner: { select: { profitCode: true, displayName: true } },
        restores: { orderBy: [{ restoredAt: 'desc' }, { id: 'desc' }], take: RESTORE_HISTORY },
      },
    });
    if (!row) throw new NotFoundException('Simulación no encontrada.');
    const dataVersion = await this.currentDataVersion();
    const closed = await this.closedLinesMap([row]);
    return {
      ...this.toListItem(row, viewer, dataVersion, closed.get(row.id) ?? 0),
      payload: this.parsePayload(row),
      restores: row.restores.map((restore) => this.toRestoreLog(restore)),
    };
  }

  // ---------- Bloqueo del plan global ----------

  // Toma (o renueva) el control del plan. Un ADMIN puede arrebatarlo con
  // `force`, dejando auditoría; el resto espera a que expire o a que lo libere.
  async acquireLock(
    actorInput: ScenarioActorInput,
    viewerInput: ScenarioViewerInput,
    options: { force?: boolean } = {},
  ): Promise<ScenarioLockResponse> {
    const viewer = asViewer(viewerInput);
    let actor = asActor(actorInput);
    if (!actor.id) throw new ForbiddenException('Sesión requerida');
    actor = await this.withName(actor);
    let draft = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!draft) draft = await this.createEmptyDraft(actor);

    const active = lockIsActive(draft);
    const heldByOther = active && draft.lockedById !== actor.id;
    if (heldByOther && !options.force) {
      throw new ConflictException(
        `El plan lo está editando ${draft.lockedByName ?? 'otro usuario'}. Espera o pide el control.`,
      );
    }
    if (heldByOther && options.force && !viewer.isAdmin) {
      throw new ForbiddenException('Solo un administrador puede quitarle el control a otro usuario.');
    }

    const token = active && draft.lockedById === actor.id && draft.lockToken ? draft.lockToken : randomUUID();
    const until = new Date(Date.now() + SCENARIO_LOCK_SECONDS * 1000);
    const updated = await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: {
        lockedById: actor.id,
        lockedByName: actor.name ?? null,
        lockedUntil: until,
        lockToken: token,
      },
    });

    if (heldByOther && options.force) {
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.code ?? null,
        action: 'SCENARIO_TAKEOVER',
        entityType: 'DispatchDraft',
        entityId: 'GLOBAL',
        context: { previousHolder: draft.lockedById, previousHolderName: draft.lockedByName },
      });
    } else if (!active || draft.lockedById !== actor.id) {
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.code ?? null,
        action: 'SCENARIO_LOCK',
        entityType: 'DispatchDraft',
        entityId: 'GLOBAL',
        context: { version: updated.version },
      });
    }

    return {
      holderId: actor.id ?? null,
      holderName: actor.name ?? null,
      until: until.toISOString(),
      isMine: true,
      token,
      version: updated.version,
    };
  }

  async releaseLock(actorInput: ScenarioActorInput, token?: string): Promise<{ released: true }> {
    const actor = asActor(actorInput);
    const draft = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!draft) return { released: true };
    const mine = draft.lockedById && draft.lockedById === actor.id;
    if (!mine || (token && draft.lockToken !== token)) {
      throw new ConflictException('El control del plan ya no es tuyo.');
    }
    await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: { lockedById: null, lockedByName: null, lockedUntil: null, lockToken: null },
    });
    await this.audit.record({
      actorId: actor.id ?? null,
      actorEmail: actor.code ?? null,
      action: 'SCENARIO_UNLOCK',
      entityType: 'DispatchDraft',
      entityId: 'GLOBAL',
      context: null,
    });
    return { released: true };
  }

  // ---------- Escritura del plan global ----------

  // Autoguardado del plan global. Exige versión y lock vigente del titular.
  // Si el lock expiró, el guardado lo renueva (el usuario sigue en pantalla).
  async saveDraft(actorInput: ScenarioActorInput, input: ScenarioDraftInput): Promise<ScenarioListItem> {
    let actor = asActor(actorInput);
    if (!actor.id) throw new ForbiddenException('Sesión requerida');
    actor = await this.withName(actor);
    const payload: ScenarioPayload = {
      recipe: input.recipe,
      selected: input.selected,
      snapshot: null,
      loadPlan: input.loadPlan ?? null,
    };
    const dataVersion = await this.currentDataVersion();
    const data = {
      payload: JSON.stringify(payload),
      dataVersion,
      ...this.derive(payload),
      lockedById: actor.id,
      lockedByName: actor.name ?? null,
      lockedUntil: new Date(Date.now() + SCENARIO_LOCK_SECONDS * 1000),
      lockToken: input.lockToken ?? randomUUID(),
      updatedById: actor.id,
      updatedByCode: actor.code ?? null,
      updatedByName: actor.name ?? null,
    };

    let existing = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!existing) {
      const row = await this.prisma.dispatchDraft.create({ data: { id: 'GLOBAL', ...data } });
      return this.toDraftDetail(row, { id: actor.id!, isAdmin: false }, dataVersion);
    }

    if (lockIsActive(existing) && existing.lockedById !== actor.id) {
      throw new ConflictException(
        `El plan lo está editando ${existing.lockedByName ?? 'otro usuario'}. Toma el control para guardar.`,
      );
    }
    if (existing.lockedById === actor.id && !input.lockToken && existing.lockToken) {
      data.lockToken = existing.lockToken;
    }
    if (input.version !== undefined && input.version !== existing.version) {
      throw new ConflictException('El plan cambió en otra pestaña. Recarga para ver la versión más reciente.');
    }
    if (existing.lockedById === actor.id && input.lockToken && existing.lockToken !== input.lockToken) {
      throw new ConflictException('Tu control del plan expiró. Vuelve a tomar el control.');
    }

    const row = await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: { ...data, version: { increment: 1 } },
    });
    return this.toDraftDetail(row, { id: actor.id!, isAdmin: false }, dataVersion);
  }

  // ---------- Escenarios guardados ----------

  async create(viewerInput: ScenarioViewerInput, input: ScenarioSaveInput, actorInput: ScenarioActorInput): Promise<ScenarioDetail> {
    const viewer = asViewer(viewerInput);
    const actor = asActor(actorInput);
    const saved = await this.prisma.dispatchScenario.count({ where: { kind: 'SAVED' } });
    if (saved >= MAX_SCENARIOS) {
      throw new ConflictException(
        `El equipo llegó al límite de ${MAX_SCENARIOS} simulaciones guardadas. Borra una para guardar otra.`,
      );
    }

    const payload: ScenarioPayload = {
      recipe: input.recipe,
      selected: input.selected,
      snapshot: input.snapshot,
      loadPlan: input.loadPlan ?? null,
    };
    const dataVersion = await this.currentDataVersion();
    const data = {
      ownerId: viewer.id,
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
      return this.detail(viewer, row.id);
    } catch (error) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  async update(
    viewerInput: ScenarioViewerInput,
    id: string,
    input: ScenarioUpdateInput,
    actorInput: ScenarioActorInput,
  ): Promise<ScenarioDetail> {
    const viewer = asViewer(viewerInput);
    const actor = asActor(actorInput);
    const row = await this.findSaved(id);
    this.assertCanEdit(row, viewer);
    if (input.version !== undefined && input.version !== row.version) {
      throw new ConflictException('Esta simulación cambió en otra pestaña. Recarga la lista e intenta de nuevo.');
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
      return this.detail(viewer, updated.id);
    } catch (error) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  // Solo el creador o un ADMIN eliminan. El resto del equipo puede verla.
  async remove(viewerInput: ScenarioViewerInput, id: string, actorInput: ScenarioActorInput): Promise<{ deleted: true }> {
    const viewer = asViewer(viewerInput);
    const actor = asActor(actorInput);
    const row = await this.findSaved(id);
    if (!viewer.isAdmin && row.ownerId !== viewer.id) {
      throw new ForbiddenException('Solo quien creó la simulación o un administrador puede eliminarla.');
    }
    await this.prisma.dispatchScenario.delete({ where: { id: row.id } });
    await this.audit.record({
      actorId: actor.id ?? null,
      actorEmail: actor.code ?? null,
      action: 'SCENARIO_DELETE',
      entityType: 'DispatchScenario',
      entityId: row.id,
      context: { name: row.name, kind: row.kind, lines: row.lineCount, ownerId: row.ownerId },
    });
    return { deleted: true };
  }

  // Registrar una restauración (la aplica el cliente) con el diff calculado.
  // Cualquier usuario con permiso de edición puede restaurar un plan del equipo.
  async markRestored(
    viewerInput: ScenarioViewerInput,
    id: string,
    input: ScenarioRestoreInput,
    actorInput: ScenarioActorInput,
  ): Promise<{ restoredAt: string; restoreCount: number }> {
    const viewer = asViewer(viewerInput);
    const actor = asActor(actorInput);
    const row = await this.findSaved(id);
    if (!viewer.isAdmin && row.ownerId !== viewer.id) {
      throw new ForbiddenException('Solo quien creó la simulación o un administrador puede restaurarla.');
    }
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

  // ---------- Limpieza por cierres de pedidos ----------

  // Quita del plan global los renglones cuyos pedidos ya salieron de la
  // cartera (nota de entrega / anulación). Los guardados NO se mutan: son
  // historia y muestran `closedLines` en la lista/detalle.
  async pruneClosedOrders(orderNumbers: string[]): Promise<{ removed: number }> {
    if (orderNumbers.length === 0) return { removed: 0 };
    const closed = new Set(orderNumbers);
    const draft = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!draft) return { removed: 0 };
    // No pisar a quien está editando: el cliente resuelve los renglones
    // cerrados al hidratar y el borrador se poda en la siguiente ventana.
    if (lockIsActive(draft) && draft.lockedById) return { removed: 0 };
    const payload = this.parseDraftPayload(draft);
    const selected = payload.selected.filter((ref) => !closed.has(ref.orderNumber));
    const removed = payload.selected.length - selected.length;
    if (removed === 0) return { removed: 0 };
    const loadPlan = payload.loadPlan
      ? {
          ...payload.loadPlan,
          segments: payload.loadPlan.segments
            .map((segment) => ({
              ...segment,
              orderNumbers: segment.orderNumbers.filter((number) => !closed.has(number)),
            }))
            .filter((segment) => segment.orderNumbers.length > 0),
        }
      : null;
    const next: ScenarioPayload = { ...payload, selected, loadPlan };
    await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: {
        payload: JSON.stringify(next),
        lineCount: selected.length,
        version: { increment: 1 },
      },
    });
    return { removed };
  }

  // ---------- Internos ----------

  private async findSaved(id: string): Promise<DispatchScenario & { owner?: { profitCode: string; displayName: string } | null }> {
    const row = await this.prisma.dispatchScenario.findFirst({
      where: { id, kind: 'SAVED' },
      include: { owner: { select: { profitCode: true, displayName: true } } },
    });
    if (!row) throw new NotFoundException('Simulación no encontrada.');
    return row;
  }

  // El JWT no trae el nombre visible: se resuelve una vez para el lock y la
  // auditoría del plan global.
  private async withName(actor: ScenarioActor): Promise<ScenarioActor> {
    if (actor.name || !actor.id) return actor;
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { displayName: true } });
    return { ...actor, name: user?.displayName ?? null };
  }

  private assertCanEdit(row: DispatchScenario, viewer: ScenarioViewer): void {
    if (!viewer.isAdmin && row.ownerId !== viewer.id) {
      throw new ForbiddenException('Solo quien creó la simulación o un administrador puede modificarla.');
    }
  }

  private async createEmptyDraft(actor: ScenarioActor): Promise<DispatchDraft> {
    const payload = emptyPayload();
    return this.prisma.dispatchDraft.create({
      data: {
        id: 'GLOBAL',
        payload: JSON.stringify(payload),
        ...this.derive(payload),
        dataVersion: await this.currentDataVersion(),
        lockedById: actor.id ?? null,
        lockedByName: actor.name ?? null,
        updatedById: actor.id ?? null,
        updatedByCode: actor.code ?? null,
        updatedByName: actor.name ?? null,
      },
    });
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

  // Renglones de cada escenario cuyo pedido ya está cerrado. Se consulta en
  // lotes para no reventar el límite de parámetros de SQLite.
  private async closedLinesMap(rows: Array<DispatchScenario>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (rows.length === 0) return result;
    const refsByScenario = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const row of rows) {
      const payload = this.parsePayloadQuiet(row.payload);
      const refs = new Set((payload?.selected ?? []).map((ref) => ref.orderNumber));
      refsByScenario.set(row.id, refs);
      for (const ref of refs) all.add(ref);
    }
    if (all.size === 0) return result;

    const closed = new Set<string>();
    const list = [...all];
    const chunk = 400;
    for (let index = 0; index < list.length; index += chunk) {
      const slice = list.slice(index, index + chunk);
      const orders = await this.prisma.salesOrder.findMany({
        where: { externalNumber: { in: slice } },
        select: { externalNumber: true, status: true, isActive: true },
      });
      for (const order of orders) {
        if (!order.isActive || ['NOTA_ENTREGA', 'CERRADO', 'CANCELADO'].includes(order.status)) {
          closed.add(order.externalNumber);
        }
      }
    }
    for (const [scenarioId, refs] of refsByScenario) {
      let count = 0;
      for (const ref of refs) if (closed.has(ref)) count += 1;
      result.set(scenarioId, count);
    }
    return result;
  }

  private toListItem(
    row: ScenarioRow,
    viewer: ScenarioViewer,
    dataVersion: string | null,
    closedLines = 0,
  ): ScenarioListItem {
    const canManage = viewer.isAdmin || row.ownerId === viewer.id;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === 'DRAFT' ? 'DRAFT' : 'SAVED',
      ownerId: row.ownerId,
      ownerCode: row.owner?.profitCode ?? null,
      ownerName: row.owner?.displayName ?? null,
      lineCount: row.lineCount,
      sacks: toNumber(row.sacks),
      assignedKg: toNumber(row.assignedKg),
      missingKg: toNumber(row.missingKg),
      coverage: row.coverage,
      stale: Boolean(row.dataVersion && dataVersion && row.dataVersion !== dataVersion),
      version: row.version,
      restoredAt: row.restoredAt ? row.restoredAt.toISOString() : null,
      restoreCount: row._count?.restores ?? 0,
      canEdit: canManage,
      canDelete: canManage,
      canRestore: canManage,
      closedLines,
      lock: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDraftDetail(row: DispatchDraft, viewer: ScenarioViewer, dataVersion: string | null): ScenarioDetail {
    const lock = this.lockFor(row, viewer);
    return {
      id: 'GLOBAL',
      name: 'Plan global',
      kind: 'DRAFT',
      ownerId: row.updatedById ?? 'GLOBAL',
      ownerCode: row.updatedByCode ?? null,
      ownerName: row.updatedByName ?? null,
      lineCount: row.lineCount,
      sacks: toNumber(row.sacks),
      assignedKg: toNumber(row.assignedKg),
      missingKg: toNumber(row.missingKg),
      coverage: row.coverage,
      stale: Boolean(row.dataVersion && dataVersion && row.dataVersion !== dataVersion),
      version: row.version,
      restoredAt: null,
      restoreCount: 0,
      canEdit: lock === null || lock.isMine,
      canDelete: false,
      canRestore: true,
      closedLines: 0,
      lock,
      payload: this.parseDraftPayload(row),
      restores: [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private lockFor(row: DispatchDraft, viewer: ScenarioViewer): ScenarioLock | null {
    if (!lockIsActive(row)) return null;
    const isMine = row.lockedById === viewer.id;
    return {
      holderId: row.lockedById ?? null,
      holderName: row.lockedByName ?? null,
      until: iso(row.lockedUntil),
      isMine,
      token: isMine ? row.lockToken : null,
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

  private parsePayloadQuiet(raw: string): ScenarioPayload | null {
    try {
      return zScenarioPayload.parse(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  private parseDraftPayload(row: DispatchDraft): ScenarioPayload {
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

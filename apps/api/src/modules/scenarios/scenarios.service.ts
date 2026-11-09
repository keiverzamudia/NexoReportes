import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DraftDispatchImpact,
  DraftReleaseInput,
  MAX_SCENARIOS,
  ScenarioDetail,
  ScenarioDraftInput,
  ScenarioDraftResponse,
  ScenarioListItem,
  ScenarioListResponse,
  ScenarioLock,
  ScenarioLockResponse,
  ScenarioPayload,
  ScenarioRestoreInput,
  ScenarioRestoreLog,
  ScenarioSaveInput,
  ScenarioSendDispatchInput,
  ScenarioUpdateInput,
  SCENARIO_LOCK_SECONDS,
  zScenarioPayload,
} from '@nexo/contracts';
import { DispatchDraft, DispatchScenario, DispatchScenarioRestore } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { DispatchService, DispatchViewer } from '../dispatch/dispatch.service';
import { buildDraftPlan, draftLineKey } from './draft-plan';

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
  /** Permiso «Quitar selecciones de otros» (pedidos:override). */
  canOverride?: boolean;
}

export type ScenarioViewerInput = string | ScenarioViewer;
export type ScenarioActorInput = string | ScenarioActor;

function asViewer(input: ScenarioViewerInput): ScenarioViewer {
  return typeof input === 'string' ? { id: input, isAdmin: false, canOverride: false } : input;
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
    private readonly dispatch: DispatchService,
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

  // Plan vivo del equipo (o vacío si nadie lo ha guardado todavía). Devuelve
  // los renglones resueltos y la asignación calculada en el servidor, para que
  // todas las pantallas vean el mismo compromiso y el mismo stock libre.
  async getDraft(viewerInput: ScenarioViewerInput): Promise<ScenarioDraftResponse> {
    const viewer = asViewer(viewerInput);
    const row = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!row) {
      return { scenario: null, lines: [], assignments: [], freeByProduct: [], activeSheet: null, dispatchImpact: null };
    }
    const dataVersion = await this.currentDataVersion();
    return this.buildDraftResponse(row, viewer, dataVersion);
  }

  private async buildDraftResponse(
    row: DispatchDraft,
    viewer: ScenarioViewer,
    dataVersion: string | null,
    dispatchImpact: DraftDispatchImpact | null = null,
  ): Promise<ScenarioDraftResponse> {
    const payload = this.parseDraftPayload(row);
    const plan = await buildDraftPlan(this.prisma, payload.selected);
    const activeSheet = await this.prisma.dispatchSheet.findFirst({
      where: { draftId: 'GLOBAL', status: { notIn: ['DESPACHADO', 'CANCELADO'] } },
      orderBy: { sentAt: 'desc' },
      select: { id: true, number: true, status: true },
    });
    return {
      scenario: this.toDraftDetail(row, viewer, dataVersion),
      lines: plan.lines,
      assignments: plan.assignments,
      freeByProduct: plan.freeByProduct,
      activeSheet,
      dispatchImpact,
    };
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
    const actorId = actor.id;
    if (!actorId) throw new ForbiddenException('Sesión requerida');
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

  // ---------- Escritura del plan compartido ----------

  // Autoguardado del plan del equipo. No hay lock: aplica un DIFF sobre la
  // selección vigente. Lo ajeno nunca se borra sin `pedidos:override`; lo nuevo
  // se marca a nombre de quien guarda. El primero que guarda se queda con el
  // renglón (los demás lo ven tomado en el siguiente refresco).
  async saveDraft(
    actorInput: ScenarioActorInput,
    input: ScenarioDraftInput,
    viewerInput?: ScenarioViewerInput,
  ): Promise<ScenarioDraftResponse> {
    let actor = asActor(actorInput);
    const actorId = actor.id;
    if (!actorId) throw new ForbiddenException('Sesión requerida');
    actor = await this.withName(actor);
    const viewer = viewerInput
      ? asViewer(viewerInput)
      : { id: actor.id!, isAdmin: false, canOverride: false };

    let existing = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!existing) existing = await this.createEmptyDraft(actor);

    const previous = this.parseDraftPayload(existing);
    const current = previous.selected;
    const canOverride = Boolean(viewer.isAdmin || viewer.canOverride);
    const incomingKeys = new Set(input.selected.map(draftLineKey));
    const currentByKey = new Map(current.map((ref) => [draftLineKey(ref), ref]));
    const now = new Date().toISOString();

    // Lo que sigue en el plan conserva dueño y orden de marcado.
    const kept: typeof current = [];
    for (const ref of current) {
      if (incomingKeys.has(draftLineKey(ref))) {
        kept.push(ref);
        continue;
      }
      const removable = canOverride || !ref.selectedById || ref.selectedById === actorId;
      if (removable) continue;
      kept.push(ref);
    }

    // Lo nuevo se marca al final: el orden del arreglo es el turno de reserva.
    const added: typeof current = [];
    for (const ref of input.selected) {
      if (currentByKey.has(draftLineKey(ref))) continue;
      added.push({
        orderNumber: ref.orderNumber,
        productCode: ref.productCode,
        selectedById: actorId,
        selectedByName: actor.name ?? null,
        selectedAt: now,
      });
    }

    const payload: ScenarioPayload = {
      recipe: input.recipe,
      selected: [...kept, ...added],
      snapshot: null,
      loadPlan: input.loadPlan ?? null,
      comments: input.comments ?? previous.comments ?? {},
    };
    const dataVersion = await this.currentDataVersion();
    const row = await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: {
        payload: JSON.stringify(payload),
        dataVersion,
        ...this.derive(payload),
        updatedById: actor.id,
        updatedByCode: actor.code ?? null,
        updatedByName: actor.name ?? null,
        version: { increment: 1 },
      },
    });

    const impact = await this.syncSheetSafely(row, {
      actor,
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });
    return this.buildDraftResponse(row, viewer, dataVersion, impact);
  }

  // Libera selecciones. `all` exige override; `lines` respeta al dueño; sin
  // lista libera solo lo marcado por quien pide.
  async releaseDraftLines(
    actorInput: ScenarioActorInput,
    input: DraftReleaseInput,
    viewerInput?: ScenarioViewerInput,
  ): Promise<ScenarioDraftResponse> {
    let actor = asActor(actorInput);
    const actorId = actor.id;
    if (!actorId) throw new ForbiddenException('Sesión requerida');
    actor = await this.withName(actor);
    const viewer = viewerInput
      ? asViewer(viewerInput)
      : { id: actor.id!, isAdmin: false, canOverride: false };
    const canOverride = Boolean(viewer.isAdmin || viewer.canOverride);

    const existing = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!existing) {
      return { scenario: null, lines: [], assignments: [], freeByProduct: [], activeSheet: null, dispatchImpact: null };
    }
    if (input.all && !canOverride) {
      throw new ForbiddenException(
        'Solo un administrador o quien tenga «Quitar selecciones de otros» puede liberar todo.',
      );
    }

    const payload = this.parseDraftPayload(existing);
    const keys = new Set((input.lines ?? []).map(draftLineKey));
    const selected = payload.selected.filter((ref) => {
      if (input.all) return false;
      if (keys.size > 0 && !keys.has(draftLineKey(ref))) return true;
      if (ref.selectedById === actorId) return false;
      if (keys.size > 0) return !canOverride;
      return true;
    });

    const removed = payload.selected.length - selected.length;
    const keptOrders = new Set(selected.map((ref) => ref.orderNumber));
    const loadPlan = payload.loadPlan
      ? {
          ...payload.loadPlan,
          segments: payload.loadPlan.segments
            .map((segment) => ({
              ...segment,
              orderNumbers: segment.orderNumbers.filter((number) => keptOrders.has(number)),
            }))
            .filter((segment) => segment.orderNumbers.length > 0),
        }
      : null;
    const keptKeys = new Set(selected.map((ref) => draftLineKey(ref)));
    const comments = Object.fromEntries(
      Object.entries(payload.comments ?? {}).filter(([key]) => keptKeys.has(key)),
    );
    const next: ScenarioPayload = { ...payload, selected, loadPlan, comments };
    const dataVersion = await this.currentDataVersion();
    const row = await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: {
        payload: JSON.stringify(next),
        dataVersion,
        ...this.derive(next),
        updatedById: actor.id,
        updatedByCode: actor.code ?? null,
        updatedByName: actor.name ?? null,
        version: { increment: 1 },
      },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code ?? null,
      action: 'SCENARIO_RELEASE',
      entityType: 'DispatchDraft',
      entityId: 'GLOBAL',
      context: { removed, all: Boolean(input.all) },
    });
    const impact = await this.syncSheetSafely(row, {
      actor,
      defaultReason: 'RETIRADO_DEL_PLAN',
      source: 'PLAN',
    });
    return this.buildDraftResponse(row, viewer, dataVersion, impact);
  }

  // Envía la simulación VIVA al almacén. La hoja queda enlazada al borrador y
  // se actualiza sola mientras sus renglones no estén CARGADOS.
  async sendDraftToDispatch(
    viewerInput: ScenarioViewerInput,
    actorInput: ScenarioActorInput,
    dispatchViewer: DispatchViewer,
    input: ScenarioSendDispatchInput,
  ) {
    let actor = asActor(actorInput);
    const actorId = actor.id;
    if (!actorId) throw new ForbiddenException('Sesión requerida');
    actor = await this.withName(actor);
    const row = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!row) throw new ConflictException('No hay una simulación del equipo para enviar.');
    const payload = this.parseDraftPayload(row);
    if (payload.selected.length === 0) {
      throw new ConflictException('Marca al menos un renglón antes de enviar la simulación.');
    }

    const plan = await buildDraftPlan(this.prisma, payload.selected);
    if (plan.lines.length === 0) {
      throw new ConflictException('Los renglones marcados ya no están en la cartera. Actualiza y vuelve a intentar.');
    }
    const assignmentByKey = new Map(plan.assignments.map((item) => [draftLineKey(item), item]));
    const snapshotLines = plan.lines.map((line, index) => {
      const assignment = assignmentByKey.get(draftLineKey(line))!;
      return {
        orderNumber: line.orderNumber,
        productCode: line.productCode,
        selectedById: payload.selected.find((ref) => draftLineKey(ref) === draftLineKey(line))?.selectedById ?? null,
        selectedByName: payload.selected.find((ref) => draftLineKey(ref) === draftLineKey(line))?.selectedByName ?? null,
        selectedAt: payload.selected.find((ref) => draftLineKey(ref) === draftLineKey(line))?.selectedAt ?? null,
        customerCode: line.customerCode,
        customerName: line.customerName,
        description: line.description,
        uom: line.uom,
        pendingQty: line.pendingQty,
        pendingKg: line.pendingKg,
        assignedQty: assignment.assignedQty,
        assignedKg: assignment.assignedKg,
        missingQty: assignment.missingQty,
        missingKg: assignment.missingKg,
        stockTotal: assignment.stockTotal,
        effectiveDate: line.tentativeDate ?? line.requestedDate,
        priority: index + 1,
        comment: payload.comments?.[draftLineKey(line)] ?? null,
      };
    });
    const totalKg = snapshotLines.reduce((sum, line) => sum + line.assignedKg, 0);
    const missingKg = snapshotLines.reduce((sum, line) => sum + line.missingKg, 0);
    const snapshot = {
      takenAt: new Date().toISOString(),
      carteraLines: plan.lines.length,
      totals: {
        lines: snapshotLines.length,
        sacks: snapshotLines.reduce((sum, line) => sum + (line.uom === 'SAC' ? line.assignedQty : 0), 0),
        pendingQty: snapshotLines.reduce((sum, line) => sum + line.pendingQty, 0),
        pendingKg: snapshotLines.reduce((sum, line) => sum + (line.pendingKg ?? 0), 0),
        assignedQty: snapshotLines.reduce((sum, line) => sum + line.assignedQty, 0),
        assignedKg: totalKg,
        missingQty: snapshotLines.reduce((sum, line) => sum + line.missingQty, 0),
        missingKg,
        coverage: totalKg + missingKg > 0 ? totalKg / (totalKg + missingKg) : 1,
      },
      lines: snapshotLines,
    };

    const payloadWithSnapshot: ScenarioPayload = { ...payload, snapshot };
    return this.dispatch.createFromDraft(
      dispatchViewer,
      {
        title: input.title?.trim() || 'Simulación del equipo',
        instructions: input.instructions,
        assignedToId: input.assignedToId ?? null,
      },
      payloadWithSnapshot,
      row.version,
      actor,
    );
  }

  // El guardado nunca debe fallar porque el almacén no pudo sincronizarse.
  private async syncSheetSafely(
    row: DispatchDraft,
    context: Parameters<DispatchService['syncFromDraft']>[1],
  ): Promise<DraftDispatchImpact | null> {
    try {
      const report = await this.dispatch.syncFromDraft(row.id, context);
      if (!report || (report.removedLines === 0 && report.canceledSheets.length === 0)) return null;
      return {
        removedLines: report.removedLines,
        sheetNumbers: report.sheetNumbers,
        canceledSheets: report.canceledSheets,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo sincronizar la hoja de despacho: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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
      comments: input.comments ?? {},
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
  // cartera (nota de entrega / anulación) y sincroniza las hojas abiertas para
  // que esos renglones queden ANULADOS con su motivo. Los guardados NO se
  // mutan: son historia y muestran `closedLines` en la lista/detalle.
  async pruneClosedOrders(
    items: Array<{ orderNumber: string; reason: string }>,
  ): Promise<{ removed: number }> {
    if (items.length === 0) return { removed: 0 };
    const closed = new Set(items.map((item) => item.orderNumber));
    const reasonByOrder = new Map(
      items.map((item) => [
        item.orderNumber,
        item.reason === 'CANCELADO' ? 'PEDIDO_ANULADO_EN_PROFIT' : 'PEDIDO_CERRADO_EN_PROFIT',
      ]),
    );
    const draft = await this.prisma.dispatchDraft.findUnique({ where: { id: 'GLOBAL' } });
    if (!draft) return { removed: 0 };
    // Ya no hay lock de pantalla: el plan se poda siempre y el cliente
    // reconcilia los renglones cerrados en el siguiente refresco.
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
    next.comments = Object.fromEntries(
      Object.entries(payload.comments ?? {}).filter(([key]) => selected.some((ref) => draftLineKey(ref) === key)),
    );
    const row = await this.prisma.dispatchDraft.update({
      where: { id: 'GLOBAL' },
      data: {
        payload: JSON.stringify(next),
        lineCount: selected.length,
        version: { increment: 1 },
      },
    });
    // Atribución correcta: el que anuló fue Profit, no el siguiente usuario
    // que abra la pantalla de Pedidos.
    await this.syncSheetSafely(row, {
      actor: { id: null, code: 'PROFIT', name: 'Profit' },
      reasonByOrder,
      source: 'PROFIT',
      defaultReason: 'PEDIDO_CERRADO_EN_PROFIT',
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
    return {
      id: 'GLOBAL',
      name: 'Plan del equipo',
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
      // Sin lock: cualquiera con permiso puede sumar renglones; la propiedad
      // se controla por renglón, no por pantalla.
      canEdit: true,
      canDelete: false,
      canRestore: true,
      closedLines: 0,
      lock: null,
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

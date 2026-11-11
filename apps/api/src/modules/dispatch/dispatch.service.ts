import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DispatchAckInput,
  DispatchAssigneesResponse,
  DispatchCancelInput,
  DispatchCompleteInput,
  DispatchCustomerInvoiceInput,
  DispatchCustomerKeyInput,
  DispatchCustomerProgress,
  DispatchCustomerReopenInput,
  DispatchEventMeta,
  DispatchEventProduct,
  DispatchInvoiceInput,
  DispatchLineInput,
  DispatchMessageInput,
  DispatchMetricsQuery,
  DispatchMetricsResponse,
  DispatchPulse,
  DispatchReopenInvoiceInput,
  DispatchRemovalsQuery,
  DispatchRemovalsResponse,
  DispatchSheetCreateInput,
  DispatchSheetDetail,
  DispatchSheetEvent,
  DispatchSheetLine,
  DispatchSheetListResponse,
  DispatchSheetQuery,
  DispatchSheetSummary,
  DraftAssignment,
  LoadPlan,
  Notification,
  NotificationReadInput,
  NotificationListResponse,
  OrderGroupLine,
  ScenarioPayload,
  zDispatchEventMeta,
  zLoadPlan,
  zScenarioPayload,
} from '@nexo/contracts';
import {
  DispatchCustomerProgress as ProgressRow,
  DispatchSheet,
  DispatchSheetEvent as EventRow,
  DispatchSheetLine as LineRow,
  Prisma,
} from '@prisma/client';
import { buildDispatchMetrics } from './dispatch-metrics';
import { buildDispatchPulse } from './dispatch-pulse';
import { buildDispatchRemovals } from './dispatch-removals';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { ArrivalsService, ArrivalSourceLine } from '../arrivals/arrivals.service';
import { buildDraftPlan, draftLineKey } from '../scenarios/draft-plan';

// ============================================================
// Despacho de almacén: hoja de trabajo + túnel de acuses.
//
// Un despacho nace de un escenario guardado del simulador. El planificador lo
// publica, el almacén lo recibe, resuelve cada renglón (cargado, parcial con X
// unidades o no cargado con motivo) y lo cierra. Cada paso deja: sello
// temporal, evento en la bitácora y notificación al otro lado. Nada de esto
// escribe en Profit.
//
// Máquina de estados (validada aquí, no en el controlador):
//   ENVIADO → RECIBIDO → EN_PROCESO → { CON_NOVEDAD ⇄ EN_PROCESO } → DESPACHADO
//   { ENVIADO | RECIBIDO | EN_PROCESO | CON_NOVEDAD } → CANCELADO
// ============================================================

export interface DispatchViewer {
  id: string;
  role: string;
  // La bitácora solo se entrega al rol ADMIN (ver `detail`/`message`).
  isAdmin?: boolean;
  // Permiso `despacho:create`: armar y enviar simulaciones al almacén.
  canPublish?: boolean;
  // Permiso individual `despacho:view_all`: ve toda la bandeja e historial.
  canViewAll?: boolean;
  // Vistas separadas de la bandeja (`despacho:view_history` / `view_removals`).
  canViewHistory?: boolean;
  canViewRemovals?: boolean;
  // Permisos de la matriz (independientes del rol histórico).
  canUpdate?: boolean;
  canDelete?: boolean;
  code?: string | null;
  name?: string | null;
}

interface ViewerInfo {
  id: string;
  code: string | null;
  name: string | null;
}

export interface SyncActor {
  id?: string | null;
  code?: string | null;
  name?: string | null;
}

export interface DispatchSyncContext {
  actor?: SyncActor | null;
  // Motivo por pedido (Profit): CANCELADO → PEDIDO_ANULADO_EN_PROFIT,
  // NOTA_ENTREGA → PEDIDO_CERRADO_EN_PROFIT.
  reasonByOrder?: Map<string, string> | null;
  // Motivo por defecto para los renglones retirados del plan.
  defaultReason?: string;
  source?: 'PLAN' | 'PROFIT' | 'SYSTEM';
}

export interface DispatchSyncRemoval {
  sheetId: string;
  sheetNumber: string;
  orderNumber: string;
  productCode: string;
  customerName: string | null;
  reason: string;
}

export interface DispatchSyncReport {
  removedLines: number;
  sheetNumbers: string[];
  canceledSheets: Array<{ id: string; number: string }>;
  removals: DispatchSyncRemoval[];
}

type LineRowLite = Pick<
  LineRow,
  | 'id'
  | 'position'
  | 'orderNumber'
  | 'productCode'
  | 'description'
  | 'status'
  | 'effectiveDate'
  | 'customerCode'
  | 'customerName'
  | 'plannedQty'
  | 'plannedKg'
  | 'loadedQty'
  | 'loadedKg'
  | 'uom'
  | 'note'
  | 'checkedAt'
  | 'checkedById'
  | 'checkedByName'
>;

type SheetWithLines = DispatchSheet & {
  lines: LineRowLite[];
  assignedTo?: { displayName: string } | null;
  customerProgress?: ProgressRow[];
};

interface CustomerGroupBucket {
  key: string;
  code: string | null;
  name: string;
  lines: LineRowLite[];
}

const SIN_CLIENTE = 'SIN_CLIENTE';

const OPEN_STATUSES = ['ENVIADO', 'RECIBIDO', 'EN_PROCESO', 'CON_NOVEDAD'];
const OPERATOR_ROLES = ['ALMACEN', 'ADMIN'];
const PLANNER_ROLES = ['PLANIFICADOR', 'GERENCIA', 'ADMIN'];
// Estos roles ven toda la bandeja, incluido el historial cerrado por otros.
const FULL_VISIBILITY_ROLES = ['ADMIN', 'GERENCIA', 'ALMACEN'];
const NOVEDAD_LINE_STATUSES = ['PARCIAL', 'FALTANTE', 'NOVEDAD'];

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Clave estable del cliente dentro de una hoja. */
function customerKey(line: { customerCode: string | null; customerName: string | null }): string {
  const code = line.customerCode?.trim();
  if (code) return code;
  const name = line.customerName?.trim();
  if (name) return name;
  return SIN_CLIENTE;
}

/** Fecha de negocio (America/Caracas) de un instante. */
function businessDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

function durationLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}

/** Lee el detalle congelado de un evento; si no es válido, la bitácora cae al texto. */
function parseEventMeta(raw: string | null | undefined): DispatchEventMeta | null {
  if (!raw) return null;
  try {
    const parsed = zDispatchEventMeta.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Las llegadas de PCP nacen con el despacho: sin botón ni paso extra.
    private readonly arrivals: ArrivalsService,
  ) {}

  // ---------- Bandeja ----------

  async list(viewer: DispatchViewer, query: DispatchSheetQuery): Promise<DispatchSheetListResponse> {
    // El historial es una vista aparte: entrada a la bandeja no implica ver
    // hojas cerradas por otros.
    if (query.scope === 'history' && !viewer.canViewHistory) {
      throw new ForbiddenException('No tienes permiso para ver el historial de despachos.');
    }
    const where = this.visibilityWhere(viewer, query);
    const rows = await this.prisma.dispatchSheet.findMany({
      where,
      include: {
        lines: { select: LINE_LITE },
        assignedTo: { select: { displayName: true } },
        customerProgress: true,
      },
      orderBy: [{ sentAt: 'asc' }],
      take: 300,
    });

    const summaries = rows.map((row) => this.toSummary(row, viewer));
    const items = query.status ? summaries.filter((item) => item.status === query.status) : summaries;

    const counters = {
      pending: summaries.filter((item) => item.status === 'ENVIADO').length,
      inProgress: summaries.filter((item) => ['RECIBIDO', 'EN_PROCESO', 'CON_NOVEDAD'].includes(item.status)).length,
      doneToday: summaries.filter(
        (item) => item.status === 'DESPACHADO' && item.completedAt !== null && new Date(item.completedAt) >= todayStart(),
      ).length,
      kgPending: round2(
        summaries
          .filter((item) => OPEN_STATUSES.includes(item.status))
          .reduce((sum, item) => sum + Math.max(0, item.plannedKg - item.loadedKg), 0),
      ),
      kgDoneToday: round2(
        summaries
          .filter((item) => item.status === 'DESPACHADO' && item.completedAt !== null && new Date(item.completedAt) >= todayStart())
          .reduce((sum, item) => sum + item.loadedKg, 0),
      ),
    };

    return { items, total: items.length, counters };
  }

  /**
   * Pulso de carga: solo lo que falta por cargar en las hojas abiertas.
   * Se calcula aparte de `list()` para que no dependa del tab o del filtro
   * activo (Pendientes / Publicados / Historial) y para poder protegerlo con
   * el permiso `despacho:view_summary`.
   */
  async pulse(viewer: DispatchViewer): Promise<DispatchPulse> {
    const rows = await this.prisma.dispatchSheet.findMany({
      where: { AND: [this.baseVisibility(viewer), { status: { in: OPEN_STATUSES } }] },
      include: { lines: { select: LINE_LITE } },
      orderBy: [{ sentAt: 'asc' }],
      take: 300,
    });
    return buildDispatchPulse(rows);
  }

  async detail(viewer: DispatchViewer, id: string): Promise<DispatchSheetDetail> {
    const sheet = await this.prisma.dispatchSheet.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        assignedTo: { select: { displayName: true } },
        customerProgress: true,
      },
    });
    // Un despacho ajeno responde 404: no se filtra su existencia.
    if (!sheet || !this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');

    return {
      ...this.toSummary(sheet, viewer),
      lines: sheet.lines.map((line) => this.toLine(line, sheet)),
      events: this.eventsFor(sheet, viewer),
      loadPlan: this.parseLoadPlan(sheet.loadPlanJson),
      customerProgress: this.toProgressList(sheet),
    };
  }

  /**
   * Operadores = usuarios activos cuyo rol tiene `despacho:update`.
   * Ya no se depende de los códigos fijos ALMACEN/ADMIN: un rol nuevo puede
   * recibir la acción «Operar» desde la matriz de permisos.
   */
  private async operatorCandidates(): Promise<
    Array<{ id: string; code: string; displayName: string; role: string; baseRole: string }>
  > {
    const [granted, overrides] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { module: 'despacho', action: 'update' },
        select: { roleCode: true },
      }),
      // Una excepción individual puede conceder «Operar» aunque el rol no lo
      // tenga: esa persona también debe aparecer como operador.
      this.prisma.userPermission.findMany({
        where: { module: 'despacho', action: 'update', allowed: true },
        select: { userId: true },
      }),
    ]);
    const roleCodes = granted.map((row) => row.roleCode);
    const directUserIds = overrides.map((row) => row.userId);
    if (roleCodes.length === 0 && directUserIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(roleCodes.length > 0 || directUserIds.length > 0
          ? {
              OR: [
                ...(roleCodes.length > 0 ? [{ role: { in: roleCodes } }] : []),
                ...(directUserIds.length > 0 ? [{ id: { in: directUserIds } }] : []),
              ],
            }
          : {}),
      },
      select: { id: true, profitCode: true, displayName: true, role: true },
    });
    const roles = await this.prisma.role.findMany({
      where: { code: { in: [...new Set(users.map((user) => user.role))] } },
      select: { code: true, baseRole: true },
    });
    const baseByRole = new Map(roles.map((role) => [role.code, role.baseRole]));
    return users
      .map((user) => ({
        id: user.id,
        code: user.profitCode,
        displayName: user.displayName,
        role: user.role,
        baseRole: baseByRole.get(user.role) ?? 'CONSULTA',
      }))
      // Primero la plantilla ALMACEN (es quien realmente opera); después el
      // resto por nombre. Conserva el orden útil del selector.
      .sort((a, b) => {
        if (a.baseRole !== b.baseRole) {
          if (a.baseRole === 'ALMACEN') return -1;
          if (b.baseRole === 'ALMACEN') return 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }

  // Usuarios a los que se puede asignar un despacho (bandeja compartida si no).
  // `hasWarehouseOperators` es la condición para poder publicar: sin operadores
  // de almacén activos el aviso no tendría a quién llegar.
  async assignees(): Promise<DispatchAssigneesResponse> {
    const candidates = await this.operatorCandidates();
    const operators = candidates.map((user) => ({
      id: user.id,
      code: user.code,
      displayName: user.displayName,
      role: user.role,
    }));
    return {
      operators,
      hasWarehouseOperators: candidates.some((operator) => operator.baseRole === 'ALMACEN'),
    };
  }

  // ---------- Publicar ----------

  async create(viewer: DispatchViewer, input: DispatchSheetCreateInput): Promise<DispatchSheetDetail> {
    if (!viewer.canPublish) {
      throw new ForbiddenException(
        'No tienes el permiso «Armar y enviar simulación» en Despacho.',
      );
    }
    const actor = await this.viewerInfo(viewer);

    // Sin operadores de almacén el despacho cae en la bandeja compartida: no
    // se bloquea el envío desde el simulador, solo se avisa a quien exista.
    const candidates = await this.operatorCandidates();

    const scenario = await this.prisma.dispatchScenario.findFirst({
      where: { id: input.scenarioId, kind: 'SAVED' },
    });
    if (!scenario) {
      throw new NotFoundException('No encontramos ese escenario guardado. Guarda el plan en Pedidos y vuelve a intentar.');
    }
    const payload = zScenarioPayload.parse(JSON.parse(scenario.payload) as unknown);
    const snapshot = payload.snapshot;
    if (!snapshot || snapshot.lines.length === 0) {
      throw new BadRequestException('Ese escenario no tiene un plan con renglones. Restáuralo en Pedidos y guárdalo de nuevo.');
    }

    let assignee: { id: string; displayName: string } | null = null;
    if (input.assignedToId) {
      const user = candidates.find((candidate) => candidate.id === input.assignedToId);
      if (!user) throw new BadRequestException('El operador elegido no está disponible.');
      assignee = { id: user.id, displayName: user.displayName };
    }

    const lines = [...snapshot.lines].sort((a, b) => a.priority - b.priority);
    const plannedSacks = round2(lines.reduce((sum, line) => sum + (line.uom === 'SAC' ? line.assignedQty : 0), 0));
    const plannedKg = round2(lines.reduce((sum, line) => sum + line.assignedKg, 0));
    const destination = assignee ? assignee.displayName : 'todo el almacén';

    const arrivalLines: ArrivalSourceLine[] = lines.map((line) => ({
      orderNumber: line.orderNumber,
      customerCode: line.customerCode ?? null,
      customerName: line.customerName ?? null,
      uom: line.uom ?? null,
      effectiveDate: line.effectiveDate ?? null,
      plannedQty: line.assignedQty,
      plannedKg: line.assignedKg,
    }));
    let arrivalCount = 0;

    const sheet = await this.createWithNumber(async (number) => {
      // Los clientes esperados en planta (PCP) se crean en el mismo `create`:
      // o queda el despacho con sus llegadas, o no queda nada.
      const arrivalRows = await this.arrivals.rowsForSheet({
        sheetNumber: number,
        sheetTitle: input.title,
        lines: arrivalLines,
        actor,
      });
      arrivalCount = arrivalRows.length;
      return this.prisma.dispatchSheet.create({
        data: {
          number,
          title: input.title,
          status: 'ENVIADO',
          instructions: input.instructions ?? null,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          recipeJson: JSON.stringify(payload.recipe),
          photoJson: JSON.stringify(snapshot),
          loadPlanJson: payload.loadPlan ? JSON.stringify(payload.loadPlan) : null,
          assignedToId: assignee?.id ?? null,
          assignedRole: 'ALMACEN',
          createdById: actor.id,
          createdByCode: actor.code,
          createdByName: actor.name,
          sentAt: new Date(),
          plannedLines: lines.length,
          plannedSacks,
          plannedKg,
          lines: {
            create: lines.map((line, index) => ({
              position: index + 1,
              orderNumber: line.orderNumber,
              productCode: line.productCode,
              description: line.description,
              uom: line.uom,
              customerCode: line.customerCode,
              customerName: line.customerName,
              warehouseCode: null,
              effectiveDate: line.effectiveDate,
              plannedQty: line.assignedQty,
              plannedKg: line.assignedKg,
              // El comentario de la simulación viaja al renglón del almacén.
              note: line.comment ?? null,
              status: 'PENDIENTE',
            })),
          },
          events: {
            create: {
              kind: 'SYSTEM',
              type: 'ENVIADO',
              body: `Despacho enviado a ${destination}.`,
              authorId: actor.id,
              authorCode: actor.code,
              authorName: actor.name,
            },
          },
          arrivals: { create: arrivalRows },
          customerProgress: { create: this.progressSeed(lines) },
        },
        include: {
          lines: { orderBy: { position: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
          assignedTo: { select: { displayName: true } },
          customerProgress: true,
        },
      });
    });

    await this.notify(await this.operatorRecipients(sheet), {
      type: 'DESPACHO_ENVIADO',
      title: `Nuevo despacho ${sheet.number}`,
      body: `${sheet.title} · ${lines.length} renglón(es) · ${plannedSacks} sacos · ${plannedKg} kg`,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });

    // PCP recibe a sus clientes en la misma publicación: sin botón extra.
    await this.arrivals.notifyExpected(sheet, { customers: arrivalCount, kg: plannedKg }, actor);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_SEND',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, lines: lines.length, plannedKg, assignedTo: assignee?.id ?? 'ALMACEN' },
    });

    return {
      ...this.toSummary(sheet, viewer),
      lines: sheet.lines.map((line) => this.toLine(line, sheet)),
      events: this.eventsFor(sheet, viewer),
      loadPlan: this.parseLoadPlan(sheet.loadPlanJson),
      customerProgress: this.toProgressList(sheet),
    };
  }

  // Publica la simulación VIVA del equipo. No nace de un escenario guardado:
  // queda enlazada al borrador (`draftId`) y se actualiza sola mientras sus
  // renglones no estén CARGADOS.
  async createFromDraft(
    viewer: DispatchViewer,
    input: { title: string; instructions?: string; assignedToId?: string | null },
    payload: ScenarioPayload,
    draftRevision: number,
    actorInput?: { id?: string | null; code?: string | null; name?: string | null },
  ): Promise<DispatchSheetDetail> {
    if (!viewer.canPublish) {
      throw new ForbiddenException('No tienes el permiso «Armar y enviar simulación» en Despacho.');
    }
    const actor =
      actorInput?.id
        ? { id: actorInput.id, code: actorInput.code ?? null, name: actorInput.name ?? null }
        : await this.viewerInfo(viewer);

    const snapshot = payload.snapshot;
    if (!snapshot) throw new BadRequestException('La simulación no tiene una foto de renglones.');
    const lines = [...snapshot.lines].filter((line) => line.assignedQty > 0).sort((a, b) => a.priority - b.priority);
    if (lines.length === 0) {
      throw new BadRequestException('Ningún renglón seleccionado tiene existencia para despachar.');
    }

    const candidates = await this.operatorCandidates();
    let assignee: { id: string; displayName: string } | null = null;
    if (input.assignedToId) {
      const user = candidates.find((candidate) => candidate.id === input.assignedToId);
      if (!user) throw new BadRequestException('El operador elegido no está disponible.');
      assignee = { id: user.id, displayName: user.displayName };
    }

    const plannedSacks = round2(lines.reduce((sum, line) => sum + (line.uom === 'SAC' ? line.assignedQty : 0), 0));
    const plannedKg = round2(lines.reduce((sum, line) => sum + line.assignedKg, 0));
    const destination = assignee ? assignee.displayName : 'todo el almacén';
    const arrivalLines: ArrivalSourceLine[] = lines.map((line) => ({
      orderNumber: line.orderNumber,
      customerCode: line.customerCode ?? null,
      customerName: line.customerName ?? null,
      uom: line.uom ?? null,
      effectiveDate: line.effectiveDate ?? null,
      plannedQty: line.assignedQty,
      plannedKg: line.assignedKg,
    }));
    let arrivalCount = 0;

    const sheet = await this.createWithNumber(async (number) => {
      const arrivalRows = await this.arrivals.rowsForSheet({
        sheetNumber: number,
        sheetTitle: input.title,
        lines: arrivalLines,
        actor,
      });
      arrivalCount = arrivalRows.length;
      return this.prisma.dispatchSheet.create({
        data: {
          number,
          title: input.title,
          status: 'ENVIADO',
          instructions: input.instructions ?? null,
          scenarioId: null,
          scenarioName: 'Simulación del equipo',
          draftId: 'GLOBAL',
          source: 'DRAFT',
          draftRevision,
          recipeJson: JSON.stringify(payload.recipe),
          photoJson: JSON.stringify(snapshot),
          loadPlanJson: payload.loadPlan ? JSON.stringify(payload.loadPlan) : null,
          assignedToId: assignee?.id ?? null,
          assignedRole: 'ALMACEN',
          createdById: actor.id,
          createdByCode: actor.code,
          createdByName: actor.name,
          sentAt: new Date(),
          plannedLines: lines.length,
          plannedSacks,
          plannedKg,
          lines: {
            create: lines.map((line, index) => ({
              position: index + 1,
              orderNumber: line.orderNumber,
              productCode: line.productCode,
              description: line.description,
              uom: line.uom,
              customerCode: line.customerCode,
              customerName: line.customerName,
              warehouseCode: null,
              effectiveDate: line.effectiveDate,
              plannedQty: line.assignedQty,
              plannedKg: line.assignedKg,
              note: line.comment ?? null,
              status: 'PENDIENTE',
            })),
          },
          events: {
            create: {
              kind: 'SYSTEM',
              type: 'ENVIADO',
              body: `Despacho enviado a ${destination} desde la simulación del equipo.`,
              authorId: actor.id,
              authorCode: actor.code,
              authorName: actor.name,
            },
          },
          arrivals: { create: arrivalRows },
          customerProgress: { create: this.progressSeed(lines) },
        },
        include: {
          lines: { orderBy: { position: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
          assignedTo: { select: { displayName: true } },
          customerProgress: true,
        },
      });
    });

    await this.notify(await this.operatorRecipients(sheet), {
      type: 'DESPACHO_ENVIADO',
      title: `Nuevo despacho ${sheet.number}`,
      body: `${sheet.title} · ${lines.length} renglón(es) · ${plannedSacks} sacos · ${plannedKg} kg`,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });
    await this.arrivals.notifyExpected(sheet, { customers: arrivalCount, kg: plannedKg }, actor);
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_SEND',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, lines: lines.length, plannedKg, source: 'DRAFT', assignedTo: assignee?.id ?? 'ALMACEN' },
    });

    return {
      ...this.toSummary(sheet, viewer),
      lines: sheet.lines.map((line) => this.toLine(line, sheet)),
      events: this.eventsFor(sheet, viewer),
      loadPlan: this.parseLoadPlan(sheet.loadPlanJson),
      customerProgress: this.toProgressList(sheet),
    };
  }

  // Refleja los cambios del plan vivo en las hojas abiertas. Los renglones ya
  // resueltos son intocables; los PENDIENTES se agregan, actualizan, anulan o
  // reactivan. Nunca se borra un renglón: la anulación deja quién, cuándo y por
  // qué. Si la hoja se queda sin renglones activos, se anula sola.
  async syncFromDraft(draftId = 'GLOBAL', context: DispatchSyncContext = {}): Promise<DispatchSyncReport> {
    const sheets = await this.prisma.dispatchSheet.findMany({
      where: { draftId, status: { notIn: ['DESPACHADO', 'CANCELADO'] } },
      include: { lines: { orderBy: { position: 'asc' } }, customerProgress: true },
    });
    const report: DispatchSyncReport = {
      removedLines: 0,
      sheetNumbers: [],
      canceledSheets: [],
      removals: [],
    };
    if (sheets.length === 0) return report;

    const draft = await this.prisma.dispatchDraft.findUnique({ where: { id: draftId } });
    if (!draft) return report;
    const payload = zScenarioPayload.parse(JSON.parse(draft.payload) as unknown);
    const plan = await buildDraftPlan(this.prisma, payload.selected);
    const assignmentByKey = new Map(plan.assignments.map((item) => [draftLineKey(item), item]));
    const planLines = plan.lines
      .map((line, index) => {
        const assignment = assignmentByKey.get(draftLineKey(line));
        return assignment
          ? {
              line,
              assignment,
              priority: index + 1,
              effectiveDate: line.tentativeDate ?? line.requestedDate,
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    for (const sheet of sheets) {
      const result = await this.syncSheet(sheet, planLines, payload, draft.version, context);
      if (result.removedLines > 0) {
        report.removedLines += result.removedLines;
        if (!report.sheetNumbers.includes(sheet.number)) report.sheetNumbers.push(sheet.number);
        report.removals.push(...result.removals);
      }
      if (result.canceled) report.canceledSheets.push({ id: sheet.id, number: sheet.number });
    }
    return report;
  }

  private async syncSheet(
    sheet: DispatchSheet & { lines: LineRow[]; customerProgress?: ProgressRow[] },
    planLines: Array<{
      line: OrderGroupLine;
      assignment: DraftAssignment;
      priority: number;
      effectiveDate: string | null;
    }>,
    payload: ScenarioPayload,
    draftRevision: number,
    context: DispatchSyncContext,
  ): Promise<{ removedLines: number; canceled: boolean; removals: DispatchSyncRemoval[] }> {
    const noChanges = { removedLines: 0, canceled: false, removals: [] as DispatchSyncRemoval[] };
    // Una vez entregada una factura, el plan vivo ya no debe mover esa hoja:
    // la corrección exige reabrir la factura primero.
    if ((sheet.customerProgress ?? []).some((row) => row.invoiceDeliveredAt !== null)) return noChanges;

    const source = context.source ?? 'PLAN';
    const actor = context.actor ?? null;
    const removalName =
      actor?.name ?? (source === 'PROFIT' ? 'Profit' : source === 'SYSTEM' ? 'Sistema' : 'Simulación del equipo');
    const removalCode = actor?.code ?? (source === 'PROFIT' ? 'PROFIT' : source === 'SYSTEM' ? 'SYSTEM' : null);
    const reasonFor = (orderNumber: string) =>
      context.reasonByOrder?.get(orderNumber) ?? context.defaultReason ?? 'RETIRADO_DEL_PLAN';

    const activeRows = sheet.lines.filter((row) => row.status !== 'ANULADO');
    const annulledRows = sheet.lines.filter((row) => row.status === 'ANULADO');
    // Los renglones ya resueltos (cargado, parcial o no cargado) son
    // intocables: la simulación viva solo toca los PENDIENTES.
    const lockedRows = activeRows.filter((row) => row.status !== 'PENDIENTE');
    const pendingRows = activeRows.filter((row) => row.status === 'PENDIENTE');
    const lockedKeys = new Set(lockedRows.map((row) => draftLineKey(row)));
    const planByKey = new Map(planLines.map((item) => [draftLineKey(item.line), item]));
    const existingByKey = new Map(sheet.lines.map((row) => [draftLineKey(row), row]));

    const toAnnull: LineRow[] = [];
    const toUpdate: Array<{ row: LineRow; plan: (typeof planLines)[number] }> = [];
    for (const row of pendingRows) {
      const plan = planByKey.get(draftLineKey(row));
      if (!plan || plan.assignment.assignedQty <= 0) {
        toAnnull.push(row);
        continue;
      }
      const qtyChanged = round2(toNumber(row.plannedQty)) !== round2(plan.assignment.assignedQty);
      const kgChanged = round2(toNumber(row.plannedKg)) !== round2(plan.assignment.assignedKg);
      if (qtyChanged || kgChanged) toUpdate.push({ row, plan });
    }

    const toCreate: Array<(typeof planLines)[number]> = [];
    const toRevive: Array<{ row: LineRow; plan: (typeof planLines)[number] }> = [];
    for (const item of planLines) {
      if (item.assignment.assignedQty <= 0) continue;
      const key = draftLineKey(item.line);
      const existing = existingByKey.get(key);
      if (!existing) {
        if (!lockedKeys.has(key)) toCreate.push(item);
        continue;
      }
      // Un renglón anulado que vuelve al plan se reactiva en la misma fila
      // (la restricción sheet+pedido+artículo es única).
      if (existing.status === 'ANULADO') toRevive.push({ row: existing, plan: item });
    }

    const loadPlanJson = payload.loadPlan ? JSON.stringify(payload.loadPlan) : null;
    const desiredPending = planLines.filter(
      (item) => item.assignment.assignedQty > 0 && !lockedKeys.has(draftLineKey(item.line)),
    );
    const desiredKeys = new Set(desiredPending.map((item) => draftLineKey(item.line)));
    const retainedAnnulled = annulledRows.filter((row) => !desiredKeys.has(draftLineKey(row)));
    const plannedLines = desiredPending.length + lockedRows.length;

    const rowSignature = (row: LineRow) =>
      row.status === 'PENDIENTE'
        ? `${draftLineKey(row)}|PENDIENTE|${round2(toNumber(row.plannedQty))}|${round2(toNumber(row.plannedKg))}|${row.note ?? ''}`
        : `${draftLineKey(row)}|${row.status}|${round2(toNumber(row.plannedQty))}|${round2(toNumber(row.plannedKg))}|${round2(
            toNumber(row.loadedQty),
          )}|${row.note ?? ''}`;
    const signature = [
      ...lockedRows.map(rowSignature),
      ...desiredPending.map(
        (item) =>
          `${draftLineKey(item.line)}|PENDIENTE|${round2(item.assignment.assignedQty)}|${round2(
            item.assignment.assignedKg,
          )}|${payload.comments?.[draftLineKey(item.line)] ?? ''}`,
      ),
      ...retainedAnnulled.map((row) => `${draftLineKey(row)}|ANULADO`),
    ]
      .sort()
      .join(';');
    const currentSignature = [...activeRows.map(rowSignature), ...annulledRows.map((row) => `${draftLineKey(row)}|ANULADO`)]
      .sort()
      .join(';');

    // Una hoja que ya quedó vacía se procesa igual para poder anularla.
    if (plannedLines > 0 && signature === currentSignature && sheet.loadPlanJson === loadPlanJson) {
      return noChanges;
    }

    const plannedSacks = round2(
      desiredPending.reduce((sum, item) => sum + (item.line.uom === 'SAC' ? item.assignment.assignedQty : 0), 0) +
        lockedRows.reduce((sum, row) => sum + (row.uom === 'SAC' ? toNumber(row.plannedQty) : 0), 0),
    );
    const plannedKg = round2(
      desiredPending.reduce((sum, item) => sum + item.assignment.assignedKg, 0) +
        lockedRows.reduce((sum, row) => sum + toNumber(row.plannedKg), 0),
    );

    const snapshotLines = [
      ...lockedRows.map((row) => ({
        orderNumber: row.orderNumber,
        productCode: row.productCode,
        selectedById: null,
        selectedByName: null,
        selectedAt: null,
        customerCode: row.customerCode,
        customerName: row.customerName,
        description: row.description,
        uom: row.uom,
        pendingQty: toNumber(row.plannedQty),
        pendingKg: toNumber(row.plannedKg),
        assignedQty: toNumber(row.plannedQty),
        assignedKg: toNumber(row.plannedKg),
        missingQty: 0,
        missingKg: 0,
        stockTotal: 0,
        effectiveDate: row.effectiveDate,
        priority: row.position,
        comment: row.note,
      })),
      ...desiredPending.map((item) => ({
        orderNumber: item.line.orderNumber,
        productCode: item.line.productCode,
        selectedById: null,
        selectedByName: null,
        selectedAt: null,
        customerCode: item.line.customerCode,
        customerName: item.line.customerName,
        description: item.line.description,
        uom: item.line.uom,
        pendingQty: item.line.pendingQty,
        pendingKg: item.line.pendingKg,
        assignedQty: item.assignment.assignedQty,
        assignedKg: item.assignment.assignedKg,
        missingQty: item.assignment.missingQty,
        missingKg: item.assignment.missingKg,
        stockTotal: item.assignment.stockTotal,
        effectiveDate: item.effectiveDate,
        priority: item.priority,
        comment: payload.comments?.[draftLineKey(item.line)] ?? null,
      })),
    ];
    const totalKg = snapshotLines.reduce((sum, line) => sum + line.assignedKg, 0);
    const missingKg = snapshotLines.reduce((sum, line) => sum + line.missingKg, 0);
    const snapshot = {
      takenAt: new Date().toISOString(),
      carteraLines: snapshotLines.length,
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

    // Clientes activos después del cambio: se usan para limpiar relojes
    // huérfanos sin actividad. La creación/reapertura la resuelve
    // `recomputeProgress` justo después.
    const annulledIds = new Set(toAnnull.map((row) => row.id));
    const finalCustomers = new Map<string, { customerCode: string | null; customerName: string | null }>();
    for (const row of activeRows) {
      if (annulledIds.has(row.id)) continue;
      finalCustomers.set(customerKey(row), { customerCode: row.customerCode, customerName: row.customerName });
    }
    for (const item of [...toCreate, ...toRevive.map((entry) => entry.plan)]) {
      finalCustomers.set(customerKey(item.line), {
        customerCode: item.line.customerCode ?? null,
        customerName: item.line.customerName ?? null,
      });
    }
    const progressToDelete = (sheet.customerProgress ?? []).filter(
      (row) =>
        !finalCustomers.has(row.customerKey) &&
        !row.loadStartedAt &&
        !row.loadClosedAt &&
        !row.invoiceDeliveredAt,
    );

    const now = new Date();
    const shouldCancel = plannedLines === 0;
    const cancelReason = shouldCancel
      ? toAnnull.length > 0
        ? `El plan quedó vacío: se anularon ${toAnnull.length} renglón(es) desde Pedidos.`
        : 'El despacho no tiene renglones activos.'
      : null;

    const removals: DispatchSyncRemoval[] = toAnnull.map((row) => ({
      sheetId: sheet.id,
      sheetNumber: sheet.number,
      orderNumber: row.orderNumber,
      productCode: row.productCode,
      customerName: row.customerName,
      reason: reasonFor(row.orderNumber),
    }));

    const reasonText =
      source === 'PROFIT'
        ? 'Profit anuló o cerró los pedidos.'
        : `Retirados por ${removalName}.`;

    const events: Array<{ kind: 'SYSTEM'; type: string; body: string; meta?: string | null }> = [];
    if (toAnnull.length > 0) {
      const products = this.eventProducts(toAnnull);
      const customers = [...new Set(toAnnull.map((row) => row.customerName ?? 'Sin cliente'))];
      events.push({
        kind: 'SYSTEM',
        type: 'RENGLON_ANULADO',
        body: this.eventSummary(customers.length === 1 ? customers[0]! : null, products, reasonText),
        meta: this.eventMeta(toAnnull, customers.length === 1 ? { key: customerKey(toAnnull[0]!), name: customers[0]! } : null),
      });
    }
    if (toRevive.length > 0) {
      events.push({
        kind: 'SYSTEM',
        type: 'RENGLON_REACTIVADO',
        body: `Volvieron al plan ${toRevive.length} renglón(es) que estaban anulados.`,
      });
    }
    if (toCreate.length > 0 || toUpdate.length > 0 || toRevive.length > 0) {
      events.push({
        kind: 'SYSTEM',
        type: 'SIMULACION_ACTUALIZADA',
        body: `La simulación del equipo cambió: ${toCreate.length} renglón(es) agregado(s), ${toAnnull.length} anulado(s), ${toUpdate.length} actualizado(s).`,
      });
    }
    if (shouldCancel && cancelReason) {
      events.push({ kind: 'SYSTEM', type: 'PLAN_VACIO', body: `Anulación automática: ${cancelReason}` });
    }

    await this.prisma.$transaction([
      ...toAnnull.map((row) =>
        this.prisma.dispatchSheetLine.update({
          where: { id: row.id },
          data: {
            status: 'ANULADO',
            loadedQty: null,
            loadedKg: null,
            checkedAt: null,
            checkedById: null,
            checkedByName: null,
            removedAt: now,
            removedById: actor?.id ?? null,
            removedByCode: removalCode,
            removedByName: removalName,
            removalReason: reasonFor(row.orderNumber),
            removalSource: source,
          },
        }),
      ),
      ...progressToDelete.map((row) =>
        this.prisma.dispatchCustomerProgress.delete({ where: { id: row.id } }),
      ),
      ...toUpdate.map(({ row, plan }) =>
        this.prisma.dispatchSheetLine.update({
          where: { id: row.id },
          data: {
            plannedQty: plan.assignment.assignedQty,
            plannedKg: plan.assignment.assignedKg,
            effectiveDate: plan.effectiveDate,
            note: payload.comments?.[draftLineKey(plan.line)] ?? row.note ?? null,
            status: 'PENDIENTE',
          },
        }),
      ),
      ...toRevive.map(({ row, plan }) =>
        this.prisma.dispatchSheetLine.update({
          where: { id: row.id },
          data: {
            plannedQty: plan.assignment.assignedQty,
            plannedKg: plan.assignment.assignedKg,
            effectiveDate: plan.effectiveDate,
            note: payload.comments?.[draftLineKey(plan.line)] ?? null,
            status: 'PENDIENTE',
            loadedQty: null,
            loadedKg: null,
            checkedAt: null,
            checkedById: null,
            checkedByName: null,
            removedAt: null,
            removedById: null,
            removedByCode: null,
            removedByName: null,
            removalReason: null,
            removalSource: null,
          },
        }),
      ),
      ...toCreate.map((item) =>
        this.prisma.dispatchSheetLine.create({
          data: {
            sheetId: sheet.id,
            position: item.priority,
            orderNumber: item.line.orderNumber,
            productCode: item.line.productCode,
            description: item.line.description,
            uom: item.line.uom,
            customerCode: item.line.customerCode,
            customerName: item.line.customerName,
            warehouseCode: null,
            effectiveDate: item.effectiveDate,
            plannedQty: item.assignment.assignedQty,
            plannedKg: item.assignment.assignedKg,
            note: payload.comments?.[draftLineKey(item.line)] ?? null,
            status: 'PENDIENTE',
          },
        }),
      ),
      this.prisma.dispatchSheet.update({
        where: { id: sheet.id },
        data: {
          plannedLines,
          plannedSacks,
          plannedKg,
          photoJson: JSON.stringify(snapshot),
          loadPlanJson,
          draftRevision,
          ...(shouldCancel
            ? {
                status: 'CANCELADO',
                canceledAt: now,
                canceledById: actor?.id ?? null,
                canceledByName: removalName,
                cancelReason,
              }
            : {}),
        },
      }),
      ...events.map((event) =>
        this.prisma.dispatchSheetEvent.create({
          data: {
            sheetId: sheet.id,
            kind: event.kind,
            type: event.type,
            body: event.body,
            meta: event.meta ?? null,
            authorId: actor?.id ?? null,
            authorCode: removalCode,
            authorName: removalName,
          },
        }),
      ),
    ]);

    // Recalcula relojes de los clientes que siguen activos: cierra al cliente
    // que ya no tiene pendientes y reabre al que recibió un renglón nuevo.
    await this.recomputeProgress(
      sheet.id,
      { id: actor?.id ?? 'SYSTEM', code: removalCode, name: removalName },
      { notify: shouldCancel ? false : true },
    );

    for (const removal of removals) {
      await this.audit.record({
        actorId: actor?.id ?? null,
        actorEmail: removalCode,
        action: 'DISPATCH_LINE_ANNUL',
        entityType: 'DispatchSheet',
        entityId: sheet.id,
        context: {
          number: sheet.number,
          orderNumber: removal.orderNumber,
          productCode: removal.productCode,
          customer: removal.customerName,
          reason: removal.reason,
          source,
        },
      });
    }

    if (shouldCancel && cancelReason) {
      await this.audit.record({
        actorId: actor?.id ?? null,
        actorEmail: removalCode,
        action: 'DISPATCH_AUTO_CANCEL',
        entityType: 'DispatchSheet',
        entityId: sheet.id,
        context: { number: sheet.number, reason: cancelReason, removedLines: toAnnull.length },
      });
      await this.arrivals.cancelForSheet(
        sheet.id,
        { id: actor?.id ?? 'SYSTEM', code: removalCode, name: removalName },
        cancelReason,
      );
      await this.notify([sheet.createdById, ...(await this.operatorRecipients(sheet))], {
        type: 'DESPACHO_CANCELADO',
        title: `${sheet.number}: anulado`,
        body: cancelReason,
        entityId: sheet.id,
        actorId: actor?.id ?? 'SYSTEM',
        actorName: removalName,
        linkPath: `/despacho/${sheet.id}`,
      });
    }

    return { removedLines: toAnnull.length, canceled: shouldCancel, removals };
  }

  // ---------- Carga por renglón ----------

  async updateLine(viewer: DispatchViewer, id: string, lineId: string, input: DispatchLineInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    this.assertOperable(sheet, viewer);
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) {
      throw new ConflictException('El despacho ya está cerrado.');
    }
    const line = await this.prisma.dispatchSheetLine.findFirst({ where: { id: lineId, sheetId: sheet.id } });
    if (!line) throw new NotFoundException('Renglón no encontrado.');
    if (line.status === 'ANULADO') {
      throw new ConflictException('Este renglón fue anulado porque salió del plan. Vuelve a incluirlo en Pedidos para reactivarlo.');
    }

    const actor = await this.viewerInfo(viewer);
    const progress = this.progressFor(sheet, customerKey(line));
    if (progress?.invoiceDeliveredAt) {
      throw new ConflictException(
        'La factura de este cliente ya fue entregada. Un administrador debe reabrirla antes de cambiar la carga.',
      );
    }
    const plannedQty = toNumber(line.plannedQty);
    const plannedKg = toNumber(line.plannedKg);
    const previousStatus = line.status;
    const hadDifference = NOVEDAD_LINE_STATUSES.includes(previousStatus);
    const note = input.note?.trim() || null;

    if (input.status === 'PARCIAL') {
      const loadedQty = round2(input.loadedQty ?? 0);
      if (loadedQty <= 0) {
        throw new BadRequestException('Indica cuántas unidades cargaste (mayor que cero).');
      }
      if (loadedQty >= plannedQty) {
        throw new BadRequestException('Si cargaste todo, marca el renglón como «Cargado».');
      }
      if (!note) throw new BadRequestException('Escribe el motivo de la carga parcial.');
    }
    if (input.status === 'FALTANTE' && !note) {
      throw new BadRequestException('Escribe el motivo por el que no se cargó.');
    }

    // Cargado toma el plan completo; parcial deriva los kg del ratio de la
    // unidad; faltante deja todo en cero. El almacén nunca digita dos veces
    // el mismo dato.
    const loadedQty =
      input.status === 'CARGADO'
        ? plannedQty
        : input.status === 'PARCIAL'
          ? round2(input.loadedQty ?? 0)
          : input.status === 'FALTANTE'
            ? 0
            : null;
    const loadedKg =
      loadedQty === null
        ? null
        : plannedQty > 0
          ? round2((loadedQty * plannedKg) / plannedQty)
          : round2(loadedQty);
    // El motivo reemplaza la nota del renglón; al deshacer una diferencia o
    // volver a cargado completo se limpia para no dejar motivos obsoletos.
    const nextNote =
      input.status === 'PARCIAL' || input.status === 'FALTANTE'
        ? note
        : hadDifference
          ? null
          : line.note;

    // El sello de cierre es el de la PRIMERA resolución del producto. Editar
    // nota o cantidad después no mueve el reloj; reabrir a PENDIENTE lo limpia
    // y volver a cerrarlo toma una hora nueva.
    const keepCheck = input.status !== 'PENDIENTE' && line.status !== 'PENDIENTE' && line.checkedAt !== null;
    const checkedAt = input.status === 'PENDIENTE' ? null : keepCheck ? line.checkedAt : new Date();
    const checkedById = input.status === 'PENDIENTE' ? null : keepCheck ? line.checkedById ?? actor.id : actor.id;
    const checkedByName = input.status === 'PENDIENTE' ? null : keepCheck ? line.checkedByName ?? actor.name : actor.name;

    await this.prisma.dispatchSheetLine.update({
      where: { id: line.id },
      data:
        input.status === 'PENDIENTE'
          ? {
              loadedQty: null,
              loadedKg: null,
              status: 'PENDIENTE',
              note: nextNote,
              checkedAt: null,
              checkedById: null,
              checkedByName: null,
            }
          : {
              loadedQty,
              loadedKg,
              status: input.status,
              note: nextNote,
              checkedAt,
              checkedById,
              checkedByName,
            },
    });

    // El estado de la hoja refleja si hay novedades entre los renglones.
    // Al marcar el primer renglón la hoja arranca sola: ya no hay acuse previo.
    // `recomputeProgress` cierra el grupo cuando ya no queda PENDIENTE y
    // registra los hitos de carga en la bitácora.
    const { sheet: refreshed } = await this.recomputeProgress(sheet.id, actor, { notify: true });
    const starting = refreshed.status === 'ENVIADO' || refreshed.status === 'RECIBIDO';
    const hasNovedad = refreshed.lines.some((item) => NOVEDAD_LINE_STATUSES.includes(item.status));
    const nextStatus = hasNovedad
      ? 'CON_NOVEDAD'
      : refreshed.status === 'CON_NOVEDAD' || starting
        ? 'EN_PROCESO'
        : refreshed.status;
    if (nextStatus !== refreshed.status) {
      const claimed = starting ? this.claimPatch(refreshed, actor) : {};
      await this.prisma.$transaction([
        this.prisma.dispatchSheet.update({
          where: { id: refreshed.id },
          data: {
            status: nextStatus,
            ...(starting ? { startedAt: refreshed.startedAt ?? new Date() } : {}),
            ...claimed,
          },
        }),
        this.prisma.dispatchSheetEvent.create({
          data: {
            sheetId: refreshed.id,
            kind: 'SYSTEM',
            type: hasNovedad ? 'NOVEDAD' : 'EN_PROCESO',
            body: hasNovedad
              ? `${actor.name ?? 'Almacén'} reportó diferencias en la carga.`
              : starting
                ? `${actor.name ?? 'El almacén'} empezó a cargar.`
                : 'Las diferencias quedaron resueltas.',
            authorId: actor.id,
            authorCode: actor.code,
            authorName: actor.name,
          },
        }),
      ]);
      if (hasNovedad) {
        await this.notify([refreshed.createdById], {
          type: 'DESPACHO_NOVEDAD',
          title: `${refreshed.number}: novedad en la carga`,
          body: `${actor.name ?? 'Almacén'} reportó cargas parciales o no cargadas. Revisa el detalle.`,
          entityId: refreshed.id,
          actorId: actor.id,
          actorName: actor.name,
          linkPath: `/despacho/${refreshed.id}`,
        });
      }
    }

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_LINE',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: {
        number: sheet.number,
        orderNumber: line.orderNumber,
        productCode: line.productCode,
        plannedQty,
        loadedQty,
        status: input.status,
        note: nextNote,
      },
    });

    return this.detail(viewer, id);
  }

  // ---------- Tiempos: iniciar carga y facturar ----------

  /** «Iniciar carga» del cliente: arranca los dos relojes, no marca productos. */
  async startLoad(viewer: DispatchViewer, id: string, input: DispatchCustomerKeyInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    this.assertOperable(sheet, viewer);
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) {
      throw new ConflictException('El despacho ya está cerrado.');
    }
    const bucket = this.customerBuckets(sheet.lines).find((item) => item.key === input.customerKey);
    if (!bucket) throw new NotFoundException('Ese cliente no pertenece al despacho.');

    const progress = this.progressFor(sheet, bucket.key);
    if (progress?.invoiceDeliveredAt) {
      throw new ConflictException('La factura de este cliente ya fue entregada. Reábrela antes de iniciar la carga.');
    }
    if (progress?.loadStartedAt) return this.detail(viewer, id);

    const actor = await this.viewerInfo(viewer);
    const now = new Date();
    if (progress) {
      await this.prisma.dispatchCustomerProgress.update({
        where: { id: progress.id },
        data: { loadStartedAt: now, loadStartedById: actor.id, loadStartedByName: actor.name },
      });
    } else {
      await this.prisma.dispatchCustomerProgress.create({
        data: {
          sheetId: sheet.id,
          customerKey: bucket.key,
          customerCode: bucket.code,
          customerName: bucket.name,
          loadStartedAt: now,
          loadStartedById: actor.id,
          loadStartedByName: actor.name,
        },
      });
    }

    // El primer operador que inicia una carga toma la hoja, igual que antes
    // ocurría al marcar el primer renglón.
    const starting = sheet.status === 'ENVIADO' || sheet.status === 'RECIBIDO';
    if (starting || !sheet.claimedById || !sheet.startedAt) {
      await this.prisma.dispatchSheet.update({
        where: { id: sheet.id },
        data: {
          ...(starting ? { status: 'EN_PROCESO' } : {}),
          startedAt: sheet.startedAt ?? now,
          ...this.claimPatch(sheet, actor),
        },
      });
    }

    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'CARGA_INICIADA',
        body: this.eventSummary(bucket.name, this.eventProducts(bucket.lines)),
        meta: this.eventMeta(bucket.lines, bucket),
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_LOAD_START',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, customer: bucket.name, products: bucket.lines.length },
    });

    return this.detail(viewer, id);
  }

  /** «Factura entregada» de un cliente. */
  async deliverInvoice(
    viewer: DispatchViewer,
    id: string,
    input: DispatchCustomerInvoiceInput,
  ): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    if (!this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');
    if (!this.canInvoice(sheet, viewer)) {
      throw new ForbiddenException('No tienes permiso para registrar la factura de este despacho.');
    }
    if (sheet.status === 'CANCELADO') throw new ConflictException('El despacho está anulado.');
    const bucket = this.customerBuckets(sheet.lines).find((item) => item.key === input.customerKey);
    if (!bucket) throw new NotFoundException('Ese cliente no pertenece al despacho.');

    const actor = await this.viewerInfo(viewer);
    // Recalcula relojes y crea la fila si es histórica antes de facturar.
    await this.recomputeProgress(sheet.id, actor, { notify: false });
    const refreshed = await this.findSheet(id);
    const progress = this.progressFor(refreshed, bucket.key);
    if (!progress) throw new NotFoundException('No encontramos el registro de tiempos de ese cliente.');
    if (progress.invoiceDeliveredAt) return this.detail(viewer, id);

    const pending = bucket.lines.filter((line) => line.status === 'PENDIENTE');
    if (pending.length > 0) {
      throw new BadRequestException(
        `Faltan ${pending.length} producto(s) de ${bucket.name} por cerrar antes de entregar la factura.`,
      );
    }
    if (!progress.loadClosedAt) {
      throw new BadRequestException('Cierra la carga completa del cliente antes de entregar la factura.');
    }

    const beforeInvoiced = this.toProgressList(refreshed).every((row) => row.invoiceDeliveredAt !== null);
    const now = new Date();
    await this.prisma.dispatchCustomerProgress.update({
      where: { id: progress.id },
      data: {
        invoiceDeliveredAt: now,
        invoiceDeliveredById: actor.id,
        invoiceDeliveredByName: actor.name,
        invoiceRef: input.invoiceRef ?? null,
        note: input.note ?? progress.note ?? null,
      },
    });
    const invoiceMinutes = minutesBetween(progress.loadStartedAt, now);
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURA_ENTREGADA',
        body: this.eventSummary(
          bucket.name,
          this.eventProducts(bucket.lines),
          input.invoiceRef ? `Factura N° ${input.invoiceRef}` : null,
        ),
        meta: this.eventMeta(bucket.lines, bucket, { invoiceRef: input.invoiceRef ?? null, minutes: invoiceMinutes }),
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_INVOICE',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: {
        number: sheet.number,
        customer: bucket.name,
        invoiceRef: input.invoiceRef ?? null,
        minutes: minutesBetween(progress.loadStartedAt, now),
      },
    });

    if (!beforeInvoiced) {
      const after = await this.findSheet(id);
      const allInvoiced = this.toProgressList(after).every((row) => row.invoiceDeliveredAt !== null);
      if (allInvoiced) {
        await this.notify([refreshed.createdById], {
          type: 'DESPACHO_FACTURADO',
          title: `${refreshed.number}: facturación entregada`,
          body: `Todos los clientes del despacho tienen la factura marcada como entregada.`,
          entityId: refreshed.id,
          actorId: actor.id,
          actorName: actor.name,
          linkPath: `/despacho/${refreshed.id}`,
        });
      }
    }

    return this.detail(viewer, id);
  }

  /** «Facturar todo»: marca la factura de todos los clientes pendientes. */
  async deliverAllInvoices(viewer: DispatchViewer, id: string, input: DispatchInvoiceInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    if (!this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');
    if (!this.canInvoice(sheet, viewer)) {
      throw new ForbiddenException('No tienes permiso para registrar la factura de este despacho.');
    }
    if (sheet.status === 'CANCELADO') throw new ConflictException('El despacho está anulado.');

    const actor = await this.viewerInfo(viewer);
    await this.recomputeProgress(sheet.id, actor, { notify: false });
    const refreshed = await this.findSheet(id);
    const progress = this.toProgressList(refreshed);
    const pendingLines = refreshed.lines.filter((line) => line.status === 'PENDIENTE');
    if (pendingLines.length > 0) {
      throw new BadRequestException(
        `Faltan ${pendingLines.length} producto(s) por cerrar. No se puede facturar todo el despacho.`,
      );
    }
    if (progress.some((row) => !row.loadClosedAt)) {
      throw new BadRequestException('Cierra la carga de todos los clientes antes de facturar.');
    }
    if (progress.every((row) => row.invoiceDeliveredAt)) return this.detail(viewer, id);

    const now = new Date();
    await this.prisma.dispatchCustomerProgress.updateMany({
      where: { sheetId: sheet.id, invoiceDeliveredAt: null },
      data: {
        invoiceDeliveredAt: now,
        invoiceDeliveredById: actor.id,
        invoiceDeliveredByName: actor.name,
        invoiceRef: input.invoiceRef ?? null,
        note: input.note ?? null,
      },
    });
    const allLines = refreshed.lines.filter((line) => line.status !== 'ANULADO');
    const allProducts = this.eventProducts(allLines);
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURADO',
        body: this.eventSummary(
          `${progress.length} cliente(s)`,
          allProducts,
          input.invoiceRef ? `Factura N° ${input.invoiceRef}` : null,
        ),
        meta: this.eventMeta(allLines, null, { invoiceRef: input.invoiceRef ?? null }),
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_INVOICE',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, customers: progress.length, invoiceRef: input.invoiceRef ?? null, scope: 'ALL' },
    });
    await this.notify([refreshed.createdById], {
      type: 'DESPACHO_FACTURADO',
      title: `${refreshed.number}: facturación entregada`,
      body: `Todos los clientes del despacho tienen la factura marcada como entregada.`,
      entityId: refreshed.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${refreshed.id}`,
    });

    return this.detail(viewer, id);
  }

  /** Corrección de una factura ya entregada: solo ADMIN o «Anular». */
  async reopenInvoice(
    viewer: DispatchViewer,
    id: string,
    input: DispatchCustomerReopenInput,
  ): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    if (!this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');
    if (!viewer.isAdmin && !viewer.canDelete && viewer.role !== 'ADMIN') {
      throw new ForbiddenException('Solo un administrador puede reabrir una factura.');
    }
    if (sheet.status === 'CANCELADO') throw new ConflictException('El despacho está anulado.');
    const progress = this.progressFor(sheet, input.customerKey);
    if (!progress) throw new NotFoundException('No encontramos el registro de tiempos de ese cliente.');
    if (!progress.invoiceDeliveredAt) throw new BadRequestException('Ese cliente no tiene factura entregada.');

    const actor = await this.viewerInfo(viewer);
    await this.prisma.dispatchCustomerProgress.update({
      where: { id: progress.id },
      data: {
        invoiceDeliveredAt: null,
        invoiceDeliveredById: null,
        invoiceDeliveredByName: null,
        invoiceRef: null,
        note: input.reason,
      },
    });
    const bucket = this.customerBuckets(sheet.lines).find((item) => item.key === input.customerKey);
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURA_REABIERTA',
        body: this.eventSummary(progress.customerName ?? input.customerKey, bucket ? this.eventProducts(bucket.lines) : [], input.reason),
        meta: this.eventMeta(bucket?.lines ?? [], {
          key: progress.customerKey,
          name: progress.customerName ?? input.customerKey,
        }),
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_REOPEN',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, customer: progress.customerName, scope: 'INVOICE', reason: input.reason },
    });

    return this.detail(viewer, id);
  }

  // ---------- Reporte de tiempos ----------

  async metrics(viewer: DispatchViewer, query: DispatchMetricsQuery): Promise<DispatchMetricsResponse> {
    const from = new Date(`${query.from}T00:00:00.000-04:00`);
    const to = new Date(`${query.to}T23:59:59.999-04:00`);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('La fecha final debe ser mayor o igual a la inicial.');
    }
    if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('El reporte de tiempos admite como máximo 400 días.');
    }

    const sheets = await this.prisma.dispatchSheet.findMany({
      where: {
        AND: [
          this.baseVisibility(viewer),
          { status: query.onlyClosed ? 'DESPACHADO' : { not: 'CANCELADO' } },
          {
            OR: [
              { customerProgress: { some: { loadClosedAt: { gte: from, lte: to } } } },
              { customerProgress: { some: { invoiceDeliveredAt: { gte: from, lte: to } } } },
              // Hojas históricas sin filas de relojes: se usa completedAt.
              { customerProgress: { none: {} }, completedAt: { gte: from, lte: to } },
            ],
          },
        ],
      },
      include: { lines: { orderBy: { position: 'asc' } }, customerProgress: true },
      orderBy: { sentAt: 'desc' },
      take: 2500,
    });

    return buildDispatchMetrics(
      sheets.map((sheet) => ({
        id: sheet.id,
        number: sheet.number,
        status: sheet.status,
        sentAt: sheet.sentAt,
        startedAt: sheet.startedAt,
        completedAt: sheet.completedAt,
        lines: sheet.lines.map((line) => ({
          orderNumber: line.orderNumber,
          productCode: line.productCode,
          description: line.description,
          status: line.status,
          effectiveDate: line.effectiveDate,
          plannedKg: toNumber(line.plannedKg),
          customerCode: line.customerCode,
          customerName: line.customerName,
          checkedAt: line.checkedAt,
          checkedByName: line.checkedByName,
        })),
        customerProgress: (sheet.customerProgress ?? []).map((row) => ({
          customerKey: row.customerKey,
          customerCode: row.customerCode,
          customerName: row.customerName,
          loadStartedAt: row.loadStartedAt,
          loadClosedAt: row.loadClosedAt,
          invoiceDeliveredAt: row.invoiceDeliveredAt,
          invoiceDeliveredByName: row.invoiceDeliveredByName,
          invoiceRef: row.invoiceRef,
        })),
      })),
      query,
    );
  }

  // ---------- Retiros de simulación ----------

  /**
   * Renglones ANULADOS de las hojas visibles, agrupados por pedido.
   * Es solo lectura: muestra qué se retiró del plan y por qué, sin tocar la
   * hoja ni Profit. El filtro de visibilidad es el mismo de la bandeja.
   */
  async removals(viewer: DispatchViewer, query: DispatchRemovalsQuery): Promise<DispatchRemovalsResponse> {
    const from = query.from ? new Date(`${query.from}T00:00:00.000-04:00`) : null;
    const to = query.to ? new Date(`${query.to}T23:59:59.999-04:00`) : null;
    const where: Prisma.DispatchSheetLineWhereInput = {
      status: 'ANULADO',
      sheet: this.baseVisibility(viewer),
    };
    if (from || to) {
      where.removedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }
    if (query.reason) where.removalReason = query.reason;
    if (query.sheetId) where.sheetId = query.sheetId;
    if (query.q?.trim()) {
      const needle = query.q.trim();
      where.OR = [
        { orderNumber: { contains: needle } },
        { productCode: { contains: needle } },
        { description: { contains: needle } },
        { customerCode: { contains: needle } },
        { customerName: { contains: needle } },
        { sheet: { number: { contains: needle } } },
      ];
    }

    const rows = await this.prisma.dispatchSheetLine.findMany({
      where,
      select: {
        id: true,
        sheetId: true,
        orderNumber: true,
        productCode: true,
        description: true,
        uom: true,
        customerCode: true,
        customerName: true,
        plannedQty: true,
        plannedKg: true,
        removalReason: true,
        removedAt: true,
        removedByName: true,
        sheet: { select: { id: true, number: true, status: true } },
      },
      orderBy: { removedAt: 'desc' },
      take: 5000,
    });
    return buildDispatchRemovals(rows);
  }

  // ---------- Cerrar ----------

  async complete(viewer: DispatchViewer, id: string, input: DispatchCompleteInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    // Idempotente: cerrar dos veces devuelve el mismo estado.
    if (sheet.status === 'DESPACHADO') return this.detail(viewer, id);
    this.assertOperable(sheet, viewer);
    if (!['RECIBIDO', 'EN_PROCESO', 'CON_NOVEDAD'].includes(sheet.status)) {
      throw new ConflictException('Carga al menos un renglón antes de cerrarlo.');
    }
    const activeLines = sheet.lines.filter((line) => line.status !== 'ANULADO');
    if (activeLines.length === 0) {
      throw new ConflictException('El despacho no tiene renglones activos: anúlalo o vuelve a incluirlos en Pedidos.');
    }
    const pending = activeLines.filter((line) => line.status === 'PENDIENTE');
    if (pending.length > 0) {
      throw new BadRequestException(
        `Faltan ${pending.length} renglón(es) por resolver. Marca cada uno como cargado, parcial o no cargado.`,
      );
    }
    // Las diferencias exigen motivo: sin él, el cierre no deja rastro del porqué.
    const sinMotivo = activeLines.filter(
      (line) => NOVEDAD_LINE_STATUSES.includes(line.status) && !line.note?.trim(),
    );
    if (sinMotivo.length > 0) {
      throw new BadRequestException(
        `Hay ${sinMotivo.length} renglón(es) con diferencia sin motivo. Agrega el motivo antes de cerrar.`,
      );
    }

    const actor = await this.viewerInfo(viewer);
    // Cierra los relojes de los grupos que aún no tengan hora (hojas viejas o
    // cargas hechas por API sin «Iniciar carga»).
    const { sheet: refreshed } = await this.recomputeProgress(sheet.id, actor, { notify: false });
    const totals = this.liveTotals(refreshed.lines);
    await this.prisma.$transaction([
      this.prisma.dispatchSheet.update({
        where: { id: refreshed.id },
        data: {
          status: 'DESPACHADO',
          completedAt: new Date(),
          completedById: actor.id,
          completedByName: actor.name,
          loadedSacks: totals.loadedSacks,
          loadedKg: totals.loadedKg,
          differenceKg: totals.differenceKg,
        },
      }),
      this.prisma.dispatchSheetEvent.create({
        data: {
          sheetId: sheet.id,
          kind: 'SYSTEM',
          type: 'DESPACHADO',
          body: input.note
            ? `Despacho cerrado por ${actor.name ?? 'almacén'}. ${input.note}`
            : `Despacho cerrado por ${actor.name ?? 'almacén'}.`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.notify([sheet.createdById], {
      type: 'DESPACHO_CERRADO',
      title: `${sheet.number}: despachado`,
      body: `${actor.name ?? 'Almacén'} cerró la carga: ${totals.loadedSacks} sacos · ${totals.loadedKg} kg · diferencia ${totals.differenceKg} kg.`,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_COMPLETE',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, ...totals, note: input.note ?? null },
    });

    return this.detail(viewer, id);
  }

  async cancel(viewer: DispatchViewer, id: string, input: DispatchCancelInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    if (!this.canCancel(sheet, viewer)) {
      throw new ForbiddenException('Solo quien publicó el despacho (o gerencia) puede anularlo.');
    }
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) {
      throw new ConflictException('El despacho ya está cerrado.');
    }
    const invoiced = (sheet.customerProgress ?? []).filter((row) => row.invoiceDeliveredAt !== null);
    if (invoiced.length > 0) {
      throw new ConflictException(
        `Hay ${invoiced.length} factura(s) entregada(s). Reábrelas antes de anular el despacho.`,
      );
    }
    const actor = await this.viewerInfo(viewer);
    await this.prisma.$transaction([
      this.prisma.dispatchSheet.update({
        where: { id: sheet.id },
        data: {
          status: 'CANCELADO',
          canceledAt: new Date(),
          canceledById: actor.id,
          canceledByName: actor.name,
          cancelReason: input.reason,
        },
      }),
      this.prisma.dispatchSheetEvent.create({
        data: {
          sheetId: sheet.id,
          kind: 'SYSTEM',
          type: 'CANCELADO',
          body: `Anulado: ${input.reason}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.notify(await this.operatorRecipients(sheet), {
      type: 'DESPACHO_CANCELADO',
      title: `${sheet.number}: anulado`,
      body: `${actor.name ?? 'Planificación'} anuló el despacho. Motivo: ${input.reason}`,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });

    // Las llegadas que aún no ocurrieron se cancelan; las que sí, se conservan.
    await this.arrivals.cancelForSheet(sheet.id, actor, input.reason);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_CANCEL',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, reason: input.reason },
    });

    return this.detail(viewer, id);
  }

  // ---------- Bitácora (mensajes libres) ----------

  async message(viewer: DispatchViewer, id: string, input: DispatchMessageInput): Promise<DispatchSheetDetail> {
    if (!viewer.isAdmin) {
      throw new ForbiddenException('La bitácora es solo para administradores.');
    }
    const sheet = await this.findSheet(id);
    if (!this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');
    const actor = await this.viewerInfo(viewer);

    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'MESSAGE',
        type: 'MENSAJE',
        body: input.body,
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });

    // El mensaje viaja al otro lado del túnel (nunca a quien lo escribió).
    const isPlannerSide = PLANNER_ROLES.includes(viewer.role) && sheet.createdById === viewer.id;
    const recipients = isPlannerSide
      ? await this.operatorRecipients(sheet)
      : [sheet.createdById];
    await this.notify(recipients, {
      type: 'MENSAJE',
      title: `${sheet.number}: mensaje de ${actor.name ?? 'la contraparte'}`,
      body: input.body,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });

    return this.detail(viewer, id);
  }

  // ---------- Notificaciones ----------

  async listNotifications(viewer: DispatchViewer, limit: number): Promise<NotificationListResponse> {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: viewer.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({ where: { recipientId: viewer.id, readAt: null } }),
    ]);
    return { items: rows.map((row) => this.toNotification(row)), unread };
  }

  async markNotificationsRead(viewer: DispatchViewer, input: NotificationReadInput): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: viewer.id,
        readAt: null,
        ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // ---------- Internos ----------

  private async findSheet(id: string) {
    const sheet = await this.prisma.dispatchSheet.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        assignedTo: { select: { displayName: true } },
        customerProgress: true,
      },
    });
    if (!sheet) throw new NotFoundException('Despacho no encontrado.');
    return sheet;
  }

  private async viewerInfo(viewer: DispatchViewer): Promise<ViewerInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { profitCode: true, displayName: true },
    });
    return {
      id: viewer.id,
      code: user?.profitCode ?? viewer.code ?? null,
      name: user?.displayName ?? viewer.name ?? null,
    };
  }

  // ---------- Tiempos por cliente ----------

  /** Filas iniciales de relojes: una por cliente del plan, sin horas todavía. */
  private progressSeed(lines: Array<{ customerCode: string | null; customerName: string | null }>) {
    const map = new Map<string, { customerKey: string; customerCode: string | null; customerName: string | null }>();
    for (const line of lines) {
      const key = customerKey(line);
      if (map.has(key)) continue;
      map.set(key, {
        customerKey: key,
        customerCode: line.customerCode ?? null,
        customerName: line.customerName ?? null,
      });
    }
    return [...map.values()];
  }

  private customerBuckets(lines: LineRowLite[]): CustomerGroupBucket[] {
    const map = new Map<string, CustomerGroupBucket>();
    for (const line of lines) {
      // Los renglones anulados no forman parte de la operación: no deben
      // aparecer como cliente activo ni bloquear el cierre.
      if (line.status === 'ANULADO') continue;
      const key = customerKey(line);
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key,
          code: line.customerCode ?? null,
          name: line.customerName ?? 'Sin cliente',
          lines: [],
        };
        map.set(key, bucket);
      }
      bucket.lines.push(line);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  private progressFor(sheet: SheetWithLines, key: string): ProgressRow | undefined {
    return (sheet.customerProgress ?? []).find((row) => row.customerKey === key);
  }

  // ---------- Bitácora: detalle congelado ----------

  /**
   * Guarda en el evento el cliente, la factura y los productos del momento.
   * Así la bitácora muestra pedido/código/nombre sin depender de cómo cambie
   * el plan después; el texto `body` queda como respaldo para CSV/histórico.
   */
  private eventMeta(
    lines: LineRowLite[],
    customer: { key: string; name: string } | null,
    options: { invoiceRef?: string | null; minutes?: number | null } = {},
  ): string | null {
    const products = this.eventProducts(lines);
    const meta: DispatchEventMeta = {
      customerKey: customer?.key ?? null,
      customerName: customer?.name ?? null,
      invoiceRef: options.invoiceRef ?? null,
      minutes: options.minutes ?? null,
      products,
    };
    if (products.length === 0 && !meta.invoiceRef && meta.minutes === null) return null;
    return JSON.stringify(meta);
  }

  private eventProducts(lines: LineRowLite[]): DispatchEventProduct[] {
    return lines.map((line) => ({
      orderNumber: line.orderNumber,
      productCode: line.productCode,
      description: line.description ?? null,
      qty:
        line.loadedQty != null
          ? toNumber(line.loadedQty)
          : line.plannedQty != null
            ? toNumber(line.plannedQty)
            : null,
      uom: line.uom ?? null,
      status: line.status,
    }));
  }

  /** Resumen de una línea para el CSV y para eventos sin `meta`. */
  private eventSummary(
    customerName: string | null,
    products: DispatchEventProduct[],
    extra?: string | null,
  ): string {
    const items = products
      .map((product) => {
        const qty = product.qty != null ? ` (${product.qty}${product.uom ? ` ${product.uom}` : ''})` : '';
        return `${product.orderNumber} ${product.productCode}${qty}`;
      })
      .join(' · ');
    return [customerName, items, extra].filter((part) => Boolean(part && String(part).trim())).join(' · ');
  }

  private toProgressList(sheet: SheetWithLines): DispatchCustomerProgress[] {
    const buckets = this.customerBuckets(sheet.lines);
    const rows = new Map((sheet.customerProgress ?? []).map((row) => [row.customerKey, row]));
    return buckets.map((bucket) => {
      const row = rows.get(bucket.key);
      const checked = bucket.lines
        .map((line) => line.checkedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime());
      const pending = bucket.lines.filter((line) => line.status === 'PENDIENTE').length;
      // Fallback para hojas históricas sin fila: los sellos globales y las
      // horas de los renglones alcanzan para mostrar el tiempo de carga.
      const startedAt = row?.loadStartedAt ?? sheet.startedAt ?? checked[0] ?? null;
      const closedAt =
        row?.loadClosedAt ?? (pending === 0 ? checked[checked.length - 1] ?? sheet.completedAt : null);
      return {
        customerKey: bucket.key,
        customerCode: bucket.code,
        customerName: bucket.name,
        loadStartedAt: iso(startedAt),
        loadStartedByName: row?.loadStartedByName ?? null,
        loadClosedAt: iso(closedAt),
        invoiceDeliveredAt: iso(row?.invoiceDeliveredAt),
        invoiceDeliveredByName: row?.invoiceDeliveredByName ?? null,
        invoiceRef: row?.invoiceRef ?? null,
        note: row?.note ?? null,
        products: bucket.lines.length,
        pendingProducts: pending,
        loadedProducts: bucket.lines.filter((line) => line.status === 'CARGADO').length,
        partialProducts: bucket.lines.filter((line) => line.status === 'PARCIAL').length,
        missingProducts: bucket.lines.filter((line) => line.status === 'FALTANTE' || line.status === 'NOVEDAD').length,
      };
    });
  }

  /**
   * Recalcula los relojes de todos los clientes de una hoja. Se llama después
   * de cerrar/reabrir un producto. Cierra el grupo cuando ya no queda ningún
   * renglón PENDIENTE y deja el evento en la bitácora una sola vez.
   */
  private async recomputeProgress(
    sheetId: string,
    actor: ViewerInfo,
    options: { notify?: boolean } = {},
  ): Promise<{ sheet: SheetWithLines; allClosed: boolean; allInvoiced: boolean }> {
    const before = await this.prisma.dispatchSheet.findUnique({
      where: { id: sheetId },
      include: {
        lines: { orderBy: { position: 'asc' } },
        customerProgress: true,
        assignedTo: { select: { displayName: true } },
      },
    });
    if (!before) throw new NotFoundException('Despacho no encontrado.');

    const buckets = this.customerBuckets(before.lines);
    const activeKeys = new Set(buckets.map((bucket) => bucket.key));
    const previousRows = new Map((before.customerProgress ?? []).map((row) => [row.customerKey, row]));
    const activeBefore = (before.customerProgress ?? []).filter((row) => activeKeys.has(row.customerKey));
    const oldAllClosed = buckets.length > 0 && activeBefore.every((row) => row.loadClosedAt !== null);
    const oldAllInvoiced = buckets.length > 0 && activeBefore.every((row) => row.invoiceDeliveredAt !== null);
    const events: Array<{ type: string; body: string; meta?: string | null }> = [];

    for (const bucket of buckets) {
      const previous = previousRows.get(bucket.key);
      // Se guarda antes de actualizar: algunos clientes de Prisma devuelven la
      // misma referencia y mutan `previous` al escribir el nuevo cierre.
      const wasClosed = Boolean(previous?.loadClosedAt);
      const resolved = bucket.lines.filter((line) => line.status !== 'PENDIENTE');
      const pending = bucket.lines.length - resolved.length;
      const checked = resolved
        .map((line) => line.checkedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime());
      const firstChecked = checked[0] ?? null;
      const lastChecked = checked.length > 0 ? checked[checked.length - 1] : null;
      const startedAt = previous?.loadStartedAt ?? firstChecked ?? null;
      const closedAt = pending === 0 && startedAt ? lastChecked ?? new Date() : null;

      const data = {
        customerCode: bucket.code,
        customerName: bucket.name,
        loadStartedAt: startedAt,
        loadStartedById: previous?.loadStartedById ?? (startedAt ? actor.id : null),
        loadStartedByName: previous?.loadStartedByName ?? (startedAt ? actor.name : null),
        loadClosedAt: closedAt,
      };

      if (!previous) {
        await this.prisma.dispatchCustomerProgress.create({
          data: { sheetId: before.id, customerKey: bucket.key, ...data },
        });
      } else if (
        previous.loadStartedAt?.getTime() !== startedAt?.getTime() ||
        previous.loadClosedAt?.getTime() !== closedAt?.getTime()
      ) {
        await this.prisma.dispatchCustomerProgress.update({ where: { id: previous.id }, data });
      }

      if (!wasClosed && closedAt) {
        const loadMinutes = minutesBetween(startedAt, closedAt);
        events.push({
          type: 'CARGA_CERRADA',
          body: this.eventSummary(bucket.name, this.eventProducts(bucket.lines), durationLabel(loadMinutes)),
          meta: this.eventMeta(bucket.lines, bucket, { minutes: loadMinutes }),
        });
        await this.audit.record({
          actorId: actor.id,
          actorEmail: actor.code ?? undefined,
          action: 'DISPATCH_LOAD_CLOSE',
          entityType: 'DispatchSheet',
          entityId: before.id,
          context: {
            number: before.number,
            customer: bucket.name,
            products: bucket.lines.length,
            minutes: minutesBetween(startedAt, closedAt),
          },
        });
      } else if (wasClosed && !closedAt) {
        events.push({
          type: 'CARGA_REABIERTA',
          body: this.eventSummary(bucket.name, this.eventProducts(bucket.lines)),
          meta: this.eventMeta(bucket.lines, bucket),
        });
        await this.audit.record({
          actorId: actor.id,
          actorEmail: actor.code ?? undefined,
          action: 'DISPATCH_REOPEN',
          entityType: 'DispatchSheet',
          entityId: before.id,
          context: { number: before.number, customer: bucket.name, scope: 'CARGA' },
        });
      }
    }

    for (const event of events) {
      await this.prisma.dispatchSheetEvent.create({
        data: {
          sheetId: before.id,
          kind: 'SYSTEM',
          type: event.type,
          body: event.body,
          meta: event.meta ?? null,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      });
    }

    const refreshed = await this.prisma.dispatchSheet.findUnique({
      where: { id: sheetId },
      include: {
        lines: { orderBy: { position: 'asc' } },
        customerProgress: true,
        assignedTo: { select: { displayName: true } },
      },
    });
    if (!refreshed) throw new NotFoundException('Despacho no encontrado.');

    const activeAfter = (refreshed.customerProgress ?? []).filter((row) => activeKeys.has(row.customerKey));
    const allClosed = buckets.length > 0 && activeAfter.every((row) => row.loadClosedAt !== null);
    const allInvoiced = buckets.length > 0 && activeAfter.every((row) => row.invoiceDeliveredAt !== null);

    if (options.notify && allClosed && !oldAllClosed) {
      await this.notify([refreshed.createdById], {
        type: 'DESPACHO_CARGA_CERRADA',
        title: `${refreshed.number}: carga cerrada`,
        body: `El almacén cerró la carga de todos los clientes. Ya se puede registrar la facturación.`,
        entityId: refreshed.id,
        actorId: actor.id,
        actorName: actor.name,
        linkPath: `/despacho/${refreshed.id}`,
      });
    }
    if (options.notify && allInvoiced && !oldAllInvoiced) {
      await this.notify([refreshed.createdById], {
        type: 'DESPACHO_FACTURADO',
        title: `${refreshed.number}: facturación entregada`,
        body: `Todos los clientes del despacho tienen la factura marcada como entregada.`,
        entityId: refreshed.id,
        actorId: actor.id,
        actorName: actor.name,
        linkPath: `/despacho/${refreshed.id}`,
      });
    }

    return { sheet: refreshed, allClosed, allInvoiced };
  }

  private canInvoice(sheet: DispatchSheet, viewer: DispatchViewer): boolean {
    if (sheet.status === 'CANCELADO') return false;
    const allowed =
      viewer.isAdmin === true ||
      viewer.canUpdate === true ||
      viewer.canDelete === true ||
      ['ADMIN', 'GERENCIA', 'ALMACEN'].includes(viewer.role);
    if (!allowed) return false;
    if (!['ADMIN', 'GERENCIA'].includes(viewer.role)) {
      if (sheet.assignedToId && sheet.assignedToId !== viewer.id) return false;
      if (sheet.claimedById && sheet.claimedById !== viewer.id) return false;
    }
    return true;
  }

  // Correlativo legible DSP-AAAA-NNNN con reintento ante colisión.
  private async createWithNumber<T>(run: (number: string) => Promise<T>): Promise<T> {
    const year = new Date().getFullYear();
    const prefix = `DSP-${year}-`;
    const last = await this.prisma.dispatchSheet.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let sequence = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await run(`${prefix}${String(sequence).padStart(4, '0')}`);
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        sequence += 1;
      }
    }
    throw new ConflictException('No se pudo generar el número del despacho. Intenta de nuevo.');
  }

  private visibilityWhere(viewer: DispatchViewer, query: DispatchSheetQuery): Prisma.DispatchSheetWhereInput {
    const filters: Prisma.DispatchSheetWhereInput[] = [];
    if (query.q?.trim()) {
      const needle = query.q.trim();
      filters.push({
        OR: [{ number: { contains: needle } }, { title: { contains: needle } }, { scenarioName: { contains: needle } }],
      });
    }
    if (query.from || query.to) {
      const dateRange = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000-04:00`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999-04:00`) } : {}),
      };
      // El historial se filtra por el día en que el despacho salió (cierre o
      // anulación), no por el día en que se publicó. Las hojas viejas sin
      // sellos conservan el envío como respaldo.
      if (query.scope === 'history') {
        filters.push({
          OR: [
            { completedAt: dateRange },
            { canceledAt: dateRange },
            { completedAt: null, canceledAt: null, sentAt: dateRange },
          ],
        });
      } else {
        filters.push({ sentAt: dateRange });
      }
    }

    // La bandeja de pendientes es de piso: cualquier usuario con «Ver» ve todo
    // lo abierto, sin importar quién lo publicó.
    const scope: Prisma.DispatchSheetWhereInput =
      query.scope === 'pending'
        ? { status: { in: OPEN_STATUSES } }
        : query.scope === 'history'
          ? { status: { in: ['DESPACHADO', 'CANCELADO'] } }
          : query.scope === 'created'
            ? { createdById: viewer.id }
            : query.scope === 'assigned'
              ? this.operatorVisibility(viewer)
              : this.baseVisibility(viewer);

    // La bandeja respeta la visibilidad del rol o del permiso «Ver todos».
    const base = this.baseVisibility(viewer);
    return filters.length > 0 ? { AND: [base, scope, ...filters] } : { AND: [base, scope] };
  }

  private baseVisibility(viewer: DispatchViewer): Prisma.DispatchSheetWhereInput {
    if (FULL_VISIBILITY_ROLES.includes(viewer.role) || viewer.canViewAll) return {};
    if (viewer.role === 'PLANIFICADOR') return { createdById: viewer.id };
    if (viewer.role === 'ALMACEN') {
      return {
        OR: [
          this.operatorVisibility(viewer),
          { claimedById: viewer.id },
          { receivedById: viewer.id },
        ],
      };
    }
    // CONSULTA y cualquier otro rol: sin bandeja.
    return { id: { in: [] } };
  }

  private operatorVisibility(viewer: DispatchViewer): Prisma.DispatchSheetWhereInput {
    return {
      OR: [
        { assignedToId: viewer.id },
        { assignedToId: null, assignedRole: 'ALMACEN' },
        { claimedById: viewer.id },
      ],
    };
  }

  private canSee(sheet: DispatchSheet, viewer: DispatchViewer): boolean {
    if (FULL_VISIBILITY_ROLES.includes(viewer.role) || viewer.canViewAll) return true;
    if (sheet.createdById === viewer.id) return true;
    if (viewer.role === 'ALMACEN') {
      return (
        sheet.assignedToId === viewer.id ||
        (sheet.assignedToId === null && sheet.assignedRole === 'ALMACEN') ||
        sheet.claimedById === viewer.id ||
        sheet.receivedById === viewer.id
      );
    }
    return false;
  }

  private canOperate(sheet: DispatchSheet, viewer: DispatchViewer): boolean {
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) return false;
    if (!viewer.canUpdate && !OPERATOR_ROLES.includes(viewer.role)) return false;
    if (sheet.assignedToId && sheet.assignedToId !== viewer.id && viewer.role !== 'ADMIN') return false;
    if (sheet.claimedById && sheet.claimedById !== viewer.id && viewer.role !== 'ADMIN') return false;
    return true;
  }

  private canCancel(sheet: DispatchSheet, viewer: DispatchViewer): boolean {
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) return false;
    if (['ADMIN', 'GERENCIA'].includes(viewer.role)) return true;
    return viewer.role === 'PLANIFICADOR' && sheet.createdById === viewer.id;
  }

  private assertOperable(sheet: DispatchSheet, viewer: DispatchViewer): void {
    if (!this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');
    if (['DESPACHADO', 'CANCELADO'].includes(sheet.status)) {
      throw new ConflictException('El despacho ya está cerrado.');
    }
    if (!viewer.canUpdate && !OPERATOR_ROLES.includes(viewer.role)) {
      throw new ForbiddenException('Solo el personal de almacén opera los despachos.');
    }
    if (sheet.assignedToId && sheet.assignedToId !== viewer.id && viewer.role !== 'ADMIN') {
      throw new ForbiddenException('Este despacho está asignado a otro operador.');
    }
    if (sheet.claimedById && sheet.claimedById !== viewer.id && viewer.role !== 'ADMIN') {
      throw new ConflictException(`Este despacho ya lo tomó ${sheet.claimedByName ?? 'otro operador'}.`);
    }
  }

  // El primer operador que abre una hoja de la bandeja compartida la reclama.
  private claimPatch(sheet: DispatchSheet, actor: ViewerInfo) {
    if (sheet.claimedById) return {};
    return { claimedById: actor.id, claimedByCode: actor.code, claimedByName: actor.name, claimedAt: new Date() };
  }

  private liveTotals(lines: LineRowLite[]) {
    const active = lines.filter((line) => line.status !== 'ANULADO');
    const plannedKg = round2(active.reduce((sum, line) => sum + toNumber(line.plannedKg), 0));
    const loadedSacks = round2(
      active.reduce((sum, line) => sum + (line.uom === 'SAC' ? toNumber(line.loadedQty) : 0), 0),
    );
    const loadedKg = round2(active.reduce((sum, line) => sum + toNumber(line.loadedKg), 0));
    const checkedPlannedKg = round2(
      active.filter((line) => line.status !== 'PENDIENTE').reduce((sum, line) => sum + toNumber(line.plannedKg), 0),
    );
    return {
      plannedKg,
      loadedSacks,
      loadedKg,
      differenceKg: round2(loadedKg - checkedPlannedKg),
    };
  }

  private parseLoadPlan(raw: string | null | undefined): LoadPlan | null {
    if (!raw) return null;
    try {
      return zLoadPlan.parse(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  private toSummary(sheet: SheetWithLines, viewer: DispatchViewer): DispatchSheetSummary {
    const allLines = sheet.lines ?? [];
    // Los renglones anulados son historia: no cuentan en totales ni progreso.
    const lines = allLines.filter((line) => line.status !== 'ANULADO');
    const annulledLines = allLines.length - lines.length;
    const totals = this.liveTotals(lines);
    // «Resuelto» = cargado, parcial o no cargado. Solo pendiente bloquea.
    const linesDone = lines.filter((line) => line.status !== 'PENDIENTE').length;
    // Pedidos distintos (nº de orden) y cuántos todavía tienen algo por cargar.
    const plannedOrderKeys = new Set<string>();
    const pendingOrderKeys = new Set<string>();
    for (const line of lines) {
      const key = line.orderNumber?.trim() || `__line-${line.id}`;
      plannedOrderKeys.add(key);
      const pendingQty = Math.max(0, toNumber(line.plannedQty) - toNumber(line.loadedQty));
      const pendingKg = Math.max(0, toNumber(line.plannedKg) - toNumber(line.loadedKg));
      if (pendingQty > 0 || pendingKg > 0) pendingOrderKeys.add(key);
    }
    const closed = ['DESPACHADO', 'CANCELADO'].includes(sheet.status);
    // «Recibido» era el acuse anterior: se muestra como «en carga».
    const status = sheet.status === 'RECIBIDO' ? 'EN_PROCESO' : sheet.status;
    const customers = [...new Set(lines.map((line) => line.customerName).filter((name): name is string => Boolean(name)))];
    const pendingDates = lines
      .filter((line) => line.status === 'PENDIENTE' && line.effectiveDate)
      .map((line) => line.effectiveDate!)
      .sort();
    const allDates = lines.map((line) => line.effectiveDate).filter((date): date is string => Boolean(date)).sort();

    // Relojes por cliente. `toProgressList` ya sintetiza los sellos globales
    // de una hoja histórica sin filas, así el resumen y el detalle coinciden.
    const progress = this.toProgressList(sheet);
    const starts = progress
      .map((row) => (row.loadStartedAt ? new Date(row.loadStartedAt) : null))
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    const closes = progress
      .map((row) => (row.loadClosedAt ? new Date(row.loadClosedAt) : null))
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    const invoices = progress
      .map((row) => (row.invoiceDeliveredAt ? new Date(row.invoiceDeliveredAt) : null))
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    const loadClosedAt =
      progress.length > 0 && progress.every((row) => row.loadClosedAt)
        ? closes[closes.length - 1] ?? sheet.completedAt
        : null;
    const invoiceDeliveredAt =
      progress.length > 0 && progress.every((row) => row.invoiceDeliveredAt)
        ? invoices[invoices.length - 1] ?? null
        : null;
    const pendingInvoiceCustomers = progress.filter(
      (row) => row.loadClosedAt !== null && row.invoiceDeliveredAt === null,
    ).length;

    return {
      id: sheet.id,
      number: sheet.number,
      title: sheet.title,
      status: status as DispatchSheetSummary['status'],
      instructions: sheet.instructions,
      assignedToId: sheet.assignedToId,
      assignedToName: sheet.assignedTo?.displayName ?? null,
      assignedRole: sheet.assignedRole,
      claimedById: sheet.claimedById,
      claimedByName: sheet.claimedByName,
      claimedAt: iso(sheet.claimedAt),
      createdById: sheet.createdById,
      createdByName: sheet.createdByName,
      createdByCode: sheet.createdByCode,
      sentAt: sheet.sentAt.toISOString(),
      receivedAt: iso(sheet.receivedAt),
      receivedByName: sheet.receivedByName,
      startedAt: iso(sheet.startedAt),
      completedAt: iso(sheet.completedAt),
      completedByName: sheet.completedByName,
      canceledAt: iso(sheet.canceledAt),
      canceledByName: sheet.canceledByName,
      cancelReason: sheet.cancelReason,
      plannedLines: lines.length,
      plannedOrders: plannedOrderKeys.size,
      pendingOrders: pendingOrderKeys.size,
      annulledLines,
      plannedSacks: toNumber(sheet.plannedSacks),
      plannedKg: totals.plannedKg || toNumber(sheet.plannedKg),
      // Una hoja cerrada conserva los totales con los que se firmó, aunque
      // después se agreguen/retiren renglones por una corrección histórica.
      loadedSacks: closed ? toNumber(sheet.loadedSacks) : totals.loadedSacks,
      loadedKg: closed ? toNumber(sheet.loadedKg) : totals.loadedKg,
      differenceKg: closed ? toNumber(sheet.differenceKg) : totals.differenceKg,
      linesDone,
      progress: lines.length > 0 ? linesDone / lines.length : 0,
      customers: customers.slice(0, 3),
      nextDeliveryDate: (pendingDates[0] ?? allDates[0]) || null,
      updatedAt: sheet.updatedAt.toISOString(),
      loadStartedAt: iso(starts[0] ?? sheet.startedAt),
      loadClosedAt: iso(loadClosedAt),
      invoiceDeliveredAt: iso(invoiceDeliveredAt),
      pendingInvoiceCustomers,
      totalCustomers: progress.length,
      closedCustomers: progress.filter((row) => row.loadClosedAt !== null).length,
      invoicedCustomers: progress.filter((row) => row.invoiceDeliveredAt !== null).length,
      canOperate: this.canOperate(sheet, viewer),
      canCancel: this.canCancel(sheet, viewer),
      canInvoice: this.canInvoice(sheet, viewer),
    };
  }

  private toLine(line: LineRow, sheet?: SheetWithLines): DispatchSheetLine {
    const active = line.status !== 'ANULADO';
    const progress = sheet?.customerProgress?.find((row) => row.customerKey === customerKey(line));
    const startedAt = active ? progress?.loadStartedAt ?? sheet?.startedAt ?? line.checkedAt ?? null : null;
    return {
      id: line.id,
      position: line.position,
      orderNumber: line.orderNumber,
      productCode: line.productCode,
      description: line.description,
      uom: line.uom,
      customerCode: line.customerCode,
      customerName: line.customerName,
      warehouseCode: line.warehouseCode,
      effectiveDate: line.effectiveDate,
      plannedQty: toNumber(line.plannedQty),
      plannedKg: toNumber(line.plannedKg),
      loadedQty: line.loadedQty === null ? null : toNumber(line.loadedQty),
      loadedKg: line.loadedKg === null ? null : toNumber(line.loadedKg),
      status: line.status as DispatchSheetLine['status'],
      note: line.note,
      checkedAt: iso(line.checkedAt),
      checkedByName: line.checkedByName,
      removedAt: iso(line.removedAt),
      removedByName: line.removedByName,
      removalReason: line.removalReason,
      removalSource: line.removalSource,
      loadStartedAt: iso(startedAt),
      loadClosedAt: active ? iso(line.checkedAt) : null,
      loadClosedByName: active ? line.checkedByName : null,
    };
  }

  private eventsFor(sheet: { events: EventRow[] }, viewer: DispatchViewer): DispatchSheetEvent[] {
    // La bitácora es exclusiva del rol ADMIN (no depende solo de la pantalla).
    return viewer.isAdmin ? sheet.events.map((event) => this.toEvent(event)) : [];
  }

  private toEvent(event: EventRow): DispatchSheetEvent {
    return {
      id: event.id,
      kind: event.kind === 'MESSAGE' ? 'MESSAGE' : 'SYSTEM',
      type: event.type,
      body: event.body,
      meta: parseEventMeta(event.meta),
      authorId: event.authorId,
      authorCode: event.authorCode,
      authorName: event.authorName,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private toNotification(row: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    entityType: string;
    entityId: string;
    linkPath: string;
    actorName: string | null;
    readAt: Date | null;
    createdAt: Date;
  }): Notification {
    return {
      id: row.id,
      type: row.type as Notification['type'],
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      linkPath: row.linkPath,
      actorName: row.actorName,
      readAt: iso(row.readAt),
      createdAt: row.createdAt.toISOString(),
    };
  }

  // Destinatarios del lado almacén: el asignado, el que ya la tomó, o todos.
  private async operatorRecipients(sheet: DispatchSheet): Promise<string[]> {
    if (sheet.claimedById) return [sheet.claimedById];
    if (sheet.assignedToId) return [sheet.assignedToId];
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: 'ALMACEN' },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private async notify(
    recipients: string[],
    input: {
      type: Notification['type'];
      title: string;
      body?: string | null;
      entityId: string;
      actorId: string;
      actorName: string | null;
      linkPath: string;
    },
  ): Promise<void> {
    const unique = [...new Set(recipients)].filter((id) => id && id !== input.actorId);
    if (unique.length === 0) return;
    // createMany no es portable en todos los motores de desarrollo: se usa
    // una transacción de creates, que siempre funciona (SQLite/PostgreSQL).
    await this.prisma.$transaction(
      unique.map((recipientId) =>
        this.prisma.notification.create({
          data: {
            recipientId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            entityType: 'DispatchSheet',
            entityId: input.entityId,
            linkPath: input.linkPath,
            actorId: input.actorId,
            actorName: input.actorName,
          },
        }),
      ),
    );
  }
}

// Campos de renglón que bastan para resumir la bandeja (no se traen notas ni quién marcó).
const LINE_LITE = {
  id: true,
  position: true,
  orderNumber: true,
  productCode: true,
  description: true,
  status: true,
  effectiveDate: true,
  customerCode: true,
  customerName: true,
  plannedQty: true,
  plannedKg: true,
  loadedQty: true,
  loadedKg: true,
  uom: true,
  note: true,
  checkedAt: true,
  checkedById: true,
  checkedByName: true,
} as const;

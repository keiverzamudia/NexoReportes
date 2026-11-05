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
  DispatchInvoiceInput,
  DispatchLineInput,
  DispatchMessageInput,
  DispatchMetricsQuery,
  DispatchMetricsResponse,
  DispatchReopenInvoiceInput,
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
  // resueltos son intocables; los PENDIENTES se agregan, actualizan o quitan.
  async syncFromDraft(draftId = 'GLOBAL'): Promise<void> {
    const sheets = await this.prisma.dispatchSheet.findMany({
      where: { draftId, status: { notIn: ['DESPACHADO', 'CANCELADO'] } },
      include: { lines: { orderBy: { position: 'asc' } }, customerProgress: true },
    });
    if (sheets.length === 0) return;

    const draft = await this.prisma.dispatchDraft.findUnique({ where: { id: draftId } });
    if (!draft) return;
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
      await this.syncSheet(sheet, planLines, payload, draft.version);
    }
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
  ): Promise<void> {
    // Una vez entregada una factura, el plan vivo ya no debe mover esa hoja:
    // la corrección exige reabrir la factura primero.
    if ((sheet.customerProgress ?? []).some((row) => row.invoiceDeliveredAt !== null)) return;

    // Los renglones ya resueltos (cargado, parcial o no cargado) son
    // intocables: la simulación viva solo agrega, actualiza o quita pendientes.
    const lockedRows = sheet.lines.filter((row) => row.status !== 'PENDIENTE');
    const lockedKeys = new Set(lockedRows.map((row) => draftLineKey(row)));
    const planByKey = new Map(planLines.map((item) => [draftLineKey(item.line), item]));
    const existingByKey = new Map(sheet.lines.map((row) => [draftLineKey(row), row]));

    const toDelete: string[] = [];
    const toUpdate: Array<{ row: LineRow; plan: (typeof planLines)[number] }> = [];
    for (const row of sheet.lines) {
      if (row.status !== 'PENDIENTE') continue;
      const plan = planByKey.get(draftLineKey(row));
      if (!plan || plan.assignment.assignedQty <= 0) {
        toDelete.push(row.id);
        continue;
      }
      const qtyChanged = round2(toNumber(row.plannedQty)) !== round2(plan.assignment.assignedQty);
      const kgChanged = round2(toNumber(row.plannedKg)) !== round2(plan.assignment.assignedKg);
      if (qtyChanged || kgChanged) toUpdate.push({ row, plan });
    }
    const toCreate = planLines.filter(
      (item) =>
        item.assignment.assignedQty > 0 &&
        !existingByKey.has(draftLineKey(item.line)) &&
        !lockedKeys.has(draftLineKey(item.line)),
    );

    const loadPlanJson = payload.loadPlan ? JSON.stringify(payload.loadPlan) : null;
    const desiredPending = planLines.filter(
      (item) => item.assignment.assignedQty > 0 && !lockedKeys.has(draftLineKey(item.line)),
    );
    const signature = [
      ...lockedRows.map(
        (row) =>
          `${draftLineKey(row)}|${row.status}|${round2(toNumber(row.plannedQty))}|${round2(toNumber(row.plannedKg))}|${round2(toNumber(row.loadedQty))}|${row.note ?? ''}`,
      ),
      ...desiredPending.map(
        (item) =>
          `${draftLineKey(item.line)}|PENDIENTE|${round2(item.assignment.assignedQty)}|${round2(item.assignment.assignedKg)}|${payload.comments?.[draftLineKey(item.line)] ?? ''}`,
      ),
    ]
      .sort()
      .join(';');
    const currentSignature = sheet.lines
      .map(
        (row) =>
          `${draftLineKey(row)}|${row.status}|${round2(toNumber(row.plannedQty))}|${round2(toNumber(row.plannedKg))}${
            row.status === 'PENDIENTE' ? `|${row.note ?? ''}` : `|${round2(toNumber(row.loadedQty))}|${row.note ?? ''}`
          }`,
      )
      .sort()
      .join(';');

    if (signature === currentSignature && sheet.loadPlanJson === loadPlanJson) return;

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

    // Filas de relojes: crear las de clientes nuevos y quitar huérfanas sin
    // actividad. Si un cliente ya cerrado recibe un renglón nuevo, se reabre
    // su carga (sin factura: arriba se descartó la hoja facturada).
    const deletedIds = new Set(toDelete);
    const finalCustomers = new Map<string, { customerCode: string | null; customerName: string | null }>();
    for (const row of sheet.lines) {
      if (deletedIds.has(row.id)) continue;
      finalCustomers.set(customerKey(row), { customerCode: row.customerCode, customerName: row.customerName });
    }
    for (const item of toCreate) {
      finalCustomers.set(customerKey(item.line), {
        customerCode: item.line.customerCode ?? null,
        customerName: item.line.customerName ?? null,
      });
    }
    const existingProgressKeys = new Set((sheet.customerProgress ?? []).map((row) => row.customerKey));
    const progressToCreate = [...finalCustomers.entries()].filter(([key]) => !existingProgressKeys.has(key));
    const progressToDelete = (sheet.customerProgress ?? []).filter(
      (row) => !finalCustomers.has(row.customerKey) && !row.loadStartedAt && !row.invoiceDeliveredAt,
    );
    const progressToReopen = [...new Set(toCreate.map((item) => customerKey(item.line)))].filter((key) =>
      existingProgressKeys.has(key),
    );

    await this.prisma.$transaction([
      ...toDelete.map((id) => this.prisma.dispatchSheetLine.delete({ where: { id } })),
      ...progressToDelete.map((row) =>
        this.prisma.dispatchCustomerProgress.delete({ where: { id: row.id } }),
      ),
      ...progressToCreate.map(([key, customer]) =>
        this.prisma.dispatchCustomerProgress.create({
          data: {
            sheetId: sheet.id,
            customerKey: key,
            customerCode: customer.customerCode,
            customerName: customer.customerName,
          },
        }),
      ),
      ...progressToReopen.map((key) =>
        this.prisma.dispatchCustomerProgress.updateMany({
          where: { sheetId: sheet.id, customerKey: key },
          data: { loadClosedAt: null },
        }),
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
          plannedLines: desiredPending.length + lockedRows.length,
          plannedSacks,
          plannedKg,
          photoJson: JSON.stringify(snapshot),
          loadPlanJson,
          draftRevision,
        },
      }),
      this.prisma.dispatchSheetEvent.create({
        data: {
          sheetId: sheet.id,
          kind: 'SYSTEM',
          type: 'SIMULACION_ACTUALIZADA',
          body: `La simulación del equipo cambió: ${toCreate.length} renglón(es) agregado(s), ${toDelete.length} quitado(s), ${toUpdate.length} actualizado(s).`,
          authorName: 'Simulación del equipo',
        },
      }),
    ]);
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
              checkedAt: new Date(),
              checkedById: actor.id,
              checkedByName: actor.name,
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
        body: `${actor.name ?? 'Almacén'} inició la carga de ${bucket.name} (${bucket.lines.length} producto(s)).`,
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
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURA_ENTREGADA',
        body: `Factura${input.invoiceRef ? ` N° ${input.invoiceRef}` : ''} entregada a ${bucket.name} en ${durationLabel(
          minutesBetween(progress.loadStartedAt, now),
        )} desde el inicio de carga.`,
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
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURADO',
        body: `Facturación entregada a ${progress.length} cliente(s)${
          input.invoiceRef ? ` (N° ${input.invoiceRef})` : ''
        }.`,
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
    await this.prisma.dispatchSheetEvent.create({
      data: {
        sheetId: sheet.id,
        kind: 'SYSTEM',
        type: 'FACTURA_REABIERTA',
        body: `Reabrió la factura de ${progress.customerName ?? input.customerKey}. Motivo: ${input.reason}`,
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
          { status: { not: 'CANCELADO' } },
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

  // ---------- Cerrar ----------

  async complete(viewer: DispatchViewer, id: string, input: DispatchCompleteInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    // Idempotente: cerrar dos veces devuelve el mismo estado.
    if (sheet.status === 'DESPACHADO') return this.detail(viewer, id);
    this.assertOperable(sheet, viewer);
    if (!['RECIBIDO', 'EN_PROCESO', 'CON_NOVEDAD'].includes(sheet.status)) {
      throw new ConflictException('Carga al menos un renglón antes de cerrarlo.');
    }
    const pending = sheet.lines.filter((line) => line.status === 'PENDIENTE');
    if (pending.length > 0) {
      throw new BadRequestException(
        `Faltan ${pending.length} renglón(es) por resolver. Marca cada uno como cargado, parcial o no cargado.`,
      );
    }
    // Las diferencias exigen motivo: sin él, el cierre no deja rastro del porqué.
    const sinMotivo = sheet.lines.filter(
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
    const events: Array<{ type: string; body: string }> = [];

    for (const bucket of buckets) {
      const previous = previousRows.get(bucket.key);
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

      if (!previous?.loadClosedAt && closedAt) {
        events.push({
          type: 'CARGA_CERRADA',
          body: `Cerró la carga de ${bucket.name}: ${bucket.lines.length} producto(s) en ${durationLabel(
            minutesBetween(startedAt, closedAt),
          )}.`,
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
      } else if (previous?.loadClosedAt && !closedAt) {
        events.push({
          type: 'CARGA_REABIERTA',
          body: `Reabrió la carga de ${bucket.name}.`,
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
    if (query.from) filters.push({ sentAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
    if (query.to) filters.push({ sentAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } });

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
    const plannedKg = round2(lines.reduce((sum, line) => sum + toNumber(line.plannedKg), 0));
    const loadedSacks = round2(
      lines.reduce((sum, line) => sum + (line.uom === 'SAC' ? toNumber(line.loadedQty) : 0), 0),
    );
    const loadedKg = round2(lines.reduce((sum, line) => sum + toNumber(line.loadedKg), 0));
    const checkedPlannedKg = round2(
      lines.filter((line) => line.status !== 'PENDIENTE').reduce((sum, line) => sum + toNumber(line.plannedKg), 0),
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
    const lines = sheet.lines ?? [];
    const totals = this.liveTotals(lines);
    // «Resuelto» = cargado, parcial o no cargado. Solo pendiente bloquea.
    const linesDone = lines.filter((line) => line.status !== 'PENDIENTE').length;
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
      plannedLines: sheet.plannedLines || lines.length,
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
      canOperate: this.canOperate(sheet, viewer),
      canCancel: this.canCancel(sheet, viewer),
      canInvoice: this.canInvoice(sheet, viewer),
    };
  }

  private toLine(line: LineRow, sheet?: SheetWithLines): DispatchSheetLine {
    const progress = sheet?.customerProgress?.find((row) => row.customerKey === customerKey(line));
    const startedAt = progress?.loadStartedAt ?? sheet?.startedAt ?? line.checkedAt ?? null;
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
      loadStartedAt: iso(startedAt),
      loadClosedAt: iso(line.checkedAt),
      loadClosedByName: line.checkedByName,
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

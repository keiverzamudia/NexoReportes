import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DispatchAckInput,
  DispatchAssigneesResponse,
  DispatchCancelInput,
  DispatchCompleteInput,
  DispatchLineInput,
  DispatchMessageInput,
  DispatchSheetCreateInput,
  DispatchSheetDetail,
  DispatchSheetEvent,
  DispatchSheetLine,
  DispatchSheetListResponse,
  DispatchSheetQuery,
  DispatchSheetSummary,
  Notification,
  NotificationReadInput,
  NotificationListResponse,
  zScenarioPayload,
} from '@nexo/contracts';
import { DispatchSheet, DispatchSheetEvent as EventRow, DispatchSheetLine as LineRow, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { ArrivalsService, ArrivalSourceLine } from '../arrivals/arrivals.service';

// ============================================================
// Despacho de almacén: hoja de trabajo + túnel de acuses.
//
// Un despacho nace de un escenario guardado del simulador. El planificador lo
// publica, el almacén lo recibe, lo carga renglón por renglón y lo cierra.
// Cada paso deja: sello temporal, evento en la bitácora y notificación al otro
// lado. Nada de esto escribe en Profit.
//
// Máquina de estados (validada aquí, no en el controlador):
//   ENVIADO → RECIBIDO → EN_PROCESO → { CON_NOVEDAD ⇄ EN_PROCESO } → DESPACHADO
//   { ENVIADO | RECIBIDO | EN_PROCESO | CON_NOVEDAD } → CANCELADO
// ============================================================

export interface DispatchViewer {
  id: string;
  role: string;
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
  'status' | 'effectiveDate' | 'customerName' | 'plannedQty' | 'plannedKg' | 'loadedQty' | 'loadedKg' | 'uom'
>;

type SheetWithLines = DispatchSheet & { lines: LineRowLite[]; assignedTo?: { displayName: string } | null };

const OPEN_STATUSES = ['ENVIADO', 'RECIBIDO', 'EN_PROCESO', 'CON_NOVEDAD'];
const OPERATOR_ROLES = ['ALMACEN', 'ADMIN'];
const PLANNER_ROLES = ['PLANIFICADOR', 'GERENCIA', 'ADMIN'];
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
      include: { lines: { select: LINE_LITE }, assignedTo: { select: { displayName: true } } },
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
      },
    });
    // Un despacho ajeno responde 404: no se filtra su existencia.
    if (!sheet || !this.canSee(sheet, viewer)) throw new NotFoundException('Despacho no encontrado.');

    return {
      ...this.toSummary(sheet, viewer),
      lines: sheet.lines.map((line) => this.toLine(line)),
      events: sheet.events.map((event) => this.toEvent(event)),
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
    const actor = await this.viewerInfo(viewer);

    // Sin operadores de almacén activos la publicación se bloquea: el aviso no
    // llegaría a nadie y la hoja quedaría huérfana.
    const candidates = await this.operatorCandidates();
    const warehouseOperators = candidates.filter((candidate) => candidate.baseRole === 'ALMACEN');
    if (warehouseOperators.length === 0) {
      throw new ConflictException(
        'No hay operadores de almacén activos, así que el despacho no tendría a quién llegar. Un administrador debe dar el permiso «Operar» (Despacho) a un rol con plantilla Almacén antes de publicar.',
      );
    }

    const scenario = await this.prisma.dispatchScenario.findFirst({
      where: { id: input.scenarioId, ownerId: viewer.id, kind: 'SAVED' },
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
        },
        include: {
          lines: { orderBy: { position: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
          assignedTo: { select: { displayName: true } },
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
      lines: sheet.lines.map((line) => this.toLine(line)),
      events: sheet.events.map((event) => this.toEvent(event)),
    };
  }

  // ---------- Acuses ----------

  async ack(viewer: DispatchViewer, id: string, input: DispatchAckInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    const actor = await this.viewerInfo(viewer);
    this.assertOperable(sheet, viewer);

    if (input.event === 'RECIBIDO') {
      // Idempotente: repetir el acuse no duplica sellos ni notificaciones.
      if (sheet.receivedAt) return this.detail(viewer, id);
      const claimed = this.claimPatch(sheet, actor);
      await this.prisma.$transaction([
        this.prisma.dispatchSheet.update({
          where: { id: sheet.id },
          data: {
            status: 'RECIBIDO',
            receivedAt: new Date(),
            receivedById: actor.id,
            receivedByName: actor.name,
            ...claimed,
          },
        }),
        this.prisma.dispatchSheetEvent.create({
          data: {
            sheetId: sheet.id,
            kind: 'SYSTEM',
            type: 'RECIBIDO',
            body: `${actor.name ?? 'El almacén'} abrió el despacho.`,
            authorId: actor.id,
            authorCode: actor.code,
            authorName: actor.name,
          },
        }),
      ]);
      await this.notify([sheet.createdById], {
        type: 'DESPACHO_RECIBIDO',
        title: `${sheet.number}: abierto por el almacén`,
        body: `${actor.name ?? 'Almacén'} recibió el despacho ${sheet.title}.`,
        entityId: sheet.id,
        actorId: actor.id,
        actorName: actor.name,
        linkPath: `/despacho/${sheet.id}`,
      });
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.code,
        action: 'DISPATCH_ACK',
        entityType: 'DispatchSheet',
        entityId: sheet.id,
        context: { number: sheet.number, event: 'RECIBIDO' },
      });
      return this.detail(viewer, id);
    }

    // EN_PROCESO
    if (sheet.status === 'EN_PROCESO') return this.detail(viewer, id);
    if (!['RECIBIDO', 'CON_NOVEDAD'].includes(sheet.status)) {
      throw new ConflictException('Primero hay que abrir (recibir) el despacho.');
    }
    const claimed = this.claimPatch(sheet, actor);
    await this.prisma.$transaction([
      this.prisma.dispatchSheet.update({
        where: { id: sheet.id },
        data: {
          status: 'EN_PROCESO',
          startedAt: sheet.startedAt ?? new Date(),
          receivedAt: sheet.receivedAt ?? new Date(),
          receivedById: sheet.receivedById ?? actor.id,
          receivedByName: sheet.receivedByName ?? actor.name,
          ...claimed,
        },
      }),
      this.prisma.dispatchSheetEvent.create({
        data: {
          sheetId: sheet.id,
          kind: 'SYSTEM',
          type: 'EN_PROCESO',
          body: `${actor.name ?? 'El almacén'} empezó a cargar.`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);
    await this.notify([sheet.createdById], {
      type: 'DESPACHO_EN_PROCESO',
      title: `${sheet.number}: en carga`,
      body: `${actor.name ?? 'Almacén'} está cargando el despacho.`,
      entityId: sheet.id,
      actorId: actor.id,
      actorName: actor.name,
      linkPath: `/despacho/${sheet.id}`,
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'DISPATCH_ACK',
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      context: { number: sheet.number, event: 'EN_PROCESO' },
    });
    return this.detail(viewer, id);
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
    const plannedQty = toNumber(line.plannedQty);
    const plannedKg = toNumber(line.plannedKg);
    const loadedQty = round2(input.loadedQty);
    // Los kg reales se derivan del kg/unidad planificado: el almacén solo
    // digita lo que cargó, nunca dos veces el mismo dato.
    const loadedKg = plannedQty > 0 ? round2((loadedQty * plannedKg) / plannedQty) : round2(loadedQty);

    await this.prisma.dispatchSheetLine.update({
      where: { id: line.id },
      data: {
        loadedQty,
        loadedKg,
        status: input.status,
        note: input.note ?? null,
        checkedAt: new Date(),
        checkedById: actor.id,
        checkedByName: actor.name,
      },
    });

    // El estado de la hoja refleja si hay novedades entre los renglones.
    const refreshed = await this.findSheet(id);
    const hasNovedad = refreshed.lines.some((item) => NOVEDAD_LINE_STATUSES.includes(item.status));
    const nextStatus = hasNovedad ? 'CON_NOVEDAD' : refreshed.status === 'CON_NOVEDAD' ? 'EN_PROCESO' : refreshed.status;
    if (nextStatus !== refreshed.status) {
      await this.prisma.$transaction([
        this.prisma.dispatchSheet.update({ where: { id: refreshed.id }, data: { status: nextStatus } }),
        this.prisma.dispatchSheetEvent.create({
          data: {
            sheetId: refreshed.id,
            kind: 'SYSTEM',
            type: hasNovedad ? 'NOVEDAD' : 'EN_PROCESO',
            body: hasNovedad
              ? `${actor.name ?? 'Almacén'} reportó diferencias en la carga.`
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
          body: `${actor.name ?? 'Almacén'} reportó faltantes o diferencias. Revisa la bitácora.`,
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
      },
    });

    return this.detail(viewer, id);
  }

  // ---------- Cerrar ----------

  async complete(viewer: DispatchViewer, id: string, input: DispatchCompleteInput): Promise<DispatchSheetDetail> {
    const sheet = await this.findSheet(id);
    // Idempotente: cerrar dos veces devuelve el mismo estado.
    if (sheet.status === 'DESPACHADO') return this.detail(viewer, id);
    this.assertOperable(sheet, viewer);
    if (!['EN_PROCESO', 'CON_NOVEDAD'].includes(sheet.status)) {
      throw new ConflictException('Toma el despacho (en proceso) antes de cerrarlo.');
    }
    const pending = sheet.lines.filter((line) => line.status === 'PENDIENTE');
    if (pending.length > 0) {
      throw new BadRequestException(
        `Faltan ${pending.length} renglón(es) por confirmar. Marca cada uno como cargado, parcial o faltante.`,
      );
    }

    const actor = await this.viewerInfo(viewer);
    const totals = this.liveTotals(sheet.lines);
    await this.prisma.$transaction([
      this.prisma.dispatchSheet.update({
        where: { id: sheet.id },
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
      include: { lines: { orderBy: { position: 'asc' } }, assignedTo: { select: { displayName: true } } },
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
    const base = this.baseVisibility(viewer);
    const filters: Prisma.DispatchSheetWhereInput[] = [];
    if (query.q?.trim()) {
      const needle = query.q.trim();
      filters.push({
        OR: [{ number: { contains: needle } }, { title: { contains: needle } }, { scenarioName: { contains: needle } }],
      });
    }
    if (query.from) filters.push({ sentAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
    if (query.to) filters.push({ sentAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } });

    const scope: Prisma.DispatchSheetWhereInput =
      query.scope === 'created'
        ? { createdById: viewer.id }
        : query.scope === 'assigned'
          ? this.operatorVisibility(viewer)
          : {};

    return filters.length > 0 ? { AND: [base, scope, ...filters] } : { AND: [base, scope] };
  }

  private baseVisibility(viewer: DispatchViewer): Prisma.DispatchSheetWhereInput {
    if (['ADMIN', 'GERENCIA'].includes(viewer.role)) return {};
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
    if (['ADMIN', 'GERENCIA'].includes(viewer.role)) return true;
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
    if (!OPERATOR_ROLES.includes(viewer.role)) return false;
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
    if (!OPERATOR_ROLES.includes(viewer.role)) {
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

  private toSummary(sheet: SheetWithLines, viewer: DispatchViewer): DispatchSheetSummary {
    const lines = sheet.lines ?? [];
    const totals = this.liveTotals(lines);
    const linesDone = lines.filter((line) => line.status !== 'PENDIENTE').length;
    const customers = [...new Set(lines.map((line) => line.customerName).filter((name): name is string => Boolean(name)))];
    const pendingDates = lines
      .filter((line) => line.status === 'PENDIENTE' && line.effectiveDate)
      .map((line) => line.effectiveDate!)
      .sort();
    const allDates = lines.map((line) => line.effectiveDate).filter((date): date is string => Boolean(date)).sort();

    return {
      id: sheet.id,
      number: sheet.number,
      title: sheet.title,
      status: sheet.status as DispatchSheetSummary['status'],
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
      loadedSacks: totals.loadedSacks,
      loadedKg: totals.loadedKg,
      differenceKg: totals.differenceKg,
      linesDone,
      progress: lines.length > 0 ? linesDone / lines.length : 0,
      customers: customers.slice(0, 3),
      nextDeliveryDate: (pendingDates[0] ?? allDates[0]) || null,
      updatedAt: sheet.updatedAt.toISOString(),
      canOperate: this.canOperate(sheet, viewer),
      canCancel: this.canCancel(sheet, viewer),
    };
  }

  private toLine(line: LineRow): DispatchSheetLine {
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
    };
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
  status: true,
  effectiveDate: true,
  customerName: true,
  plannedQty: true,
  plannedKg: true,
  loadedQty: true,
  loadedKg: true,
  uom: true,
} as const;

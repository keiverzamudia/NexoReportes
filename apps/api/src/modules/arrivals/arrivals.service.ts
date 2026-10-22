import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ArrivalCheckInInput,
  ArrivalCloseInput,
  ArrivalDetail,
  ArrivalEditInput,
  ArrivalEvent,
  ArrivalIncident,
  ArrivalIncidentInput,
  ArrivalIncidentResolveInput,
  ArrivalListResponse,
  ArrivalMessageInput,
  ArrivalQuery,
  ArrivalStatus,
  ArrivalSummary,
} from '@nexo/contracts';
import {
  ArrivalEvent as EventRow,
  ArrivalIncident as IncidentRow,
  CustomerArrival,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';

// ============================================================
// Llegadas de clientes (PCP).
//
// El registro NACE solo: al publicar un despacho se agrupan los renglones por
// cliente y se crea una llegada esperada por cada uno (`rowsForSheet`). Nadie
// tiene que apretar otro botón.
//
// En planta: `checkIn` sella la hora con el reloj del servidor; las
// incidencias se acumulan con severidad; cerrar deja ATENDIDO o AUSENTE.
// Corregir un registro ya hecho exige el permiso «Corregir registros» y deja
// en la bitácora el antes → después y el motivo.
//
// Nada de esto escribe en Profit: es bitácora operativa de la planta.
// ============================================================

export interface ArrivalViewer {
  id: string;
  code?: string | null;
  name?: string | null;
  permissions: string[];
}

export interface ArrivalActor {
  id: string;
  code: string | null;
  name: string | null;
}

export interface ArrivalSourceLine {
  orderNumber: string;
  customerCode: string | null;
  customerName: string | null;
  uom: string | null;
  effectiveDate: string | null;
  plannedQty: number;
  plannedKg: number;
}

type ArrivalWithIncidents = CustomerArrival & { incidents: Array<Pick<IncidentRow, 'status'>> };

const CHECK_IN_OPEN = ['ESPERADO', 'CON_INCIDENCIA'];
const CLOSED_STATUSES = ['ATENDIDO', 'AUSENTE', 'CANCELADO'];

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

function clock(value: Date): string {
  return value.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

@Injectable()
export class ArrivalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Creación automática desde el despacho ----------

  /**
   * Agrupa los renglones del despacho por cliente y devuelve las filas listas
   * para el `create` anidado de `DispatchSheet` (atómico con la publicación).
   */
  async rowsForSheet(input: {
    sheetNumber: string;
    sheetTitle: string;
    lines: ArrivalSourceLine[];
    actor: ArrivalActor;
  }): Promise<Prisma.CustomerArrivalCreateWithoutSheetInput[]> {
    const grouped = this.groupByCustomer(input.lines);
    if (grouped.length === 0) return [];
    const numbers = await this.nextNumbers(grouped.length);

    return grouped.map((group, index) => ({
      number: numbers[index]!,
      sheetNumber: input.sheetNumber,
      sheetTitle: input.sheetTitle,
      customerCode: group.code,
      customerName: group.name,
      expectedDate: group.expectedDate,
      orderNumbers: group.orderNumbers.join(','),
      lineCount: group.lineCount,
      plannedSacks: group.sacks,
      plannedKg: group.kg,
      status: 'ESPERADO',
      createdById: input.actor.id,
      createdByCode: input.actor.code,
      createdByName: input.actor.name,
      events: {
        create: {
          kind: 'SYSTEM',
          type: 'CREADO',
          body: `Esperado por el despacho ${input.sheetNumber} · ${group.orderNumbers.length} pedido(s) · ${group.kg} kg.`,
          authorId: input.actor.id,
          authorCode: input.actor.code,
          authorName: input.actor.name,
        },
      },
    }));
  }

  /** Aviso a PCP de que hay clientes nuevos esperados (campana del shell). */
  async notifyExpected(
    sheet: { id: string; number: string; title: string },
    input: { customers: number; kg: number },
    actor: ArrivalActor,
  ): Promise<void> {
    if (input.customers === 0) return;
    const recipients = await this.pcpRecipients();
    await this.notify(recipients, {
      type: 'LLEGADA_ESPERADA',
      title: `Clientes esperados · ${sheet.number}`,
      body: `${input.customers} cliente(s) · ${input.kg} kg · ${sheet.title}`,
      entityType: 'DispatchSheet',
      entityId: sheet.id,
      linkPath: '/llegadas',
      actorId: actor.id,
      actorName: actor.name,
    });
  }

  /** El despacho se anuló: las llegadas que aún no ocurrieron se cancelan. */
  async cancelForSheet(sheetId: string, actor: ArrivalActor, reason: string): Promise<void> {
    const rows = await this.prisma.customerArrival.findMany({
      where: { sheetId, status: { not: 'CANCELADO' } },
      select: { id: true, arrivedAt: true },
    });
    if (rows.length === 0) return;

    await this.prisma.$transaction(
      rows.flatMap((row) => {
        const nextStatus: ArrivalStatus = row.arrivedAt ? 'ATENDIDO' : 'CANCELADO';
        return [
          this.prisma.customerArrival.update({
            where: { id: row.id },
            data: {
              status: nextStatus,
              closedAt: row.arrivedAt ? undefined : new Date(),
              updatedById: actor.id,
              updatedByName: actor.name,
            },
          }),
          this.prisma.arrivalEvent.create({
            data: {
              arrivalId: row.id,
              kind: 'SYSTEM',
              type: row.arrivedAt ? 'DESPACHO_ANULADO' : 'CANCELADO',
              body: row.arrivedAt
                ? `El despacho se anuló después de la llegada (${reason}). El registro se conserva como atendido.`
                : `Llegada cancelada: el despacho se anuló (${reason}).`,
              authorId: actor.id,
              authorCode: actor.code,
              authorName: actor.name,
            },
          }),
        ];
      }),
    );
  }

  // ---------- Consulta ----------

  async list(viewer: ArrivalViewer, query: ArrivalQuery): Promise<ArrivalListResponse> {
    const rows = await this.prisma.customerArrival.findMany({
      where: query.date ? { expectedDate: query.date } : {},
      include: { incidents: { select: { status: true } } },
      orderBy: [{ expectedDate: 'asc' }, { customerName: 'asc' }],
      take: query.limit,
    });

    const counters = {
      expected: rows.filter((row) => row.status === 'ESPERADO').length,
      onSite: rows.filter((row) => row.status === 'EN_PLANTA').length,
      attended: rows.filter((row) => row.status === 'ATENDIDO').length,
      withIncident: rows.filter((row) => row.status === 'CON_INCIDENCIA').length,
      missed: rows.filter((row) => row.status === 'AUSENTE').length,
      kgExpected: round2(
        rows
          .filter((row) => !CLOSED_STATUSES.includes(row.status))
          .reduce((sum, row) => sum + toNumber(row.plannedKg), 0),
      ),
    };

    const term = query.q?.toLowerCase() ?? '';
    const items = rows
      .filter((row) => (query.status ? row.status === query.status : true))
      .filter((row) => {
        if (!term) return true;
        return [row.customerName, row.customerCode, row.sheetNumber, row.orderNumbers]
          .join(' ')
          .toLowerCase()
          .includes(term);
      })
      .map((row) => this.toSummary(row, viewer));

    return { items, total: items.length, counters };
  }

  async detail(viewer: ArrivalViewer, id: string): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    return {
      ...this.toSummary(row, viewer),
      incidents: row.incidents.map((incident) => this.toIncident(incident)),
      events: row.events.map((event) => this.toEvent(event)),
    };
  }

  // ---------- Operación en planta ----------

  async checkIn(viewer: ArrivalViewer, id: string, input: ArrivalCheckInInput): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    if (row.status === 'CANCELADO') {
      throw new BadRequestException('Ese despacho se anuló: la llegada ya no aplica.');
    }
    if (row.arrivedAt) {
      throw new ConflictException(
        `La llegada ya estaba marcada a las ${clock(row.arrivedAt)}${row.arrivedByName ? ` por ${row.arrivedByName}` : ''}.`,
      );
    }

    const actor = await this.viewerInfo(viewer);
    const at = input.at ? new Date(input.at) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('La hora indicada no es válida.');

    await this.prisma.$transaction([
      this.prisma.customerArrival.update({
        where: { id: row.id },
        data: {
          status: 'EN_PLANTA',
          arrivedAt: at,
          arrivedById: actor.id,
          arrivedByCode: actor.code,
          arrivedByName: actor.name,
          note: input.note ?? row.note,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'LLEGADA',
          body: `Llegada marcada a las ${clock(at)} por ${actor.name ?? actor.code ?? 'PCP'}.${input.note ? ` ${input.note}` : ''}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ARRIVAL_CHECK_IN',
      entityType: 'CustomerArrival',
      entityId: row.id,
      context: { number: row.number, customer: row.customerName, at: at.toISOString() },
    });

    await this.notifyDispatchers(row, {
      type: 'LLEGADA_MARCADA',
      title: `Llegó ${row.customerName}`,
      body: `${row.number} · ${row.sheetNumber} · marcada a las ${clock(at)}${input.note ? ` · ${input.note}` : ''}`,
      actorId: actor.id,
      actorName: actor.name,
    });

    return this.detail(viewer, id);
  }

  async close(viewer: ArrivalViewer, id: string, input: ArrivalCloseInput): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    if (row.status === 'CANCELADO') throw new BadRequestException('Una llegada cancelada no se puede cerrar.');
    if (row.status === input.status) throw new ConflictException('La llegada ya está en ese estado.');

    const actor = await this.viewerInfo(viewer);
    const at = new Date();

    await this.prisma.$transaction([
      this.prisma.customerArrival.update({
        where: { id: row.id },
        data: {
          status: input.status,
          closedAt: at,
          note: input.note ?? row.note,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: input.status === 'ATENDIDO' ? 'ATENDIDO' : 'AUSENTE',
          body:
            (input.status === 'ATENDIDO'
              ? `Atención cerrada por ${actor.name ?? 'PCP'} a las ${clock(at)}.`
              : `Se marcó como no presentado por ${actor.name ?? 'PCP'} a las ${clock(at)}.`) +
            (input.note ? ` ${input.note}` : ''),
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ARRIVAL_CLOSE',
      entityType: 'CustomerArrival',
      entityId: row.id,
      context: { number: row.number, status: input.status },
    });

    return this.detail(viewer, id);
  }

  // ---------- Correcciones (jefe de PCP / ADMIN) ----------

  async update(viewer: ArrivalViewer, id: string, input: ArrivalEditInput): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    const actor = await this.viewerInfo(viewer);

    const changes: string[] = [];
    const data: Prisma.CustomerArrivalUpdateInput = {
      updatedById: actor.id,
      updatedByName: actor.name,
    };

    if (input.arrivedAt !== undefined) {
      const next = input.arrivedAt ? new Date(input.arrivedAt) : null;
      if (next && Number.isNaN(next.getTime())) throw new BadRequestException('La hora indicada no es válida.');
      if ((row.arrivedAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
        changes.push(`hora ${row.arrivedAt ? clock(row.arrivedAt) : '—'} → ${next ? clock(next) : '—'}`);
        data.arrivedAt = next;
        if (next) {
          data.arrivedById = actor.id;
          data.arrivedByCode = actor.code;
          data.arrivedByName = actor.name;
        }
        if (next && !input.status && CLOSED_STATUSES.includes(row.status) === false && row.status === 'ESPERADO') {
          data.status = 'EN_PLANTA';
        }
      }
    }
    if (input.status !== undefined && input.status !== row.status) {
      changes.push(`estado ${row.status} → ${input.status}`);
      data.status = input.status;
      if (CLOSED_STATUSES.includes(input.status)) data.closedAt = new Date();
      if (!CLOSED_STATUSES.includes(input.status) && row.closedAt) data.closedAt = null;
    }
    if (input.expectedDate !== undefined && input.expectedDate !== row.expectedDate) {
      changes.push(`fecha ${row.expectedDate ?? '—'} → ${input.expectedDate ?? '—'}`);
      data.expectedDate = input.expectedDate;
    }
    if (input.note !== undefined && input.note !== row.note) {
      changes.push('nota actualizada');
      data.note = input.note;
    }

    if (changes.length === 0) return this.detail(viewer, id);

    await this.prisma.$transaction([
      this.prisma.customerArrival.update({ where: { id: row.id }, data }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'EDICION',
          body: `Corrección por ${actor.name ?? 'jefe de PCP'}: ${input.reason}. Cambios: ${changes.join('; ')}.`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ARRIVAL_EDIT',
      entityType: 'CustomerArrival',
      entityId: row.id,
      context: { number: row.number, reason: input.reason, changes },
    });

    return this.detail(viewer, id);
  }

  // ---------- Incidencias ----------

  async addIncident(viewer: ArrivalViewer, id: string, input: ArrivalIncidentInput): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    if (row.status === 'CANCELADO') throw new BadRequestException('Una llegada cancelada no admite incidencias.');
    const actor = await this.viewerInfo(viewer);

    await this.prisma.$transaction([
      this.prisma.arrivalIncident.create({
        data: {
          arrivalId: row.id,
          kind: input.kind,
          severity: input.severity,
          body: input.body,
          status: 'ABIERTA',
          reportedById: actor.id,
          reportedByCode: actor.code,
          reportedByName: actor.name,
        },
      }),
      this.prisma.customerArrival.update({
        where: { id: row.id },
        data: {
          status: CLOSED_STATUSES.includes(row.status) ? row.status : 'CON_INCIDENCIA',
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'INCIDENCIA',
          body: `Incidencia ${input.kind} (${input.severity}) reportada por ${actor.name ?? 'PCP'}: ${input.body}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ARRIVAL_INCIDENT',
      entityType: 'CustomerArrival',
      entityId: row.id,
      context: { number: row.number, kind: input.kind, severity: input.severity },
    });

    await this.notifyDispatchers(row, {
      type: 'LLEGADA_INCIDENCIA',
      title: `Incidencia con ${row.customerName}`,
      body: `${row.number} · ${input.kind}: ${input.body}`,
      actorId: actor.id,
      actorName: actor.name,
    });

    return this.detail(viewer, id);
  }

  async resolveIncident(
    viewer: ArrivalViewer,
    id: string,
    incidentId: string,
    input: ArrivalIncidentResolveInput,
  ): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    const incident = row.incidents.find((item) => item.id === incidentId);
    if (!incident) throw new NotFoundException('Incidencia no encontrada.');
    if (incident.status === 'RESUELTA') throw new ConflictException('Esa incidencia ya estaba resuelta.');

    const actor = await this.viewerInfo(viewer);
    const at = new Date();

    await this.prisma.$transaction([
      this.prisma.arrivalIncident.update({
        where: { id: incident.id },
        data: {
          status: 'RESUELTA',
          resolution: input.resolution,
          severity: input.severity ?? incident.severity,
          resolvedById: actor.id,
          resolvedByName: actor.name,
          resolvedAt: at,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'INCIDENCIA_RESUELTA',
          body: `Incidencia ${incident.kind} resuelta por ${actor.name ?? 'PCP'}: ${input.resolution}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    // Si ya no queda ninguna abierta, el cliente vuelve a su estado real.
    const remaining = await this.prisma.arrivalIncident.count({
      where: { arrivalId: row.id, status: 'ABIERTA' },
    });
    if (remaining === 0 && !CLOSED_STATUSES.includes(row.status)) {
      await this.prisma.customerArrival.update({
        where: { id: row.id },
        data: { status: row.arrivedAt ? 'EN_PLANTA' : 'ESPERADO' },
      });
    }

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ARRIVAL_INCIDENT_RESOLVE',
      entityType: 'CustomerArrival',
      entityId: row.id,
      context: { number: row.number, incidentId: incident.id },
    });

    return this.detail(viewer, id);
  }

  // ---------- Bitácora ----------

  async message(viewer: ArrivalViewer, id: string, input: ArrivalMessageInput): Promise<ArrivalDetail> {
    const row = await this.findRow(id);
    const actor = await this.viewerInfo(viewer);

    await this.prisma.arrivalEvent.create({
      data: {
        arrivalId: row.id,
        kind: 'MESSAGE',
        type: 'NOTA',
        body: input.body,
        authorId: actor.id,
        authorCode: actor.code,
        authorName: actor.name,
      },
    });

    return this.detail(viewer, id);
  }

  // ---------- Internos ----------

  private async findRow(id: string) {
    const row = await this.prisma.customerArrival.findUnique({
      where: { id },
      include: {
        incidents: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Llegada no encontrada.');
    return row;
  }

  private async viewerInfo(viewer: ArrivalViewer): Promise<ArrivalActor> {
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

  private groupByCustomer(lines: ArrivalSourceLine[]) {
    const groups = new Map<
      string,
      {
        code: string;
        name: string;
        orderNumbers: string[];
        lineCount: number;
        sacks: number;
        kg: number;
        dates: string[];
      }
    >();

    for (const line of lines) {
      const code = (line.customerCode ?? '').trim();
      const name = (line.customerName ?? '').trim();
      if (!code && !name) continue;
      const key = code || name;
      const group = groups.get(key) ?? {
        code: code || 'SIN-CODIGO',
        name: name || code,
        orderNumbers: [],
        lineCount: 0,
        sacks: 0,
        kg: 0,
        dates: [],
      };
      if (!group.orderNumbers.includes(line.orderNumber)) group.orderNumbers.push(line.orderNumber);
      group.lineCount += 1;
      if (line.uom === 'SAC') group.sacks += toNumber(line.plannedQty);
      group.kg += toNumber(line.plannedKg);
      if (line.effectiveDate) group.dates.push(line.effectiveDate);
      groups.set(key, group);
    }

    return [...groups.values()]
      .map((group) => ({
        code: group.code,
        name: group.name,
        orderNumbers: group.orderNumbers.sort(),
        lineCount: group.lineCount,
        sacks: round2(group.sacks),
        kg: round2(group.kg),
        // La llegada se espera cuando vence su pedido más próximo.
        expectedDate: group.dates.sort()[0] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  // Correlativo LLG-AAAA-NNNN; la colisión la absorbe el reintento del despacho.
  private async nextNumbers(count: number): Promise<string[]> {
    const year = new Date().getFullYear();
    const prefix = `LLG-${year}-`;
    const last = await this.prisma.customerArrival.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const start = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return Array.from({ length: count }, (_, index) => `${prefix}${String(start + index).padStart(4, '0')}`);
  }

  /** Usuarios activos con `llegadas:read` (rol o excepción) + administradores. */
  private async pcpRecipients(): Promise<string[]> {
    const [granted, overrides, admins] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { module: 'llegadas', action: 'read' },
        select: { roleCode: true },
      }),
      this.prisma.userPermission.findMany({
        where: { module: 'llegadas', action: 'read', allowed: true },
        select: { userId: true },
      }),
      this.prisma.user.findMany({ where: { isActive: true, role: 'ADMIN' }, select: { id: true } }),
    ]);

    const roleCodes = granted.map((row) => row.roleCode);
    const directUserIds = overrides.map((row) => row.userId);
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [...(roleCodes.length ? [{ role: { in: roleCodes } }] : []), ...(directUserIds.length ? [{ id: { in: directUserIds } }] : [])],
      },
      select: { id: true },
    });
    return [...new Set([...users.map((user) => user.id), ...admins.map((admin) => admin.id)])];
  }

  /** Avisa al lado despacho (quien publicó y almacén) de un hito del cliente. */
  private async notifyDispatchers(
    row: CustomerArrival,
    input: {
      type: 'LLEGADA_MARCADA' | 'LLEGADA_INCIDENCIA';
      title: string;
      body: string;
      actorId: string;
      actorName: string | null;
    },
  ): Promise<void> {
    const sheet = await this.prisma.dispatchSheet.findUnique({
      where: { id: row.sheetId },
      select: { createdById: true, assignedToId: true, claimedById: true },
    });
    const recipients = [sheet?.assignedToId, sheet?.claimedById, sheet?.createdById].filter(
      (value): value is string => Boolean(value),
    );
    await this.notify(recipients, {
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: 'CustomerArrival',
      entityId: row.id,
      linkPath: `/llegadas/${row.id}`,
      actorId: input.actorId,
      actorName: input.actorName,
    });
  }

  private async notify(
    recipients: string[],
    input: {
      type: 'LLEGADA_ESPERADA' | 'LLEGADA_MARCADA' | 'LLEGADA_INCIDENCIA';
      title: string;
      body?: string | null;
      entityType: string;
      entityId: string;
      linkPath: string;
      actorId: string;
      actorName: string | null;
    },
  ): Promise<void> {
    const unique = [...new Set(recipients)].filter((id) => id && id !== input.actorId);
    if (unique.length === 0) return;
    await this.prisma.$transaction(
      unique.map((recipientId) =>
        this.prisma.notification.create({
          data: {
            recipientId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            entityType: input.entityType,
            entityId: input.entityId,
            linkPath: input.linkPath,
            actorId: input.actorId,
            actorName: input.actorName,
          },
        }),
      ),
    );
  }

  private toSummary(row: ArrivalWithIncidents, viewer: ArrivalViewer): ArrivalSummary {
    const can = (action: string) => viewer.permissions.includes(`llegadas:${action}`);
    const openIncidents = row.incidents.filter((incident) => incident.status === 'ABIERTA').length;
    return {
      id: row.id,
      number: row.number,
      customerCode: row.customerCode,
      customerName: row.customerName,
      expectedDate: row.expectedDate,
      sheetId: row.sheetId,
      sheetNumber: row.sheetNumber,
      sheetTitle: row.sheetTitle,
      status: row.status as ArrivalStatus,
      arrivedAt: iso(row.arrivedAt),
      arrivedById: row.arrivedById,
      arrivedByCode: row.arrivedByCode,
      arrivedByName: row.arrivedByName,
      closedAt: iso(row.closedAt),
      note: row.note,
      orderNumbers: row.orderNumbers ? row.orderNumbers.split(',').filter(Boolean) : [],
      lineCount: row.lineCount,
      plannedSacks: toNumber(row.plannedSacks),
      plannedKg: toNumber(row.plannedKg),
      incidentCount: row.incidents.length,
      openIncidentCount: openIncidents,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedByName,
      canCheckIn: can('create') && !row.arrivedAt && row.status !== 'CANCELADO',
      canClose: can('update') && !CLOSED_STATUSES.includes(row.status),
      canReportIncident: can('create') && row.status !== 'CANCELADO',
      canEdit: can('delete'),
    };
  }

  private toIncident(row: IncidentRow): ArrivalIncident {
    return {
      id: row.id,
      kind: row.kind as ArrivalIncident['kind'],
      severity: row.severity as ArrivalIncident['severity'],
      body: row.body,
      status: row.status as ArrivalIncident['status'],
      resolution: row.resolution,
      reportedById: row.reportedById,
      reportedByName: row.reportedByName,
      resolvedById: row.resolvedById,
      resolvedByName: row.resolvedByName,
      resolvedAt: iso(row.resolvedAt),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toEvent(row: EventRow): ArrivalEvent {
    return {
      id: row.id,
      kind: row.kind === 'MESSAGE' ? 'MESSAGE' : 'SYSTEM',
      type: row.type,
      body: row.body,
      authorId: row.authorId,
      authorCode: row.authorCode,
      authorName: row.authorName,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

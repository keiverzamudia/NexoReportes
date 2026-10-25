import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_MODULES,
  AuditEntry,
  AuditFeedResponse,
  AuditQuery,
  AuditSeverity,
  auditMeta,
  auditModuleLabel,
} from '@nexo/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.module';
import { currentRequestMeta } from '../../common/request-context';

export interface AuditEventInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  context?: Record<string, unknown> | null;
}

// ============================================================
// Bitácora: registro inmutable de «quién cambió qué y desde dónde».
//
// `record()` sigue siendo fire-safe (jamás rompe la operación principal) y
// ahora completa módulo, severidad, IP y dispositivo sin tocar los call sites.
//
// La bandeja (`feed`) combina la auditoría con las notas libres de las
// bitácoras operativas (despacho y llegadas), que no tienen acción propia.
// Se filtra en memoria sobre una ventana acotada: el volumen de una pantalla
// de administración es pequeño y así el comportamiento es idéntico en SQLite
// y PostgreSQL (que difieren en `contains` y en mayúsculas).
// ============================================================

const WINDOW_PER_SOURCE = 2000;
const EXPORT_LIMIT = 5000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAgo(days: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

function parseContext(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function contextNumber(context: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!context) return null;
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function entryLink(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'DispatchSheet') return `/despacho/${entityId}`;
  if (entityType === 'CustomerArrival') return `/llegadas/${entityId}`;
  if (entityType === 'User' || entityType === 'Role' || entityType === 'UserPermission') return '/usuarios';
  return null;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Registrar ----------

  async record(event: AuditEventInput): Promise<void> {
    const meta = auditMeta(event.action);
    const request = currentRequestMeta();
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorId: event.actorId ?? null,
          actorEmail: event.actorEmail ?? null,
          action: event.action,
          module: meta.module,
          severity: meta.severity,
          entityType: event.entityType,
          entityId: event.entityId ?? null,
          context: event.context ? JSON.stringify(event.context) : null,
          ip: request.ip,
          userAgent: request.userAgent ? request.userAgent.slice(0, 300) : null,
        },
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar auditoría para ${event.entityType}:${event.entityId ?? '-'}`, error);
    }
  }

  // ---------- Bandeja ----------

  async feed(query: AuditQuery): Promise<AuditFeedResponse> {
    const entries = await this.collect(query);
    const total = entries.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: entries.slice(start, start + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      stats: await this.stats(),
      facets: this.facets(entries),
    };
  }

  async exportCsv(query: AuditQuery): Promise<string> {
    const entries = (await this.collect({ ...query, page: 1, pageSize: EXPORT_LIMIT })).slice(0, EXPORT_LIMIT);
    const header = ['Fecha', 'Hora', 'Usuario', 'Código', 'Módulo', 'Acción', 'Severidad', 'Entidad', 'Detalle', 'IP', 'Dispositivo'];
    const lines = [header.map(csvCell).join(',')];
    for (const entry of entries) {
      const date = new Date(entry.at);
      lines.push(
        [
          date.toLocaleDateString('es-VE'),
          date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          entry.actorName ?? '—',
          entry.actorCode ?? '—',
          entry.moduleLabel,
          entry.label,
          entry.severity,
          entry.entityType,
          entry.detail ?? entry.title,
          entry.ip ?? '',
          entry.userAgent ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }

  // ---------- Internos ----------

  private where(query: AuditQuery): Prisma.AuditEventWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000`);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999`);
    return {
      ...(query.from || query.to ? { createdAt } : {}),
      ...(query.module ? { module: query.module } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };
  }

  private async collect(query: AuditQuery): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];

    if (query.source !== 'notes') {
      const rows = await this.prisma.auditEvent.findMany({
        where: this.where(query),
        orderBy: { createdAt: 'desc' },
        take: WINDOW_PER_SOURCE,
        include: { actor: { select: { displayName: true, profitCode: true } } },
      });
      entries.push(...rows.map((row) => this.fromAudit(row)));    }

    if (query.source !== 'audit' && (!query.module || query.module === 'dispatch')) {
      const notes = await this.prisma.dispatchSheetEvent.findMany({
        where: {
          kind: 'MESSAGE',
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999`) } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: WINDOW_PER_SOURCE,
        include: { sheet: { select: { id: true, number: true, title: true } } },
      });
      entries.push(
        ...notes.map<AuditEntry>((note) => ({
          id: `dispatch-note:${note.id}`,
          source: 'dispatch-note',
          at: note.createdAt.toISOString(),
          module: 'dispatch',
          moduleLabel: auditModuleLabel('dispatch'),
          action: 'DISPATCH_NOTE',
          label: 'Nota en el despacho',
          severity: 'INFO',
          actorId: note.authorId,
          actorCode: note.authorCode,
          actorName: note.authorName,
          entityType: 'DispatchSheet',
          entityId: note.sheetId,
          title: `Nota en ${note.sheet.number}`,
          detail: note.body,
          linkPath: `/despacho/${note.sheetId}`,
          ip: null,
          userAgent: null,
          context: null,
        })),
      );
    }

    if (query.source !== 'audit' && (!query.module || query.module === 'arrivals')) {
      const notes = await this.prisma.arrivalEvent.findMany({
        where: {
          kind: 'MESSAGE',
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999`) } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: WINDOW_PER_SOURCE,
        include: { arrival: { select: { id: true, number: true, customerName: true } } },
      });
      entries.push(
        ...notes.map<AuditEntry>((note) => ({
          id: `arrival-note:${note.id}`,
          source: 'arrival-note',
          at: note.createdAt.toISOString(),
          module: 'arrivals',
          moduleLabel: auditModuleLabel('arrivals'),
          action: 'ARRIVAL_NOTE',
          label: 'Nota de llegada',
          severity: 'INFO',
          actorId: note.authorId,
          actorCode: note.authorCode,
          actorName: note.authorName,
          entityType: 'CustomerArrival',
          entityId: note.arrivalId,
          title: `Nota de ${note.arrival.customerName}`,
          detail: note.body,
          linkPath: `/llegadas/${note.arrivalId}`,
          ip: null,
          userAgent: null,
          context: null,
        })),
      );
    }

    const filtered = entries
      .filter((entry) => (query.automation === 'show' ? true : !(entry.action === 'SYNC_RUN' && !entry.actorId)))
      .filter((entry) => (query.severity ? entry.severity === query.severity : true))
      .filter((entry) => (query.actorId ? entry.actorId === query.actorId : true))
      .filter((entry) => {
        if (!query.q) return true;
        const haystack = [entry.title, entry.detail, entry.label, entry.action, entry.actorName, entry.actorCode, entry.entityType]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query.q.toLowerCase());
      })
      .sort((a, b) => b.at.localeCompare(a.at));

    return filtered;
  }

  private fromAudit(row: {
    id: string;
    actorId: string | null;
    actorEmail: string | null;
    action: string;
    module: string | null;
    severity: string;
    entityType: string;
    entityId: string | null;
    context: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    actor?: { displayName: string; profitCode: string } | null;
  }): AuditEntry {
    const meta = auditMeta(row.action);
    const moduleKey = row.module ?? meta.module;
    const context = parseContext(row.context);
    const subject = contextNumber(context, 'number', 'customer', 'customerName', 'name', 'code', 'role');
    return {
      id: `audit:${row.id}`,
      source: 'audit',
      at: row.createdAt.toISOString(),
      module: moduleKey,
      moduleLabel: auditModuleLabel(moduleKey),
      action: row.action,
      label: meta.label,
      severity: (row.severity as AuditSeverity) ?? meta.severity,
      actorId: row.actorId,
      actorCode: row.actorEmail ?? row.actor?.profitCode ?? null,
      actorName: row.actor?.displayName ?? null,
      entityType: row.entityType,
      entityId: row.entityId,
      title: subject ? `${meta.label} · ${subject}` : meta.label,
      detail: contextNumber(context, 'reason', 'note', 'body') ?? this.detailFromContext(context),
      linkPath: entryLink(row.entityType, row.entityId),
      ip: row.ip,
      userAgent: row.userAgent,
      context,
    };
  }

  private detailFromContext(context: Record<string, unknown> | null): string | null {
    if (!context) return null;
    const changes = context.changes;
    if (Array.isArray(changes) && changes.length > 0) return changes.join('; ');
    const status = typeof context.status === 'string' ? context.status : null;
    const domain = typeof context.domain === 'string' ? context.domain : null;
    if (domain && status) return `${domain}: ${status}`;
    return null;
  }

  private facets(entries: AuditEntry[]): AuditFeedResponse['facets'] {
    const actors = new Map<string, { id: string; name: string; code: string | null; count: number }>();
    const actions = new Map<string, { action: string; label: string; module: string; count: number }>();
    const modules = new Map<string, number>();

    for (const entry of entries) {
      if (entry.actorId) {
        const current = actors.get(entry.actorId);
        actors.set(entry.actorId, {
          id: entry.actorId,
          name: current?.name ?? entry.actorName ?? entry.actorCode ?? 'Usuario',
          code: current?.code ?? entry.actorCode,
          count: (current?.count ?? 0) + 1,
        });
      }
      const action = actions.get(entry.action);
      actions.set(entry.action, {
        action: entry.action,
        label: action?.label ?? entry.label,
        module: entry.module,
        count: (action?.count ?? 0) + 1,
      });
      modules.set(entry.module, (modules.get(entry.module) ?? 0) + 1);
    }

    return {
      actors: [...actors.values()].sort((a, b) => b.count - a.count).slice(0, 15),
      actions: [...actions.values()].sort((a, b) => b.count - a.count).slice(0, 15),
      modules: AUDIT_MODULES.map((module) => ({
        key: module.key,
        label: module.label,
        count: modules.get(module.key) ?? 0,
      })).filter((module) => module.count > 0),
    };
  }

  private async stats(): Promise<AuditFeedResponse['stats']> {
    const today = startOfDay(new Date());
    const week = daysAgo(7);
    const [todayCount, critical7d, actors, syncErrors] = await Promise.all([
      this.prisma.auditEvent.count({ where: { createdAt: { gte: today } } }),
      this.prisma.auditEvent.count({ where: { severity: 'CRITICAL', createdAt: { gte: week } } }),
      this.prisma.auditEvent.groupBy({
        by: ['actorId'],
        where: { createdAt: { gte: today }, actorId: { not: null } },
      }),
      this.prisma.auditEvent.count({
        where: {
          createdAt: { gte: week },
          OR: [{ action: 'PROFIT_USERS_SYNC_FAILED' }, { context: { contains: '"status":"ERROR"' } }],
        },
      }),
    ]);
    return {
      today: todayCount,
      critical7d,
      actorsToday: actors.length,
      syncErrors7d: syncErrors,
    };
  }
}

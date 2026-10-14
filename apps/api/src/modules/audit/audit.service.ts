import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.module';

export interface AuditEventInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  context?: Record<string, unknown> | null;
}

// Auditoría: registro inmutable desde el punto de vista de la aplicación
// (no existen endpoints de modificación/borrado de eventos).
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Fire-safe: un fallo de auditoría nunca debe romper la operación principal,
  // pero se loguea como error para investigación.
  async record(event: AuditEventInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorId: event.actorId ?? null,
          actorEmail: event.actorEmail ?? null,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId ?? null,
          context: event.context ? JSON.stringify(event.context) : null,
        },
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar auditoría para ${event.entityType}:${event.entityId ?? '-'}`, error);
    }
  }

  async list(query: { page: number; pageSize: number; entityType?: string }) {
    const where = query.entityType ? { entityType: query.entityType } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return {
      items: items.map((event) => ({ ...event, context: event.context ? (JSON.parse(event.context) as unknown) : null })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}

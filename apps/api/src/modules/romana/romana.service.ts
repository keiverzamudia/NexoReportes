import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ROMANA_DOC_KINDS,
  ROMANA_LIMITS,
  ArrivalCloseInput,
  ArrivalEvent,
  ArrivalIncident,
  ArrivalIncidentInput,
  ArrivalIncidentResolveInput,
  ArrivalMessageInput,
  ArrivalStatus,
  RomanaArrivalDetail,
  RomanaArrivalSummary,
  RomanaCheckInInput,
  RomanaDocKind,
  RomanaDocument,
  RomanaListResponse,
  RomanaQuery,
  RomanaStatus,
  RomanaValidateInput,
} from '@nexo/contracts';
import {
  ArrivalEvent as EventRow,
  ArrivalIncident as IncidentRow,
  ArrivalOrderDocument,
  CustomerArrival,
} from '@prisma/client';
import type { ReadStream } from 'node:fs';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { RomanaStorageService } from './romana-storage.service';
import { arrivalDateFilter } from '../arrivals/arrival-date-filter';

// ============================================================
// Romana (báscula).
//
// La llegada es la misma que ve PCP. Romana añade un hito propio: por cada
// pedido exige cédula del chofer y carnet de circulación. Las fotos bloquean
// el marcado; al validar se borran del volumen y solo quedan metadatos.
// ============================================================

export interface RomanaViewer {
  id: string;
  code?: string | null;
  name?: string | null;
  permissions: string[];
}

export interface RomanaActor {
  id: string | null;
  code: string | null;
  name: string | null;
}

type RomanaListRow = CustomerArrival & {
  incidents: Array<Pick<IncidentRow, 'status'>>;
  romanaDocuments: ArrivalOrderDocument[];
};

type RomanaDetailRow = CustomerArrival & {
  incidents: IncidentRow[];
  events: EventRow[];
  romanaDocuments: ArrivalOrderDocument[];
};

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

function splitOrders(csv: string): string[] {
  return csv
    .split(',')
    .map((order) => order.trim())
    .filter(Boolean);
}

@Injectable()
export class RomanaService {
  private readonly logger = new Logger(RomanaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: RomanaStorageService,
  ) {}

  // ---------- Consulta ----------

  async list(viewer: RomanaViewer, query: RomanaQuery): Promise<RomanaListResponse> {
    const rows = await this.prisma.customerArrival.findMany({
      where: arrivalDateFilter(query.date, query.overdue),
      include: {
        incidents: { select: { status: true } },
        romanaDocuments: true,
      },
      orderBy: [{ expectedDate: 'asc' }, { customerName: 'asc' }],
      take: query.limit,
    });

    const term = query.q?.toLowerCase() ?? '';
    const items = rows
      .filter((row) => (query.status ? row.status === query.status : true))
      .filter((row) => {
        if (!term) return true;
        return [row.customerName, row.customerCode, row.sheetNumber, row.orderNumbers, row.number]
          .join(' ')
          .toLowerCase()
          .includes(term);
      })
      .map((row) => this.toSummary(row, viewer))
      .filter((row) => (query.romanaStatus ? row.romana.status === query.romanaStatus : true));

    const counters = {
      expected: items.filter((row) => row.status === 'ESPERADO').length,
      docsPending: items.filter((row) => row.romana.pendingDocs > 0).length,
      ready: items.filter((row) => row.romana.status === 'LISTO').length,
      onSite: items.filter((row) => row.romana.status === 'EN_ROMANA').length,
      validated: items.filter((row) => row.romana.status === 'VALIDADO').length,
      withIncident: items.filter((row) => row.status === 'CON_INCIDENCIA').length,
      missed: items.filter((row) => row.status === 'AUSENTE').length,
      kgExpected: round2(
        items.filter((row) => !CLOSED_STATUSES.includes(row.status)).reduce((sum, row) => sum + row.plannedKg, 0),
      ),
    };

    return { items, total: items.length, counters };
  }

  async detail(viewer: RomanaViewer, id: string): Promise<RomanaArrivalDetail> {
    const row = await this.findRow(id);
    return {
      ...this.toSummary(row, viewer),
      incidents: row.incidents.map((incident) => this.toIncident(incident)),
      events: row.events.map((event) => this.toEvent(event)),
    };
  }

  async stream(
    arrivalId: string,
    documentId: string,
    thumbnail: boolean,
  ): Promise<{ stream: ReadStream; bytes: number; mimeType: string }> {
    const document = await this.prisma.arrivalOrderDocument.findFirst({
      where: { id: documentId, arrivalId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    const key = thumbnail ? document.thumbKey : document.storageKey;
    if (!key) throw new NotFoundException('La foto ya no está disponible.');
    const file = await this.storage.read(key);
    return { ...file, mimeType: document.mimeType ?? 'image/webp' };
  }

  // ---------- Fotos por pedido ----------

  async saveDocument(
    viewer: RomanaViewer,
    id: string,
    orderNumber: string,
    kind: RomanaDocKind,
    buffer: Buffer,
  ): Promise<{ detail: RomanaArrivalDetail; document: RomanaDocument }> {
    const row = await this.findRow(id);
    const order = orderNumber.trim();
    const orders = splitOrders(row.orderNumbers);
    if (!orders.includes(order)) {
      throw new BadRequestException('Ese pedido no pertenece a esta llegada.');
    }
    if (row.status === 'CANCELADO') {
      throw new BadRequestException('La llegada está cancelada: no admite documentos.');
    }
    if (row.romanaValidatedAt) {
      throw new ConflictException('Los documentos ya se validaron y se borraron.');
    }
    if (!ROMANA_DOC_KINDS.includes(kind)) {
      throw new BadRequestException('Tipo de documento inválido.');
    }

    const existing = row.romanaDocuments.find(
      (document) => document.orderNumber === order && document.kind === kind,
    );
    if (!existing && row.romanaDocuments.length >= ROMANA_LIMITS.maxDocsPerArrival) {
      throw new BadRequestException('La llegada supera el máximo de documentos permitido.');
    }

    const actor = await this.viewerInfo(viewer);
    const stored = await this.storage.store({
      arrivalId: row.id,
      orderNumber: order,
      kind,
      buffer,
    });

    let document: ArrivalOrderDocument;
    try {
      document = existing
        ? await this.prisma.arrivalOrderDocument.update({
            where: { id: existing.id },
            data: {
              storageKey: stored.storageKey,
              thumbKey: stored.thumbKey,
              mimeType: stored.mimeType,
              bytes: stored.bytes,
              width: stored.width,
              height: stored.height,
              sha256: stored.sha256,
              uploadedById: actor.id,
              uploadedByName: actor.name,
              purgedAt: null,
              purgedById: null,
              purgedByName: null,
              purgeReason: null,
            },
          })
        : await this.prisma.arrivalOrderDocument.create({
            data: {
              arrivalId: row.id,
              orderNumber: order,
              kind,
              storageKey: stored.storageKey,
              thumbKey: stored.thumbKey,
              mimeType: stored.mimeType,
              bytes: stored.bytes,
              width: stored.width,
              height: stored.height,
              sha256: stored.sha256,
              uploadedById: actor.id,
              uploadedByName: actor.name,
            },
          });
    } catch (error) {
      await this.storage.removeKeys([stored.storageKey, stored.thumbKey]);
      throw error;
    }

    if (existing) {
      await this.storage.removeKeys([existing.storageKey, existing.thumbKey]);
    }

    // Si la llegada había expirado, una foto nueva reinicia el estado: el
    // barrido no debe seguir mostrándola como «expirada».
    if (row.romanaPhotosPurgedAt && !row.romanaValidatedAt) {
      await this.prisma.customerArrival.update({
        where: { id: row.id },
        data: { romanaPhotosPurgedAt: null },
      });
    }

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ROMANA_DOC_UPLOAD',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, orderNumber: order, kind, bytes: stored.bytes },
    });

    return {
      detail: await this.detail(viewer, id),
      document: this.toDocument(document),
    };
  }

  async deleteDocument(
    viewer: RomanaViewer,
    id: string,
    orderNumber: string,
    kind: RomanaDocKind,
  ): Promise<RomanaArrivalDetail> {
    const row = await this.findRow(id);
    if (row.romanaValidatedAt) {
      throw new ConflictException('Los documentos ya se validaron y se borraron.');
    }
    const order = orderNumber.trim();
    const document = row.romanaDocuments.find(
      (item) => item.orderNumber === order && item.kind === kind,
    );
    if (!document) throw new NotFoundException('Ese documento no existe.');

    const failed = await this.storage.removeKeys([document.storageKey, document.thumbKey]);
    if (failed.length > 0) {
      throw new ConflictException('No se pudo borrar la foto del disco. Intenta de nuevo.');
    }
    await this.prisma.arrivalOrderDocument.delete({ where: { id: document.id } });

    const actor = await this.viewerInfo(viewer);
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ROMANA_DOC_DELETE',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, orderNumber: order, kind },
    });

    return this.detail(viewer, id);
  }

  // ---------- Operación en planta ----------

  async checkIn(viewer: RomanaViewer, id: string, input: RomanaCheckInInput): Promise<RomanaArrivalDetail> {
    const row = await this.findRow(id);
    if (row.status === 'CANCELADO') {
      throw new BadRequestException('Ese despacho se anuló: la llegada ya no aplica.');
    }
    if (row.romanaArrivedAt) {
      throw new ConflictException(
        `La llegada a Romana ya estaba marcada a las ${clock(row.romanaArrivedAt)}${
          row.romanaArrivedByName ? ` por ${row.romanaArrivedByName}` : ''
        }.`,
      );
    }
    if (CLOSED_STATUSES.includes(row.status)) {
      throw new BadRequestException('La llegada ya está cerrada; no se puede marcar de nuevo.');
    }

    const missing = this.missingDocuments(row);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Faltan fotos: ${missing.join(', ')}. Sube la cédula y el carnet de cada pedido.`,
      );
    }

    const actor = await this.viewerInfo(viewer);
    const at = new Date();

    await this.prisma.$transaction([
      this.prisma.customerArrival.update({
        where: { id: row.id },
        data: {
          romanaArrivedAt: at,
          romanaArrivedById: actor.id,
          romanaArrivedByName: actor.name,
          // La llegada física la marca PCP. Si aún no lo hizo, Romana la sella:
          // el camión ya está en planta y la espera no puede seguir viva.
          ...(row.arrivedAt
            ? {}
            : {
                arrivedAt: at,
                arrivedById: actor.id,
                arrivedByCode: actor.code,
                arrivedByName: actor.name,
                status: 'EN_PLANTA',
              }),
          note: input.note ?? row.note,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'ROMANA_LLEGADA',
          body: `Llegada a Romana marcada a las ${clock(at)} por ${actor.name ?? actor.code ?? 'Romana'}.${
            input.note ? ` ${input.note}` : ''
          }`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ROMANA_CHECK_IN',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, customer: row.customerName, at: at.toISOString() },
    });

    await this.notifyDispatchers(row, {
      title: `Llegó ${row.customerName} a Romana`,
      body: `${row.number} · ${row.sheetNumber} · marcada a las ${clock(at)}${
        input.note ? ` · ${input.note}` : ''
      }`,
      actorId: actor.id,
      actorName: actor.name,
    });

    return this.detail(viewer, id);
  }

  async validate(viewer: RomanaViewer, id: string, input: RomanaValidateInput): Promise<RomanaArrivalDetail> {
    const row = await this.findRow(id);
    if (row.status === 'CANCELADO') {
      throw new BadRequestException('Una llegada cancelada no se puede validar.');
    }
    if (!row.romanaArrivedAt) {
      throw new BadRequestException('Primero marca la llegada en Romana.');
    }
    if (row.romanaValidatedAt) return this.detail(viewer, id);

    const liveDocs = row.romanaDocuments.filter((document) => document.storageKey);
    if (liveDocs.length === 0) {
      throw new ConflictException(
        'Las fotos ya no están disponibles (se borraron por antigüedad). No hay nada que validar.',
      );
    }

    const actor = await this.viewerInfo(viewer);
    const at = new Date();
    const bytes = liveDocs.reduce((sum, document) => sum + document.bytes, 0);

    await this.prisma.$transaction([
      this.prisma.customerArrival.update({
        where: { id: row.id },
        data: {
          romanaValidatedAt: at,
          romanaValidatedById: actor.id,
          romanaValidatedByName: actor.name,
          note: input.note ?? row.note,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      }),
      this.prisma.arrivalEvent.create({
        data: {
          arrivalId: row.id,
          kind: 'SYSTEM',
          type: 'ROMANA_VALIDADA',
          body: `Documentos validados por ${actor.name ?? actor.code ?? 'Romana'} a las ${clock(at)} · ${
            liveDocs.length
          } foto(s) · ${round2(bytes / 1024)} KB.${input.note ? ` ${input.note}` : ''}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ROMANA_VALIDATE',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, documents: liveDocs.length, bytes },
    });

    await this.purgeFiles(row.id, 'VALIDACION', actor, {
      type: 'ROMANA_FOTOS_ELIMINADAS',
      body: `Fotos eliminadas al validar: ${liveDocs.length} archivo(s), ${round2(bytes / 1024)} KB liberados.`,
    });

    return this.detail(viewer, id);
  }

  async close(viewer: RomanaViewer, id: string, input: ArrivalCloseInput): Promise<RomanaArrivalDetail> {
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
              ? `Atención cerrada por ${actor.name ?? 'Romana'} a las ${clock(at)}.`
              : `Se marcó como no presentado por ${actor.name ?? 'Romana'} a las ${clock(at)}.`) +
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
      action: 'ROMANA_CLOSE',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, status: input.status },
    });

    return this.detail(viewer, id);
  }

  // ---------- Incidencias y bitácora ----------

  async addIncident(
    viewer: RomanaViewer,
    id: string,
    input: ArrivalIncidentInput,
  ): Promise<RomanaArrivalDetail> {
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
          body: `Incidencia ${input.kind} (${input.severity}) reportada por ${actor.name ?? 'Romana'}: ${input.body}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.code,
      action: 'ROMANA_INCIDENT',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, kind: input.kind, severity: input.severity },
    });

    return this.detail(viewer, id);
  }

  async resolveIncident(
    viewer: RomanaViewer,
    id: string,
    incidentId: string,
    input: ArrivalIncidentResolveInput,
  ): Promise<RomanaArrivalDetail> {
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
          body: `Incidencia ${incident.kind} resuelta por ${actor.name ?? 'Romana'}: ${input.resolution}`,
          authorId: actor.id,
          authorCode: actor.code,
          authorName: actor.name,
        },
      }),
    ]);

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
      action: 'ROMANA_INCIDENT_RESOLVE',
      entityType: 'RomanaArrival',
      entityId: row.id,
      context: { number: row.number, incidentId: incident.id },
    });

    return this.detail(viewer, id);
  }

  async message(viewer: RomanaViewer, id: string, input: ArrivalMessageInput): Promise<RomanaArrivalDetail> {
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

  // ---------- Barrido ----------

  async cleanup(options: { retentionHours?: number; dryRun?: boolean } = {}): Promise<{
    purged: number;
    expired: number;
    orphans: number;
    errors: number;
  }> {
    const retentionHours = options.retentionHours ?? ROMANA_LIMITS.retentionHours;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    const dryRun = options.dryRun === true;

    const documents = await this.prisma.arrivalOrderDocument.findMany({
      where: { storageKey: { not: null } },
      include: {
        arrival: {
          select: { id: true, status: true, romanaValidatedAt: true, createdAt: true },
        },
      },
    });

    const byArrival = new Map<string, typeof documents>();
    for (const document of documents) {
      const group = byArrival.get(document.arrival.id) ?? [];
      group.push(document);
      byArrival.set(document.arrival.id, group);
    }

    let purged = 0;
    let expired = 0;
    let errors = 0;
    for (const [arrivalId, group] of byArrival) {
      const arrival = group[0]!.arrival;
      const reason: 'VALIDACION' | 'EXPIRACION' | 'CANCELACION' | null = arrival.romanaValidatedAt
        ? 'VALIDACION'
        : arrival.status === 'CANCELADO'
          ? 'CANCELACION'
          : // La retención corre desde la subida de la foto, no desde que nació
            // la llegada: una foto re-subida vuelve a tener su ventana completa.
            group.every((document) => document.createdAt < cutoff)
            ? 'EXPIRACION'
            : null;
      if (!reason) continue;

      if (dryRun) {
        purged += group.length;
        if (reason === 'EXPIRACION') expired += 1;
        continue;
      }
      try {
        const result = await this.purgeFiles(arrivalId, reason, null, {
          type:
            reason === 'VALIDACION'
              ? 'ROMANA_FOTOS_ELIMINADAS'
              : reason === 'CANCELACION'
                ? 'ROMANA_FOTOS_CANCELADAS'
                : 'ROMANA_FOTOS_EXPIRADAS',
          body:
            reason === 'VALIDACION'
              ? 'Barrido: se completó el borrado de fotos de una llegada validada.'
              : reason === 'CANCELACION'
                ? 'Barrido: se borraron las fotos de una llegada cancelada.'
                : `Barrido: fotos eliminadas por antigüedad (${retentionHours} h).`,
        });
        purged += result.purged;
        if (reason === 'EXPIRACION') expired += 1;
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `Barrido de Romana: no se pudo purgar la llegada ${arrivalId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    let orphans = 0;
    const folders = await this.storage.listArrivalFolders();
    for (const folder of folders) {
      const live = await this.prisma.arrivalOrderDocument.count({
        where: { arrivalId: folder.arrivalId, storageKey: { not: null } },
      });
      if (live > 0) continue;
      const arrival = await this.prisma.customerArrival.findUnique({
        where: { id: folder.arrivalId },
        select: { id: true },
      });
      const oldEnough = !arrival || folder.modifiedAt < cutoff;
      if (!oldEnough) continue;
      if (dryRun) {
        orphans += 1;
        continue;
      }
      try {
        await this.storage.removeFolder(folder.dir);
        orphans += 1;
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `Barrido de Romana: no se pudo borrar la carpeta ${folder.dir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (purged > 0 || orphans > 0 || errors > 0) {
      this.logger.log(
        `Romana: ${purged} foto(s) purgada(s), ${expired} llegada(s) expirada(s), ${orphans} carpeta(s) huérfana(s), ${errors} error(es)${
          dryRun ? ' (dry-run)' : ''
        }.`,
      );
    }

    return { purged, expired, orphans, errors };
  }

  // ---------- Internos ----------

  private async findRow(id: string): Promise<RomanaDetailRow> {
    const row = await this.prisma.customerArrival.findUnique({
      where: { id },
      include: {
        incidents: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'asc' } },
        romanaDocuments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Llegada de Romana no encontrada.');
    return row;
  }

  private async viewerInfo(viewer: RomanaViewer): Promise<RomanaActor> {
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

  private missingDocuments(row: RomanaDetailRow): string[] {
    const missing: string[] = [];
    for (const order of splitOrders(row.orderNumbers)) {
      for (const kind of ROMANA_DOC_KINDS) {
        const document = row.romanaDocuments.find(
          (item) => item.orderNumber === order && item.kind === kind && item.storageKey,
        );
        if (!document) {
          missing.push(`${order} · ${kind === 'CEDULA' ? 'cédula' : 'carnet'}`);
        }
      }
    }
    return missing;
  }

  private async purgeFiles(
    arrivalId: string,
    reason: 'VALIDACION' | 'EXPIRACION' | 'CANCELACION',
    actor: RomanaActor | null,
    event: { type: string; body: string } | null,
  ): Promise<{ purged: number; bytes: number }> {
    const documents = await this.prisma.arrivalOrderDocument.findMany({
      where: { arrivalId, storageKey: { not: null } },
    });
    if (documents.length === 0) {
      await this.markPhotosPurged(arrivalId);
      return { purged: 0, bytes: 0 };
    }

    const failed = await this.storage.removeKeys(
      documents.flatMap((document) => [document.storageKey, document.thumbKey]),
    );
    const failedSet = new Set(failed);
    const removed = documents.filter(
      (document) =>
        !failedSet.has(document.storageKey ?? '') && !failedSet.has(document.thumbKey ?? ''),
    );
    if (removed.length > 0) {
      await this.prisma.arrivalOrderDocument.updateMany({
        where: { id: { in: removed.map((document) => document.id) } },
        data: {
          storageKey: null,
          thumbKey: null,
          mimeType: null,
          purgedAt: new Date(),
          purgedById: actor?.id ?? null,
          purgedByName: actor?.name ?? null,
          purgeReason: reason,
        },
      });
    }

    const remaining = await this.prisma.arrivalOrderDocument.count({
      where: { arrivalId, storageKey: { not: null } },
    });
    if (remaining === 0) await this.markPhotosPurged(arrivalId);

    if (removed.length > 0 && event) {
      await this.prisma.arrivalEvent
        .create({
          data: {
            arrivalId,
            kind: 'SYSTEM',
            type: event.type,
            body: event.body,
            authorId: actor?.id ?? null,
            authorCode: actor?.code ?? null,
            authorName: actor?.name ?? null,
          },
        })
        .catch(() => undefined);
    }

    if (removed.length > 0) {
      await this.audit
        .record({
          actorId: actor?.id ?? null,
          actorEmail: actor?.code ?? 'SYSTEM',
          action: 'ROMANA_PHOTO_PURGE',
          entityType: 'RomanaArrival',
          entityId: arrivalId,
          context: { reason, documents: removed.length },
        })
        .catch(() => undefined);
    }

    return {
      purged: removed.length,
      bytes: removed.reduce((sum, document) => sum + document.bytes, 0),
    };
  }

  private async markPhotosPurged(arrivalId: string): Promise<void> {
    await this.prisma.customerArrival.update({
      where: { id: arrivalId },
      data: { romanaPhotosPurgedAt: new Date() },
    });
  }

  private async notifyDispatchers(
    row: CustomerArrival,
    input: { title: string; body: string; actorId: string | null; actorName: string | null },
  ): Promise<void> {
    try {
      const sheet = await this.prisma.dispatchSheet.findUnique({
        where: { id: row.sheetId },
        select: { createdById: true, assignedToId: true, claimedById: true },
      });
      const recipients = [sheet?.assignedToId, sheet?.claimedById, sheet?.createdById].filter(
        (value): value is string => Boolean(value),
      );
      const unique = [...new Set(recipients)].filter((id) => id !== input.actorId);
      if (unique.length === 0) return;
      await this.prisma.$transaction(
        unique.map((recipientId) =>
          this.prisma.notification.create({
            data: {
              recipientId,
              type: 'LLEGADA_MARCADA',
              title: input.title,
              body: input.body,
              entityType: 'RomanaArrival',
              entityId: row.id,
              linkPath: `/pcp/${row.id}`,
              actorId: input.actorId,
              actorName: input.actorName,
            },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar la llegada a Romana: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toSummary(row: RomanaListRow | RomanaDetailRow, viewer: RomanaViewer): RomanaArrivalSummary {
    const can = (action: string) => viewer.permissions.includes(`pcp:${action}`);
    const orders = splitOrders(row.orderNumbers);
    const documents = row.romanaDocuments;
    const liveDocs = documents.filter((document) => document.storageKey);
    // Las llegadas anteriores a Romana no exigen documentos: se pueden marcar
    // igual y, si alguien sube fotos, se validan y borran como las nuevas.
    const required = row.romanaRequired;
    const requiredDocs = required ? orders.length * 2 : 0;
    const validated = Boolean(row.romanaValidatedAt);
    const uploadedDocs = validated || row.romanaPhotosPurgedAt ? documents.length : liveDocs.length;
    const openIncidents = row.incidents.filter((incident) => incident.status === 'ABIERTA').length;

    const orderDocuments = orders.map((orderNumber) => {
      const orderDocs = documents
        .filter((document) => document.orderNumber === orderNumber)
        .map((document) => this.toDocument(document));
      return {
        orderNumber,
        documents: orderDocs,
        complete: ROMANA_DOC_KINDS.every((kind) =>
          documents.some(
            (document) =>
              document.orderNumber === orderNumber && document.kind === kind && document.storageKey,
          ),
        ),
      };
    });

    const complete = !required || orderDocuments.every((order) => order.complete);
    const status = this.statusOf(row, complete);

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
      orderNumbers: orders,
      lineCount: row.lineCount,
      plannedSacks: toNumber(row.plannedSacks),
      plannedKg: toNumber(row.plannedKg),
      incidentCount: row.incidents.length,
      openIncidentCount: openIncidents,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedByName,
      // Marca de PCP: es la hora física en portería y no exige fotos.
      canCheckIn: can('create') && !row.arrivedAt && row.status !== 'CANCELADO',
      canClose: can('update') && !CLOSED_STATUSES.includes(row.status),
      canReportIncident: can('upload') && row.status !== 'CANCELADO',
      canEdit: can('delete'),
      romana: {
        status,
        requiredDocs,
        uploadedDocs,
        pendingDocs: Math.max(0, requiredDocs - uploadedDocs),
        totalBytes: documents.reduce((sum, document) => sum + document.bytes, 0),
        arrivedAt: iso(row.romanaArrivedAt),
        arrivedByName: row.romanaArrivedByName,
        validatedAt: iso(row.romanaValidatedAt),
        validatedByName: row.romanaValidatedByName,
        photosPurgedAt: iso(row.romanaPhotosPurgedAt),
        orders: orderDocuments,
        canCheckIn:
          can('upload') &&
          !row.romanaArrivedAt &&
          !validated &&
          row.status !== 'CANCELADO' &&
          !CLOSED_STATUSES.includes(row.status) &&
          complete,
        canValidate:
          can('validate') && Boolean(row.romanaArrivedAt) && !validated && liveDocs.length > 0,
        canUploadDocs: can('upload') && !validated && row.status !== 'CANCELADO',
      },
    };
  }

  private statusOf(row: RomanaListRow | RomanaDetailRow, complete: boolean): RomanaStatus {
    if (row.status === 'CANCELADO') return 'CANCELADO';
    if (row.romanaValidatedAt) return 'VALIDADO';
    if (row.romanaPhotosPurgedAt) return 'EXPIRADO';
    if (row.romanaArrivedAt) return 'EN_ROMANA';
    return complete ? 'LISTO' : 'PENDIENTE';
  }

  private toDocument(row: ArrivalOrderDocument): RomanaDocument {
    const base = `/api/romana/arrivals/${row.arrivalId}/documents/${row.id}`;
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      kind: row.kind as RomanaDocKind,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      uploadedByName: row.uploadedByName,
      createdAt: row.createdAt.toISOString(),
      purgedAt: iso(row.purgedAt),
      purgeReason: row.purgeReason,
      url: row.storageKey ? base : null,
      thumbUrl: row.thumbKey ? `${base}?variant=thumb` : null,
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

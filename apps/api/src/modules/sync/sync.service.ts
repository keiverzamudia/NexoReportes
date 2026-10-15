import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SYNC_DOMAINS, SyncDomain, SyncRun, SyncStatusResponse } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { RawSolicitudLine, normalizeSolicitudRow } from './normalizers';
import { ProfitAdapter, PROFIT_ADAPTER } from './profit.adapter';

// Única vista de origen (PROFIT_VIEW_SOLICITUDES). Cada dominio de sync se
// DERIVA de las filas de esta vista; no existe una vista por dominio.
type ProfitViewsConfig = { solicitudes?: string };

// La vista expone las existencias en columnas fijas por almacén.
// Códigos derivados de los nombres reales de columna (Stock_03 → Stock 03).
const STOCK_COLUMNS = [
  { column: 'stock03', code: 'Stock 03' },
  { column: 'stock68', code: 'Stock 68' },
] as const;

type StockColumn = (typeof STOCK_COLUMNS)[number]['column'];

function warehouseCodeFor(column: StockColumn): string {
  return STOCK_COLUMNS.find((c) => c.column === column)?.code ?? column;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(PROFIT_ADAPTER) private readonly profit: ProfitAdapter,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async status(): Promise<SyncStatusResponse> {
    const lastRun = await this.prisma.syncRun.findFirst({
      where: { status: 'EXITOSA' },
      orderBy: { finishedAt: 'desc' },
    });

    const successfulDomains = new Set(
      (await this.prisma.syncRun.findMany({ where: { status: 'EXITOSA' }, select: { domain: true } })).map((r) => r.domain),
    );
    const pendingDomains = SYNC_DOMAINS.filter((domain) => !successfulDomains.has(domain));

    let connected = false;
    let message: string | null = null;
    if (this.profit.dialect === 'fixtures') {
      message = 'Modo fixtures: los datos mostrados en desarrollo no provienen de Profit.';
    }
    try {
      const test = await this.profit.testConnection();
      connected = test.connected;
      message = test.message ?? message;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Error desconocido';
    }

    return {
      dialect: this.profit.dialect,
      connected,
      lastSuccessfulRun: lastRun ? this.toSyncRun(lastRun) : null,
      pendingDomains,
      message,
    };
  }

  async views(): Promise<{ views: string[]; dialect: 'mssql' | 'fixtures' }> {
    const views = await this.profit.listViews();
    return { views, dialect: this.profit.dialect };
  }

  // Columnas reales de la vista configurada (INFORMATION_SCHEMA en mssql).
  async describe() {
    const view = this.resolveView();
    const columns = await this.profit.describeView(view);
    return { view, dialect: this.profit.dialect, columns };
  }

  async testConnection() {
    const result = await this.profit.testConnection();
    await this.audit.record({
      action: 'SYNC_TEST_CONNECTION',
      entityType: 'SyncRun',
      context: { dialect: this.profit.dialect, connected: result.connected },
    });
    return { ...result, dialect: this.profit.dialect };
  }

  async listRuns(page: number, pageSize: number) {
    const where = {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.syncRun.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startedAt: 'desc' },
        include: { _count: { select: { errors: true } } },
      }),
      this.prisma.syncRun.count({ where }),
    ]);
    return { items: items.map((run) => ({ ...this.toSyncRun(run), errorsCount: run.errorsCount || run._count.errors })), page, pageSize, total };
  }

  // ============================================================
  // Ejecución de sincronización (idempotente)
  // Todas las corridas leen la MISMA vista aplanada y derivan el
  // dominio solicitado. Cada fila = un renglón de solicitud.
  // ============================================================
  async run(domain: SyncDomain, actor?: { id?: string; email?: string }): Promise<SyncRun> {
    const view = this.resolveView();

    const run = await this.prisma.syncRun.create({
      data: { domain, status: 'EN_CURSO', sourceRef: view },
    });

    let recordsRead = 0;
    let recordsUpserted = 0;
    let errorsCount = 0;

    try {
      const pageSize = this.config.get<number>('sync.pageSize') ?? 5000;
      const rawRows = await this.profit.select(view, {}, pageSize);
      recordsRead = rawRows.length;

      // Normalización primero: las filas inválidas se registran como error
      // y NO alimentan ningún dominio (no se inventa datos para enmascararlos).
      const lines: RawSolicitudLine[] = [];
      for (const raw of rawRows) {
        const parsed = normalizeSolicitudRow(raw);
        if (!parsed.ok || !parsed.value) {
          errorsCount += 1;
          await this.prisma.syncError.create({
            data: {
              runId: run.id,
              entity: domain,
              externalId: this.rawExternalId(raw),
              message: parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; ') || 'Fila inválida',
              raw: JSON.stringify(raw).slice(0, 4000),
            },
          });
          continue;
        }
        lines.push(parsed.value);
      }

      // Fotografía coherente de inventario por corrida (no por fila).
      const snapshotId =
        domain === 'EXISTENCIAS' && lines.length > 0
          ? (await this.prisma.inventorySnapshot.create({ data: { source: this.profit.dialect, takenAt: new Date(), runId: run.id } })).id
          : null;

      const seen = new Set<string>();
      try {
        recordsUpserted = await this.applyDomain(domain, lines, seen, snapshotId, run.id);
      } catch (error) {
        errorsCount += 1;
        await this.prisma.syncError.create({
          data: {
            runId: run.id,
            entity: domain,
            externalId: null,
            message: error instanceof Error ? error.message : 'Error desconocido',
            raw: null,
          },
        });
      }

      // Bajas lógicas: lo que no apareció en esta corrida se marca como inactivo
      // (nunca se borra histórico). Solo si la lectura devolvió filas.
      const missingMarked = recordsRead > 0 && errorsCount === 0 ? await this.markMissing(domain, seen) : 0;

      const status = errorsCount === 0 ? 'EXITOSA' : recordsUpserted > 0 ? 'PARCIAL' : 'ERROR';
      const finished = await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status, finishedAt: new Date(), recordsRead, recordsUpserted, errorsCount },
      });

      await this.audit.record({
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: 'SYNC_RUN',
        entityType: 'SyncRun',
        entityId: run.id,
        context: { domain, status, recordsRead, recordsUpserted, errorsCount, missingMarked, dialect: this.profit.dialect, view },
      });

      this.logger.log(`Sync ${domain}: ${status} (leídas=${recordsRead}, upsert=${recordsUpserted}, errores=${errorsCount}, bajas=${missingMarked})`);
      return this.toSyncRun(finished);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      const failed = await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'ERROR', finishedAt: new Date(), recordsRead, recordsUpserted, errorsCount: errorsCount + 1, errorDetail: message },
      });
      this.logger.error(`Sync ${domain} falló: ${message}`);
      return this.toSyncRun(failed);
    }
  }

  private resolveView(): string {
    const views = (this.config.get<ProfitViewsConfig>('profit.views') ?? {}) as ProfitViewsConfig;
    const configured = views.solicitudes?.trim();
    if (configured) {
      return configured;
    }
    if (this.profit.dialect === 'fixtures') {
      return 'fixtures.Solicitudes_Pendientes_Clientes';
    }
    throw new NotFoundException('Vista de Profit no configurada (variable PROFIT_VIEW_SOLICITUDES)');
  }

  private rawExternalId(raw: Record<string, unknown>): string | null {
    const nro = raw['nro_solicitud'];
    const art = raw['co_art'];
    if (nro === undefined && art === undefined) return null;
    return `${nro ?? '?'}#${String(art ?? '?').trim()}`;
  }

  // ============================================================
  // Derivación por dominio desde las líneas normalizadas
  // ============================================================
  private async applyDomain(
    domain: SyncDomain,
    lines: RawSolicitudLine[],
    seen: Set<string>,
    snapshotId: string | null,
    runId: string,
  ): Promise<number> {
    switch (domain) {
      case 'ALMACENES':
        return this.syncWarehouses(lines, seen);
      case 'PRODUCTOS':
        return this.syncProducts(lines, seen);
      case 'CLIENTES':
        return this.syncCustomers(lines, seen);
      case 'PEDIDOS':
        return this.syncOrders(lines, seen);
      case 'PEDIDOS_DETALLE':
        return this.syncOrderLines(lines, seen, runId);
      case 'EXISTENCIAS':
        return this.syncInventory(lines, seen, snapshotId, runId);
      default:
        return 0;
    }
  }

  // Los almacenes se derivan de las columnas de existencia de la vista.
  // Aunque una columna venga toda en NULL, el almacén existe (columna real).
  private async syncWarehouses(_lines: RawSolicitudLine[], seen: Set<string>): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const { code } of STOCK_COLUMNS) {
      seen.add(code);
      await this.prisma.warehouse.upsert({
        where: { externalCode: code },
        update: { name: code, isActive: true, removedAt: null, lastSyncedAt: now },
        create: { externalCode: code, name: code, lastSyncedAt: now },
      });
      count += 1;
    }
    return count;
  }

  // Catálogo derivado: un producto por co_art distinto.
  private async syncProducts(lines: RawSolicitudLine[], seen: Set<string>): Promise<number> {
    const now = new Date();
    const byCode = new Map<string, RawSolicitudLine>();
    for (const line of lines) {
      if (!byCode.has(line.coArt)) byCode.set(line.coArt, line);
    }
    let count = 0;
    for (const [code, line] of byCode) {
      seen.add(code);
      await this.prisma.product.upsert({
        where: { externalCode: code },
        // family no viene en la vista: NO se sobreescribe si ya existía.
        // kgPerUom (relacion_empaque) sólo se actualiza si la vista lo trae
        // (columna anulable: no se borra un dato conocido con null).
        update: {
          description: line.artDes,
          uom: line.uniVenta,
          ...(line.relacionEmpaque !== null ? { kgPerUom: line.relacionEmpaque } : {}),
          isActive: true,
          removedAt: null,
          lastSyncedAt: now,
        },
        create: {
          externalCode: code,
          description: line.artDes,
          uom: line.uniVenta,
          kgPerUom: line.relacionEmpaque,
          lastSyncedAt: now,
        },
      });
      count += 1;
    }
    return count;
  }

  // Clientes derivados: un cliente por co_cli distinto.
  // La vista NO trae tipo de cliente ni vendedor: quedan null (documentado
  // en PROFIT_SQL_MAPPING.md); no se rellenan con valores inventados.
  private async syncCustomers(lines: RawSolicitudLine[], seen: Set<string>): Promise<number> {
    const now = new Date();
    const byCode = new Map<string, RawSolicitudLine>();
    for (const line of lines) {
      if (!byCode.has(line.coCli)) byCode.set(line.coCli, line);
    }
    let count = 0;
    for (const [code, line] of byCode) {
      seen.add(code);
      await this.prisma.customer.upsert({
        where: { externalCode: code },
        update: { name: line.cliDes, isActive: true, removedAt: null, lastSyncedAt: now },
        create: { externalCode: code, name: line.cliDes, lastSyncedAt: now },
      });
      count += 1;
    }
    return count;
  }

  // Un encabezado por nro_solicitud distinto.
  // Supuesto documentado: la vista sólo contiene solicitudes PENDIENTES,
  // por eso el estado se deriva como ABIERTO (la vista no trae columna de estado).
  private async syncOrders(lines: RawSolicitudLine[], seen: Set<string>): Promise<number> {
    const now = new Date();
    const byNumber = new Map<number, RawSolicitudLine>();
    for (const line of lines) {
      if (!byNumber.has(line.nroSolicitud)) byNumber.set(line.nroSolicitud, line);
    }
    let count = 0;
    for (const [number, line] of byNumber) {
      const externalNumber = String(number);
      seen.add(externalNumber);
      const customer = await this.prisma.customer.findUnique({ where: { externalCode: line.coCli } });
      await this.prisma.salesOrder.upsert({
        where: { externalNumber },
        update: {
          customerId: customer?.id ?? null,
          customerCode: line.coCli,
          customerName: line.cliDes,
          orderDate: line.emision,
          requestedDate: line.entrega,
          status: 'ABIERTO',
          statusRaw: null,
          isActive: true,
          removedAt: null,
          lastSyncedAt: now,
        },
        create: {
          externalNumber,
          customerId: customer?.id ?? null,
          customerCode: line.coCli,
          customerName: line.cliDes,
          orderDate: line.emision,
          requestedDate: line.entrega,
          status: 'ABIERTO',
          statusRaw: null,
          lastSyncedAt: now,
        },
      });
      count += 1;
    }
    return count;
  }

  // Un renglón por fila de la vista. La vista no trae número de línea:
  // se numera de forma DETERMINISTA (orden alfabético de co_art dentro de
  // cada solicitud) para que dos corridas produzcan las mismas claves.
  // Requiere PEDIDOS previo (mismo contrato de dependencia que antes).
  private async syncOrderLines(lines: RawSolicitudLine[], seen: Set<string>, runId: string): Promise<number> {
    const byOrder = new Map<number, RawSolicitudLine[]>();
    for (const line of lines) {
      const bucket = byOrder.get(line.nroSolicitud);
      if (bucket) bucket.push(line);
      else byOrder.set(line.nroSolicitud, [line]);
    }

    let count = 0;
    for (const [number, orderLines] of byOrder) {
      const order = await this.prisma.salesOrder.findUnique({ where: { externalNumber: String(number) } });
      if (!order) {
        throw new Error(`Solicitud ${number} no existe; sincronice PEDIDOS antes que PEDIDOS_DETALLE`);
      }
      const sorted = [...orderLines].sort((a, b) => a.coArt.localeCompare(b.coArt));
      seen.add(String(number));
      let lineNumber = 0;
      for (const line of sorted) {
        lineNumber += 1;
        const product = await this.prisma.product.findUnique({ where: { externalCode: line.coArt } });
        await this.prisma.salesOrderLine.upsert({
          where: { orderId_lineNumber: { orderId: order.id, lineNumber } },
          update: {
            productCode: line.coArt,
            productId: product?.id ?? null,
            description: line.artDes,
            uom: line.uniVenta,
            pendingQty: line.pendiente,
            // Valor crudo de la vista (`kg` = pendiente × relacion_empaque);
            // no se recalcula para no divergir de Profit.
            pendingKg: line.kg,
          },
          create: {
            orderId: order.id,
            lineNumber,
            productCode: line.coArt,
            productId: product?.id ?? null,
            description: line.artDes,
            uom: line.uniVenta,
            pendingQty: line.pendiente,
            pendingKg: line.kg,
          },
        });
        count += 1;
      }
      // Baja de renglones que ya no están en la vista (la vista es la verdad).
      await this.prisma.salesOrderLine.deleteMany({ where: { orderId: order.id, lineNumber: { gt: lineNumber } } });
    }
    void runId;
    return count;
  }

  // Fotografía: una línea por (artículo, almacén) con columna no nula.
  // NULL = la vista no informa esa existencia → NO se crea línea (no se inventa 0).
  private async syncInventory(
    lines: RawSolicitudLine[],
    seen: Set<string>,
    snapshotId: string | null,
    runId: string,
  ): Promise<number> {
    if (!snapshotId) {
      throw new Error('Fotografía de inventario no creada para esta corrida');
    }
    const byArticle = new Map<string, RawSolicitudLine>();
    for (const line of lines) {
      if (!byArticle.has(line.coArt)) byArticle.set(line.coArt, line);
    }

    let count = 0;
    for (const [code, line] of byArticle) {
      const product = await this.prisma.product.findUnique({ where: { externalCode: code } });
      for (const { column, code: warehouseCode } of STOCK_COLUMNS) {
        const qty = line[column];
        if (qty === null) continue; // columna anulable sin dato: no se rellena
        seen.add(`${code}@${warehouseCode}`);
        const warehouse = await this.prisma.warehouse.findUnique({ where: { externalCode: warehouseCode } });
        await this.prisma.inventorySnapshotLine.create({
          data: {
            snapshotId,
            productCode: code,
            productId: product?.id ?? null,
            warehouseCode,
            warehouseId: warehouse?.id ?? null,
            qty,
            reservedQty: 0, // la vista no expone reservas (documentado)
          },
        });
        count += 1;
      }
    }
    void runId;
    return count;
  }

  private async markMissing(domain: SyncDomain, seen: Set<string>): Promise<number> {
    if (seen.size === 0) return 0;
    const now = new Date();
    switch (domain) {
      case 'PRODUCTOS': {
        const result = await this.prisma.product.updateMany({
          where: { externalCode: { notIn: [...seen] }, isActive: true },
          data: { isActive: false, removedAt: now },
        });
        return result.count;
      }
      case 'CLIENTES': {
        const result = await this.prisma.customer.updateMany({
          where: { externalCode: { notIn: [...seen] }, isActive: true },
          data: { isActive: false, removedAt: now },
        });
        return result.count;
      }
      case 'ALMACENES': {
        const result = await this.prisma.warehouse.updateMany({
          where: { externalCode: { notIn: [...seen] }, isActive: true },
          data: { isActive: false, removedAt: now },
        });
        return result.count;
      }
      case 'PEDIDOS': {
        const result = await this.prisma.salesOrder.updateMany({
          where: { externalNumber: { notIn: [...seen] }, isActive: true },
          data: { isActive: false, removedAt: now },
        });
        return result.count;
      }
      default:
        // Líneas y snapshots no generan bajas lógicas propias.
        return 0;
    }
  }

  private toSyncRun(run: {
    id: string;
    domain: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    recordsRead: number;
    recordsUpserted: number;
    errorsCount: number;
    errorDetail: string | null;
    sourceRef: string | null;
  }): SyncRun {
    return {
      id: run.id,
      domain: run.domain as SyncDomain,
      status: run.status as SyncRun['status'],
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      recordsRead: run.recordsRead,
      recordsUpserted: run.recordsUpserted,
      errorsCount: run.errorsCount,
      errorDetail: run.errorDetail,
      sourceRef: run.sourceRef,
    };
  }
}

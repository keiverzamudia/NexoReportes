import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SYNC_DOMAINS, SyncDomain, SyncRun, SyncStatusResponse } from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import {
  normalizeCustomerRow,
  normalizeInventoryRow,
  normalizeOrderLineRow,
  normalizeOrderRow,
  normalizeProductRow,
  normalizeWarehouseRow,
} from './normalizers';
import { ProfitAdapter, PROFIT_ADAPTER } from './profit.adapter';

type ProfitViewsConfig = Partial<Record<'productos' | 'clientes' | 'pedidos' | 'pedidosDetalle' | 'existencias' | 'almacenes', string>>;

const VIEW_KEY_BY_DOMAIN: Record<SyncDomain, keyof ProfitViewsConfig> = {
  PRODUCTOS: 'productos',
  CLIENTES: 'clientes',
  PEDIDOS: 'pedidos',
  PEDIDOS_DETALLE: 'pedidosDetalle',
  EXISTENCIAS: 'existencias',
  ALMACENES: 'almacenes',
};

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
  // ============================================================
  async run(domain: SyncDomain, actor?: { id?: string; email?: string }): Promise<SyncRun> {
    const view = this.resolveView(domain);

    const run = await this.prisma.syncRun.create({
      data: { domain, status: 'EN_CURSO', sourceRef: view },
    });

    let recordsRead = 0;
    let recordsUpserted = 0;
    let errorsCount = 0;
    const seenExternalCodes = new Set<string>();

    try {
      const pageSize = this.config.get<number>('sync.pageSize') ?? 5000;
      const rows = await this.profit.select(view, {}, pageSize);
      recordsRead = rows.length;

      // Una fotografía coherente de inventario por corrida (no por fila).
      const snapshotId =
        domain === 'EXISTENCIAS' && rows.length > 0
          ? (await this.prisma.inventorySnapshot.create({ data: { source: this.profit.dialect, takenAt: new Date(), runId: run.id } })).id
          : null;

      for (const row of rows) {
        try {
          const upserted = await this.upsertRow(domain, row, seenExternalCodes, snapshotId);
          if (upserted) {
            recordsUpserted += 1;
          }
        } catch (error) {
          errorsCount += 1;
          await this.prisma.syncError.create({
            data: {
              runId: run.id,
              entity: domain,
              externalId: this.externalIdOf(domain, row),
              message: error instanceof Error ? error.message : 'Error desconocido',
              raw: JSON.stringify(row).slice(0, 4000),
            },
          });
        }
      }

      // Bajas lógicas: lo que no apareció en esta corrida se marca como inactivo
      // (nunca se borra histórico). Solo si la lectura devolvió filas.
      const missingMarked = recordsRead > 0 ? await this.markMissing(domain, seenExternalCodes) : 0;

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
        context: { domain, status, recordsRead, recordsUpserted, errorsCount, missingMarked, dialect: this.profit.dialect },
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

  private resolveView(domain: SyncDomain): string {
    const views = (this.config.get<ProfitViewsConfig>('profit.views') ?? {}) as ProfitViewsConfig;
    const configured = views[VIEW_KEY_BY_DOMAIN[domain]];
    if (configured && configured.trim()) {
      return configured.trim();
    }
    if (this.profit.dialect === 'fixtures') {
      // Los fixtures aceptan cualquier nombre que identifique el dominio.
      return `fixtures.vw_${VIEW_KEY_BY_DOMAIN[domain]}`;
    }
    throw new NotFoundException(`Vista de Profit no configurada para el dominio ${domain} (variable PROFIT_VIEW_*)`);
  }

  private externalIdOf(domain: SyncDomain, row: Record<string, unknown>): string | null {
    const idFields: Record<SyncDomain, string[]> = {
      PRODUCTOS: ['codigo', 'codigo_producto', 'cod', 'producto'],
      CLIENTES: ['cliente_codigo', 'codigo', 'codigo_cliente'],
      PEDIDOS: ['numero', 'numero_pedido', 'pedido'],
      PEDIDOS_DETALLE: ['numero', 'numero_pedido', 'pedido'],
      EXISTENCIAS: ['codigo_producto', 'producto', 'codigo'],
      ALMACENES: ['almacen', 'codigo', 'codigo_almacen'],
    };
    for (const field of idFields[domain]) {
      const value = row[field];
      if (value !== undefined && value !== null && String(value).trim()) {
        return `${String(value).trim()}${domain === 'PEDIDOS_DETALLE' ? `#${row['linea'] ?? row['lineNumber'] ?? 1}` : ''}`;
      }
    }
    return null;
  }

  private async upsertRow(domain: SyncDomain, row: Record<string, unknown>, seen: Set<string>, snapshotId: string | null): Promise<boolean> {
    const now = new Date();
    switch (domain) {
      case 'PRODUCTOS': {
        const parsed = normalizeProductRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const { codigo, descripcion, unidad, familia } = parsed.value;
        seen.add(codigo);
        await this.prisma.product.upsert({
          where: { externalCode: codigo },
          update: { description: descripcion, uom: unidad, family: familia, isActive: true, removedAt: null, lastSyncedAt: now },
          create: { externalCode: codigo, description: descripcion, uom: unidad, family: familia, lastSyncedAt: now },
        });
        return true;
      }
      case 'CLIENTES': {
        const parsed = normalizeCustomerRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const { codigo, nombre, tipoCliente, vendedor } = parsed.value;
        seen.add(codigo);
        await this.prisma.customer.upsert({
          where: { externalCode: codigo },
          update: { name: nombre, customerType: tipoCliente, vendor: vendedor, isActive: true, removedAt: null, lastSyncedAt: now },
          create: { externalCode: codigo, name: nombre, customerType: tipoCliente, vendor: vendedor, lastSyncedAt: now },
        });
        return true;
      }
      case 'ALMACENES': {
        const parsed = normalizeWarehouseRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const { codigo, nombre } = parsed.value;
        seen.add(codigo);
        await this.prisma.warehouse.upsert({
          where: { externalCode: codigo },
          update: { name: nombre, isActive: true, removedAt: null, lastSyncedAt: now },
          create: { externalCode: codigo, name: nombre, lastSyncedAt: now },
        });
        return true;
      }
      case 'PEDIDOS': {
        const parsed = normalizeOrderRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const order = parsed.value;
        seen.add(order.numero);
        const customer = order.clienteCodigo
          ? await this.prisma.customer.findUnique({ where: { externalCode: order.clienteCodigo } })
          : null;
        await this.prisma.salesOrder.upsert({
          where: { externalNumber: order.numero },
          update: {
            customerId: customer?.id ?? null,
            customerCode: order.clienteCodigo,
            customerName: order.clienteNombre,
            customerType: order.tipoCliente,
            vendor: order.vendedor,
            orderDate: order.fechaEmision,
            requestedDate: order.fechaEntrega,
            status: order.status,
            statusRaw: order.statusRaw,
            authorized: order.autorizado,
            isActive: true,
            removedAt: null,
            lastSyncedAt: now,
          },
          create: {
            externalNumber: order.numero,
            customerId: customer?.id ?? null,
            customerCode: order.clienteCodigo,
            customerName: order.clienteNombre,
            customerType: order.tipoCliente,
            vendor: order.vendedor,
            orderDate: order.fechaEmision,
            requestedDate: order.fechaEntrega,
            status: order.status,
            statusRaw: order.statusRaw,
            authorized: order.autorizado,
            lastSyncedAt: now,
          },
        });
        return true;
      }
      case 'PEDIDOS_DETALLE': {
        const parsed = normalizeOrderLineRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const line = parsed.value;
        const order = await this.prisma.salesOrder.findUnique({ where: { externalNumber: line.numero } });
        if (!order) {
          throw new Error(`Pedido ${line.numero} no existe; sincronice PEDIDOS antes que PEDIDOS_DETALLE`);
        }
        const product = await this.prisma.product.findUnique({ where: { externalCode: line.codigoProducto } });
        seen.add(line.numero);
        await this.prisma.salesOrderLine.upsert({
          where: { orderId_lineNumber: { orderId: order.id, lineNumber: line.lineNumber } },
          update: {
            productCode: line.codigoProducto,
            productId: product?.id ?? null,
            description: line.descripcion,
            uom: line.unidad,
            quantity: line.cantidad,
            pendingQty: line.pendiente,
            warehouses: line.almacenes,
          },
          create: {
            orderId: order.id,
            lineNumber: line.lineNumber,
            productCode: line.codigoProducto,
            productId: product?.id ?? null,
            description: line.descripcion,
            uom: line.unidad,
            quantity: line.cantidad,
            pendingQty: line.pendiente,
            warehouses: line.almacenes,
          },
        });
        return true;
      }
      case 'EXISTENCIAS': {
        const parsed = normalizeInventoryRow(row);
        if (!parsed.ok || !parsed.value) throw new Error(parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
        const inv = parsed.value;
        seen.add(`${inv.codigoProducto}@${inv.almacen}`);
        if (!snapshotId) {
          throw new Error('Fotografía de inventario no creada para esta corrida');
        }
        const product = await this.prisma.product.findUnique({ where: { externalCode: inv.codigoProducto } });
        const warehouse = await this.prisma.warehouse.findUnique({ where: { externalCode: inv.almacen } });
        await this.prisma.inventorySnapshotLine.create({
          data: {
            snapshotId,
            productCode: inv.codigoProducto,
            productId: product?.id ?? null,
            warehouseCode: inv.almacen,
            warehouseId: warehouse?.id ?? null,
            qty: inv.cantidad,
            reservedQty: inv.reservada,
          },
        });
        return true;
      }
      default:
        return false;
    }
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

import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ForecastSellerQuota,
  ForecastSellerQuotaUpdate,
  ForecastSellerQuotasResponse,
} from '@nexo/contracts';
import { PrismaService } from '../../common/prisma.module';
import { AuditService } from '../audit/audit.service';
import { pad2, todayInTimeZone } from './sales-run-rate';

// ============================================================
// Cuotas mensuales de activación por vendedor.
//
// Viven en la BD local (`SellerQuota`), nunca en Profit. La lectura la puede
// hacer cualquiera que vea el módulo Vendedor; la escritura exige el permiso
// especial `vendedor_cuotas:update`.
//
// Reglas:
//  · Una cuota por vendedor + año + mes. `null` = sin cuota asignada.
//  · Mes cerrado = solo lectura: no se reescribe el cumplimiento histórico.
//  · 0 se normaliza a `null` para no dividir por cero en la UI.
//  · Cada cambio deja un evento de auditoría con el antes/después.
// ============================================================

const BUSINESS_TIME_ZONE = 'America/Caracas';

function currentMonthKey(): string {
  return todayInTimeZone(BUSINESS_TIME_ZONE).slice(0, 7);
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function normalizeQuota(value: number | null): number | null {
  return value !== null && value > 0 ? Math.trunc(value) : null;
}

function mapQuota(row: {
  sellerCode: string;
  year: number;
  month: number;
  reactivationQuota: number | null;
  newClientsQuota: number | null;
  updatedAt: Date;
}): ForecastSellerQuota {
  return {
    sellerCode: row.sellerCode,
    year: row.year,
    month: row.month,
    reactivationQuota: row.reactivationQuota,
    newClientsQuota: row.newClientsQuota,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SellerQuotasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(year: number, month: number, sellerCode?: string): Promise<ForecastSellerQuotasResponse> {
    const rows = await this.prisma.sellerQuota.findMany({
      where: { year, month, ...(sellerCode ? { sellerCode } : {}) },
      orderBy: { sellerCode: 'asc' },
    });
    return {
      year,
      month,
      quotas: rows.map(mapQuota),
      generatedAt: new Date().toISOString(),
    };
  }

  async set(input: ForecastSellerQuotaUpdate, actor?: { id?: string }): Promise<ForecastSellerQuota> {
    const sellerCode = input.sellerCode.trim();
    if (!sellerCode) throw new BadRequestException('Indica el vendedor');
    if (monthKey(input.year, input.month) < currentMonthKey()) {
      throw new BadRequestException('Las cuotas de un mes cerrado son solo lectura');
    }

    const reactivationQuota = normalizeQuota(input.reactivationQuota);
    const newClientsQuota = normalizeQuota(input.newClientsQuota);
    const where = {
      sellerCode_year_month: {
        sellerCode,
        year: input.year,
        month: input.month,
      },
    };

    const current = await this.prisma.sellerQuota.findUnique({ where });
    const updated = await this.prisma.sellerQuota.upsert({
      where,
      update: {
        reactivationQuota,
        newClientsQuota,
        updatedById: actor?.id ?? null,
      },
      create: {
        sellerCode,
        year: input.year,
        month: input.month,
        reactivationQuota,
        newClientsQuota,
        createdById: actor?.id ?? null,
        updatedById: actor?.id ?? null,
      },
    });

    const changes: string[] = [];
    if ((current?.reactivationQuota ?? null) !== reactivationQuota) {
      changes.push(
        `reactivación ${current?.reactivationQuota ?? '—'} → ${reactivationQuota ?? '—'}`,
      );
    }
    if ((current?.newClientsQuota ?? null) !== newClientsQuota) {
      changes.push(`nuevos ${current?.newClientsQuota ?? '—'} → ${newClientsQuota ?? '—'}`);
    }

    await this.audit.record({
      actorId: actor?.id ?? null,
      action: 'SELLER_QUOTA_UPDATED',
      entityType: 'SellerQuota',
      entityId: `${monthKey(input.year, input.month)}:${sellerCode}`,
      context: {
        code: sellerCode,
        sellerCode,
        year: input.year,
        month: input.month,
        before: {
          reactivationQuota: current?.reactivationQuota ?? null,
          newClientsQuota: current?.newClientsQuota ?? null,
        },
        reactivationQuota,
        newClientsQuota,
        changes,
      },
    });

    return mapQuota(updated);
  }
}

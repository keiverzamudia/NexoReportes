import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  SystemAnnouncement,
  SystemAnnouncementInput,
  SystemMetaResponse,
} from '@nexo/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma.module';

const VERSION_KEY = 'SYSTEM_VERSION';
const ANNOUNCEMENTS_KEY = 'SYSTEM_ANNOUNCEMENTS';
const DEFAULT_VERSION = 'v1.0.0';
const MAX_ANNOUNCEMENTS = 50;

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService) {}

  async getVersion(): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: VERSION_KEY } });
    const value = row?.value.trim();
    return value || DEFAULT_VERSION;
  }

  async setVersion(version: string): Promise<{ version: string }> {
    const clean = version.trim();
    await this.prisma.systemSetting.upsert({
      where: { key: VERSION_KEY },
      update: { value: clean },
      create: {
        key: VERSION_KEY,
        value: clean,
        description: 'Versión visible del sistema junto al logo de Corpoagro',
      },
    });
    return { version: clean };
  }

  private async readAnnouncements(): Promise<SystemAnnouncement[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: ANNOUNCEMENTS_KEY } });
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => ({
        ...(item as SystemAnnouncement),
        repeatIntervalMinutes: Number((item as Partial<SystemAnnouncement>).repeatIntervalMinutes ?? 0),
      }));
    } catch {
      return [];
    }
  }

  private async writeAnnouncements(items: SystemAnnouncement[]): Promise<void> {
    const trimmed = items.slice(0, MAX_ANNOUNCEMENTS);
    await this.prisma.systemSetting.upsert({
      where: { key: ANNOUNCEMENTS_KEY },
      update: { value: JSON.stringify(trimmed) },
      create: {
        key: ANNOUNCEMENTS_KEY,
        value: JSON.stringify(trimmed),
        description: 'Avisos y noticias globales del sistema (modal de ingreso)',
      },
    });
  }

  async getMeta(): Promise<SystemMetaResponse> {
    const [version, all] = await Promise.all([this.getVersion(), this.readAnnouncements()]);
    const now = Date.now();
    const activeAnnouncements = all.filter(
      (item) => item.active && new Date(item.expiresAt).getTime() > now,
    );
    return { version, activeAnnouncements };
  }

  async listAnnouncements(): Promise<SystemAnnouncement[]> {
    return this.readAnnouncements();
  }

  async createAnnouncement(
    input: SystemAnnouncementInput,
    actorId?: string,
  ): Promise<SystemAnnouncement> {
    const actor = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { displayName: true },
        })
      : null;

    const created: SystemAnnouncement = {
      id: randomUUID(),
      title: input.title,
      message: input.message,
      type: input.type,
      expiresAt: input.expiresAt,
      repeatIntervalMinutes: input.repeatIntervalMinutes ?? 0,
      active: true,
      createdAt: new Date().toISOString(),
      createdByName: actor?.displayName ?? null,
    };

    const existing = await this.readAnnouncements();
    await this.writeAnnouncements([created, ...existing]);
    return created;
  }

  async setAnnouncementActive(id: string, active: boolean): Promise<SystemAnnouncement> {
    const items = await this.readAnnouncements();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundException('Aviso no encontrado');
    }
    const updated: SystemAnnouncement = { ...items[index]!, active };
    const next = [...items];
    next[index] = updated;
    await this.writeAnnouncements(next);
    return updated;
  }

  async deleteAnnouncement(id: string): Promise<{ deleted: true }> {
    const items = await this.readAnnouncements();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      throw new NotFoundException('Aviso no encontrado');
    }
    await this.writeAnnouncements(next);
    return { deleted: true };
  }
}

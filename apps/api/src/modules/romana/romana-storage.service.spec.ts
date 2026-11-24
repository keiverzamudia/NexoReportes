import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROMANA_LIMITS } from '@nexo/contracts';
import { RomanaStorageService } from './romana-storage.service';

describe('RomanaStorageService', () => {
  let root: string;
  let service: RomanaStorageService;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'romana-storage-'));
    const config = {
      get: (key: string) => (key === 'romana.uploadDir' ? root : undefined),
    };
    service = new RomanaStorageService(config as any);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('convierte a WebP, genera miniatura y respeta el tope de peso', async () => {
    const input = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: '#f5f0e6' },
    })
      .png()
      .toBuffer();

    const stored = await service.store({
      arrivalId: 'a1',
      orderNumber: 'PED-1',
      kind: 'CEDULA',
      buffer: input,
      now: new Date(2026, 10, 19),
    });

    expect(stored.storageKey).toMatch(/^2026\/11\/a1\/PED-1-[0-9a-f]{8}-[a-z0-9]+__CEDULA\.webp$/);
    expect(stored.thumbKey).toContain('__CEDULA.thumb.webp');
    expect(stored.mimeType).toBe('image/webp');
    expect(stored.bytes).toBeLessThanOrEqual(ROMANA_LIMITS.maxFullBytes);
    expect(stored.width).toBe(1440);
    expect(stored.height).toBe(960);

    const file = await service.read(stored.storageKey);
    expect(file.bytes).toBeGreaterThan(0);
    const thumb = await service.read(stored.thumbKey);
    expect(thumb.bytes).toBeGreaterThan(0);
    file.stream.destroy();
    thumb.stream.destroy();

    const folders = await service.listArrivalFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]!.arrivalId).toBe('a1');

    const failed = await service.removeKeys([stored.storageKey, stored.thumbKey]);
    expect(failed).toEqual([]);
    await expect(service.read(stored.storageKey)).rejects.toThrow();
  });

  it('rechaza imágenes demasiado pequeñas', async () => {
    const tiny = await sharp({
      create: { width: 200, height: 120, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    await expect(
      service.store({ arrivalId: 'a2', orderNumber: 'PED-2', kind: 'CARNET', buffer: tiny }),
    ).rejects.toThrow(/muy pequeña/);
  });
});

import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROMANA_LIMITS } from '@nexo/contracts';
import { createHash } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';

// ============================================================
// Almacenamiento de las fotos de Romana.
//
// La imagen NO vive en la base: se recompone con sharp (WebP, metadata
// fuera) y se escribe en un volumen. La base guarda solo una clave relativa.
// Al validar la llegada se borran los archivos y las claves.
// ============================================================

export interface StoredImage {
  storageKey: string;
  thumbKey: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

export interface StoredStream {
  stream: ReadStream;
  bytes: number;
}

export interface ArrivalFolder {
  arrivalId: string;
  dir: string;
  modifiedAt: Date;
}

@Injectable()
export class RomanaStorageService implements OnModuleInit {
  private readonly logger = new Logger(RomanaStorageService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('romana.uploadDir') ?? 'uploads/romana';
    this.root = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    // Las fotos de documentos son pequeñas y las subidas llegan de a una:
    // limitar la concurrencia evita picos de CPU en el servidor de planta.
    sharp.concurrency(1);
  }

  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      this.logger.log(`Fotos de Romana en ${this.root}`);
    } catch (error) {
      this.logger.error(
        `No se pudo crear la carpeta de Romana (${this.root}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async store(input: {
    arrivalId: string;
    orderNumber: string;
    kind: 'CEDULA' | 'CARNET';
    buffer: Buffer;
    now?: Date;
  }): Promise<StoredImage> {
    const maxUpload =
      this.config.get<number>('romana.maxUploadBytes') ?? ROMANA_LIMITS.maxUploadBytes;
    if (input.buffer.length > maxUpload) {
      throw new BadRequestException(
        `La foto supera el máximo de ${Math.round(maxUpload / (1024 * 1024))} MB.`,
      );
    }
    const now = input.now ?? new Date();
    const full = await this.compress(input.buffer);

    const thumbnail = await sharp(full.buffer)
      .resize({
        width: ROMANA_LIMITS.thumbEdge,
        height: ROMANA_LIMITS.thumbEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 60, effort: 4 })
      .toBuffer();

    const folder = [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), input.arrivalId];
    const safeOrder = input.orderNumber.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'pedido';
    const suffix = createHash('sha1').update(input.orderNumber).digest('hex').slice(0, 8);
    // Versión única: reemplazar una foto escribe un archivo nuevo y solo
    // después se borra el anterior. Así una falla de BD no deja la fila
    // apuntando a un archivo pisado.
    const version = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const baseName = `${safeOrder}-${suffix}-${version}__${input.kind}`;

    const storageKey = [...folder, `${baseName}.webp`].join('/');
    const thumbKey = [...folder, `${baseName}.thumb.webp`].join('/');

    await this.write(storageKey, full.buffer);
    try {
      await this.write(thumbKey, thumbnail);
    } catch (error) {
      await this.removeKeys([storageKey]);
      throw error;
    }

    return {
      storageKey,
      thumbKey,
      mimeType: 'image/webp',
      bytes: full.buffer.length,
      width: full.width,
      height: full.height,
      sha256: createHash('sha256').update(full.buffer).digest('hex'),
    };
  }

  async read(storageKey: string): Promise<StoredStream> {
    const absolute = this.resolveKey(storageKey);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error('no es un archivo');
      return { stream: createReadStream(absolute), bytes: info.size };
    } catch {
      throw new NotFoundException('La foto ya no está disponible.');
    }
  }

  /** Borra las claves indicadas. Devuelve las que no se pudieron borrar. */
  async removeKeys(keys: Array<string | null | undefined>): Promise<string[]> {
    const failed: string[] = [];
    for (const key of keys) {
      if (!key) continue;
      try {
        await rm(this.resolveKey(key), { force: true });
      } catch (error) {
        this.logger.warn(
          `No se pudo borrar ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
        failed.push(key);
      }
    }
    return failed;
  }

  async removeFolder(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  /** Carpetas por llegada (año/mes/llegada), para el barrido de huérfanas. */
  async listArrivalFolders(): Promise<ArrivalFolder[]> {
    const folders: ArrivalFolder[] = [];
    let years: string[] = [];
    try {
      years = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return folders;
    }

    for (const year of years) {
      let months: string[] = [];
      try {
        months = (await readdir(path.join(this.root, year), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const month of months) {
        let arrivals: string[] = [];
        try {
          arrivals = (await readdir(path.join(this.root, year, month), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        } catch {
          continue;
        }
        for (const arrivalId of arrivals) {
          const dir = path.join(this.root, year, month, arrivalId);
          try {
            const info = await stat(dir);
            folders.push({ arrivalId, dir, modifiedAt: info.mtime });
          } catch {
            // La carpeta desapareció entre la lectura y el stat.
          }
        }
      }
    }
    return folders;
  }

  private async compress(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
    const edges = [ROMANA_LIMITS.maxEdge, 1280, 1080];
    const qualities = [72, 62, 52];
    let best: { buffer: Buffer; width: number; height: number } | null = null;

    for (const edge of edges) {
      for (const quality of qualities) {
        let output: OutputInfo;
        let data: Buffer;
        try {
          const result = await sharp(input, { failOn: 'error', animated: false })
            .rotate()
            .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
            .webp({ quality, effort: 4 })
            .toBuffer({ resolveWithObject: true });
          data = result.data;
          output = result.info;
        } catch {
          throw new BadRequestException('El archivo no es una imagen válida o está dañado.');
        }

        if (Math.max(output.width, output.height) < 480) {
          throw new BadRequestException('La foto es muy pequeña: acerca la cámara y vuelve a intentarlo.');
        }

        best = { buffer: data, width: output.width, height: output.height };
        if (data.length <= ROMANA_LIMITS.maxFullBytes) return best;
      }
    }

    if (!best || best.buffer.length > ROMANA_LIMITS.maxFullBytes) {
      throw new BadRequestException('No se pudo comprimir la foto lo suficiente. Intenta con otra imagen.');
    }
    return best;
  }

  private async write(key: string, data: Buffer): Promise<void> {
    const absolute = this.resolveKey(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, absolute);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private resolveKey(key: string): string {
    const parts = key.split('/');
    if (parts.some((part) => !part || part === '..' || part === '.' || part.includes('\\'))) {
      throw new BadRequestException('Ruta de foto inválida.');
    }
    const absolute = path.resolve(this.root, ...parts);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${path.sep}`)) {
      throw new BadRequestException('Ruta de foto inválida.');
    }
    return absolute;
  }
}

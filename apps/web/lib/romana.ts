'use client';

import type { RomanaArrivalSummary, RomanaDocument, RomanaDocKind, RomanaStatus } from '@nexo/contracts';
import type { ArrivalTone } from './arrival';

// ============================================================
// Romana (báscula): etiquetas, orden de la bandeja y compresión previa
// de la foto en el navegador. La compresión final la hace el servidor.
// ============================================================

export const ROMANA_STATUS_META: Record<
  RomanaStatus,
  { label: string; short: string; tone: ArrivalTone; hint: string }
> = {
  PENDIENTE: {
    label: 'Faltan fotos',
    short: 'Faltan fotos',
    tone: 'warning',
    hint: 'Sube la cédula del chofer y el carnet de circulación de cada pedido.',
  },
  LISTO: {
    label: 'Listo para marcar',
    short: 'Listo',
    tone: 'primary',
    hint: 'Ya están las 2 fotos de todos los pedidos. Marca la llegada en Romana.',
  },
  EN_ROMANA: {
    label: 'En Romana',
    short: 'En Romana',
    tone: 'primary',
    hint: 'La llegada está marcada; revisa las fotos y valida para liberar espacio.',
  },
  VALIDADO: {
    label: 'Validado',
    short: 'Validado',
    tone: 'success',
    hint: 'Los documentos se validaron y las fotos ya se borraron.',
  },
  EXPIRADO: {
    label: 'Fotos expiradas',
    short: 'Expirado',
    tone: 'muted',
    hint: 'El barrido eliminó las fotos por antigüedad antes de validarlas.',
  },
  CANCELADO: {
    label: 'Cancelado',
    short: 'Cancelado',
    tone: 'muted',
    hint: 'El despacho se anuló y las fotos se purgan.',
  },
};

export function romanaStatusMeta(status: RomanaStatus) {
  return ROMANA_STATUS_META[status] ?? ROMANA_STATUS_META.PENDIENTE;
}

export const ROMANA_DOC_META: Record<RomanaDocKind, { label: string; short: string; hint: string }> = {
  CEDULA: {
    label: 'Cédula del chofer',
    short: 'Cédula',
    hint: 'Foto clara del documento, con el número legible.',
  },
  CARNET: {
    label: 'Carnet de circulación',
    short: 'Carnet',
    hint: 'Foto del carnet del vehículo que retira el pedido.',
  },
};

const STATUS_ORDER: Record<RomanaStatus, number> = {
  LISTO: 0,
  EN_ROMANA: 1,
  PENDIENTE: 2,
  VALIDADO: 3,
  EXPIRADO: 4,
  CANCELADO: 5,
};

export function sortRomanaArrivals(items: RomanaArrivalSummary[]): RomanaArrivalSummary[] {
  return [...items].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.romana.status] - STATUS_ORDER[b.romana.status];
    if (byStatus !== 0) return byStatus;
    const byDate = (a.expectedDate ?? '9999-12-31').localeCompare(b.expectedDate ?? '9999-12-31');
    if (byDate !== 0) return byDate;
    return a.customerName.localeCompare(b.customerName, 'es');
  });
}

export function romanaProgress(item: Pick<RomanaArrivalSummary, 'romana'>): {
  uploaded: number;
  required: number;
  pending: number;
  ratio: number;
} {
  const { uploadedDocs, requiredDocs, pendingDocs } = item.romana;
  return {
    uploaded: uploadedDocs,
    required: requiredDocs,
    pending: pendingDocs,
    ratio: requiredDocs > 0 ? uploadedDocs / requiredDocs : 0,
  };
}

export function documentFor(
  item: Pick<RomanaArrivalSummary, 'romana'>,
  orderNumber: string,
  kind: RomanaDocKind,
): RomanaDocument | undefined {
  return item.romana.orders
    .find((order) => order.orderNumber === orderNumber)
    ?.documents.find((document) => document.kind === kind);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Comprime en el navegador antes de subir: ahorra datos móviles y convierte
 * HEIC/PNG a JPEG. El servidor vuelve a recomprimir a WebP.
 */
export async function compressForUpload(file: File, maxEdge = 2048, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return file;
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    // El navegador no pudo decodificar (p. ej. HEIC): se envía tal cual y el
    // servidor decide. Si sharp tampoco puede, devuelve un error legible.
    return file;
  }
}

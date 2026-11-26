'use client';

// ============================================================
// Hoja de carga de UN cliente en PDF (jsPDF + autotable).
//
// Se abre desde el bloque del cliente (bandeja, página del despacho y móvil)
// para que el pedido se pueda imprimir y marcar a mano cuando el usuario no
// tiene teléfono. Lleva los mismos campos de la pantalla: pedido, turno,
// artículo, entrega, plan, cargado, estado y motivo, más una columna «OK»
// vacía para el marcado manual.
//
// No escribe nada: se genera en el navegador con los datos ya cargados.
// ============================================================

import type { DispatchCustomerProgress, DispatchSheetDetail } from '@nexo/contracts';
import type { CustomerGroup } from './dispatch-sheet';
import {
  formatBusinessDate,
  formatDateTime,
  formatNumber,
  lineEffectiveQty,
  lineStatusMeta,
} from './dispatch-sheet';

const BRAND: [number, number, number] = [15, 76, 92];
const INK: [number, number, number] = [33, 43, 54];
const MUTED: [number, number, number] = [110, 120, 132];
const LINE: [number, number, number] = [203, 210, 216];

const MARGIN = 12;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type PdfResult = 'opened' | 'downloaded';

export interface PdfOptions {
  /** Usuario que imprime (se muestra en la cabecera del PDF). */
  printedBy?: string | null;
  /** Momento de generación; por defecto, ahora. */
  printedAt?: Date;
}

const LOGO_SRC = '/brand/corpoagro-logo.png';

/**
 * Genera el PDF del cliente y lo abre en una pestaña nueva.
 * La ventana se abre en el mismo gesto del clic (antes de los imports
 * dinámicos) para que el navegador no la trate como popup.
 */
export async function openCustomerPdf(
  sheet: DispatchSheetDetail,
  group: CustomerGroup,
  progress?: DispatchCustomerProgress,
  options: PdfOptions = {},
): Promise<PdfResult> {
  const win = typeof window === 'undefined' ? null : window.open('', '_blank');
  try {
    const { doc, fileName } = await buildCustomerPdf(sheet, group, progress, options);
    if (win) {
      win.location.replace(String(doc.output('bloburl')));
      win.focus();
      return 'opened';
    }
    // Popup bloqueado: se descarga para que el usuario lo abra desde su lector.
    doc.save(fileName);
    return 'downloaded';
  } catch (error) {
    win?.close();
    throw error;
  }
}

/** Construye el documento (exportado para pruebas o descargas directas). */
export async function buildCustomerPdf(
  sheet: DispatchSheetDetail,
  group: CustomerGroup,
  progress?: DispatchCustomerProgress,
  options: PdfOptions = {},
): Promise<{ doc: import('jspdf').jsPDF; fileName: string }> {
  const printedAt = options.printedAt ?? new Date();
  const printedBy = options.printedBy?.trim() || null;
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogo(),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const fileName = `hoja-carga-${slug(sheet.number)}-${slug(group.name)}.pdf`;

  const customer = sheet.customerRows.find((row) => row.customerKey === group.key);
  const started = Boolean(progress?.loadStartedAt);
  const invoiced = Boolean(progress?.invoiceDeliveredAt);
  const groupClosed = group.pendingLines === 0 && group.lines.length > 0;
  const loadClosed = Boolean(progress?.loadClosedAt) || groupClosed;
  const status = invoiced ? 'Facturada' : loadClosed ? 'Carga cerrada' : started ? 'En carga' : 'Sin iniciar';
  const deliveryDates = [...new Set(group.lines.map((line) => line.effectiveDate).filter(Boolean))]
    .sort()
    .map((date) => formatBusinessDate(date))
    .join(', ');
  const orders = new Set(group.lines.map((line) => line.orderNumber).filter(Boolean)).size;
  const plannedSacks = group.lines
    .filter((line) => line.uom === 'SAC')
    .reduce((sum, line) => sum + line.plannedQty, 0);
  const loadedSacks = group.lines
    .filter((line) => line.uom === 'SAC')
    .reduce((sum, line) => sum + lineEffectiveQty(line), 0);

  doc.setProperties({
    title: `Hoja de carga · ${group.name} · ${sheet.number}`,
    subject: `Despacho ${sheet.number}`,
    creator: 'Corpoagro',
  });

  drawHeader(doc, sheet, group, status, printedBy, printedAt, false, logo);

  // Datos del cliente en dos columnas (cada llamada avanza la Y compartida).
  let y = 44;
  const row = (
    leftLabel: string,
    leftValue: string,
    rightLabel: string,
    rightValue: string,
  ) => {
    const left = drawField(doc, y, MARGIN, leftLabel, leftValue, 96);
    const right = drawField(doc, y, 118, rightLabel, rightValue, PAGE_WIDTH - MARGIN - 118);
    y = Math.max(left, right);
  };
  row('Cliente', group.name, 'Código', customer?.customerCode ?? group.lines[0]?.customerCode ?? '-');
  row('Vendedor', customer?.vendor ?? '-', 'Entrega', deliveryDates || '-');
  row('Pedidos', String(orders), 'Renglones', String(group.lines.length));
  row(
    'Plan',
    `${formatNumber(plannedSacks)} sacos · ${formatNumber(group.plannedKg)} kg`,
    'Cargado',
    `${formatNumber(loadedSacks)} sacos · ${formatNumber(group.loadedKg)} kg`,
  );
  row(
    'Inicio de carga',
    stamp(progress?.loadStartedAt, progress?.loadStartedByName),
    'Carga cerrada',
    progress?.loadClosedAt ? formatDateTime(progress.loadClosedAt) : '-',
  );
  row(
    'Factura entregada',
    stamp(progress?.invoiceDeliveredAt, progress?.invoiceDeliveredByName),
    'Despacho',
    sheet.number,
  );

  if (sheet.instructions) {
    y = drawField(doc, y, MARGIN, 'Instrucciones', sheet.instructions, CONTENT_WIDTH);
  }

  const tableStart = y + 2;

  autoTable(doc, {
    startY: tableStart,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN, top: 30, bottom: 18 },
    head: [['OK', 'Pedido', 'Código', 'Artículo', 'Entrega', 'Plan', 'Cargado', 'Estado', 'Motivo / obs.']],
    body: group.lines.map((line) => {
      const effective = lineEffectiveQty(line);
      const pending = line.status === 'PENDIENTE';
      return [
        '',
        `${line.orderNumber}\nturno ${line.position}`,
        line.productCode,
        line.description ?? '-',
        formatBusinessDate(line.effectiveDate) === '—' ? '-' : formatBusinessDate(line.effectiveDate),
        `${formatNumber(line.plannedQty)} ${line.uom ?? ''}\n${formatNumber(line.plannedKg)} kg`,
        pending ? '' : `${formatNumber(effective)} ${line.uom ?? ''}\n${formatNumber(line.loadedKg ?? 0)} kg`,
        lineStatusMeta(line.status).label,
        line.note ?? '',
      ];
    }),
    foot: [
      [
        {
          content: `TOTAL · ${group.lines.length} renglón(es)`,
          colSpan: 5,
          styles: { halign: 'right' as const },
        },
        `${formatNumber(plannedSacks)} SAC\n${formatNumber(group.plannedKg)} kg`,
        `${formatNumber(loadedSacks)} SAC\n${formatNumber(group.loadedKg)} kg`,
        '',
        '',
      ],
    ],
    styles: {
      font: 'helvetica',
      fontSize: 7.4,
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.15,
      cellPadding: 1.4,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontSize: 6.8,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      cellPadding: 1.6,
    },
    footStyles: {
      fillColor: [236, 241, 243],
      textColor: INK,
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [248, 250, 251] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 20 },
      3: { cellWidth: 43 },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 16, halign: 'center' },
    },
    rowPageBreak: 'avoid',
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, sheet, group, status, printedBy, printedAt, true, logo);
      drawFooter(doc, sheet, data.pageNumber, printedAt);
    },
  });

  const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableStart;
  drawSignatures(doc, lastY + 10, sheet, printedAt);

  return { doc, fileName };
}

function drawHeader(
  doc: import('jspdf').jsPDF,
  sheet: DispatchSheetDetail,
  group: CustomerGroup,
  status: string,
  printedBy: string | null,
  printedAt: Date,
  compact = false,
  logo: LogoImage | null = null,
) {
  if (compact) {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${group.name} · ${sheet.number}`, MARGIN, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Impreso por ${printedBy ?? '-'}`, PAGE_WIDTH - MARGIN, 12, { align: 'right' });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 20, PAGE_WIDTH - MARGIN, 20);
    return;
  }

  // Marca oficial del sistema. Si la imagen no carga, queda el texto.
  if (logo) {
    const height = 11;
    const width = Math.min(64, (logo.width / logo.height) * height);
    doc.addImage(logo.data, 'PNG', MARGIN, 10, width, height);
  } else {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('CORPOAGRO', MARGIN, 17);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`Hoja de carga por cliente · ${status}`, MARGIN, 26);

  // Quién imprime y cuándo (se reemplaza el número/estado del encabezado).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  doc.setTextColor(...INK);
  doc.text(`Impreso por ${printedBy ?? '-'}`, PAGE_WIDTH - MARGIN, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(formatPrintedAt(printedAt), PAGE_WIDTH - MARGIN, 20.5, { align: 'right' });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 29, PAGE_WIDTH - MARGIN, 29);
}

/** Etiqueta + valor en una línea; devuelve la siguiente Y disponible. */
function drawField(
  doc: import('jspdf').jsPDF,
  y: number,
  x: number,
  label: string,
  value: string,
  maxWidth = 80,
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(value || '-', maxWidth);
  doc.text(lines, x, y + 3.6);
  return y + 4 + Math.max(0, lines.length - 1) * 3.4 + 2.4;
}

function drawSignatures(doc: import('jspdf').jsPDF, y: number, sheet: DispatchSheetDetail, printedAt: Date) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(...MUTED);
  doc.text('Marca cada renglón cargado en la columna OK. Este documento es de trabajo; no es una factura.', MARGIN, y);

  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + 26 > pageHeight - 16) {
    doc.addPage();
    y = 24;
    drawFooter(doc, sheet, doc.getNumberOfPages(), printedAt);
  }

  const width = (CONTENT_WIDTH - 16) / 3;
  const labels = ['Cargado por', 'Verificado por', 'Recibido por (cliente)'];
  labels.forEach((label, index) => {
    const x = MARGIN + index * (width + 8);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(x, y + 18, x + width, y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y + 22);
  });
}

function drawFooter(doc: import('jspdf').jsPDF, sheet: DispatchSheetDetail, page: number, printedAt: Date) {
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, pageHeight - 14, PAGE_WIDTH - MARGIN, pageHeight - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Despacho ${sheet.number} · impreso ${formatPrintedAt(printedAt)} · Corpoagro`,
    MARGIN,
    pageHeight - 9,
  );
  doc.text(`Página ${page}`, PAGE_WIDTH - MARGIN, pageHeight - 9, { align: 'right' });
}

/** Logo oficial del sistema (PNG para poder incrustarlo en el PDF). */
interface LogoImage {
  data: string;
  width: number;
  height: number;
}

async function loadLogo(): Promise<LogoImage | null> {
  if (typeof window === 'undefined' || typeof FileReader === 'undefined') return null;
  try {
    const response = await fetch(LOGO_SRC);
    if (!response.ok) return null;
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar el logo'));
      img.src = data;
    });
    return { data, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  } catch {
    return null;
  }
}

function formatPrintedAt(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function stamp(at: string | null | undefined, byName: string | null | undefined): string {
  if (!at) return '-';
  return byName ? `${formatDateTime(at)} · ${byName}` : formatDateTime(at);
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
}

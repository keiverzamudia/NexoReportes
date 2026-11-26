'use client';

// ============================================================
// Nota de entrega de Profit en PDF (jsPDF + autotable).
//
// Replica el documento que Profit muestra: cabecera, cliente, renglones con
// origen, totales en la moneda de presentación y espacio de firma. Se genera
// en el navegador con los datos que devuelve la API; no escribe en Profit.
// ============================================================

import type { DeliveryNoteDocument } from '@nexo/contracts';

const BRAND: [number, number, number] = [15, 76, 92];
const INK: [number, number, number] = [33, 43, 54];
const MUTED: [number, number, number] = [110, 120, 132];
const LINE: [number, number, number] = [203, 210, 216];
const SOFT: [number, number, number] = [243, 247, 248];

const MARGIN = 12;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type PdfResult = 'opened' | 'downloaded';

export interface DeliveryNotePdfOptions {
  printedBy?: string | null;
  printedAt?: Date;
}

const LOGO_SRC = '/brand/corpoagro-logo.png';

export async function openDeliveryNotePdf(
  note: DeliveryNoteDocument,
  options: DeliveryNotePdfOptions = {},
): Promise<PdfResult> {
  const win = typeof window === 'undefined' ? null : window.open('', '_blank');
  try {
    const { doc, fileName } = await buildDeliveryNotePdf(note, options);
    if (win) {
      win.location.replace(String(doc.output('bloburl')));
      win.focus();
      return 'opened';
    }
    doc.save(fileName);
    return 'downloaded';
  } catch (error) {
    win?.close();
    throw error;
  }
}

export async function saveDeliveryNotePdf(
  note: DeliveryNoteDocument,
  options: DeliveryNotePdfOptions = {},
): Promise<void> {
  const { doc, fileName } = await buildDeliveryNotePdf(note, options);
  doc.save(fileName);
}

export async function buildDeliveryNotePdf(
  note: DeliveryNoteDocument,
  options: DeliveryNotePdfOptions = {},
): Promise<{ doc: import('jspdf').jsPDF; fileName: string }> {
  const printedAt = options.printedAt ?? new Date();
  const printedBy = options.printedBy?.trim() || null;
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogo(),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const fileName = `nota-entrega-${slug(note.number)}-${slug(note.customerName)}.pdf`;

  doc.setProperties({
    title: `Nota de entrega ${note.number} · ${note.customerName}`,
    subject: `Pedido ${note.orders.join(', ') || note.number}`,
    creator: 'Corpoagro',
  });

  drawHeader(doc, note, printedBy, printedAt, logo);

  let y = 45;
  y = drawCustomer(doc, note, y);
  y = drawMeta(doc, note, y);

  autoTable(doc, {
    startY: y + 2,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN, top: 28, bottom: 22 },
    head: [['#', 'Código', 'Descripción', 'Alm.', 'Cant.', 'Unid.', 'Precio', 'Desc.', 'Neto', 'Origen']],
    body: note.lines.map((line) => [
      String(line.line),
      line.productCode,
      line.description || '-',
      line.warehouse ?? '-',
      formatNumber(line.quantity, 2),
      line.unit ?? '',
      money(line.price, note.currency),
      line.discountPct ? `${formatNumber(line.discountPct, 2)}%` : '-',
      money(line.net, note.currency),
      line.origin ?? '-',
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 7.1,
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.15,
      cellPadding: 1.35,
      valign: 'middle',
    },
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontSize: 6.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      cellPadding: 1.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 251] },
    columnStyles: {
      0: { cellWidth: 6, halign: 'center' },
      1: { cellWidth: 18 },
      2: { cellWidth: 57 },
      3: { cellWidth: 10, halign: 'center' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 10, halign: 'center' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 10, halign: 'right' },
      8: { cellWidth: 22, halign: 'right' },
      9: { cellWidth: 15, halign: 'center' },
    },
    rowPageBreak: 'avoid',
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, note, printedBy, printedAt, logo, true);
      drawFooter(doc, note, data.pageNumber, printedAt);
    },
  });

  const lastY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  const totalsY = drawTotals(doc, note, lastY + 6);
  const commentsY = note.comments ? drawComments(doc, note.comments, totalsY + 4) : totalsY;
  drawSignatures(doc, note, commentsY + 10, printedAt);

  return { doc, fileName };
}

function drawHeader(
  doc: import('jspdf').jsPDF,
  note: DeliveryNoteDocument,
  printedBy: string | null,
  printedAt: Date,
  logo: LogoImage | null,
  compact = false,
) {
  if (compact) {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Nota de entrega ${note.number} · ${note.customerName}`, MARGIN, 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    if (printedBy) doc.text(`Generado por ${printedBy}`, PAGE_WIDTH - MARGIN, 11, { align: 'right' });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 17, PAGE_WIDTH - MARGIN, 17);
    return;
  }

  if (logo) {
    const height = 11;
    const width = Math.min(64, (logo.width / logo.height) * height);
    doc.addImage(logo.data, 'PNG', MARGIN, 9, width, height);
  } else {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('CORPOAGRO', MARGIN, 16);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...MUTED);
  doc.text('Corporación Agropecuaria Venezolana, C.A.', MARGIN, 24);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text('NOTA DE ENTREGA', PAGE_WIDTH - MARGIN, 14, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BRAND);
  doc.text(`Nº ${note.number}`, PAGE_WIDTH - MARGIN, 20, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(...MUTED);
  doc.text(`Fecha ${formatDate(note.date)}`, PAGE_WIDTH - MARGIN, 25, { align: 'right' });

  if (note.annulled) {
    doc.setFillColor(185, 28, 28);
    doc.roundedRect(PAGE_WIDTH - MARGIN - 22, 28, 22, 5.5, 1.2, 1.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('ANULADA', PAGE_WIDTH - MARGIN - 11, 31.6, { align: 'center' });
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, 34, PAGE_WIDTH - MARGIN, 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text(`Generado por ${printedBy ?? '-'}`, MARGIN, 39);
  doc.text(formatPrintedAt(printedAt), PAGE_WIDTH - MARGIN, 39, { align: 'right' });
}

function drawCustomer(doc: import('jspdf').jsPDF, note: DeliveryNoteDocument, y: number): number {
  doc.setFillColor(...SOFT);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 25, 1.8, 1.8, 'F');
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.15);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 25, 1.8, 1.8, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...MUTED);
  doc.text('CLIENTE', MARGIN + 4, y + 5.5);
  doc.setFontSize(9.2);
  doc.setTextColor(...INK);
  const customerName = doc.splitTextToSize(note.customerName || '-', 90)[0] ?? '-';
  doc.text(customerName, MARGIN + 4, y + 10.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text(`Código ${note.customerCode || '-'}`, MARGIN + 4, y + 15.5);
  doc.text(`RIF ${note.customerRif ?? '-'}`, MARGIN + 4, y + 20);

  const address = doc.splitTextToSize(note.customerAddress ?? '-', 84);
  doc.text(address.slice(0, 2), 112, y + 7.5);
  doc.text(note.customerPhone ? `Tel. ${note.customerPhone}` : 'Tel. -', 112, y + 18.5);

  return y + 29;
}

function drawMeta(doc: import('jspdf').jsPDF, note: DeliveryNoteDocument, y: number): number {
  const column = (x: number, rowY: number, label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(value || '-', 55).slice(0, 2), x, rowY + 3.6);
  };

  column(MARGIN, y, 'Vendedor', note.vendor ?? '-');
  column(MARGIN + 62, y, 'Condición de pago', note.paymentTerms ?? '-');
  column(MARGIN + 124, y, 'Vence', formatDate(note.dueDate));

  const y2 = y + 10;
  column(MARGIN, y2, 'Moneda', note.currency === 'USD' ? 'Dólares (US$)' : note.currency === 'VES' ? 'Bolívares (Bs)' : note.currency);
  column(MARGIN + 62, y2, 'Tasa', note.exchangeRate ? formatNumber(note.exchangeRate, 4) : '-');
  column(MARGIN + 124, y2, 'Pedido(s) origen', note.orders.join(', ') || '-');

  return y2 + 8;
}

function drawTotals(doc: import('jspdf').jsPDF, note: DeliveryNoteDocument, y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + 36 > pageHeight - 28) {
    doc.addPage();
    drawHeader(doc, note, null, new Date(), null, true);
    y = 24;
  }

  const labelX = PAGE_WIDTH - MARGIN - 60;
  const valueX = PAGE_WIDTH - MARGIN;
  const rows: Array<[string, string]> = [
    ['Subtotal', money(note.subtotal, note.currency)],
    ['Descuento', money(note.discount, note.currency)],
    ['IVA', money(note.tax, note.currency)],
  ];

  doc.setFontSize(7.6);
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(label, labelX, y);
    doc.setTextColor(...INK);
    doc.text(value, valueX, y, { align: 'right' });
    y += 4.2;
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(labelX, y - 1.5, valueX, y - 1.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.6);
  doc.setTextColor(...INK);
  doc.text('TOTAL', labelX, y + 4);
  doc.text(money(note.total, note.currency), valueX, y + 4, { align: 'right' });

  if (note.totalLocal !== null) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`Total en Bs ${formatNumber(note.totalLocal, 2)}`, valueX, y + 8.5, { align: 'right' });
    y += 4.5;
  }

  return y + 10;
}

function drawComments(doc: import('jspdf').jsPDF, comments: string, y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + 14 > pageHeight - 24) {
    doc.addPage();
    y = 24;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...MUTED);
  doc.text('OBSERVACIONES', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(comments, CONTENT_WIDTH);
  doc.text(lines.slice(0, 4), MARGIN, y + 4);
  return y + 4 + Math.min(lines.length, 4) * 3.4;
}

function drawSignatures(
  doc: import('jspdf').jsPDF,
  note: DeliveryNoteDocument,
  y: number,
  printedAt: Date,
) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + 28 > pageHeight - 16) {
    doc.addPage();
    y = 24;
    drawFooter(doc, note, doc.getNumberOfPages(), printedAt);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    'Documento generado desde Profit. No es una factura; sirve como constancia de entrega.',
    MARGIN,
    y,
  );

  const width = (CONTENT_WIDTH - 20) / 2;
  const labels = ['Despachado por', 'Recibido por (cliente)'];
  labels.forEach((label, index) => {
    const x = MARGIN + index * (width + 20);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(x, y + 18, x + width, y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y + 22);
  });
}

function drawFooter(
  doc: import('jspdf').jsPDF,
  note: DeliveryNoteDocument,
  page: number,
  printedAt: Date,
) {
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, pageHeight - 14, PAGE_WIDTH - MARGIN, pageHeight - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(...MUTED);
  doc.text(
    `Nota de entrega ${note.number} · ${formatPrintedAt(printedAt)} · Corpoagro`,
    MARGIN,
    pageHeight - 9,
  );
  doc.text(`Página ${page}`, PAGE_WIDTH - MARGIN, pageHeight - 9, { align: 'right' });
}

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

function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '-';
  const amount = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  if (currency === 'USD') return `US$ ${amount}`;
  if (currency === 'VES') return `Bs ${amount}`;
  return `${currency} ${amount}`;
}

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
}

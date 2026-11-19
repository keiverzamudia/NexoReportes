import type {
  ForecastSellerAttribution,
  ForecastSellerClientDetailResponse,
  ForecastSellerClientProductRow,
  ForecastSellerNoteRow,
} from '@nexo/contracts';

// ============================================================
// Contexto del clic en el expediente de vendedor.
//
// El clic en un cliente no abre la ficha genérica: abre el detalle de las
// notas de ESE cliente en el mes y en la pestaña que se está viendo. Estas
// funciones puras deciden qué nota pertenece a cada vista y qué totales se
// muestran; el API entrega los dos vendedores de cada nota.
// ============================================================

export type SellerContextView = 'facturado' | 'cartera' | 'otros';

export interface SellerClientContext {
  sellerCode: string;
  sellerName: string;
  clientCode: string;
  clientName: string;
  year: number;
  month: number;
  basis: 'WORKING' | 'CALENDAR';
  includeToday: boolean;
  attribution: ForecastSellerAttribution;
  view: SellerContextView;
  /** Drill-down de Productos: acota las notas a un artículo. */
  productCode?: string | null;
  productLabel?: string | null;
}

/** El API usa este centinela en la ruta cuando la fila no tiene vendedor. */
export const NO_SELLER_PATH = '__sin_vendedor__';

export function sellerPathCode(code: string): string {
  return code.trim() || NO_SELLER_PATH;
}

export function contextViewLabel(view: SellerContextView): string {
  if (view === 'facturado') return 'Facturado por él';
  if (view === 'otros') return 'Facturado por otros';
  return 'Mi cartera';
}

export function contextViewShortLabel(view: SellerContextView): string {
  if (view === 'facturado') return 'Facturado';
  if (view === 'otros') return 'Por otros';
  return 'Cartera';
}

/**
 * ¿La nota entra en la vista activa?
 *  · Facturado: la firmó él (`noteSellerCode`).
 *  · Mi cartera: el cliente está en su cartera (`portfolioSellerCode`).
 *  · Por otros: está en su cartera y la firmó otro.
 */
export function noteInView(
  note: ForecastSellerNoteRow,
  context: Pick<SellerClientContext, 'sellerCode' | 'view'>,
): boolean {
  if (context.view === 'facturado') return note.noteSellerCode === context.sellerCode;
  if (context.view === 'otros') {
    return (
      note.portfolioSellerCode === context.sellerCode &&
      note.noteSellerCode !== context.sellerCode
    );
  }
  return note.portfolioSellerCode === context.sellerCode;
}

/** Totales del detalle ya agregados por el API, resueltos para la vista. */
export interface SellerContextSummary {
  viewKg: number;
  viewNotes: number;
  allKg: number;
  allNotes: number;
  ownKg: number;
  ownNotes: number;
  otherKg: number;
  otherNotes: number;
  otherExternalKg: number;
  otherInternalKg: number;
  lastInvoiceDate: string | null;
}

export function contextSummary(
  data: ForecastSellerClientDetailResponse,
  view: SellerContextView,
): SellerContextSummary {
  const totals = data.totals;
  const viewKg =
    view === 'facturado' ? totals.ownKg : view === 'otros' ? totals.otherKg : totals.allKg;
  const viewNotes =
    view === 'facturado' ? totals.ownNotes : view === 'otros' ? totals.otherNotes : totals.allNotes;

  return {
    viewKg,
    viewNotes,
    allKg: totals.allKg,
    allNotes: totals.allNotes,
    ownKg: totals.ownKg,
    ownNotes: totals.ownNotes,
    otherKg: totals.otherKg,
    otherNotes: totals.otherNotes,
    otherExternalKg: totals.otherExternalKg,
    otherInternalKg: totals.otherInternalKg,
    lastInvoiceDate: totals.lastInvoiceDate,
  };
}

/** Kg/notas de un producto según la vista activa. */
export function productInView(
  product: ForecastSellerClientProductRow,
  view: SellerContextView,
): { kg: number; notes: number } {
  if (view === 'facturado') return { kg: product.ownKg, notes: product.ownNotes };
  if (view === 'otros') return { kg: product.otherKg, notes: product.otherNotes };
  return { kg: product.kg, notes: product.notes };
}

/** Notas de la vista, ya filtradas y ordenadas por fecha descendente. */
export function notesInView(
  notes: ForecastSellerNoteRow[],
  context: Pick<SellerClientContext, 'sellerCode' | 'view'>,
): ForecastSellerNoteRow[] {
  return notes
    .filter((note) => noteInView(note, context))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

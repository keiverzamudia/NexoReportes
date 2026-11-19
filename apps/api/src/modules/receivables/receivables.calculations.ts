import {
  RECEIVABLES_BUCKETS,
  RECEIVABLES_BUCKET_KEYS,
  ReceivablesBucket,
  ReceivablesBucketKey,
  ReceivablesClientRow,
  ReceivablesDocumentRow,
  ReceivablesOptions,
  ReceivablesRisk,
  ReceivablesTotals,
} from '@nexo/contracts';

// ============================================================
// Cálculo puro de la cartera (sin Nest, sin SQL y sin React).
//
// Recibe los documentos crudos de `dbo.docum_cc` y los recibos agregados de
// `dbo.cobros`/`dbo.reng_cob`. Aquí se decide qué es deuda y qué es saldo a
// favor, cómo se forman los tramos y cómo se agrupa por cliente. Se prueba en
// `receivables.calculations.spec.ts`.
// ============================================================

// Mismos tipos débito que el estado de cuenta de Clientes. El resto
// (ADEL, N/CR, …) resta: son adelantos o notas de crédito.
export const DEBIT_DOCS = new Set(['FACT', 'N/DB', 'AJPM', 'GIRO']);

export type ReceivablesCurrency = 'USD' | 'BS';

export interface ReceivablesDoc {
  clienteCodigo: string;
  clienteNombre: string;
  vendedor: string;
  vendedorCodigo: string;
  vendedorCartera: string;
  vendedorCarteraCodigo: string;
  tipoCliente: string;
  tipoClienteLabel: string;
  zona: string;
  zonaLabel: string;
  segmento: string;
  segmentoLabel: string;
  limiteCredito: number | null;
  plazoPago: number | null;
  tipoDoc: string;
  nroDoc: number;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  diasVencimiento: number;
  tramo: ReceivablesBucketKey | null;
  esCredito: boolean;
  sinTasa: boolean;
  sinVencimiento: boolean;
  saldoBs: number;
  montoOriginalBs: number;
  saldoUsd: number | null;
  montoOriginalUsd: number | null;
}

export interface PaymentInfo {
  ultimoPago: string | null;
  diasSinPago: number | null;
  cobrado90Bs: number;
  cobrado90Usd: number;
  cobrado12mBs: number;
  cobrado12mUsd: number;
  cobrado12mATiempoBs: number;
  cobrado12mATiempoUsd: number;
  pagos12m: number;
  pagos12mATiempo: number;
}

export type PaymentMap = Map<string, PaymentInfo>;

type BucketAmounts = Record<ReceivablesBucketKey, number>;

interface BucketAccum {
  amounts: BucketAmounts;
}

interface ClientAccum {
  doc: ReceivablesDoc;
  cartera: number;
  aFavor: number;
  buckets: BucketAccum;
  vencido: number;
  documentos: number;
  vencidos: number;
  notasCredito: number;
  diasMaxVencido: number | null;
  vencimientoMasAntiguo: string | null;
  ultimaEmision: string | null;
}

export interface ReceivablesAggregate {
  clientes: ReceivablesClientRow[];
  totals: ReceivablesTotals;
  buckets: ReceivablesBucket[];
  risk: ReceivablesRisk;
}

const BUCKET_CLIENT_FIELD: Record<
  ReceivablesBucketKey,
  'porVencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'd91_120' | 'd121_150' | 'd150Mas'
> = {
  POR_VENCER: 'porVencer',
  D1_30: 'd1_30',
  D31_60: 'd31_60',
  D61_90: 'd61_90',
  D91_120: 'd91_120',
  D121_150: 'd121_150',
  D150_MAS: 'd150Mas',
};

export function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/** Normaliza el texto para búsquedas sin acentos ni mayúsculas. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function emptyBuckets(): BucketAccum {
  return {
    amounts: Object.fromEntries(RECEIVABLES_BUCKET_KEYS.map((key) => [key, 0])) as BucketAmounts,
  };
}

/** Tramo al que pertenece un documento según sus días de vencimiento. */
export function bucketOfDays(days: number | null | undefined): ReceivablesBucketKey {
  if (days === null || days === undefined || days <= 0) return 'POR_VENCER';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  if (days <= 120) return 'D91_120';
  if (days <= 150) return 'D121_150';
  return 'D150_MAS';
}

export function mapRawDoc(raw: Record<string, unknown>): ReceivablesDoc {
  const tipoDoc = text(raw.tipo_doc).toUpperCase();
  const saldoBs = round2(num(raw.saldo));
  const montoOriginalBs = round2(num(raw.monto_net));
  const tasa = num(raw.tasa);
  const sinTasa = !(tasa > 0);
  const diasRaw = integerOrNull(raw.dias_venc);
  const sinVencimiento = diasRaw === null;
  const diasVencimiento = diasRaw ?? 0;
  const esCredito = !DEBIT_DOCS.has(tipoDoc);
  const tipoCliente = text(raw.tipo_cli).toUpperCase();
  const tipoClienteLabel = text(raw.tipo_des) || tipoCliente;
  const zona = text(raw.co_zon);
  const zonaLabel = text(raw.zona_des) || zona;
  const segmento = text(raw.co_seg);
  const segmentoLabel = text(raw.seg_des) || segmento;

  return {
    clienteCodigo: text(raw.co_cli).toUpperCase(),
    clienteNombre: text(raw.cli_des),
    vendedor: text(raw.ven_des),
    vendedorCodigo: text(raw.co_ven),
    vendedorCartera: text(raw.ven_des_cartera),
    vendedorCarteraCodigo: text(raw.co_ven_cartera),
    tipoCliente,
    tipoClienteLabel,
    zona,
    zonaLabel,
    segmento,
    segmentoLabel,
    limiteCredito: raw.mont_cre === null || raw.mont_cre === undefined ? null : num(raw.mont_cre),
    plazoPago: integerOrNull(raw.plaz_pag),
    tipoDoc,
    nroDoc: integerOrNull(raw.nro_doc) ?? 0,
    fechaEmision: isoDate(raw.fec_emis),
    fechaVencimiento: isoDate(raw.fec_venc),
    diasVencimiento,
    tramo: esCredito ? null : bucketOfDays(diasVencimiento),
    esCredito,
    sinTasa,
    sinVencimiento,
    saldoBs,
    montoOriginalBs,
    saldoUsd: sinTasa ? null : round2(saldoBs / tasa),
    montoOriginalUsd: sinTasa ? null : round2(montoOriginalBs / tasa),
  };
}

export interface ReceivablesFilterInput {
  q?: string;
  vendedor?: string;
  tipoCliente?: string;
  zona?: string;
  tipoDoc?: string;
  desde?: string;
  hasta?: string;
  soloVencido?: boolean;
}

/**
 * Filtros de cartera. Los créditos se conservan para poder calcular el saldo
 * a favor y el neto; `incluirAFavor` solo decide si aparecen en la lista de
 * documentos. Con `soloVencido` la vista es estrictamente de mora y los
 * créditos quedan fuera.
 */
export function filterDocs(docs: ReceivablesDoc[], filters: ReceivablesFilterInput): ReceivablesDoc[] {
  const q = normalizeSearch(filters.q ?? '');
  return docs.filter((doc) => {
    if (filters.vendedor && doc.vendedorCarteraCodigo !== filters.vendedor) return false;
    if (filters.tipoCliente && doc.tipoCliente !== filters.tipoCliente) return false;
    if (filters.zona && doc.zona !== filters.zona) return false;
    if (filters.tipoDoc && doc.tipoDoc !== filters.tipoDoc) return false;
    if (filters.desde && dayOf(doc.fechaEmision) < filters.desde) return false;
    if (filters.hasta && dayOf(doc.fechaEmision) > filters.hasta) return false;
    if (filters.soloVencido && (doc.esCredito || doc.diasVencimiento <= 0)) return false;
    if (q) {
      const haystack = normalizeSearch(
        [
          doc.clienteCodigo,
          doc.clienteNombre,
          doc.vendedorCartera,
          doc.vendedor,
        ].join(' '),
      );
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function amountOf(doc: ReceivablesDoc, currency: ReceivablesCurrency): number {
  return currency === 'USD' ? doc.saldoUsd ?? 0 : doc.saldoBs;
}

function originalOf(doc: ReceivablesDoc, currency: ReceivablesCurrency): number | null {
  return currency === 'USD' ? doc.montoOriginalUsd : doc.montoOriginalBs;
}

function docToRow(doc: ReceivablesDoc, currency: ReceivablesCurrency): ReceivablesDocumentRow {
  return {
    clienteCodigo: doc.clienteCodigo,
    clienteNombre: doc.clienteNombre,
    vendedor: doc.vendedor || doc.vendedorCartera,
    vendedorCodigo: doc.vendedorCodigo || doc.vendedorCarteraCodigo,
    tipoDoc: doc.tipoDoc,
    nroDoc: doc.nroDoc,
    fechaEmision: doc.fechaEmision,
    fechaVencimiento: doc.fechaVencimiento,
    diasVencimiento: doc.diasVencimiento,
    tramo: doc.tramo,
    saldo: round2(amountOf(doc, currency)),
    montoOriginal: originalOf(doc, currency),
    esCredito: doc.esCredito,
    tipoCliente: doc.tipoCliente,
    tipoClienteLabel: doc.tipoClienteLabel,
    zona: doc.zona,
    segmento: doc.segmento,
  };
}

export function documentsForOutput(
  docs: ReceivablesDoc[],
  currency: ReceivablesCurrency,
  incluirAFavor: boolean,
): ReceivablesDocumentRow[] {
  return docs
    .filter((doc) => incluirAFavor || !doc.esCredito)
    .map((doc) => docToRow(doc, currency))
    .sort(
      (a, b) =>
        (b.esCredito ? -99999 : b.diasVencimiento) -
          (a.esCredito ? -99999 : a.diasVencimiento) ||
        a.clienteNombre.localeCompare(b.clienteNombre, 'es') ||
        a.nroDoc - b.nroDoc,
    );
}

export function aggregate(
  docs: ReceivablesDoc[],
  payments: PaymentMap,
  currency: ReceivablesCurrency,
): ReceivablesAggregate {
  const clients = new Map<string, ClientAccum>();

  for (const doc of docs) {
    const amount = amountOf(doc, currency);
    const current =
      clients.get(doc.clienteCodigo) ??
      {
        doc,
        cartera: 0,
        aFavor: 0,
        buckets: emptyBuckets(),
        vencido: 0,
        documentos: 0,
        vencidos: 0,
        notasCredito: 0,
        diasMaxVencido: null,
        vencimientoMasAntiguo: null,
        ultimaEmision: null,
      };

    if (doc.esCredito) {
      current.aFavor += amount;
      current.notasCredito += 1;
    } else {
      current.cartera += amount;
      current.documentos += 1;
      if (doc.tramo) {
        current.buckets.amounts[doc.tramo] += amount;
      }
      if (doc.diasVencimiento > 0) {
        current.vencido += amount;
        current.vencidos += 1;
      }
      if (
        doc.diasVencimiento > 0 &&
        (current.diasMaxVencido === null || doc.diasVencimiento > current.diasMaxVencido)
      ) {
        current.diasMaxVencido = doc.diasVencimiento;
      }
      if (doc.diasVencimiento > 0) {
        const due = dayOf(doc.fechaVencimiento);
        if (due && (!current.vencimientoMasAntiguo || due < current.vencimientoMasAntiguo)) {
          current.vencimientoMasAntiguo = due;
        }
      }
    }

    const emitted = dayOf(doc.fechaEmision);
    if (emitted && (!current.ultimaEmision || emitted > current.ultimaEmision)) {
      current.ultimaEmision = emitted;
    }

    clients.set(doc.clienteCodigo, current);
  }

  const rows: ReceivablesClientRow[] = [...clients.values()].map((item) => {
    const payment = payments.get(item.doc.clienteCodigo) ?? null;
    const cartera = round2(item.cartera);
    const aFavor = round2(item.aFavor);
    const vencido = round2(item.vencido);
    const pctVencido = cartera > 0 ? round2((vencido / cartera) * 100) : 0;
    const limite = item.doc.limiteCredito;
    const excedeLimite = currency === 'USD' && limite !== null && limite > 0 && cartera > limite;
    const cobrado90 =
      payment === null
        ? 0
        : round2(currency === 'USD' ? payment.cobrado90Usd : payment.cobrado90Bs);
    const cobrado12m =
      payment === null
        ? 0
        : round2(currency === 'USD' ? payment.cobrado12mUsd : payment.cobrado12mBs);
    const cobrado12mATiempo =
      payment === null
        ? 0
        : round2(
            currency === 'USD' ? payment.cobrado12mATiempoUsd : payment.cobrado12mATiempoBs,
          );
    const pctCobranzaATiempo =
      cobrado12m > 0 ? round2((cobrado12mATiempo / cobrado12m) * 100) : null;

    return {
      codigo: item.doc.clienteCodigo,
      nombre: item.doc.clienteNombre || item.doc.clienteCodigo,
      vendedor: item.doc.vendedorCartera || item.doc.vendedor || 'Sin vendedor',
      vendedorCodigo: item.doc.vendedorCarteraCodigo || item.doc.vendedorCodigo,
      tipoCliente: item.doc.tipoCliente,
      tipoClienteLabel: item.doc.tipoClienteLabel,
      zona: item.doc.zona,
      zonaLabel: item.doc.zonaLabel,
      segmento: item.doc.segmento,
      segmentoLabel: item.doc.segmentoLabel,
      limiteCredito: limite,
      plazoPago: item.doc.plazoPago,
      cartera,
      aFavor,
      neto: round2(cartera - aFavor),
      porVencer: round2(item.buckets.amounts.POR_VENCER),
      d1_30: round2(item.buckets.amounts.D1_30),
      d31_60: round2(item.buckets.amounts.D31_60),
      d61_90: round2(item.buckets.amounts.D61_90),
      d91_120: round2(item.buckets.amounts.D91_120),
      d121_150: round2(item.buckets.amounts.D121_150),
      d150Mas: round2(item.buckets.amounts.D150_MAS),
      vencido,
      pctVencido,
      documentos: item.documentos,
      vencidos: item.vencidos,
      notasCredito: item.notasCredito,
      diasMaxVencido: item.diasMaxVencido,
      vencimientoMasAntiguo: item.vencimientoMasAntiguo,
      ultimaEmision: item.ultimaEmision,
      ultimoPago: payment?.ultimoPago ?? null,
      diasSinPago: payment?.diasSinPago ?? null,
      cobrado90,
      cobrado12m,
      cobrado12mATiempo,
      pctCobranzaATiempo,
      excedeLimite,
    };
  });

  rows.sort((a, b) => b.cartera - a.cartera || a.nombre.localeCompare(b.nombre, 'es'));

  const totals = buildTotals(rows, docs, currency, payments);
  const buckets = buildBuckets(rows, docs);
  const risk = buildRisk(rows);

  return { clientes: rows, totals, buckets, risk };
}

function buildBuckets(rows: ReceivablesClientRow[], docs: ReceivablesDoc[]): ReceivablesBucket[] {
  const cartera = rows.reduce((sum, row) => sum + row.cartera, 0);
  const debitDocs = docs.filter((doc) => !doc.esCredito);
  return RECEIVABLES_BUCKETS.map((bucket) => {
    const amount = round2(rows.reduce((sum, row) => sum + row[BUCKET_CLIENT_FIELD[bucket.key]], 0));
    return {
      key: bucket.key,
      label: bucket.label,
      short: bucket.short,
      amount,
      pct: cartera > 0 ? round2((amount / cartera) * 100) : 0,
      documentos: debitDocs.filter((doc) => doc.tramo === bucket.key).length,
    };
  });
}

function buildTotals(
  rows: ReceivablesClientRow[],
  docs: ReceivablesDoc[],
  currency: ReceivablesCurrency,
  payments: PaymentMap,
): ReceivablesTotals {
  const cartera = round2(rows.reduce((sum, row) => sum + row.cartera, 0));
  const aFavor = round2(rows.reduce((sum, row) => sum + row.aFavor, 0));
  const porVencer = round2(rows.reduce((sum, row) => sum + row.porVencer, 0));
  const d1_30 = round2(rows.reduce((sum, row) => sum + row.d1_30, 0));
  const d31_60 = round2(rows.reduce((sum, row) => sum + row.d31_60, 0));
  const d61_90 = round2(rows.reduce((sum, row) => sum + row.d61_90, 0));
  const d91_120 = round2(rows.reduce((sum, row) => sum + row.d91_120, 0));
  const d121_150 = round2(rows.reduce((sum, row) => sum + row.d121_150, 0));
  const d150Mas = round2(rows.reduce((sum, row) => sum + row.d150Mas, 0));
  const vencido = round2(d1_30 + d31_60 + d61_90 + d91_120 + d121_150 + d150Mas);
  const documentos = rows.reduce((sum, row) => sum + row.documentos, 0);
  const notasCredito = rows.reduce((sum, row) => sum + row.notasCredito, 0);
  const diasMax = rows.reduce<number | null>(
    (max, row) =>
      row.diasMaxVencido === null ? max : max === null ? row.diasMaxVencido : Math.max(max, row.diasMaxVencido),
    null,
  );
  const weightedDays = docs.reduce((sum, doc) => {
    if (doc.esCredito || doc.diasVencimiento <= 0) return sum;
    const amount = currency === 'USD' ? doc.saldoUsd ?? 0 : doc.saldoBs;
    return sum + amount * doc.diasVencimiento;
  }, 0);
  const sinPago = rows.filter(
    (row) => row.cartera > 0 && (row.diasSinPago === null || row.diasSinPago > 30),
  );
  const sorted = [...rows].sort((a, b) => b.cartera - a.cartera);
  const top5 = sorted.slice(0, 5).reduce((sum, row) => sum + row.cartera, 0);
  const debtors = rows.filter((row) => row.cartera > 0).length;
  const cobrado12m = round2(rows.reduce((sum, row) => sum + row.cobrado12m, 0));
  const cobrado12mATiempo = round2(rows.reduce((sum, row) => sum + row.cobrado12mATiempo, 0));
  // Los conteos salen del mapa de cobranza de los clientes visibles, no de un
  // total global: así el KPI y la tabla siempre cuadran con los filtros.
  const pagos12m = rows.reduce((sum, row) => sum + (payments.get(row.codigo)?.pagos12m ?? 0), 0);
  const pagos12mATiempo = rows.reduce(
    (sum, row) => sum + (payments.get(row.codigo)?.pagos12mATiempo ?? 0),
    0,
  );

  return {
    cartera,
    aFavor,
    neto: round2(cartera - aFavor),
    porVencer,
    d1_30,
    d31_60,
    d61_90,
    d91_120,
    d121_150,
    d150Mas,
    vencido,
    pctVencido: cartera > 0 ? round2((vencido / cartera) * 100) : 0,
    clientes: rows.length,
    clientesConDeuda: debtors,
    clientesVencidos: rows.filter((row) => row.vencido > 0).length,
    documentos,
    documentosVencidos: rows.reduce((sum, row) => sum + row.vencidos, 0),
    notasCredito,
    diasMaxVencido: diasMax,
    diasPromedioVencido: vencido > 0 && weightedDays > 0 ? round2(weightedDays / vencido) : null,
    ticketPromedio: documentos > 0 ? round2(cartera / documentos) : null,
    concentracionTop5Pct: cartera > 0 ? round2((top5 / cartera) * 100) : 0,
    cobrado90: round2(rows.reduce((sum, row) => sum + row.cobrado90, 0)),
    cobrado12m,
    cobrado12mATiempo,
    pctCobranzaATiempo: cobrado12m > 0 ? round2((cobrado12mATiempo / cobrado12m) * 100) : null,
    pagos12m,
    pagos12mATiempo,
    clientesSinPago30: sinPago.length,
    montoSinPago30: round2(sinPago.reduce((sum, row) => sum + row.cartera, 0)),
    sinTasa: docs.filter((doc) => doc.sinTasa).length,
    sinVencimiento: docs.filter((doc) => doc.sinVencimiento).length,
  };
}

function buildRisk(rows: ReceivablesClientRow[]): ReceivablesRisk {
  const cartera = rows.reduce((sum, row) => sum + row.cartera, 0);
  const sorted = [...rows].filter((row) => row.cartera > 0).sort((a, b) => b.cartera - a.cartera);
  const top = sorted[0] ?? null;
  const top5 = sorted.slice(0, 5).reduce((sum, row) => sum + row.cartera, 0);
  const mas90 = rows.filter((row) => row.d91_120 + row.d121_150 + row.d150Mas > 0);
  const mas150 = rows.filter((row) => row.d150Mas > 0);
  const sinPago = rows.filter(
    (row) => row.cartera > 0 && (row.diasSinPago === null || row.diasSinPago > 30),
  );
  const sobreLimite = rows.filter((row) => row.excedeLimite);

  return {
    topCliente: top
      ? {
          codigo: top.codigo,
          nombre: top.nombre,
          monto: top.cartera,
          pct: cartera > 0 ? round2((top.cartera / cartera) * 100) : 0,
        }
      : null,
    top5Pct: cartera > 0 ? round2((top5 / cartera) * 100) : 0,
    clientesMas90: mas90.length,
    montoMas90: round2(mas90.reduce((sum, row) => sum + row.d91_120 + row.d121_150 + row.d150Mas, 0)),
    clientesMas150: mas150.length,
    montoMas150: round2(mas150.reduce((sum, row) => sum + row.d150Mas, 0)),
    clientesSinPago30: sinPago.length,
    montoSinPago30: round2(sinPago.reduce((sum, row) => sum + row.cartera, 0)),
    clientesSobreLimite: sobreLimite.length,
    montoSobreLimite: round2(sobreLimite.reduce((sum, row) => sum + row.cartera, 0)),
  };
}

export function optionsFromDocs(docs: ReceivablesDoc[]): ReceivablesOptions {
  const vendors = new Map<string, string>();
  const tipos = new Map<string, string>();
  const zonas = new Map<string, string>();
  const tiposDoc = new Map<string, string>();

  for (const doc of docs) {
    if (doc.vendedorCarteraCodigo) {
      vendors.set(doc.vendedorCarteraCodigo, doc.vendedorCartera || doc.vendedorCarteraCodigo);
    }
    if (doc.tipoCliente) tipos.set(doc.tipoCliente, doc.tipoClienteLabel || doc.tipoCliente);
    if (doc.zona) zonas.set(doc.zona, doc.zonaLabel || doc.zona);
    if (doc.tipoDoc) tiposDoc.set(doc.tipoDoc, doc.tipoDoc);
  }

  const toOptions = (map: Map<string, string>, withCode: boolean) =>
    [...map.entries()]
      .map(([value, label]) => ({ value, label: withCode ? `${value} · ${label}` : label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));

  return {
    vendedores: toOptions(vendors, true),
    tipos: toOptions(tipos, true),
    zonas: toOptions(zonas, true),
    tiposDoc: toOptions(tiposDoc, false),
  };
}

export function mapPayments(rows: Record<string, unknown>[]): PaymentMap {
  const map: PaymentMap = new Map();
  for (const raw of rows) {
    const code = text(raw.co_cli).toUpperCase();
    if (!code) continue;
    map.set(code, {
      ultimoPago: isoDate(raw.ultimo_pago),
      diasSinPago: integerOrNull(raw.dias_sin_pago),
      cobrado90Bs: round2(num(raw.cobrado_90_bs)),
      cobrado90Usd: round2(num(raw.cobrado_90_usd)),
      cobrado12mBs: round2(num(raw.cobrado_12m_bs)),
      cobrado12mUsd: round2(num(raw.cobrado_12m_usd)),
      cobrado12mATiempoBs: round2(num(raw.cobrado_12m_a_tiempo_bs)),
      cobrado12mATiempoUsd: round2(num(raw.cobrado_12m_a_tiempo_usd)),
      pagos12m: Math.trunc(num(raw.pagos_12m)),
      pagos12mATiempo: Math.trunc(num(raw.pagos_12m_a_tiempo)),
    });
  }
  return map;
}

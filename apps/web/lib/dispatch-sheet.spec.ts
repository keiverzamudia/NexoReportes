import { describe, expect, it } from 'vitest';
import type { DispatchSheetDetail, DispatchSheetLine, DispatchSheetSummary } from '@nexo/contracts';
import {
  buildDispatchReport,
  computeTotals,
  formatDurationBetween,
  formatMinutes,
  groupByCustomer,
  humanAge,
  lineEffectiveQty,
  minutesBetween,
  lineLoadedKg,
  lineStatusMeta,
  relativeTime,
  resolveTypedQuantity,
  sheetExport,
  sheetStatusMeta,
  sortSheets,
} from './dispatch-sheet';

// ============================================================
// Pruebas de la lógica pura del despacho (estados, avance, túnel y Excel).
// ============================================================

function line(overrides: Partial<DispatchSheetLine> = {}): DispatchSheetLine {
  return {
    id: 'l1',
    position: 1,
    orderNumber: '408251710',
    productCode: 'ABAPOR77',
    description: 'POLLO ENGORDE 35KG',
    uom: 'SAC',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    warehouseCode: 'Stock 03',
    effectiveDate: '2026-10-21',
    plannedQty: 60,
    plannedKg: 2400,
    loadedQty: null,
    loadedKg: null,
    status: 'PENDIENTE',
    note: null,
    checkedAt: null,
    checkedByName: null,
    removedAt: null,
    removedByName: null,
    removalReason: null,
    removalSource: null,
    loadStartedAt: null,
    loadClosedAt: null,
    loadClosedByName: null,
    ...overrides,
  };
}

function summary(overrides: Partial<DispatchSheetSummary> = {}): DispatchSheetSummary {
  return {
    id: 's1',
    number: 'DSP-2026-0001',
    title: 'Despacho lunes',
    status: 'ENVIADO',
    instructions: null,
    assignedToId: null,
    assignedToName: null,
    assignedRole: 'ALMACEN',
    claimedById: null,
    claimedByName: null,
    claimedAt: null,
    createdById: 'u-plan',
    createdByName: 'KEIBER ZAMUDIA',
    createdByCode: 'KZ',
    sentAt: '2026-10-21T15:00:00.000Z',
    receivedAt: null,
    receivedByName: null,
    startedAt: null,
    completedAt: null,
    completedByName: null,
    canceledAt: null,
    canceledByName: null,
    cancelReason: null,
    annulledLines: 0,
    plannedLines: 2,
    plannedOrders: 2,
    pendingOrders: 2,
    plannedSacks: 70,
    plannedKg: 2800,
    loadedSacks: 0,
    loadedKg: 0,
    differenceKg: 0,
    linesDone: 0,
    progress: 0,
    customers: ['AGRICOLA LA CAÑADA'],
    nextDeliveryDate: '2026-10-21',
    updatedAt: '2026-10-21T15:00:00.000Z',
    loadStartedAt: null,
    loadClosedAt: null,
    invoiceDeliveredAt: null,
    pendingInvoiceCustomers: 0,
    totalCustomers: 1,
    closedCustomers: 0,
    invoicedCustomers: 0,
    canOperate: true,
    canCancel: true,
    canInvoice: true,
    ...overrides,
  };
}

describe('estados y lenguaje de planta', () => {
  it('traduce los estados del servidor a etiquetas operativas', () => {
    expect(sheetStatusMeta('ENVIADO')).toMatchObject({ label: 'Pendiente', tone: 'warning' });
    expect(sheetStatusMeta('DESPACHADO')).toMatchObject({ label: 'Despachado', tone: 'success' });
    expect(sheetStatusMeta('CON_NOVEDAD').tone).toBe('danger');
  });

  it('nombra las marcas actuales de carga', () => {
    expect(lineStatusMeta('PENDIENTE')).toMatchObject({ label: 'Pendiente', tone: 'muted' });
    expect(lineStatusMeta('CARGADO')).toMatchObject({ label: 'Cargado', tone: 'success' });
    expect(lineStatusMeta('FALTANTE')).toMatchObject({ label: 'No cargado', tone: 'danger' });
    expect(lineStatusMeta('PARCIAL')).toMatchObject({ label: 'Parcial', tone: 'warning' });
  });

  it('formatea el tiempo relativo en lenguaje humano', () => {
    const now = new Date('2026-10-21T16:00:00.000Z');
    expect(relativeTime('2026-10-21T15:59:30.000Z', now)).toBe('ahora');
    expect(relativeTime('2026-10-21T15:48:00.000Z', now)).toBe('hace 12 min');
    expect(relativeTime('2026-10-21T14:00:00.000Z', now)).toBe('hace 2 h');
    expect(relativeTime('2026-10-20T16:00:00.000Z', now)).toBe('ayer');
    expect(relativeTime('2026-10-18T16:00:00.000Z', now)).toBe('hace 3 días');
  });

  it('expresa la edad de un dato en segundos (frescura de la sincronización)', () => {
    expect(humanAge(null)).toBe('nunca');
    expect(humanAge(0)).toBe('ahora');
    expect(humanAge(45)).toBe('ahora');
    expect(humanAge(120)).toBe('hace 2 min');
    expect(humanAge(3600)).toBe('hace 1 h');
    expect(humanAge(86_400)).toBe('hace 1 día');
    expect(humanAge(259_200)).toBe('hace 3 días');
  });

  it('formatea los tiempos de carga y factura', () => {
    expect(minutesBetween('2026-10-21T15:00:00.000Z', '2026-10-21T15:42:00.000Z')).toBe(42);
    expect(minutesBetween(null, '2026-10-21T15:42:00.000Z')).toBeNull();
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(42)).toBe('42 min');
    expect(formatMinutes(195)).toBe('3 h 15 min');
    expect(formatMinutes(1500)).toBe('1 d 1 h');
    expect(formatDurationBetween('2026-10-21T15:00:00.000Z', '2026-10-21T17:30:00.000Z')).toBe('2 h 30 min');
  });
});

describe('carga y avance', () => {
  it('deriva los kg del ratio cuando el servidor no los guardó', () => {
    expect(lineLoadedKg(line({ loadedQty: 40 }))).toBe(1600);
    expect(lineLoadedKg(line({ loadedQty: 40, loadedKg: 1234 }))).toBe(1234);
    expect(lineLoadedKg(line({ loadedQty: null }))).toBe(0);
  });

  it('interpreta la cantidad digitada como completa, parcial o no cargada', () => {
    // Igual al plan → cargado.
    expect(resolveTypedQuantity(900, '900')).toEqual({ kind: 'FULL' });
    // Baja del plan → parcial con esa cantidad.
    expect(resolveTypedQuantity(900, '850')).toEqual({ kind: 'PARTIAL', loadedQty: 850 });
    expect(resolveTypedQuantity(900, '17,5')).toEqual({ kind: 'PARTIAL', loadedQty: 17.5 });
    // Cero → no cargado.
    expect(resolveTypedQuantity(900, '0')).toEqual({ kind: 'MISSING' });
    // Vacío o inválido no toca la marca.
    expect(resolveTypedQuantity(900, '')).toEqual({ kind: 'UNCHANGED' });
    expect(resolveTypedQuantity(900, '   ')).toEqual({ kind: 'UNCHANGED' });
    expect(resolveTypedQuantity(900, 'abc')).toEqual({ kind: 'UNCHANGED' });
    // No se permite cargar más que el plan.
    expect(resolveTypedQuantity(900, '1200')).toEqual({ kind: 'FULL' });
    // Decimales de KG se conservan con dos cifras.
    expect(resolveTypedQuantity(100, '66.666')).toEqual({ kind: 'PARTIAL', loadedQty: 66.67 });
  });

  it('muestra en el input la cantidad efectiva del renglón', () => {
    expect(lineEffectiveQty(line({ status: 'PENDIENTE' }))).toBe(60);
    expect(lineEffectiveQty(line({ status: 'CARGADO', loadedQty: 60 }))).toBe(60);
    expect(lineEffectiveQty(line({ status: 'PARCIAL', loadedQty: 24 }))).toBe(24);
    expect(lineEffectiveQty(line({ status: 'FALTANTE', loadedQty: 0 }))).toBe(0);
  });

  it('acumula planificado, cargado y diferencia con los renglones completados', () => {
    const totals = computeTotals([
      line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
      line({
        id: 'b',
        productCode: 'ABABOV85',
        plannedQty: 10,
        plannedKg: 400,
        status: 'CARGADO',
        loadedQty: 10,
        loadedKg: 400,
      }),
      line({ id: 'c', productCode: 'ABAGRA', plannedQty: 100, plannedKg: 100, uom: 'KG', status: 'PENDIENTE' }),
      // No cargado: resuelve el renglón y pesa en la diferencia.
      line({ id: 'd', productCode: 'ABAFAL', plannedQty: 20, plannedKg: 400, status: 'FALTANTE', loadedQty: 0, loadedKg: 0 }),
    ]);

    expect(totals.lines).toBe(4);
    expect(totals.done).toBe(3);
    expect(totals.progress).toBeCloseTo(3 / 4, 5);
    expect(totals.loaded).toBe(2);
    expect(totals.partial).toBe(0);
    expect(totals.missing).toBe(1);
    expect(totals.plannedSacks).toBe(90);
    expect(totals.plannedKg).toBe(3300);
    expect(totals.loadedSacks).toBe(70);
    expect(totals.loadedKg).toBe(2800);
    // Solo los renglones marcados entran en la diferencia (2400 + 400 + 400 = 3200).
    expect(totals.differenceKg).toBe(-400);
  });

  it('cuenta el parcial como resuelto y calcula su diferencia real', () => {
    const totals = computeTotals([
      line({ id: 'a', status: 'PARCIAL', loadedQty: 24, loadedKg: 960 }),
      line({ id: 'b', productCode: 'ABABOV85', plannedQty: 10, plannedKg: 400, status: 'CARGADO', loadedQty: 10, loadedKg: 400 }),
    ]);

    expect(totals.done).toBe(2);
    expect(totals.loaded).toBe(1);
    expect(totals.partial).toBe(1);
    expect(totals.missing).toBe(0);
    expect(totals.loadedSacks).toBe(34);
    expect(totals.loadedKg).toBe(1360);
    // 1360 reales contra 2800 planificados.
    expect(totals.differenceKg).toBe(-1440);
  });

  it('agrupa por cliente con pendientes y completados', () => {
    const groups = groupByCustomer([
      line({ id: 'a' }),
      line({ id: 'b', customerCode: 'X', customerName: 'OTRO CLIENTE', status: 'CARGADO', loadedQty: 60 }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(['AGRICOLA LA CAÑADA', 'OTRO CLIENTE']);
    expect(groups[0]!.pendingLines).toBe(1);
    expect(groups[0]!.completedLines).toBe(0);
    expect(groups[1]!.pendingLines).toBe(0);
    expect(groups[1]!.completedLines).toBe(1);
  });

  it('excluye los renglones anulados de totales y agrupación activa', () => {
    const lines = [
      line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
      line({
        id: 'b',
        productCode: 'ABABOV85',
        plannedQty: 10,
        plannedKg: 400,
        status: 'ANULADO',
        removedAt: '2026-10-22T13:00:00.000Z',
        removedByName: 'KEIBER ZAMUDIA',
        removalReason: 'RETIRADO_DEL_PLAN',
        removalSource: 'PLAN',
      }),
    ];
    const totals = computeTotals(lines);
    expect(totals.lines).toBe(1);
    expect(totals.done).toBe(1);
    expect(totals.plannedKg).toBe(2400);
    expect(totals.loadedKg).toBe(2400);

    const groups = groupByCustomer(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toHaveLength(1);
    expect(groups[0]!.lines[0]!.id).toBe('a');
  });

  it('arma el reporte completo de la hoja con cargados, parciales, no cargados y pendientes', () => {
    const report = buildDispatchReport([
      line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
      line({
        id: 'b',
        productCode: 'ABABOV85',
        plannedQty: 10,
        plannedKg: 400,
        status: 'PARCIAL',
        loadedQty: 4,
        loadedKg: 160,
        note: 'Solo había 4',
      }),
      line({
        id: 'c',
        productCode: 'ABAFAL',
        plannedQty: 20,
        plannedKg: 400,
        status: 'FALTANTE',
        loadedQty: 0,
        loadedKg: 0,
        note: 'No llegó',
      }),
      line({ id: 'd', productCode: 'ABAGRA', plannedQty: 5, plannedKg: 100, uom: 'KG' }),
    ]);

    expect(report.completed).toMatchObject({ lines: 1, sacks: 60, kg: 2400 });
    expect(report.partial).toMatchObject({ lines: 1, sacks: 10, kg: 400 });
    expect(report.missing).toMatchObject({ lines: 1, sacks: 20, kg: 400 });
    expect(report.pending).toMatchObject({ lines: 1, sacks: 0, kg: 100 });
    expect(report.totals.done).toBe(3);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]!.lines).toHaveLength(4);
    expect(report.groups[0]!.partialLines).toBe(1);
    expect(report.groups[0]!.missingLines).toBe(1);
    expect(report.groups[0]!.pendingLines).toBe(1);
  });
});

describe('bandeja', () => {
  it('ordena lo que nadie ha abierto primero y luego por entrega', () => {
    const rows = [
      summary({ id: 'd', status: 'DESPACHADO' }),
      summary({ id: 'b', status: 'EN_PROCESO', nextDeliveryDate: '2026-10-23' }),
      summary({ id: 'a', status: 'ENVIADO', nextDeliveryDate: '2026-10-22' }),
      summary({ id: 'c', status: 'ENVIADO', nextDeliveryDate: '2026-10-21' }),
    ];
    expect(sortSheets(rows).map((row) => row.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('hoja exportable', () => {
  it('arma el Excel con metadatos, renglones y totales', () => {
    const detail: DispatchSheetDetail = {
      ...summary({ status: 'EN_PROCESO', receivedAt: '2026-10-21T15:02:00.000Z' }),
      loadPlan: null,
      lines: [
        line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
        line({
          id: 'b',
          productCode: 'ABABOV85',
          plannedQty: 10,
          plannedKg: 400,
          status: 'CARGADO',
          loadedQty: 10,
          loadedKg: 400,
        }),
      ],
      events: [],
      customerProgress: [],
    };
    const exported = sheetExport(detail, new Date('2026-10-21T18:00:00.000Z'));

    expect(exported.sheetName).toBe('Despacho DSP-2026-0001');
    expect(exported.aoa[0]![0]).toContain('HOJA DE DESPACHO DSP-2026-0001');
    const metaRow = exported.aoa.findIndex((row) => String(row[0] ?? '').startsWith('Publicado'));
    expect(metaRow).toBeGreaterThan(0);
    const headerRow = exported.aoa.findIndex((row) => row[0] === 'Turno');
    expect(headerRow).toBeGreaterThan(metaRow);
    expect(exported.aoa[headerRow]).toEqual(expect.arrayContaining(['Pedido', 'Cargado']));

    const dataRows = exported.aoa.slice(headerRow + 1, headerRow + 3);
    expect(dataRows[0]![10]).toBe(60);
    expect(dataRows[1]![12]).toBe('Cargado');

    const totalLine = exported.aoa.at(-2)![0] as string;
    // Cargado 2.800 kg contra 2.800 kg completados → sin diferencia.
    expect(totalLine).toContain('diferencia 0 kg');
    expect(exported.merges.length).toBeGreaterThanOrEqual(4);
    expect(exported.widths).toHaveLength(20);
  });
});

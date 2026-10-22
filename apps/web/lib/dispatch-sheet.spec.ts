import { describe, expect, it } from 'vitest';
import type { DispatchSheetDetail, DispatchSheetLine, DispatchSheetSummary } from '@nexo/contracts';
import {
  computeTotals,
  groupByCustomer,
  humanAge,
  lineLoadedKg,
  lineStatusFrom,
  relativeTime,
  sheetExport,
  sheetStatusMeta,
  sortSheets,
  timelineSteps,
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
    plannedLines: 2,
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
    canOperate: true,
    canCancel: true,
    ...overrides,
  };
}

describe('estados y lenguaje de planta', () => {
  it('traduce los estados del servidor a etiquetas operativas', () => {
    expect(sheetStatusMeta('ENVIADO')).toMatchObject({ label: 'Sin abrir', tone: 'warning' });
    expect(sheetStatusMeta('DESPACHADO')).toMatchObject({ label: 'Despachado', tone: 'success' });
    expect(sheetStatusMeta('CON_NOVEDAD').tone).toBe('danger');
  });

  it('sugiere el estado del renglón según lo cargado', () => {
    expect(lineStatusFrom(0, 60)).toBe('FALTANTE');
    expect(lineStatusFrom(40, 60)).toBe('PARCIAL');
    expect(lineStatusFrom(60, 60)).toBe('CARGADO');
    expect(lineStatusFrom(61, 60)).toBe('CARGADO');
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
});

describe('carga y avance', () => {
  it('deriva los kg del ratio cuando el servidor no los guardó', () => {
    expect(lineLoadedKg(line({ loadedQty: 40 }))).toBe(1600);
    expect(lineLoadedKg(line({ loadedQty: 40, loadedKg: 1234 }))).toBe(1234);
    expect(lineLoadedKg(line({ loadedQty: null }))).toBe(0);
  });

  it('acumula planificado, cargado y diferencia solo con lo confirmado', () => {
    const totals = computeTotals([
      line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
      line({ id: 'b', productCode: 'ABABOV85', plannedQty: 10, plannedKg: 400, status: 'PARCIAL', loadedQty: 8, loadedKg: 320 }),
      line({ id: 'c', productCode: 'ABAGRA', plannedQty: 100, plannedKg: 100, uom: 'KG', status: 'PENDIENTE' }),
    ]);

    expect(totals.lines).toBe(3);
    expect(totals.done).toBe(2);
    expect(totals.progress).toBeCloseTo(2 / 3, 5);
    expect(totals.plannedSacks).toBe(70);
    expect(totals.plannedKg).toBe(2900);
    expect(totals.loadedSacks).toBe(68);
    expect(totals.loadedKg).toBe(2720);
    // Solo los renglones confirmados entran en la diferencia (2400 + 400 = 2800).
    expect(totals.differenceKg).toBe(-80);
  });

  it('agrupa por cliente con pendientes', () => {
    const groups = groupByCustomer([
      line({ id: 'a' }),
      line({ id: 'b', customerCode: 'X', customerName: 'OTRO CLIENTE', status: 'CARGADO', loadedQty: 60 }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(['AGRICOLA LA CAÑADA', 'OTRO CLIENTE']);
    expect(groups[0]!.pendingLines).toBe(1);
    expect(groups[1]!.pendingLines).toBe(0);
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

describe('cinta de acuses (túnel)', () => {
  it('marca lo hecho, el paso actual y lo que falta', () => {
    const steps = timelineSteps(
      summary({
        status: 'EN_PROCESO',
        receivedAt: '2026-10-21T15:02:00.000Z',
        receivedByName: 'ALEXIS RIVAS',
        startedAt: '2026-10-21T15:05:00.000Z',
      }),
    );
    // El próximo paso esperado (el cierre) queda resaltado como «actual».
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(steps[1]!.by).toBe('ALEXIS RIVAS');
    expect(steps[3]!.at).toBeNull();
  });

  it('marca el siguiente paso como actual cuando aún no ocurre', () => {
    const steps = timelineSteps(summary({ status: 'ENVIADO' }));
    expect(steps.map((step) => step.state)).toEqual(['done', 'current', 'todo', 'todo']);
  });

  it('si se anula, la cinta lo muestra en lugar del cierre', () => {
    const steps = timelineSteps(summary({ status: 'CANCELADO', canceledAt: '2026-10-21T17:00:00.000Z' }));
    expect(steps.map((step) => step.key)).toEqual(['ENVIADO', 'CANCELADO']);
    expect(steps[1]!.state).toBe('canceled');
  });
});

describe('hoja exportable', () => {
  it('arma el Excel con metadatos, renglones y totales', () => {
    const detail: DispatchSheetDetail = {
      ...summary({ status: 'EN_PROCESO', receivedAt: '2026-10-21T15:02:00.000Z' }),
      lines: [
        line({ id: 'a', status: 'CARGADO', loadedQty: 60, loadedKg: 2400 }),
        line({ id: 'b', productCode: 'ABABOV85', plannedQty: 10, plannedKg: 400, status: 'FALTANTE', loadedQty: 0, loadedKg: 0 }),
      ],
      events: [],
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
    expect(dataRows[1]![12]).toBe('Faltante');

    const totalLine = exported.aoa.at(-2)![0] as string;
    // Cargado 2.400 kg contra 2.800 kg confirmados → −400 kg.
    expect(totalLine).toContain('diferencia -400 kg');
    expect(exported.merges.length).toBeGreaterThanOrEqual(4);
    expect(exported.widths).toHaveLength(14);
  });
});

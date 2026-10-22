import { describe, expect, it } from 'vitest';
import type { OrderGroup, OrderGroupLine } from '@nexo/contracts';
import type { QueueEntry } from './dispatch';
import {
  buildLiveLines,
  buildSnapshot,
  diffScenario,
  recipeFromState,
  refsFromSelection,
  resolveSelection,
  restoreLogParts,
  restoreSummaryFromDiff,
  scenarioQueryString,
  scenarioRefKey,
  toDispatchInputs,
  totalsForEntries,
} from './scenario';

// ============================================================
// Pruebas del motor puro de escenarios (receta, foto y diff).
// ============================================================

function line(overrides: Partial<OrderGroupLine> = {}): OrderGroupLine {
  return {
    orderId: 'o1',
    orderNumber: '408251710',
    customerCode: '294201237',
    customerName: 'AGRICOLA LA CAÑADA',
    requestedDate: '2026-10-20T00:00:00.000Z',
    tentativeDate: null,
    authorized: true,
    productCode: 'ABAPOR77',
    description: 'POLLO ENGORDE 35KG',
    uom: 'SAC',
    quantity: 10,
    pendingQty: 10,
    pendingKg: 350,
    warehouseCode: 'Stock 03',
    stock03: 500,
    stock9999: 0,
    stock68: 0,
    ...overrides,
  };
}

function group(lines: OrderGroupLine[]): OrderGroup {
  return {
    key: '294201237',
    code: '294201237',
    label: 'AGRICOLA LA CAÑADA',
    ordersCount: 1,
    linesCount: lines.length,
    totalPendingQty: lines.reduce((sum, item) => sum + item.pendingQty, 0),
    totalPendingKg: 0,
    itemsCount: lines.length,
    lines,
  };
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    key: 'o1#ABAPOR77',
    selected: true,
    pendingQty: 10,
    pendingKg: 350,
    assignedQty: 10,
    missingQty: 0,
    assignedKg: 350,
    missingKg: 0,
    dispatchable: true,
    productRemaining: 490,
    priority: 1,
    sortIndex: 0,
    ...overrides,
  };
}

const state = {
  by: 'cliente' as const,
  mode: 'disponible' as const,
  sort: 'cobertura' as const,
  q: '  la cañada  ',
  status: '' as const,
  customerType: '',
  vendor: '',
  authorized: '' as const,
  customerCode: '',
  emisionDesde: '',
  emisionHasta: '',
  entregaDesde: '',
  entregaHasta: '',
};

describe('receta y query de la cartera', () => {
  it('arma la receta con los filtros de la pantalla', () => {
    const recipe = recipeFromState(state);
    expect(recipe.by).toBe('cliente');
    expect(recipe.mode).toBe('disponible');
    expect(recipe.filters.q).toBe('  la cañada  ');
  });

  it('reproduce el query string de /orders/grouped recortando espacios', () => {
    const query = new URLSearchParams(scenarioQueryString(recipeFromState(state)));
    expect(query.get('by')).toBe('cliente');
    expect(query.get('q')).toBe('la cañada');
    expect(query.has('status')).toBe(false);
  });
});

describe('selección ↔ renglones', () => {
  const lineByKey = new Map([[`${'o1'}#ABAPOR77`, { line: line() }]]);

  it('guarda referencias por pedido#artículo, sin duplicar', () => {
    const refs = refsFromSelection(['o1#ABAPOR77', 'o1#ABAPOR77', 'inexistente'], lineByKey);
    expect(refs).toEqual([{ orderNumber: '408251710', productCode: 'ABAPOR77' }]);
  });

  it('resuelve los renglones vivos y omite los que ya no están', () => {
    const live = buildLiveLines([group([line()])]);
    const keys = resolveSelection(
      [
        { orderNumber: '408251710', productCode: 'ABAPOR77' },
        { orderNumber: '999999', productCode: 'NOEXISTE' },
      ],
      live,
    );
    expect(keys).toEqual(['o1#ABAPOR77']);
    expect(live.has(scenarioRefKey('408251710', 'ABAPOR77'))).toBe(true);
  });

  it('la fecha efectiva del renglón prefiere la tentativa', () => {
    const live = buildLiveLines([group([line({ tentativeDate: '2026-10-27T00:00:00.000Z' })])]);
    expect(live.get('408251710#ABAPOR77')!.effectiveDate).toBe('2026-10-27');
  });

  it('convierte los grupos en la entrada del motor de despacho', () => {
    const inputs = toDispatchInputs([group([line()])]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      key: 'o1#ABAPOR77',
      productCode: 'ABAPOR77',
      stockTotal: 500,
      orderNumber: '408251710',
    });
  });
});

describe('foto del plan', () => {
  it('calcula totales y normaliza la fecha de entrega', () => {
    const snapshot = buildSnapshot({
      entries: [entry()],
      lineByKey: new Map([['o1#ABAPOR77', { line: line() }]]),
      carteraLines: 31,
      takenAt: new Date('2026-10-18T13:12:00.000Z'),
    });

    expect(snapshot.carteraLines).toBe(31);
    expect(snapshot.takenAt).toBe('2026-10-18T13:12:00.000Z');
    expect(snapshot.totals).toMatchObject({ lines: 1, sacks: 10, assignedKg: 350, missingKg: 0, coverage: 1 });
    expect(snapshot.lines[0]!.effectiveDate).toBe('2026-10-20');
    expect(snapshot.lines[0]!.stockTotal).toBe(500);
  });

  it('ordena la foto por turno y solo cuenta sacos de artículos SAC', () => {
    const sack = entry();
    const bulk = entry({ key: 'o1#AGRANEL', assignedQty: 900, assignedKg: 900, priority: 2 });
    const snapshot = buildSnapshot({
      entries: [bulk, sack],
      lineByKey: new Map([
        ['o1#ABAPOR77', { line: line() }],
        ['o1#AGRANEL', { line: line({ orderId: 'o1', productCode: 'AGRANEL', uom: 'KG' }) }],
      ]),
      carteraLines: 2,
      takenAt: new Date(),
    });
    expect(snapshot.lines.map((item) => item.productCode)).toEqual(['ABAPOR77', 'AGRANEL']);
    expect(snapshot.totals.sacks).toBe(10);
    expect(snapshot.totals.assignedKg).toBe(1250);
  });

  it('los totales del plan recalculado usan la misma fórmula que la foto', () => {
    const totals = totalsForEntries([entry(), entry({ key: 'b', assignedQty: 0, assignedKg: 0, missingQty: 10, missingKg: 350 })], 10);
    expect(totals).toMatchObject({ lines: 2, sacks: 10, assignedKg: 350, missingKg: 350 });
    expect(totals.coverage).toBeCloseTo(0.5, 5);
  });
});

describe('historial de restauraciones', () => {
  it('resume el diff para guardarlo en el historial', () => {
    const snapshot = buildSnapshot({
      entries: [entry()],
      lineByKey: new Map([['o1#ABAPOR77', { line: line() }]]),
      carteraLines: 31,
      takenAt: new Date('2026-10-18T13:12:00.000Z'),
    });
    const live = buildLiveLines([
      group([line({ pendingQty: 15, tentativeDate: '2026-10-27T00:00:00.000Z', stock03: 300 })]),
    ]);
    const after = totalsForEntries([entry({ assignedQty: 15, assignedKg: 525 })], 15);
    const drift = diffScenario(snapshot, live, { after, carteraAfter: 35 });

    const summary = restoreSummaryFromDiff(drift, 1);

    expect(summary).toMatchObject({
      restored: 1,
      missing: 0,
      pendingChanges: 1,
      stockChanges: 1,
      dateChanges: 1,
      carteraBefore: 31,
      carteraAfter: 35,
      beforeKg: 350,
      afterKg: 525,
    });
    expect(summary.beforeCoverage).toBeCloseTo(1, 5);
  });

  it('arma el texto de cada entrada del historial', () => {
    const log = {
      id: 'r1',
      restoredAt: '2026-10-21T15:44:00.000Z',
      restoredById: 'u1',
      restoredByName: 'KEIBER ZAMUDIA',
      restored: 42,
      missing: 3,
      pendingChanges: 8,
      stockChanges: 2,
      dateChanges: 1,
      carteraBefore: 120,
      carteraAfter: 135,
      beforeKg: 42500,
      afterKg: 41200,
      beforeCoverage: 0.96,
      afterCoverage: 0.92,
    };
    const parts = restoreLogParts(log, new Date('2026-10-21T16:00:00.000Z'));

    expect(parts.author).toBe('KEIBER ZAMUDIA');
    expect(parts.when).toBe('hace 16 min');
    expect(parts.lines).toBe('42/45 renglones');
    expect(parts.kg).toBe('42.500 → 41.200 kg');
    expect(parts.coverage).toBe('96% → 92%');
    expect(parts.changes).toEqual([
      '3 fuera de cartera',
      '8 pendiente(s)',
      '2 existencia(s)',
      '1 fecha(s)',
      'cartera 120 → 135',
    ]);
  });

  it('una restauración sin diferencias no inventa cambios', () => {
    const parts = restoreLogParts(
      {
        id: 'r2',
        restoredAt: '2026-10-21T15:00:00.000Z',
        restoredById: null,
        restoredByName: null,
        restored: 45,
        missing: 0,
        pendingChanges: 0,
        stockChanges: 0,
        dateChanges: 0,
        carteraBefore: 120,
        carteraAfter: 120,
        beforeKg: 40000,
        afterKg: 40000,
        beforeCoverage: 1,
        afterCoverage: 1,
      },
      new Date('2026-10-21T15:05:00.000Z'),
    );
    expect(parts.author).toBe('Alguien');
    expect(parts.changes).toEqual([]);
    expect(parts.coverage).toBe('100% → 100%');
  });
});

describe('diff contra los datos de hoy', () => {
  const snapshot = buildSnapshot({
    entries: [entry()],
    lineByKey: new Map([['o1#ABAPOR77', { line: line() }]]),
    carteraLines: 31,
    takenAt: new Date('2026-10-18T13:12:00.000Z'),
  });

  it('sin cambios no reporta nada', () => {
    const live = buildLiveLines([group([line()])]);
    const drift = diffScenario(snapshot, live, { after: snapshot.totals, carteraAfter: 31 });
    expect(drift.hasChanges).toBe(false);
    expect(drift.missing).toHaveLength(0);
  });

  it('detecta stock, pendiente y fecha distintos', () => {
    const live = buildLiveLines([
      group([
        line({
          pendingQty: 15,
          pendingKg: 525,
          tentativeDate: '2026-10-27T00:00:00.000Z',
          stock03: 300,
        }),
      ]),
    ]);
    const drift = diffScenario(snapshot, live, { after: snapshot.totals, carteraAfter: 40 });

    expect(drift.pendingChanges).toHaveLength(1);
    expect(drift.pendingChanges[0]!.after).toBe(15);
    expect(drift.stockChanges).toHaveLength(1);
    expect(drift.stockChanges[0]).toMatchObject({ productCode: 'ABAPOR77', before: 500, after: 300 });
    expect(drift.dateChanges).toHaveLength(1);
    expect(drift.dateChanges[0]!.after).toBe('2026-10-27');
    expect(drift.carteraAfter).toBe(40);
    expect(drift.hasChanges).toBe(true);
  });

  it('marca los renglones que ya no están en la cartera', () => {
    const drift = diffScenario(snapshot, new Map(), { after: totalsForEntries([], 0), carteraAfter: 12 });
    expect(drift.missing).toHaveLength(1);
    expect(drift.missing[0]!.orderNumber).toBe('408251710');
    expect(drift.hasChanges).toBe(true);
  });

  it('un escenario sin foto (borrador) no genera diff', () => {
    const drift = diffScenario(null, buildLiveLines([group([line()])]), { after: snapshot.totals, carteraAfter: 31 });
    expect(drift.hasChanges).toBe(false);
  });
});

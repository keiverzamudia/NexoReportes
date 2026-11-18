import { describe, expect, it } from 'vitest';
import { allocateGapByHeadroom } from './sellers-gap-plan';

// ============================================================
// Plan de cierre: solo reparte margen real y nunca inventa kg.
// ============================================================

function headroomOf(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

function sumOf(map: Map<string, number>): number {
  return [...map.values()].reduce((acc, value) => acc + value, 0);
}

describe('allocateGapByHeadroom', () => {
  it('reparte la brecha proporcional a la capacidad y cuadra al kilo', () => {
    const result = allocateGapByHeadroom(headroomOf({ A: 300, B: 100 }), 200);

    expect(result.gapKg).toBe(200);
    expect(result.coveredKg).toBe(200);
    expect(result.uncoveredKg).toBe(0);
    expect(result.plan.get('A')).toBe(150);
    expect(result.plan.get('B')).toBe(50);
    expect(sumOf(result.plan)).toBe(200);
  });

  it('nunca pide más que el margen real del cliente', () => {
    const result = allocateGapByHeadroom(headroomOf({ A: 300, B: 100 }), 1000);

    expect(result.coveredKg).toBe(400);
    expect(result.uncoveredKg).toBe(600);
    expect(result.plan.get('A')).toBe(300);
    expect(result.plan.get('B')).toBe(100);
  });

  it('sin margen deja la brecha sin cubrir', () => {
    const result = allocateGapByHeadroom(headroomOf({ A: 0, B: -50 }), 120);

    expect(result.coveredKg).toBe(0);
    expect(result.uncoveredKg).toBe(120);
    expect(result.plan.get('A')).toBe(0);
    expect(result.plan.get('B')).toBe(0);
  });

  it('sin brecha no asigna nada', () => {
    const result = allocateGapByHeadroom(headroomOf({ A: 500 }), 0);

    expect(result.coveredKg).toBe(0);
    expect(result.uncoveredKg).toBe(0);
    expect(result.plan.get('A')).toBe(0);
  });

  it('reparte el residuo de redondeo sin pasarse de la brecha', () => {
    const result = allocateGapByHeadroom(headroomOf({ A: 1, B: 1, C: 1 }), 100);

    expect(result.coveredKg).toBe(3);
    expect(result.uncoveredKg).toBe(97);
    expect(sumOf(result.plan)).toBe(3);
  });

  it('sin claves devuelve la brecha completa como no cubierta', () => {
    const result = allocateGapByHeadroom(new Map(), 55.5);

    expect(result.plan.size).toBe(0);
    expect(result.coveredKg).toBe(0);
    expect(result.uncoveredKg).toBe(55.5);
  });
});

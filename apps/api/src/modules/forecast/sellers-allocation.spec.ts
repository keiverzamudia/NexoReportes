import { describe, expect, it } from 'vitest';
import { allocateByWeight, sharePct } from './sellers-allocation';

// ============================================================
// Reparto de la meta: proporcional, exacto y sin NaN.
// ============================================================

function sum(values: Map<string, number>): number {
  return Math.round([...values.values()].reduce((acc, value) => acc + value, 0) * 10) / 10;
}

describe('allocateByWeight', () => {
  it('reparte proporcionalmente al peso histórico', () => {
    const result = allocateByWeight(
      new Map([
        ['A', 60],
        ['B', 40],
      ]),
      1_000_000,
    );
    expect(result.get('A')).toBe(600_000);
    expect(result.get('B')).toBe(400_000);
  });

  it('suma EXACTAMENTE el total con residuo de redondeo', () => {
    const result = allocateByWeight(
      new Map([
        ['A', 1],
        ['B', 1],
        ['C', 1],
      ]),
      100,
    );
    expect(sum(result)).toBe(100);
    // El residuo se lo queda la primera clave con el mayor peso (empate).
    expect([...result.values()].sort((a, b) => a - b)).toEqual([33.3, 33.3, 33.4]);
  });

  it('reparte en partes iguales cuando no hay histórico y se pide el respaldo', () => {
    const result = allocateByWeight(
      new Map([
        ['A', 0],
        ['B', 0],
        ['C', 0],
      ]),
      90,
      { equalWhenEmpty: true },
    );
    expect(sum(result)).toBe(90);
    expect([...result.values()]).toEqual([30, 30, 30]);
  });

  it('deja todo en cero sin histórico y sin respaldo igualitario', () => {
    const result = allocateByWeight(
      new Map([
        ['A', 0],
        ['B', 0],
      ]),
      100,
    );
    expect([...result.values()]).toEqual([0, 0]);
  });

  it('no reparte cuando no hay meta', () => {
    const result = allocateByWeight(new Map([['A', 10]]), 0);
    expect(result.get('A')).toBe(0);
  });

  it('ignora pesos negativos o no finitos sin romper la suma', () => {
    const result = allocateByWeight(
      new Map<string, number>([
        ['A', 100],
        ['B', -50],
        ['C', Number.NaN],
      ]),
      50,
    );
    expect(result.get('A')).toBe(50);
    expect(result.get('B')).toBe(0);
    expect(result.get('C')).toBe(0);
    expect(sum(result)).toBe(50);
  });
});

describe('sharePct', () => {
  it('calcula el porcentaje con un decimal', () => {
    expect(sharePct(600, 1_000)).toBe(60);
    expect(sharePct(1, 3)).toBe(33.3);
  });

  it('devuelve null sin base', () => {
    expect(sharePct(10, 0)).toBeNull();
    expect(sharePct(Number.NaN, 100)).toBeNull();
  });
});

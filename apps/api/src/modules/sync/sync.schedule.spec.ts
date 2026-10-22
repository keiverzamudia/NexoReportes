import { describe, expect, it } from 'vitest';
import { MIN_DOMAIN_SECONDS, intervalFor, parseSyncSchedule } from './sync.schedule';

// ============================================================
// Reloj de sincronización: la configuración es la que decide cuánto se
// castiga el SQL Server de Profit, así que se prueba como contrato.
// ============================================================

describe('parseSyncSchedule', () => {
  it('interpreta el reloj por dominio', () => {
    const schedule = parseSyncSchedule('EXISTENCIAS=120,PEDIDOS=300,PEDIDOS_DETALLE=300,PRODUCTOS=21600');
    expect(schedule.get('EXISTENCIAS')).toBe(120);
    expect(schedule.get('PEDIDOS')).toBe(300);
    expect(schedule.get('PEDIDOS_DETALLE')).toBe(300);
    expect(schedule.get('PRODUCTOS')).toBe(21600);
    expect(schedule.size).toBe(4);
  });

  it('tolera espacios, minúsculas y entradas vacías', () => {
    const schedule = parseSyncSchedule('  existencias = 120 , , pedidos=600 ');
    expect(schedule.get('EXISTENCIAS')).toBe(120);
    expect(schedule.get('PEDIDOS')).toBe(600);
    expect(schedule.size).toBe(2);
  });

  it('ignora dominios desconocidos y valores inválidos', () => {
    const schedule = parseSyncSchedule('INVENTADO=60,PEDIDOS=0,CLIENTES=-5,PRODUCTOS=abc,ALMACENES=86400');
    // Solo sobrevive el dominio válido con valor válido.
    expect([...schedule.keys()]).toEqual(['ALMACENES']);
    expect(schedule.get('ALMACENES')).toBe(86400);
  });

  it('protege a Profit con un piso mínimo de segundos', () => {
    const schedule = parseSyncSchedule('EXISTENCIAS=5');
    expect(schedule.get('EXISTENCIAS')).toBe(MIN_DOMAIN_SECONDS);
  });

  it('sin configuración no hay reloj (solo sincronización manual)', () => {
    expect(parseSyncSchedule('').size).toBe(0);
    expect(parseSyncSchedule(undefined).size).toBe(0);
    expect(parseSyncSchedule(null).size).toBe(0);
    expect(intervalFor(parseSyncSchedule('PEDIDOS=300'), 'EXISTENCIAS')).toBe(0);
  });
});

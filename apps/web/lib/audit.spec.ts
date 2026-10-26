import { describe, expect, it } from 'vitest';
import { normalizeEntry, normalizeFeed, severityMeta } from './audit';

// ============================================================
// La bitácora debe tolerar que el API quede en la versión anterior
// (sin `severity`, `module`, `at` ni facetas) sin romper la pantalla.
// ============================================================

const newPayload = {
  items: [
    {
      id: 'audit:1',
      source: 'audit',
      at: '2026-10-25T14:30:00.000Z',
      module: 'users',
      moduleLabel: 'Usuarios',
      action: 'USER_PERMISSIONS_UPDATED',
      label: 'Cambió permisos de un usuario',
      severity: 'WARN',
      actorId: 'u1',
      actorCode: 'KZ',
      actorName: 'KEIBER ZAMUDIA',
      entityType: 'User',
      entityId: 'user-1',
      title: 'Cambió permisos de un usuario · ARIV',
      detail: 'pedidos:read permitido',
      linkPath: '/usuarios',
      ip: '10.0.0.5',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0',
      context: { code: 'ARIV' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 30,
  stats: { today: 1, critical7d: 0, actorsToday: 1, syncErrors7d: 0 },
  facets: { actors: [], actions: [], modules: [{ key: 'users', label: 'Usuarios', count: 1 }] },
};

const oldPayload = {
  items: [
    {
      id: 'ev-1',
      actorId: 'u1',
      actorEmail: 'KZ',
      action: 'ROLE_DELETED',
      entityType: 'Role',
      entityId: 'role-1',
      context: JSON.stringify({ role: 'SUPERVISOR' }),
      createdAt: '2026-10-25T12:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 30,
};

describe('bitácora — normalización defensiva', () => {
  it('deja pasar la respuesta actual y no la marca como vieja', () => {
    const { data, outdated } = normalizeFeed(newPayload);
    expect(outdated).toBe(false);
    expect(data.items[0]).toMatchObject({ severity: 'WARN', module: 'users', ip: '10.0.0.5' });
    expect(data.stats.today).toBe(1);
  });

  it('adapta la respuesta anterior (AuditEvent crudo) y avisa', () => {
    const { data, outdated } = normalizeFeed(oldPayload);
    expect(outdated).toBe(true);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      action: 'ROLE_DELETED',
      module: 'roles',
      moduleLabel: 'Roles y permisos',
      severity: 'CRITICAL',
      actorCode: 'KZ',
      at: '2026-10-25T12:00:00.000Z',
    });
    // Facetas calculadas en el cliente cuando el API no las manda.
    expect(data.facets.modules[0]).toMatchObject({ key: 'roles', count: 1 });
  });

  it('descarta filas inservibles en vez de reventar', () => {
    expect(normalizeEntry({ id: 'x' })).toBeNull();
    expect(normalizeEntry(null)).toBeNull();
    const { data } = normalizeFeed({ items: [null, { action: 'X' }, oldPayload.items[0]] });
    expect(data.items).toHaveLength(1);
  });

  it('una severidad desconocida se muestra como normal', () => {
    expect(severityMeta('RARO')).toMatchObject({ label: 'Normal', tone: 'muted' });
    expect(severityMeta(undefined)).toMatchObject({ tone: 'muted' });
  });
});

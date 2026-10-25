import { describe, expect, it } from 'vitest';
import { auditMeta } from '@nexo/contracts';
import { AuditService } from './audit.service';
import { runWithRequestMeta } from '../../common/request-context';

// ============================================================
// Fake mínimo de Prisma para la bitácora. Cubre las consultas que usa el
// servicio: auditoría con filtros, notas operativas y contadores.
// ============================================================

type Row = Record<string, any>;

function matches(where: Row | undefined, row: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((clause) => matches(clause, row));
    if (key === 'createdAt') {
      const date = new Date(row.createdAt).getTime();
      const gte = (value as Row).gte ? new Date((value as Row).gte).getTime() : null;
      const lte = (value as Row).lte ? new Date((value as Row).lte).getTime() : null;
      return (gte === null || date >= gte) && (lte === null || date <= lte);
    }
    if (value && typeof value === 'object' && 'contains' in value) {
      return String(row[key] ?? '').includes(String((value as Row).contains));
    }
    if (value && typeof value === 'object' && 'not' in value) {
      return row[key] !== (value as Row).not;
    }
    return row[key] === value;
  });
}

function createFakePrisma() {
  const state = {
    audit: [] as Row[],
    dispatchNotes: [] as Row[],
    arrivalNotes: [] as Row[],
  };
  let sequence = 0;

  const client: any = {
    auditEvent: {
      async findMany({ where, take }: Row = {}) {
        return state.audit
          .filter((row) => matches(where, row))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, take ?? 100)
          .map((row) => ({ actor: { displayName: 'KEIBER ZAMUDIA', profitCode: 'KZ' }, ...row }));
      },
      async count({ where }: Row) {
        return state.audit.filter((row) => matches(where, row)).length;
      },
      async groupBy({ where }: Row) {
        const ids = new Set(state.audit.filter((row) => matches(where, row)).map((row) => row.actorId).filter(Boolean));
        return [...ids].map((actorId) => ({ actorId }));
      },
      async create({ data }: Row) {
        const row = { id: `audit-${++sequence}`, createdAt: new Date(), ...data };
        state.audit.push(row);
        return row;
      },
    },
    dispatchSheetEvent: {
      async findMany() {
        return state.dispatchNotes;
      },
    },
    arrivalEvent: {
      async findMany() {
        return state.arrivalNotes;
      },
    },
  };

  return { client, state };
}

function seedAudit(state: ReturnType<typeof createFakePrisma>['state'], overrides: Row = {}) {
  const row: Row = {
    id: `audit-${state.audit.length + 1}`,
    actorId: 'u-admin',
    actorEmail: 'KZ',
    action: 'USER_PERMISSIONS_UPDATED',
    module: 'users',
    severity: 'WARN',
    entityType: 'User',
    entityId: 'user-1',
    context: JSON.stringify({ code: 'ARIV', changes: ['pedidos:read permitido'] }),
    ip: '10.0.0.5',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0',
    createdAt: new Date('2026-10-25T14:30:00.000Z'),
    ...overrides,
  };
  state.audit.push(row);
  return row;
}

const query = (overrides: Row = {}) => ({
  page: 1,
  pageSize: 30,
  source: 'all',
  ...overrides,
}) as any;

describe('auditMeta', () => {
  it('traduce las acciones conocidas a módulo, etiqueta y severidad', () => {
    expect(auditMeta('LOGIN_FAILED')).toMatchObject({ module: 'auth', severity: 'WARN' });
    expect(auditMeta('DISPATCH_SEND')).toMatchObject({ module: 'dispatch', severity: 'INFO' });
    expect(auditMeta('ROLE_DELETED')).toMatchObject({ module: 'roles', severity: 'CRITICAL' });
  });

  it('tolera acciones nuevas por prefijo', () => {
    expect(auditMeta('ARRIVAL_NEW_THING')).toMatchObject({ module: 'arrivals' });
    expect(auditMeta('ALGO_RARO').module).toBe('system');
  });
});

describe('AuditService — registro', () => {
  it('guarda módulo, severidad, IP y dispositivo de la petición', async () => {
    const { client, state } = createFakePrisma();
    const service = new AuditService(client as never);

    await runWithRequestMeta({ ip: '10.0.0.9', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0' }, async () => {
      await service.record({ actorId: 'u-admin', actorEmail: 'KZ', action: 'LOGIN_OK', entityType: 'User', entityId: 'u-admin' });
    });

    expect(state.audit[0]).toMatchObject({
      module: 'auth',
      severity: 'INFO',
      ip: '10.0.0.9',
      userAgent: expect.stringContaining('Firefox'),
    });
  });
});

describe('AuditService — bandeja', () => {
  it('mezcla auditoría y notas, ordenado de más reciente a más antiguo', async () => {
    const { client, state } = createFakePrisma();
    const service = new AuditService(client as never);
    seedAudit(state, { createdAt: new Date('2026-10-25T10:00:00.000Z') });
    seedAudit(state, {
      id: 'audit-2',
      action: 'ARRIVAL_CHECK_IN',
      module: 'arrivals',
      severity: 'INFO',
      entityType: 'CustomerArrival',
      entityId: 'arr-1',
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    });
    state.dispatchNotes.push({
      id: 'note-1',
      sheetId: 'sheet-1',
      sheet: { id: 'sheet-1', number: 'DSP-2026-0007', title: 'Despacho' },
      body: 'Cargar por la puerta 2',
      authorId: 'u-plan',
      authorCode: 'KZ',
      authorName: 'KEIBER ZAMUDIA',
      createdAt: new Date('2026-10-25T11:00:00.000Z'),
    });

    const feed = await service.feed(query({ from: '2026-10-25', to: '2026-10-25' }));

    expect(feed.items.map((item) => item.at)).toEqual([
      '2026-10-25T12:00:00.000Z',
      '2026-10-25T11:00:00.000Z',
      '2026-10-25T10:00:00.000Z',
    ]);
    expect(feed.items[1]!.source).toBe('dispatch-note');
    expect(feed.total).toBe(3);
  });

  it('filtra por módulo, severidad y texto', async () => {
    const { client, state } = createFakePrisma();
    const service = new AuditService(client as never);
    seedAudit(state);
    seedAudit(state, { id: 'audit-2', action: 'LOGIN_FAILED', module: 'auth', severity: 'WARN', context: null });
    seedAudit(state, { id: 'audit-3', action: 'DISPATCH_SEND', module: 'dispatch', severity: 'INFO', context: JSON.stringify({ number: 'DSP-2026-0009' }) });

    expect((await service.feed(query({ module: 'auth' }))).items).toHaveLength(1);
    expect((await service.feed(query({ severity: 'WARN' }))).items).toHaveLength(2);
    expect((await service.feed(query({ q: 'DSP-2026-0009' }))).items).toHaveLength(1);
  });

  it('pagina y resume facetas y contadores', async () => {
    const { client, state } = createFakePrisma();
    const service = new AuditService(client as never);
    for (let index = 0; index < 5; index += 1) {
      seedAudit(state, { id: `a-${index}`, createdAt: new Date(Date.now() - index * 60_000) });
    }

    const feed = await service.feed(query({ page: 2, pageSize: 2 }));
    expect(feed.items).toHaveLength(2);
    expect(feed.total).toBe(5);
    expect(feed.facets.actors[0]).toMatchObject({ id: 'u-admin', count: 5 });
    expect(feed.stats.today).toBe(5);
  });

  it('exporta CSV con encabezado y escape de comillas', async () => {
    const { client, state } = createFakePrisma();
    const service = new AuditService(client as never);
    seedAudit(state, { context: JSON.stringify({ reason: 'dijo "no" al cambio' }) });

    const csv = await service.exportCsv(query());
    expect(csv.split('\r\n')[0]).toContain('"Usuario"');
    expect(csv).toContain('""no""');
  });
});

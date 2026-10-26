'use client';

import { AUDIT_MODULES, auditMeta, auditModuleLabel } from '@nexo/contracts';
import type { AuditEntry, AuditFeedResponse, AuditModuleKey, AuditSeverity } from '@nexo/contracts';

// ============================================================
// Bitácora: etiquetas, agrupaciones y normalización defensiva.
//
// La clasificación (módulo/severidad) viene resuelta del API. Si el web se
// actualiza antes que el API (o al revés), la respuesta llega con la forma
// anterior: en vez de romper la pantalla, se adapta y se avisa.
// ============================================================

export type AuditTone = 'muted' | 'warning' | 'danger';

export const SEVERITY_META: Record<AuditSeverity, { label: string; tone: AuditTone }> = {
  INFO: { label: 'Normal', tone: 'muted' },
  WARN: { label: 'Atención', tone: 'warning' },
  CRITICAL: { label: 'Crítico', tone: 'danger' },
};

/** Nunca falla: una severidad desconocida se muestra como «Normal». */
export function severityMeta(severity: string | null | undefined): { label: string; tone: AuditTone } {
  return SEVERITY_META[(severity ?? 'INFO') as AuditSeverity] ?? SEVERITY_META.INFO;
}

export type RangePreset = 'today' | '7d' | '30d' | 'all';

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'all', label: 'Todo' },
];

function businessDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Rango en fechas de negocio (yyyy-MM-dd). `all` no filtra. */
export function rangeBounds(preset: RangePreset, now: Date = new Date()): { from?: string; to?: string } {
  if (preset === 'all') return {};
  const today = businessDate(now);
  if (preset === 'today') return { from: today, to: today };
  const days = preset === '7d' ? 7 : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: businessDate(start), to: today };
}

export function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function dateTimeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'sin-fecha';
  return businessDate(date);
}

/** «Hoy», «Ayer» o «mié 22 oct». */
export function dayLabel(key: string, now: Date = new Date()): string {
  if (key === 'sin-fecha') return 'Sin fecha';
  const today = businessDate(now);
  if (key === today) return 'Hoy';
  const yesterday = businessDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (key === yesterday) return 'Ayer';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString('es-VE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export interface AuditDayGroup {
  key: string;
  label: string;
  items: AuditEntry[];
}

/** Agrupa por día conservando el orden descendente del API. */
export function groupByDay(entries: AuditEntry[], now: Date = new Date()): AuditDayGroup[] {
  const groups: AuditDayGroup[] = [];
  for (const entry of entries) {
    const key = dayKeyOf(entry.at);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(entry);
    else groups.push({ key, label: dayLabel(key, now), items: [entry] });
  }
  return groups;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/** «Chrome · Windows», «Edge · Windows»… a partir del user-agent. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  let browser = 'Navegador';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('chrome/') || ua.includes('crios')) browser = 'Chrome';
  else if (ua.includes('firefox/') || ua.includes('fxios')) browser = 'Firefox';
  else if (ua.includes('safari/')) browser = 'Safari';

  let device = 'Escritorio';
  if (ua.includes('android')) device = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) device = 'iOS';
  else if (ua.includes('windows')) device = 'Windows';
  else if (ua.includes('mac os')) device = 'macOS';
  else if (ua.includes('linux')) device = 'Linux';
  else if (ua.includes('bot')) device = 'Bot';

  return `${browser} · ${device}`;
}

// ---------- Normalización defensiva (API viejo ↔ web nuevo) ----------

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function linkFor(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'DispatchSheet') return `/despacho/${entityId}`;
  if (entityType === 'CustomerArrival') return `/llegadas/${entityId}`;
  if (entityType === 'User' || entityType === 'Role' || entityType === 'UserPermission') return '/usuarios';
  return null;
}

function contextOf(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Acepta el formato actual y el anterior (AuditEvent crudo). Devuelve null
 * solo si no hay ni acción ni fecha: una fila rota no debe tumbar la pantalla.
 */
export function normalizeEntry(raw: unknown): AuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const action = text(row.action);
  const at = text(row.at) ?? text(row.createdAt);
  if (!action || !at) return null;

  const meta = auditMeta(action);
  const moduleKey = (text(row.module) ?? meta.module) as AuditModuleKey;
  const context = contextOf(row.context);
  const entityType = text(row.entityType) ?? 'Sistema';
  const entityId = text(row.entityId);

  return {
    id: text(row.id) ?? `${action}:${at}`,
    source: (text(row.source) as AuditEntry['source']) ?? 'audit',
    at,
    module: moduleKey,
    moduleLabel: text(row.moduleLabel) ?? auditModuleLabel(moduleKey),
    action,
    label: text(row.label) ?? meta.label,
    severity: (text(row.severity) as AuditSeverity) ?? meta.severity,
    actorId: text(row.actorId),
    actorCode: text(row.actorCode) ?? text(row.actorEmail),
    actorName: text(row.actorName),
    entityType,
    entityId,
    title: text(row.title) ?? meta.label,
    detail: text(row.detail) ?? text(row.body),
    linkPath: text(row.linkPath) ?? linkFor(entityType, entityId),
    ip: text(row.ip),
    userAgent: text(row.userAgent),
    context,
  };
}

function buildFallbackFacets(items: AuditEntry[]): AuditFeedResponse['facets'] {
  const actors = new Map<string, { id: string; name: string; code: string | null; count: number }>();
  const actions = new Map<string, { action: string; label: string; module: string; count: number }>();
  const modules = new Map<string, number>();

  for (const item of items) {
    if (item.actorId) {
      const current = actors.get(item.actorId);
      actors.set(item.actorId, {
        id: item.actorId,
        name: current?.name ?? item.actorName ?? item.actorCode ?? 'Usuario',
        code: current?.code ?? item.actorCode,
        count: (current?.count ?? 0) + 1,
      });
    }
    const action = actions.get(item.action);
    actions.set(item.action, {
      action: item.action,
      label: action?.label ?? item.label,
      module: item.module,
      count: (action?.count ?? 0) + 1,
    });
    modules.set(item.module, (modules.get(item.module) ?? 0) + 1);
  }

  return {
    actors: [...actors.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    actions: [...actions.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    modules: AUDIT_MODULES.map((module) => ({
      key: module.key,
      label: module.label,
      count: modules.get(module.key) ?? 0,
    })).filter((module) => module.count > 0),
  };
}

/**
 * Normaliza la bandeja completa. `outdated` avisa que el API respondió con la
 * forma anterior (sin estadísticas ni IP): la vista sigue funcionando, pero se
 * muestra un aviso para reiniciar el servidor.
 */
export function normalizeFeed(raw: unknown): { data: AuditFeedResponse; outdated: boolean } {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.map((item) => normalizeEntry(item)).filter((item): item is AuditEntry => item !== null);
  const outdated =
    rawItems.length > 0 &&
    rawItems.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return !text(row.at) || !text(row.severity) || !text(row.module);
    });
  const fallbackFacets = buildFallbackFacets(items);

  return {
    outdated,
    data: {
      items,
      total: typeof source.total === 'number' ? source.total : items.length,
      page: typeof source.page === 'number' ? source.page : 1,
      pageSize: typeof source.pageSize === 'number' ? source.pageSize : items.length || 30,
      stats:
        (source.stats as AuditFeedResponse['stats'] | undefined) ?? {
          today: items.length,
          critical7d: items.filter((item) => item.severity === 'CRITICAL').length,
          actorsToday: fallbackFacets.actors.length,
          syncErrors7d: items.filter((item) => item.action === 'SYNC_RUN' && item.severity !== 'INFO').length,
        },
      facets: (source.facets as AuditFeedResponse['facets'] | undefined) ?? fallbackFacets,
    },
  };
}

'use client';

import type { AuditEntry, AuditSeverity } from '@nexo/contracts';

// ============================================================
// Bitácora: etiquetas y agrupaciones de la bandeja.
// La clasificación (módulo/severidad) viene resuelta del API; aquí solo se
// decide cómo se ve.
// ============================================================

export type AuditTone = 'muted' | 'warning' | 'danger';

export const SEVERITY_META: Record<AuditSeverity, { label: string; tone: AuditTone }> = {
  INFO: { label: 'Normal', tone: 'muted' },
  WARN: { label: 'Atención', tone: 'warning' },
  CRITICAL: { label: 'Crítico', tone: 'danger' },
};

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

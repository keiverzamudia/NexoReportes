'use client';

import type { SystemAnnouncement, SystemAnnouncementType } from '@nexo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Megaphone, Repeat, Sparkles, Tag, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Badge, cx } from './ui';

const SEEN_STORAGE_KEY = 'nexo.announcements_seen_at';

type SeenMap = Record<string, number>;

function readSeenMap(): SeenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: SeenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

function writeSeenMap(map: SeenMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignorar cuotas de almacenamiento en modo privado
  }
}

/** Limpia el registro de avisos vistos para que vuelvan a mostrarse al iniciar sesión. */
export function clearAnnouncementDismissals(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SEEN_STORAGE_KEY);
  } catch {
    // Ignorar errores de almacenamiento
  }
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatRepeatLabel(minutes: number): string {
  if (!minutes || minutes <= 0) return 'Solo al iniciar sesión';
  if (minutes === 60) return 'Se repite cada 1 hora';
  if (minutes > 60 && minutes % 60 === 0) return `Se repite cada ${minutes / 60} horas`;
  return `Se repite cada ${minutes} min`;
}

const TYPE_META: Record<
  SystemAnnouncementType,
  {
    label: string;
    tone: 'primary' | 'warning' | 'success';
    icon: typeof Megaphone;
    headerClass: string;
    iconClass: string;
  }
> = {
  INFO: {
    label: 'Aviso del sistema',
    tone: 'primary',
    icon: Megaphone,
    headerClass: 'bg-primary-fixed/40',
    iconClass: 'bg-primary-container text-on-primary',
  },
  WARNING: {
    label: 'Mantenimiento / Alerta',
    tone: 'warning',
    icon: AlertTriangle,
    headerClass: 'bg-warning-container/60',
    iconClass: 'bg-warning-container text-on-warning-container',
  },
  UPDATE: {
    label: 'Actualización',
    tone: 'success',
    icon: Sparkles,
    headerClass: 'bg-success-container/60',
    iconClass: 'bg-success-container text-on-success-container',
  },
};

export function SystemAnnouncementsModal({
  announcements,
}: {
  announcements: SystemAnnouncement[];
}) {
  const [seenMap, setSeenMap] = useState<SeenMap | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setSeenMap(readSeenMap());
    // Revisa cada 15 s si algún aviso recurrente debe volver a mostrarse.
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    if (seenMap === null) return [];
    return announcements.filter((item) => {
      if (!item.active) return false;
      if (new Date(item.expiresAt).getTime() <= nowMs) return false;
      const lastSeen = seenMap[item.id];
      if (lastSeen === undefined) return true;
      const interval = item.repeatIntervalMinutes ?? 0;
      if (interval <= 0) return false;
      return nowMs - lastSeen >= interval * 60_000;
    });
  }, [announcements, seenMap, nowMs]);

  function dismissAll() {
    const now = Date.now();
    const next: SeenMap = { ...(seenMap ?? {}) };
    for (const item of visible) {
      next[item.id] = now;
    }
    writeSeenMap(next);
    setSeenMap(next);
    setNowMs(now);
  }

  useEffect(() => {
    if (visible.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissAll();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (visible.length === 0) return null;

  const primary = visible[0]!;
  const meta = TYPE_META[primary.type] ?? TYPE_META.INFO;
  const PrimaryIcon = meta.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-announcement-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-space-md backdrop-blur-xs"
    >
      <div className="animate-fade flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-lift">
        <div
          className={cx(
            'flex items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-lg py-space-md',
            meta.headerClass,
          )}
        >
          <div className="flex items-start gap-space-md">
            <span className={cx('mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl shadow-soft', meta.iconClass)}>
              <PrimaryIcon aria-hidden className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <h2
                id="system-announcement-title"
                className="font-display text-xl font-bold leading-snug tracking-tight text-primary sm:text-2xl"
              >
                {visible.length === 1 ? primary.title : `${visible.length} avisos importantes`}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissAll}
            aria-label="Cerrar aviso"
            className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-lowest/70 hover:text-primary"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-space-md overflow-y-auto px-space-lg py-space-lg">
          {visible.map((item) => {
            const itemMeta = TYPE_META[item.type] ?? TYPE_META.INFO;
            return (
              <article
                key={item.id}
                className={cx(
                  'flex flex-col gap-space-sm',
                  visible.length > 1 &&
                    'rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-md',
                )}
              >
                {visible.length > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-space-sm">
                    <h3 className="font-display text-lg font-bold tracking-tight text-primary">{item.title}</h3>
                    <Badge tone={itemMeta.tone}>{itemMeta.label}</Badge>
                  </div>
                )}
                <p className="whitespace-pre-line text-[15px] font-normal leading-relaxed text-on-surface sm:text-base">
                  {item.message}
                </p>
                <div className="mt-space-xs flex flex-wrap items-center gap-x-space-md gap-y-1.5 rounded-lg bg-surface-container-low/70 px-space-sm py-2 text-sm font-medium text-on-surface-variant">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock aria-hidden className="size-4 text-primary" />
                    Válido hasta: <strong className="font-semibold text-on-surface">{formatDateTime(item.expiresAt)}</strong>
                  </span>
                  {(item.repeatIntervalMinutes ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Repeat aria-hidden className="size-4 text-primary" />
                      {formatRepeatLabel(item.repeatIntervalMinutes)}
                    </span>
                  )}
                  {item.createdByName && <span>Por: {item.createdByName}</span>}
                </div>
              </article>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/40 px-space-lg py-space-md">
          <button
            type="button"
            onClick={dismissAll}
            className="inline-flex h-11 items-center gap-space-xs rounded-xl bg-primary-container px-space-xl text-base font-semibold text-on-primary shadow-soft transition-colors hover:bg-primary"
          >
            <CheckCircle2 aria-hidden className="size-5" />
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

export function SystemVersionDialog({
  currentVersion,
  onClose,
}: {
  currentVersion: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(currentVersion);

  const save = useMutation<{ version: string }, Error, string>({
    mutationFn: (nextVersion) =>
      apiFetch<{ version: string }>('/system/version', {
        method: 'PUT',
        body: JSON.stringify({ version: nextVersion }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-meta'] });
      onClose();
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!version.trim()) return;
    save.mutate(version.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-version-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/45 p-space-md backdrop-blur-xs"
    >
      <form
        onSubmit={handleSubmit}
        className="animate-fade flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-lift"
      >
        <div className="flex items-center justify-between border-b border-outline-variant/30 px-space-lg py-space-md">
          <div className="flex items-center gap-space-xs">
            <Tag aria-hidden className="size-4 text-primary" />
            <h2 id="system-version-title" className="font-display text-title-sm text-primary">
              Versión del sistema
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-space-sm px-space-lg py-space-md">
          <label className="flex flex-col gap-space-xs text-label-md font-semibold text-on-surface-variant">
            Etiqueta de versión (visible junto a Corpoagro)
            <input
              autoFocus
              required
              maxLength={32}
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="Ej. v1.2.0"
              className="h-10 rounded-xl border border-outline-variant/60 bg-surface px-space-md font-mono text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
            />
          </label>
          {save.error && <p className="text-label-sm text-error">{save.error.message}</p>}
        </div>

        <div className="flex items-center justify-end gap-space-xs border-t border-outline-variant/30 bg-surface-container-low/40 px-space-lg py-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-outline-variant px-space-md text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-low"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={save.isPending || !version.trim()}
            className="h-9 rounded-lg bg-primary-container px-space-md text-label-md font-semibold text-on-primary hover:bg-primary disabled:opacity-50"
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

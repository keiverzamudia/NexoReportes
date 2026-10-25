'use client';

// ============================================================
// Campana de notificaciones del shell.
//
// Es la cara visible del «túnel»: el planificador se entera de que el almacén
// recibió, empezó a cargar, reportó una novedad o cerró el despacho; el almacén
// se entera de que le publicaron uno o le escribieron.
//
// Sin websockets: TanStack Query refresca cada 15 s y la lista se anuncia por
// `aria-live`. Los deep links llevan al despacho.
// ============================================================

import type { Notification, NotificationListResponse, NotificationType } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Bell,
  BellRing,
  CheckCheck,
  DoorOpen,
  Inbox,
  Loader,
  MessageSquare,
  PackagePlus,
  Truck,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/dispatch-sheet';
import { cx } from './ui';

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  DESPACHO_ENVIADO: PackagePlus,
  DESPACHO_RECIBIDO: Inbox,
  DESPACHO_EN_PROCESO: Loader,
  DESPACHO_CERRADO: CheckCheck,
  DESPACHO_NOVEDAD: AlertTriangle,
  DESPACHO_CANCELADO: Ban,
  MENSAJE: MessageSquare,
  LLEGADA_ESPERADA: DoorOpen,
  LLEGADA_MARCADA: UserCheck,
  LLEGADA_INCIDENCIA: AlertTriangle,
};

const TYPE_TONE: Record<NotificationType, string> = {
  DESPACHO_ENVIADO: 'bg-primary-fixed text-primary',
  DESPACHO_RECIBIDO: 'bg-surface-container-high text-primary',
  DESPACHO_EN_PROCESO: 'bg-primary-fixed text-primary',
  DESPACHO_CERRADO: 'bg-success-container text-on-success-container',
  DESPACHO_NOVEDAD: 'bg-warning-container text-on-warning-container',
  DESPACHO_CANCELADO: 'bg-critical-container text-on-critical-container',
  MENSAJE: 'bg-secondary-container/40 text-secondary',
  LLEGADA_ESPERADA: 'bg-primary-fixed text-primary',
  LLEGADA_MARCADA: 'bg-success-container text-on-success-container',
  LLEGADA_INCIDENCIA: 'bg-warning-container text-on-warning-container',
};

export function NotificationsBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState('');

  const { data } = useQuery<NotificationListResponse>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<NotificationListResponse>('/notifications?limit=12'),
    refetchInterval: 15_000,
    // La campana no se detiene cuando la pestaña pierde el foco: en planta el
    // aviso tiene que estar ahí al volver, no 15 s después.
    refetchIntervalInBackground: true,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      apiFetch<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  // Anuncia la entrada de notificaciones nuevas sin interrumpir.
  const newestId = items[0]?.id;
  useEffect(() => {
    if (!newestId) return;
    setLive(`${items[0]?.title ?? 'Nueva notificación'}${unread > 0 ? ` (${unread} sin leer)` : ''}`);
  }, [newestId, unread, items]);

  // Garantía extra: el contador viaja en el título de la pestaña, así el aviso
  // se ve incluso si el almacén está trabajando en otra pestaña.
  const baseTitle = useRef('');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!baseTitle.current) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, '') || 'CORPOAGRO · SAN LUIS';
    document.title = unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
    return () => {
      if (baseTitle.current) document.title = baseTitle.current;
    };
  }, [unread]);

  // Escape y clic fuera cierran el panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const groups = useMemo(() => groupByDay(items), [items]);

  function openItem(notification: Notification) {
    if (!notification.readAt) markRead.mutate({ ids: [notification.id] });
    setOpen(false);
    router.push(notification.linkPath);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notifications-panel"
        title={unread > 0 ? `${unread} notificación(es) sin leer` : 'Notificaciones'}
        className={cx(
          'relative flex size-9 items-center justify-center rounded-full border shadow-soft transition-colors',
          unread > 0
            ? 'border-secondary-container/60 bg-secondary-container/25 text-primary hover:bg-secondary-container/40'
            : 'border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low hover:text-primary',
        )}
      >
        {unread > 0 ? <BellRing aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-[1.15rem] place-items-center rounded-full bg-primary-container px-1 text-[10px] font-black leading-[1.15rem] text-on-primary">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <span aria-live="polite" className="sr-only">
        {live}
      </span>

      {open && (
        <div
          id="notifications-panel"
          role="dialog"
          aria-label="Notificaciones"
          className="animate-rise absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-lift"
        >
          <div className="flex items-center justify-between gap-space-sm border-b border-outline-variant/30 bg-surface-container-low/70 px-space-md py-space-sm">
            <div>
              <p className="font-semibold text-primary">Notificaciones</p>
              <p className="text-label-sm normal-case text-on-surface-variant">
                Te avisamos cuando alguien abre, carga o cierra un despacho.
              </p>
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate({ all: true })}
                disabled={markRead.isPending}
                className="shrink-0 rounded-pill border border-outline-variant/50 px-space-sm py-1 font-semibold text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container-lowest disabled:opacity-40"
              >
                Marcar todo leído
              </button>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {items.length === 0 && (
              <div className="flex flex-col items-center gap-space-xs px-space-lg py-space-xl text-center">
                <Bell aria-hidden className="size-6 text-outline" />
                <p className="font-semibold text-on-surface">Todo al día</p>
                <p className="text-body-md text-on-surface-variant">
                  Aquí verás los avisos de despacho, acuses y mensajes.
                </p>
              </div>
            )}

            {groups.map((group) => (
              <section key={group.label}>
                <p className="sticky top-0 z-10 border-b border-outline-variant/20 bg-surface-container-lowest/95 px-space-md py-1 font-semibold uppercase tracking-wider text-label-sm text-outline backdrop-blur">
                  {group.label}
                </p>
                <ul className="divide-y divide-outline-variant/20">
                  {group.items.map((notification) => {
                    const Icon = TYPE_ICON[notification.type];
                    const isUnread = !notification.readAt;
                    return (
                      <li key={notification.id}>
                        <button
                          type="button"
                          onClick={() => openItem(notification)}
                          className={cx(
                            'flex w-full items-start gap-space-sm px-space-md py-space-sm text-left transition-colors hover:bg-surface-container-low',
                            isUnread && 'bg-secondary-container/10',
                          )}
                        >
                          <span className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', TYPE_TONE[notification.type])}>
                            <Icon aria-hidden className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-space-xs">
                              <span className={cx('truncate text-body-md', isUnread ? 'font-semibold text-on-surface' : 'text-on-surface')}>
                                {notification.title}
                              </span>
                              {isUnread && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-secondary" />}
                            </span>
                            {notification.body && (
                              <span className="mt-0.5 line-clamp-2 block text-label-md normal-case text-on-surface-variant">
                                {notification.body}
                              </span>
                            )}
                            <span className="mt-0.5 block text-label-sm normal-case text-outline">
                              {relativeTime(notification.createdAt)}
                              {notification.actorName ? ` · ${notification.actorName}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-xs">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/despacho');
              }}
              className="flex w-full items-center justify-center gap-space-xs rounded-pill py-1 font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-lowest"
            >
              <Truck aria-hidden className="size-3.5" /> Ir al tablero de despacho
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByDay(items: Notification[]): { label: string; items: Notification[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const groups: { label: string; items: Notification[] }[] = [
    { label: 'Hoy', items: [] },
    { label: 'Ayer', items: [] },
    { label: 'Anteriores', items: [] },
  ];
  for (const item of items) {
    const time = new Date(item.createdAt).getTime();
    if (time >= startOfToday) groups[0]!.items.push(item);
    else if (time >= startOfYesterday) groups[1]!.items.push(item);
    else groups[2]!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

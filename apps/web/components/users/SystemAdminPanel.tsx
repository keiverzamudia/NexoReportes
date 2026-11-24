'use client';

import type {
  SystemAnnouncement,
  SystemAnnouncementInput,
  SystemAnnouncementType,
  SystemMetaResponse,
} from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Clock,
  Megaphone,
  Power,
  Repeat,
  Send,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Badge, Card, EmptyState, cx } from '../ui';

function toLocalDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultExpiry(hours = 4): string {
  return toLocalDateTimeInput(new Date(Date.now() + hours * 3600_000));
}

function endOfToday(): string {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return toLocalDateTimeInput(date);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const TYPE_OPTIONS: { value: SystemAnnouncementType; label: string; icon: typeof Megaphone }[] = [
  { value: 'INFO', label: 'Informativo', icon: Megaphone },
  { value: 'WARNING', label: 'Mantenimiento / Alerta', icon: AlertTriangle },
  { value: 'UPDATE', label: 'Actualización', icon: Sparkles },
];

export function SystemAdminPanel() {
  const queryClient = useQueryClient();

  const metaQuery = useQuery<SystemMetaResponse>({
    queryKey: ['system-meta'],
    queryFn: () => apiFetch<SystemMetaResponse>('/system/meta'),
  });

  const listQuery = useQuery<SystemAnnouncement[]>({
    queryKey: ['system-announcements'],
    queryFn: () => apiFetch<SystemAnnouncement[]>('/system/announcements'),
  });

  const [versionInput, setVersionInput] = useState('');
  const [versionSaved, setVersionSaved] = useState(false);

  useEffect(() => {
    if (metaQuery.data?.version && !versionInput) {
      setVersionInput(metaQuery.data.version);
    }
  }, [metaQuery.data?.version, versionInput]);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<SystemAnnouncementType>('WARNING');
  const [expiresLocal, setExpiresLocal] = useState(() => defaultExpiry(4));
  const [repeatIntervalMinutes, setRepeatIntervalMinutes] = useState<number>(0);
  const [message, setMessage] = useState('');

  const saveVersion = useMutation<{ version: string }, Error, string>({
    mutationFn: (version) =>
      apiFetch<{ version: string }>('/system/version', {
        method: 'PUT',
        body: JSON.stringify({ version }),
      }),
    onSuccess: (res) => {
      setVersionInput(res.version);
      setVersionSaved(true);
      queryClient.invalidateQueries({ queryKey: ['system-meta'] });
      setTimeout(() => setVersionSaved(false), 2500);
    },
  });

  const createAnnouncement = useMutation<SystemAnnouncement, Error, SystemAnnouncementInput>({
    mutationFn: (body) =>
      apiFetch<SystemAnnouncement>('/system/announcements', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setTitle('');
      setMessage('');
      setExpiresLocal(defaultExpiry(4));
      setRepeatIntervalMinutes(0);
      queryClient.invalidateQueries({ queryKey: ['system-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['system-meta'] });
    },
  });

  const toggleAnnouncement = useMutation<SystemAnnouncement, Error, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) =>
      apiFetch<SystemAnnouncement>(`/system/announcements/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['system-meta'] });
    },
  });

  const deleteAnnouncement = useMutation<{ deleted: true }, Error, string>({
    mutationFn: (id) => apiFetch<{ deleted: true }>(`/system/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['system-meta'] });
    },
  });

  function handleVersionSubmit(event: FormEvent) {
    event.preventDefault();
    if (!versionInput.trim()) return;
    saveVersion.mutate(versionInput.trim());
  }

  function handleAnnouncementSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !message.trim() || !expiresLocal) return;
    createAnnouncement.mutate({
      title: title.trim(),
      message: message.trim(),
      type,
      expiresAt: new Date(expiresLocal).toISOString(),
      repeatIntervalMinutes: Math.max(0, Math.min(1440, Math.round(repeatIntervalMinutes || 0))),
    });
  }

  const announcements = listQuery.data ?? [];
  const now = Date.now();

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Versionador junto a Corpoagro */}
      <Card className="p-space-lg">
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-space-xs font-display text-title-md text-primary">
              <Tag aria-hidden className="size-4" />
              Versionador del sistema
            </h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Se muestra al lado del logo de Corpoagro en la barra superior para identificar la versión desplegada.
            </p>
          </div>
          <form onSubmit={handleVersionSubmit} className="flex flex-wrap items-center gap-space-sm">
            <input
              required
              maxLength={32}
              value={versionInput}
              onChange={(event) => setVersionInput(event.target.value)}
              placeholder="Ej. v1.2.0"
              aria-label="Versión del sistema"
              className="h-10 w-44 rounded-xl border border-outline-variant/60 bg-surface px-space-md font-mono text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
            />
            <button
              type="submit"
              disabled={saveVersion.isPending || !versionInput.trim()}
              className="inline-flex h-10 items-center gap-space-xs rounded-xl bg-primary-container px-space-md font-semibold text-body-md text-on-primary transition-colors hover:bg-primary disabled:opacity-50"
            >
              {versionSaved ? <Check aria-hidden className="size-4" /> : null}
              {saveVersion.isPending ? 'Guardando…' : versionSaved ? 'Guardado' : 'Guardar versión'}
            </button>
          </form>
        </div>
        {saveVersion.error && <p className="mt-space-xs text-label-sm text-error">{saveVersion.error.message}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-12">
        {/* Formulario para crear un aviso global */}
        <Card className="p-space-lg lg:col-span-5">
          <h2 className="flex items-center gap-space-xs font-display text-title-md text-primary">
            <Megaphone aria-hidden className="size-4" />
            Publicar aviso en modal
          </h2>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Aparecerá automáticamente a todos los usuarios al ingresar mientras esté vigente.
          </p>

          <form onSubmit={handleAnnouncementSubmit} className="mt-space-md flex flex-col gap-space-md">
            <label className="flex flex-col gap-space-xs text-label-md font-semibold text-on-surface-variant">
              Título
              <input
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ej. Reinicio programado del servidor"
                className="h-10 rounded-xl border border-outline-variant/60 bg-surface px-space-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
              />
            </label>

            <div className="flex flex-col gap-space-xs">
              <span className="text-label-md font-semibold text-on-surface-variant">Tipo de aviso</span>
              <div className="grid grid-cols-3 gap-space-xs">
                {TYPE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = type === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setType(option.value)}
                      className={cx(
                        'flex items-center justify-center gap-1.5 rounded-xl border px-space-sm py-2 text-label-sm font-semibold transition-colors',
                        selected
                          ? 'border-primary bg-primary-fixed/50 text-primary'
                          : 'border-outline-variant/50 bg-surface text-on-surface-variant hover:bg-surface-container-low',
                      )}
                    >
                      <Icon aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-space-xs">
              <label className="flex flex-col gap-space-xs text-label-md font-semibold text-on-surface-variant">
                Válido hasta (duración del aviso)
                <input
                  type="datetime-local"
                  required
                  value={expiresLocal}
                  onChange={(event) => setExpiresLocal(event.target.value)}
                  className="h-10 rounded-xl border border-outline-variant/60 bg-surface px-space-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
                />
              </label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  { label: '1 hora', value: () => defaultExpiry(1) },
                  { label: '4 horas', value: () => defaultExpiry(4) },
                  { label: 'Fin de hoy', value: () => endOfToday() },
                  { label: '24 horas', value: () => defaultExpiry(24) },
                  { label: '3 días', value: () => defaultExpiry(72) },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setExpiresLocal(preset.value())}
                    className="rounded-pill border border-outline-variant/50 bg-surface-container-low px-2.5 py-1 text-label-sm font-semibold text-on-surface-variant hover:border-primary/40 hover:text-primary"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-space-xs">
              <label className="flex flex-col gap-space-xs text-label-md font-semibold text-on-surface-variant">
                Repetir mientras esté en línea (minutos)
                <div className="flex items-center gap-space-sm">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={repeatIntervalMinutes}
                    onChange={(event) => setRepeatIntervalMinutes(Number(event.target.value) || 0)}
                    className="h-10 w-28 rounded-xl border border-outline-variant/60 bg-surface px-space-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
                  />
                  <span className="text-label-sm text-on-surface-variant">
                    {repeatIntervalMinutes > 0
                      ? `Saldrá al iniciar sesión y cada ${repeatIntervalMinutes} min`
                      : '0 = Solo al iniciar sesión'}
                  </span>
                </div>
              </label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  { label: 'Solo al entrar', minutes: 0 },
                  { label: 'Cada 5 min', minutes: 5 },
                  { label: 'Cada 15 min', minutes: 15 },
                  { label: 'Cada 30 min', minutes: 30 },
                  { label: 'Cada 1 hora', minutes: 60 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setRepeatIntervalMinutes(preset.minutes)}
                    className={cx(
                      'rounded-pill border px-2.5 py-1 text-label-sm font-semibold transition-colors',
                      repeatIntervalMinutes === preset.minutes
                        ? 'border-primary bg-primary-fixed/50 text-primary'
                        : 'border-outline-variant/50 bg-surface-container-low text-on-surface-variant hover:border-primary/40 hover:text-primary',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-space-xs text-label-md font-semibold text-on-surface-variant">
              Mensaje
              <textarea
                required
                rows={4}
                maxLength={1500}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ej. Hoy a las 5:00 PM reiniciaremos el servidor por mantenimiento durante 10 minutos..."
                className="rounded-xl border border-outline-variant/60 bg-surface p-space-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
              />
            </label>

            {createAnnouncement.error && (
              <p className="text-label-sm text-error">{createAnnouncement.error.message}</p>
            )}

            <button
              type="submit"
              disabled={createAnnouncement.isPending || !title.trim() || !message.trim()}
              className="inline-flex h-10 items-center justify-center gap-space-xs rounded-xl bg-primary-container px-space-lg font-semibold text-body-md text-on-primary transition-colors hover:bg-primary disabled:opacity-50"
            >
              <Send aria-hidden className="size-4" />
              {createAnnouncement.isPending ? 'Publicando…' : 'Publicar aviso'}
            </button>
          </form>
        </Card>

        {/* Lista de avisos */}
        <Card className="flex flex-col gap-space-md p-space-lg lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-title-md text-primary">Avisos publicados</h2>
            <span className="text-label-sm text-on-surface-variant">
              {announcements.filter((item) => item.active && new Date(item.expiresAt).getTime() > now).length} vigente(s)
            </span>
          </div>

          {announcements.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Sin avisos publicados"
              description="Crea un aviso para notificar a todos los usuarios al ingresar al sistema."
            />
          ) : (
            <div className="flex flex-col gap-space-sm">
              {announcements.map((item) => {
                const expired = new Date(item.expiresAt).getTime() <= now;
                const isLive = item.active && !expired;
                const statusLabel = isLive ? 'Vigente' : expired ? 'Expirado' : 'Desactivado';
                const statusTone = isLive ? 'success' : expired ? 'muted' : 'warning';

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-space-xs rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-space-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-space-sm">
                      <div className="flex flex-wrap items-center gap-space-xs">
                        <Badge tone={statusTone}>{statusLabel}</Badge>
                        <Badge tone={item.type === 'WARNING' ? 'warning' : item.type === 'UPDATE' ? 'success' : 'primary'}>
                          {TYPE_OPTIONS.find((opt) => opt.value === item.type)?.label ?? item.type}
                        </Badge>
                        <h3 className="font-semibold text-body-lg text-primary">{item.title}</h3>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleAnnouncement.mutate({ id: item.id, active: !item.active })}
                          disabled={toggleAnnouncement.isPending}
                          title={item.active ? 'Desactivar aviso' : 'Reactivar aviso'}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-outline-variant/60 bg-surface px-2.5 text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                        >
                          <Power aria-hidden className="size-3.5" />
                          {item.active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAnnouncement.mutate(item.id)}
                          disabled={deleteAnnouncement.isPending}
                          title="Eliminar aviso"
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-outline-variant/60 bg-surface text-on-surface-variant hover:border-error/40 hover:bg-error-container/40 hover:text-error"
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="whitespace-pre-line text-body-md text-on-surface">{item.message}</p>

                    <div className="flex flex-wrap items-center gap-x-space-md gap-y-1 text-label-sm text-on-surface-variant">
                      <span className="inline-flex items-center gap-1">
                        <Clock aria-hidden className="size-3.5" />
                        Hasta: <strong className="text-on-surface">{formatDateTime(item.expiresAt)}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Repeat aria-hidden className="size-3.5" />
                        {(item.repeatIntervalMinutes ?? 0) > 0
                          ? `Cada ${item.repeatIntervalMinutes} min en línea`
                          : 'Solo al iniciar sesión'}
                      </span>
                      <span>Creado: {formatDateTime(item.createdAt)}</span>
                      {item.createdByName && <span>Por: {item.createdByName}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

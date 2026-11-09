'use client';

// ============================================================
// Usuarios → Bitácoras → tarjeta «Base de datos local».
//
// Solo aparece cuando el API de este worktree tiene DB_MIRROR_ENABLED=1
// (entorno de pruebas). Toma una foto del worktree main y reemplaza la BD
// local en caliente. El API valida de nuevo que quien pulsa sea ADMIN.
// ============================================================

import type { DbMirrorRestoreResult, DbMirrorStatus } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, DatabaseZap, HardDrive, Loader2, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Badge, Card, cx } from '../ui';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function DbMirrorCard() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const status = useQuery<DbMirrorStatus>({
    queryKey: ['db-mirror'],
    queryFn: () => apiFetch<DbMirrorStatus>('/dev/db-mirror'),
    retry: false,
    staleTime: 60_000,
  });

  const restore = useMutation({
    mutationFn: () => apiFetch<DbMirrorRestoreResult>('/dev/db-mirror/restore', { method: 'POST' }),
    onSuccess: async (result) => {
      setConfirming(false);
      setNotice({
        tone: 'ok',
        text: `Restaurado: ${result.rows} filas de ${result.tables} tablas en ${Math.round(result.durationMs)} ms. Recargando…`,
      });
      await queryClient.invalidateQueries();
      // La sesión también viene de main: una recarga deja todo coherente.
      window.setTimeout(() => window.location.reload(), 1400);
    },
    onError: (error) => {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'No se pudo restaurar la base de datos.',
      });
    },
  });

  // 404/403 = capacidad apagada en este entorno: la tarjeta no se muestra.
  if (status.isError || !status.data) return null;
  const data = status.data;
  const differences = data.counts.filter((row) => row.source !== row.target).length;
  const blocked = !data.schemaOk || data.busy || restore.isPending;

  return (
    <>
      <Card className="p-space-md">
        <div className="flex flex-wrap items-start justify-between gap-space-sm">
          <div className="flex items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-fixed text-primary">
              <DatabaseZap aria-hidden className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-space-xs">
                <p className="font-bold uppercase tracking-wider text-label-md text-primary">Base de datos local</p>
                <Badge tone="warning">Solo desarrollo</Badge>
                <Badge tone={data.schemaOk ? 'success' : 'danger'}>
                  {data.schemaOk ? 'Esquema compatible' : 'Esquema incompatible'}
                </Badge>
              </div>
              <p className="mt-0.5 text-label-sm normal-case text-on-surface-variant">
                El worktree <strong>main</strong> manda. Esta acción reemplaza la BD de este worktree por una foto
                actual de main, sin reiniciar la API.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setConfirming(true);
            }}
            disabled={blocked}
            title={data.busy ? 'Hay una restauración en curso' : 'Reemplazar la BD local con la foto actual de main'}
            className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-md font-semibold text-body-md text-primary shadow-soft transition-colors hover:bg-surface-container-low disabled:opacity-40"
          >
            <RefreshCw aria-hidden className={cx('size-4', restore.isPending && 'animate-spin')} />
            {restore.isPending ? 'Restaurando…' : 'Restaurar desde main'}
          </button>
        </div>

        <div className="mt-space-md grid gap-space-sm md:grid-cols-2">
          <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/40 p-space-sm">
            <p className="flex items-center gap-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">
              <HardDrive aria-hidden className="size-3.5" /> Origen · main
            </p>
            <p className="mt-1 break-all font-mono text-label-sm text-on-surface-variant">{data.source.path}</p>
            <p className="mt-1 text-body-md text-on-surface">
              {stamp(data.source.modifiedAt)} · {bytes(data.source.sizeBytes)} · {data.source.tables} tablas
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/40 p-space-sm">
            <p className="flex items-center gap-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">
              <HardDrive aria-hidden className="size-3.5" /> Destino · este worktree
            </p>
            <p className="mt-1 break-all font-mono text-label-sm text-on-surface-variant">{data.target.path}</p>
            <p className="mt-1 text-body-md text-on-surface">
              {stamp(data.target.modifiedAt)} · {bytes(data.target.sizeBytes)} · {data.target.tables} tablas
            </p>
          </div>
        </div>

        <p className="mt-space-sm text-label-sm normal-case text-on-surface-variant">
          {differences === 0
            ? 'Las tablas ya tienen las mismas filas que main.'
            : `${differences} de ${data.counts.length} tablas tienen filas distintas a main.`}
        </p>

        {!data.schemaOk && (
          <div className="mt-space-sm rounded-xl border border-error/40 bg-error/5 p-space-sm text-body-md text-on-surface">
            <p className="flex items-center gap-space-xs font-semibold text-error">
              <AlertTriangle aria-hidden className="size-4" /> El volcado está bloqueado
            </p>
            <ul className="mt-1 list-disc pl-5 text-label-md text-on-surface-variant">
              {data.schemaIssues.slice(0, 6).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            {data.schemaIssues.length > 6 && (
              <p className="mt-1 text-label-sm text-outline">… y {data.schemaIssues.length - 6} diferencias más.</p>
            )}
            <p className="mt-1 text-label-sm text-on-surface-variant">
              Corre <code className="font-mono">pnpm db:push</code> en el worktree atrasado y recarga.
            </p>
          </div>
        )}
      </Card>

      {confirming && (
        <ConfirmRestore
          source={data.source.path}
          sourceModifiedAt={data.source.modifiedAt}
          pending={restore.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => restore.mutate()}
        />
      )}

      {notice && (
        <div
          role="status"
          className={cx(
            'animate-rise fixed bottom-space-lg left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-space-sm rounded-pill px-space-lg py-space-sm text-body-md font-semibold shadow-hero',
            notice.tone === 'ok' ? 'bg-primary text-on-primary' : 'bg-error text-on-error',
          )}
        >
          {notice.tone === 'ok' ? (
            <CheckCircle2 aria-hidden className="size-4" />
          ) : (
            <AlertTriangle aria-hidden className="size-4" />
          )}
          {notice.text}
        </div>
      )}
    </>
  );
}

function ConfirmRestore({
  source,
  sourceModifiedAt,
  pending,
  onCancel,
  onConfirm,
}: {
  source: string;
  sourceModifiedAt: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="animate-fade fixed inset-0 z-50 grid place-items-center bg-primary/40 p-space-md backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="db-mirror-title"
        className="animate-rise w-full max-w-lg rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-space-lg shadow-hero"
      >
        <div className="flex items-start justify-between gap-space-md">
          <div className="flex items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-error/10 text-error">
              <AlertTriangle aria-hidden className="size-5" />
            </span>
            <div>
              <h2 id="db-mirror-title" className="text-headline-md text-primary">
                ¿Restaurar la base de datos?
              </h2>
              <p className="mt-1 text-body-md text-on-surface-variant">
                Se reemplazará <strong>toda</strong> la BD de este worktree con la foto de main del{' '}
                <strong>{stamp(sourceModifiedAt)}</strong>. Se pierden los datos de prueba locales.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <p className="mt-space-md break-all rounded-xl bg-surface-container-low/60 p-space-sm font-mono text-label-sm text-on-surface-variant">
          {source}
        </p>

        <div className="mt-space-lg flex items-center justify-end gap-space-sm">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex h-9 items-center gap-space-xs rounded-pill bg-error px-space-md font-semibold text-body-md text-on-error shadow-soft transition-colors hover:bg-error/90 disabled:opacity-60"
          >
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
            {pending ? 'Restaurando…' : 'Sí, restaurar'}
          </button>
        </div>
      </div>
    </div>
  );
}

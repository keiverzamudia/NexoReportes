'use client';

// ============================================================
// Publicar un despacho desde un escenario guardado.
//
// El planificador elige el plan (con su foto: renglones, sacos, kg, cobertura),
// decide si va a un operador concreto o a «todo el almacén» (bandeja
// compartida) y escribe instrucciones. Al publicar, el almacén recibe la
// notificación.
// ============================================================

import type { DispatchAssigneesResponse, DispatchSheetDetail, ScenarioListResponse, ScenarioListItem } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Loader2, Send, ShieldAlert, ShoppingCart, Truck, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatNumber, relativeTime } from '../lib/dispatch-sheet';
import { Badge, EmptyState, Select, Skeleton, cx } from './ui';

export function PublishDispatchDialog({
  open,
  onClose,
  onPublished,
  canManageUsers = false,
}: {
  open: boolean;
  onClose: () => void;
  onPublished: (sheet: DispatchSheetDetail) => void;
  /** ADMIN: puede resolver el bloqueo por sí mismo (enlace a Usuarios). */
  canManageUsers?: boolean;
}) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: scenarios, isLoading: scenariosLoading } = useQuery<ScenarioListResponse>({
    queryKey: ['scenarios'],
    queryFn: () => apiFetch<ScenarioListResponse>('/scenarios'),
    enabled: open,
    retry: false,
  });

  const { data: readiness } = useQuery<DispatchAssigneesResponse>({
    queryKey: ['dispatch-assignees'],
    queryFn: () => apiFetch<DispatchAssigneesResponse>('/dispatch-sheets/assignees'),
    enabled: open,
    retry: false,
  });

  const items = scenarios?.items ?? [];
  const selected = items.find((item) => item.id === scenarioId) ?? null;
  const operators = readiness?.operators ?? [];
  // Sin operadores de almacén activos el aviso no tendría a quién llegar:
  // el servidor lo bloquea (409) y aquí se explica antes de intentarlo.
  const warehouseReady = readiness?.hasWarehouseOperators ?? true;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setScenarioId('');
    setTitle('');
    setInstructions('');
    setAssigneeId('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  function pick(item: ScenarioListItem) {
    setScenarioId(item.id);
    // El título nace del nombre del escenario y el planificador lo ajusta.
    setTitle((current) => (current.trim() === '' ? item.name : current));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!scenarioId || !title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sheet = await apiFetch<DispatchSheetDetail>('/dispatch-sheets', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId,
          title: title.trim(),
          instructions: instructions.trim() || undefined,
          assignedToId: assigneeId || null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['dispatch-sheets'] });
      onPublished(sheet);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo publicar el despacho');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        className="animate-rise relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <Truck aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">Almacén</p>
              <h2 id="publish-title" className="text-headline-md text-primary">
                Publicar despacho
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Elige un plan guardado: el almacén lo recibirá como orden de trabajo con acuse.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
            <fieldset className="flex flex-col gap-space-sm">
              <legend className="mb-space-xs font-semibold uppercase tracking-wider text-label-md text-outline">
                Plan guardado
              </legend>

              {scenariosLoading && (
                <>
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl" />
                </>
              )}

              {!scenariosLoading && items.length === 0 && (
                <EmptyState
                  icon={ShoppingCart}
                  title="No tienes simulaciones guardadas"
                  description="Arma el plan en Pedidos, guárdalo con nombre y vuelve aquí para publicarlo al almacén."
                  action={
                    <Link
                      href="/pedidos"
                      className="mt-space-sm inline-flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary"
                    >
                      <ShoppingCart aria-hidden className="size-4" /> Ir al simulador
                    </Link>
                  }
                />
              )}

              {items.map((item) => {
                const active = item.id === scenarioId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pick(item)}
                    aria-pressed={active}
                    className={cx(
                      'flex flex-wrap items-center justify-between gap-space-sm rounded-xl border px-space-sm py-space-sm text-left transition-colors',
                      active
                        ? 'border-primary-container/50 bg-primary-fixed/40 shadow-soft'
                        : 'border-outline-variant/35 bg-surface-container-lowest hover:bg-surface-container-low',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-on-surface">{item.name}</span>
                      <span className="text-label-sm text-on-surface-variant">
                        {formatNumber(item.lineCount)} renglón(es) · {formatNumber(item.sacks)} sacos · {formatNumber(item.assignedKg)} kg ·
                        guardada {relativeTime(item.updatedAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-space-xs">
                      {item.stale && (
                        <Badge tone="warning" dot>
                          datos nuevos
                        </Badge>
                      )}
                      <Badge tone={item.coverage >= 100 ? 'success' : item.coverage > 0 ? 'warning' : 'danger'}>{item.coverage}%</Badge>
                    </span>
                  </button>
                );
              })}
            </fieldset>

            {selected && (
              <div className="mt-space-md grid gap-space-sm rounded-xl border border-outline-variant/35 bg-surface-container-low/60 p-space-sm sm:grid-cols-2">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Título del despacho</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={120}
                    placeholder="Despacho lunes 20/10"
                    className="h-10 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                  />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Instrucciones para el almacén</span>
                  <textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Cargar por la puerta 2. Priorizar el pedido 408251710."
                    className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-sm py-2 text-body-md text-on-surface outline-none focus:border-transparent focus:ring-2 focus:ring-secondary-container/70"
                  />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="flex items-center gap-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">
                    <UserCheck aria-hidden className="size-3.5" /> Destinatario
                  </span>
                  <Select
                    value={assigneeId}
                    onChange={setAssigneeId}
                    ariaLabel="Destinatario del despacho"
                    options={[
                      { value: '', label: 'Todo el almacén (bandeja compartida)' },
                      ...operators.map((user) => ({
                        value: user.id,
                        label: `${user.displayName} · ${user.code}${user.role === 'ADMIN' ? ' (supervisor)' : ''}`,
                      })),
                    ]}
                  />
                  <span className="text-label-sm normal-case text-on-surface-variant">
                    {assigneeId
                      ? 'Solo esa persona lo verá y podrá cargarlo.'
                      : 'Cualquier operador de almacén puede tomarlo; el primero que lo abra lo reclama.'}
                  </span>
                </label>
              </div>
            )}

            {selected && selected.stale && (
              <p className="mt-space-sm flex items-start gap-space-sm rounded-xl border border-warning/40 bg-warning/10 px-space-sm py-space-xs text-body-md text-on-surface">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                Ese plan se guardó antes de la última sincronización. Restáuralo en Pedidos si quieres publicar cantidades al día.
              </p>
            )}

            {!warehouseReady && (
              <div className="mt-space-sm flex flex-wrap items-start justify-between gap-space-sm rounded-xl border border-critical/40 bg-critical-container/40 px-space-sm py-space-sm">
                <p className="flex min-w-[16rem] flex-1 items-start gap-space-sm text-body-md text-on-surface">
                  <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
                  <span>
                    <strong>No hay operadores de almacén activos.</strong> El despacho no tendría a quién llegar, así que la
                    publicación está bloqueada. Un administrador debe asignar el rol <strong>Almacén</strong> en Usuarios.
                  </span>
                </p>
                {canManageUsers && (
                  <Link
                    href="/usuarios"
                    className="inline-flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-sm font-semibold text-label-md text-primary transition-colors hover:bg-surface-container-low"
                  >
                    <UserCheck aria-hidden className="size-3.5" /> Asignar rol en Usuarios
                  </Link>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-space-sm flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" /> {error}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm sm:px-space-lg">
            <span className="flex items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
              <CalendarClock aria-hidden className="size-3.5" />
              {selected
                ? `${formatNumber(selected.lineCount)} renglones · ${formatNumber(selected.sacks)} sacos · ${formatNumber(selected.assignedKg)} kg`
                : 'Elige un plan para continuar'}
            </span>
            <div className="flex items-center gap-space-sm">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!scenarioId || !title.trim() || busy || !warehouseReady}
                title={warehouseReady ? undefined : 'Asigna el rol Almacén a un operador antes de publicar'}
                className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
              >
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                Publicar al almacén
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

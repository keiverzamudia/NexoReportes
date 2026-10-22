'use client';

// ============================================================
// Simulaciones guardadas del simulador de despacho.
//
// · Lista los escenarios del usuario (nunca los de otro) con su foto:
//   sacos, kg, cobertura y aviso de datos nuevos.
// · «Ver foto» muestra los números congelados del momento de guardar.
// · «Restaurar» delega en la página: esta recalcula con los datos de hoy y
//   abre RestorePreviewDialog antes de pisar el plan actual.
// · Borrar pide confirmación; renombrar usa el versionado optimista.
// ============================================================

import type { ScenarioDetail, ScenarioListResponse, ScenarioListItem } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  History,
  Loader2,
  Package,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ScenarioDrift } from '../lib/scenario';
import { restoreLogParts } from '../lib/scenario';
import { relativeTime } from '../lib/dispatch-sheet';
import { Badge, Skeleton, fmtDate, fmtQty } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export interface CurrentPlanSummary {
  lineCount: number;
  sacks: number;
  assignedKg: number;
  coverage: number;
}

export interface ScenariosDialogProps {
  open: boolean;
  onClose: () => void;
  /** Hay al menos un renglón marcado: se puede guardar. */
  canSave: boolean;
  current: CurrentPlanSummary;
  /** Abre directo el formulario de guardado (botón «Guardar» del plan). */
  startSaving: boolean;
  onSave: (name: string) => Promise<void>;
  onRestore: (detail: ScenarioDetail) => Promise<void>;
}

export function ScenariosDialog({
  open,
  onClose,
  canSave,
  current,
  startSaving,
  onSave,
  onRestore,
}: ScenariosDialogProps) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Detalle bajo demanda: la foto congelada y el historial comparten consulta.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<'photo' | 'history'>('photo');

  const { data, isLoading, error } = useQuery<ScenarioListResponse>({
    queryKey: ['scenarios'],
    queryFn: () => apiFetch<ScenarioListResponse>('/scenarios'),
    enabled: open,
    retry: false,
  });

  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery<ScenarioDetail>({
    queryKey: ['scenario', detailId],
    queryFn: () => apiFetch<ScenarioDetail>(`/scenarios/${detailId}`),
    enabled: open && detailId !== null,
    retry: false,
  });

  // Al abrir: form limpio y, si vienes del botón «Guardar», formulario visible.
  useEffect(() => {
    if (!open) return;
    setSaving(Boolean(startSaving) && canSave);
    setName('');
    setActionError(null);
    setRenameId(null);
    setConfirmDeleteId(null);
    setDetailId(null);
    setDetailView('photo');
  }, [open, startSaving, canSave]);

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

  const draft = data?.draft ?? null;
  const items = data?.items ?? [];

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
  }

  async function submitSave(event: React.FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || busyId) return;
    setBusyId('save');
    setActionError(null);
    try {
      await onSave(clean);
      setName('');
      setSaving(false);
      await refreshList();
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo guardar la simulación'));
    } finally {
      setBusyId(null);
    }
  }

  async function restore(item: ScenarioListItem) {
    setBusyId(item.id);
    setActionError(null);
    try {
      const detail = await apiFetch<ScenarioDetail>(`/scenarios/${item.id}`);
      await onRestore(detail);
      onClose();
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo restaurar la simulación'));
    } finally {
      setBusyId(null);
    }
  }

  async function submitRename(item: ScenarioListItem) {
    const clean = renameName.trim();
    if (!clean) return;
    setBusyId(item.id);
    setActionError(null);
    try {
      await apiFetch<ScenarioDetail>(`/scenarios/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: clean, version: item.version }),
      });
      setRenameId(null);
      await refreshList();
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo renombrar'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: ScenarioListItem) {
    setBusyId(item.id);
    setActionError(null);
    try {
      await apiFetch(`/scenarios/${item.id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      if (detailId === item.id) setDetailId(null);
      await refreshList();
    } catch (err) {
      setActionError(messageOf(err, 'No se pudo borrar'));
    } finally {
      setBusyId(null);
    }
  }

  function toggleDetail(item: ScenarioListItem, view: 'photo' | 'history') {
    if (detailId === item.id && detailView === view) {
      setDetailId(null);
      return;
    }
    setDetailId(item.id);
    setDetailView(view);
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
        aria-labelledby="scenarios-title"
        className="animate-rise relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 flex-wrap items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container shadow-soft">
              <History aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Simulador de despacho
              </p>
              <h2 id="scenarios-title" className="text-headline-md text-primary">
                Simulaciones guardadas
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Se guardan en tu usuario: cierras sesión o cambias de equipo y siguen ahí.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-sm">
            {items.length > 0 && (
              <Badge tone="muted" dot>
                {items.length}/{data?.limit ?? 25}
              </Badge>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar simulaciones guardadas"
              className="grid size-9 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          {/* Guardar el plan actual */}
          <section className="rounded-xl border border-outline-variant/35 bg-surface-container-low/60 p-space-sm">
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <div>
                <p className="font-semibold text-primary">Ahora mismo</p>
                <p className="text-label-sm text-on-surface-variant">
                  {current.lineCount > 0
                    ? `${current.lineCount} renglón(es) · ${fmtQty(current.sacks, 0)} sacos · ${fmtQty(current.assignedKg, 0)} kg · ${Math.round(current.coverage * 100)}% cobertura`
                    : 'Marca renglones en la cartera para armar un plan y poder guardarlo.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaving((value) => !value)}
                disabled={!canSave}
                title={canSave ? undefined : 'El plan está vacío: marca al menos un renglón'}
                className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
              >
                <Save aria-hidden className="size-4" /> Guardar la actual
              </button>
            </div>

            {saving && (
              <form onSubmit={submitSave} className="mt-space-sm flex flex-wrap items-end gap-space-sm">
                <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
                  <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Nombre</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    placeholder="Despacho lunes 20/10…"
                    className="h-9 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md text-on-surface outline-none focus:border-primary-container"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!name.trim() || busyId === 'save'}
                  className="flex h-9 items-center gap-space-xs rounded-pill bg-primary px-space-md font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {busyId === 'save' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setSaving(false)}
                  className="h-9 rounded-pill px-space-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  Cancelar
                </button>
              </form>
            )}

            {draft && draft.lineCount > 0 && (
              <p className="mt-space-xs flex items-center gap-space-xs text-label-sm text-on-surface-variant">
                <Clock3 aria-hidden className="size-3.5 shrink-0" />
                Tu trabajo en curso se autoguarda ({draft.lineCount} renglón(es) · {fmtDateTime(draft.updatedAt)}). No hace
                falta guardarlo para no perderlo.
              </p>
            )}
          </section>

          {actionError && (
            <p role="alert" className="mt-space-sm flex items-center gap-space-sm text-body-md text-error">
              <AlertTriangle aria-hidden className="size-4 shrink-0" /> {actionError}
            </p>
          )}

          {/* Lista */}
          <div className="mt-space-md flex flex-col gap-space-sm">
            {isLoading && (
              <>
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
              </>
            )}

            {error && !isLoading && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" /> {messageOf(error, 'No se pudieron cargar las simulaciones')}
              </p>
            )}

            {!isLoading && !error && items.length === 0 && (
              <div className="rounded-xl border border-dashed border-outline-variant/50 p-space-lg text-center">
                <History aria-hidden className="mx-auto size-7 text-outline" />
                <p className="mt-space-sm font-semibold text-on-surface">Todavía no hay simulaciones guardadas.</p>
                <p className="mt-space-2xs text-body-md text-on-surface-variant">
                  Arma un plan, marca renglones y usa «Guardar la actual» para volver a él cuando llegue mercancía o cambien
                  los pedidos.
                </p>
              </div>
            )}

            {items.map((item) => {
              const busy = busyId === item.id;
              const renaming = renameId === item.id;
              const confirming = confirmDeleteId === item.id;
              const openDetail = detailId === item.id;
              const showingPhoto = openDetail && detailView === 'photo';
              const showingHistory = openDetail && detailView === 'history';
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-space-sm transition-colors ${
                    showingPhoto ? 'border-primary-container/40 bg-primary-fixed/20' : 'border-outline-variant/35 bg-surface-container-lowest'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-space-sm">
                    <div className="min-w-0">
                      {renaming ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitRename(item);
                          }}
                          className="flex flex-wrap items-center gap-space-xs"
                        >
                          <input
                            autoFocus
                            value={renameName}
                            onChange={(event) => setRenameName(event.target.value)}
                            maxLength={80}
                            className="h-8 min-w-[14rem] rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md outline-none focus:border-primary-container"
                          />
                          <button
                            type="submit"
                            disabled={!renameName.trim() || busy}
                            className="rounded-pill bg-primary-container px-space-sm py-1 font-semibold text-label-md text-on-primary disabled:opacity-40"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenameId(null)}
                            className="rounded-pill px-space-sm py-1 font-semibold text-label-md text-on-surface-variant hover:bg-surface-container-low"
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <p className="truncate font-semibold text-on-surface">{item.name}</p>
                      )}
                      <p className="text-label-sm text-on-surface-variant">
                        {fmtDateTime(item.updatedAt)} · {item.lineCount} renglón(es)
                        {item.restoreCount > 0
                          ? ` · restaurada ${item.restoreCount} ${item.restoreCount === 1 ? 'vez' : 'veces'}${
                              item.restoredAt ? ` (última ${relativeTime(item.restoredAt)})` : ''
                            }`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-space-xs">
                      {item.stale && (
                        <Badge tone="warning" dot>
                          datos nuevos
                        </Badge>
                      )}
                      <Badge tone={item.coverage >= 100 ? 'success' : item.coverage > 0 ? 'warning' : 'danger'}>
                        {item.coverage}%
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-space-xs flex flex-wrap items-center gap-x-space-md gap-y-1 text-label-sm tabular-nums text-on-surface-variant">
                    <span className="flex items-center gap-1">
                      <Package aria-hidden className="size-3.5" />
                      <strong className="text-primary">{fmtQty(item.sacks, 0)}</strong> sacos
                    </span>
                    <span>
                      <strong className="text-secondary">{fmtQty(item.assignedKg, 0)}</strong> kg asignados
                    </span>
                    {item.missingKg > 0 && (
                      <span className="font-semibold text-error">{fmtQty(item.missingKg, 0)} kg faltantes</span>
                    )}
                  </div>

                  <div className="mt-space-sm flex flex-wrap items-center gap-space-xs">
                    <button
                      type="button"
                      onClick={() => void restore(item)}
                      disabled={busy || renaming}
                      className="flex h-8 items-center gap-space-xs rounded-pill bg-primary-container px-space-sm font-semibold text-label-md text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
                    >
                      {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden className="size-3.5" />}
                      Restaurar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDetail(item, 'photo')}
                      className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      {showingPhoto ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
                      {showingPhoto ? 'Ocultar foto' : 'Ver foto'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDetail(item, 'history')}
                      className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      <History aria-hidden className="size-3.5" />
                      Historial
                      {item.restoreCount > 0 && (
                        <span className="grid min-w-4 place-items-center rounded-full bg-primary-container px-1 text-[10px] font-bold text-on-primary">
                          {item.restoreCount}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameId(item.id);
                        setRenameName(item.name);
                        setConfirmDeleteId(null);
                      }}
                      className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      <Pencil aria-hidden className="size-3.5" /> Renombrar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(confirming ? null : item.id)}
                      className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-error transition-colors hover:bg-error/10"
                    >
                      <Trash2 aria-hidden className="size-3.5" /> Borrar
                    </button>
                  </div>

                  {confirming && (
                    <div className="mt-space-sm flex flex-wrap items-center justify-between gap-space-sm rounded-lg border border-error/30 bg-error/5 px-space-sm py-space-xs">
                      <p className="text-label-md text-on-surface">
                        ¿Borrar «{item.name}»? No se puede deshacer.
                      </p>
                      <div className="flex items-center gap-space-xs">
                        <button
                          type="button"
                          onClick={() => void remove(item)}
                          disabled={busy}
                          className="flex h-8 items-center gap-space-xs rounded-pill bg-error px-space-sm font-semibold text-label-md text-on-primary disabled:opacity-40"
                        >
                          {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Trash2 aria-hidden className="size-3.5" />}
                          Sí, borrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-8 rounded-pill px-space-sm font-semibold text-label-md text-on-surface-variant hover:bg-surface-container-low"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {showingPhoto && (
                    <ScenarioPhoto
                      loading={detailLoading}
                      error={detailError}
                      detail={detail && detail.id === item.id ? detail : null}
                    />
                  )}

                  {showingHistory && (
                    <ScenarioRestoreHistory
                      loading={detailLoading}
                      error={detailError}
                      detail={detail && detail.id === item.id ? detail : null}
                    />
                  )}
                </article>
              );
            })}
          </div>

          <p className="mt-space-md flex items-center gap-space-xs text-label-sm normal-case text-on-surface-variant">
            <CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
            Restaurar nunca escribe en Profit: solo vuelve a simular con los datos de hoy.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Foto congelada ----------

function ScenarioPhoto({
  loading,
  error,
  detail,
}: {
  loading: boolean;
  error: unknown;
  detail: ScenarioDetail | null;
}) {
  if (loading) return <Skeleton className="mt-space-sm h-40 rounded-xl" />;
  if (error) {
    return (
      <p role="alert" className="mt-space-sm text-body-md text-error">
        {messageOf(error, 'No se pudo abrir la foto')}
      </p>
    );
  }
  const snapshot = detail?.payload.snapshot;
  if (!snapshot) {
    return (
      <p className="mt-space-sm text-body-md text-on-surface-variant">
        Esta simulación se guardó sin foto (borrador).
      </p>
    );
  }

  const { totals, lines } = snapshot;
  return (
    <div className="mt-space-sm rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
      <div className="mb-space-xs flex flex-wrap items-center justify-between gap-space-xs">
        <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">
          Foto del {fmtDateTime(snapshot.takenAt)}
        </p>
        <p className="text-label-sm text-on-surface-variant">
          {snapshot.carteraLines} renglones en cartera · {pct(totals.coverage)} cobertura
        </p>
      </div>
      <div className="grid grid-cols-2 gap-space-xs sm:grid-cols-4">
        <PhotoKpi label="Sacos" value={fmtQty(totals.sacks, 0)} />
        <PhotoKpi label="Kg asignados" value={fmtQty(totals.assignedKg, 0)} tone="secondary" />
        <PhotoKpi label="Kg faltantes" value={fmtQty(totals.missingKg, 0)} tone={totals.missingKg > 0 ? 'error' : 'muted'} />
        <PhotoKpi label="Renglones" value={fmtQty(totals.lines, 0)} />
      </div>

      <div className="mt-space-sm max-h-64 overflow-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
        <table className="w-full border-collapse text-label-md">
          <thead className="sticky top-0 bg-surface-container-low">
            <tr className="border-b border-outline-variant/30 text-left text-outline">
              <th className="px-2 py-1 font-semibold">Pedido</th>
              <th className="px-2 py-1 font-semibold">Artículo</th>
              <th className="px-2 py-1 text-right font-semibold">Pend.</th>
              <th className="px-2 py-1 text-right font-semibold">Asignado</th>
              <th className="px-2 py-1 text-right font-semibold">Faltante</th>
              <th className="px-2 py-1 text-right font-semibold">Stock</th>
              <th className="px-2 py-1 text-right font-semibold">Entrega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {lines.map((line) => (
              <tr key={`${line.orderNumber}#${line.productCode}`} className="tabular-nums">
                <td className="px-2 py-1 font-semibold text-primary">{line.orderNumber}</td>
                <td className="max-w-[14rem] truncate px-2 py-1" title={line.description ?? ''}>
                  <span className="font-semibold text-primary">{line.productCode}</span>
                  <span className="text-on-surface-variant"> · {line.description ?? '—'}</span>
                </td>
                <td className="px-2 py-1 text-right">{fmtQty(line.pendingQty, 0)}</td>
                <td className="px-2 py-1 text-right font-semibold text-secondary">{fmtQty(line.assignedQty, 0)}</td>
                <td className={`px-2 py-1 text-right ${line.missingQty > 0 ? 'font-semibold text-error' : 'text-outline'}`}>
                  {fmtQty(line.missingQty, 0)}
                </td>
                <td className="px-2 py-1 text-right text-on-surface-variant">{fmtQty(line.stockTotal, 0)}</td>
                <td className="px-2 py-1 text-right text-on-surface-variant">{fmtDate(line.effectiveDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PhotoKpi({ label, value, tone = 'primary' }: { label: string; value: string; tone?: 'primary' | 'secondary' | 'error' | 'muted' }) {
  const color =
    tone === 'secondary' ? 'text-secondary' : tone === 'error' ? 'text-error' : tone === 'muted' ? 'text-outline' : 'text-primary';
  return (
    <div className="rounded-lg bg-surface-container-lowest p-2">
      <p className="font-semibold uppercase tracking-wider text-label-sm text-outline">{label}</p>
      <p className={`mt-0.5 text-title-md font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

// ---------- Historial de restauraciones ----------

function ScenarioRestoreHistory({
  loading,
  error,
  detail,
}: {
  loading: boolean;
  error: unknown;
  detail: ScenarioDetail | null;
}) {
  if (loading) return <Skeleton className="mt-space-sm h-32 rounded-xl" />;
  if (error) {
    return (
      <p role="alert" className="mt-space-sm text-body-md text-error">
        {messageOf(error, 'No se pudo abrir el historial')}
      </p>
    );
  }

  const restores = detail?.restores ?? [];
  if (restores.length === 0) {
    return (
      <div className="mt-space-sm rounded-xl border border-dashed border-outline-variant/50 p-space-md text-center">
        <History aria-hidden className="mx-auto size-5 text-outline" />
        <p className="mt-space-xs font-semibold text-on-surface">Todavía no la has restaurado</p>
        <p className="text-label-sm normal-case text-on-surface-variant">
          Cada restauración queda aquí con lo que cambió: renglones, kg, cobertura y quién lo hizo.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-space-sm rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
      <p className="mb-space-xs font-semibold uppercase tracking-wider text-label-sm text-outline">
        Historial de restauraciones
      </p>
      <ol className="flex flex-col gap-space-xs">
        {restores.map((log) => {
          const parts = restoreLogParts(log);
          return (
            <li key={log.id} className="flex items-start gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary-fixed text-primary">
                <RotateCcw aria-hidden className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-md text-on-surface">
                  <strong>{parts.author}</strong> restauró {parts.lines}
                </p>
                <p className="text-label-sm tabular-nums text-on-surface-variant">
                  {parts.kg} · cobertura {parts.coverage} · {parts.when}
                </p>
                {parts.changes.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-space-xs">
                    {parts.changes.map((change) => (
                      <li
                        key={change}
                        className="rounded-pill bg-warning-container/70 px-2 py-0.5 text-label-sm font-semibold text-on-warning-container"
                      >
                        {change}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {detail && detail.restoreCount > restores.length && (
        <p className="mt-space-xs text-label-sm normal-case text-outline">
          Se muestran las últimas {restores.length} de {detail.restoreCount} restauraciones.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Preview de restauración: qué cambió entre la foto y los datos de hoy.
// ============================================================

export interface RestorePreviewState {
  detail: ScenarioDetail;
  drift: ScenarioDrift;
  keys: string[];
  currentLines: number;
}

export function RestorePreviewDialog({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: RestorePreviewState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { detail, drift } = preview;
  const snapshot = detail.payload.snapshot;
  const modeLabel = detail.payload.recipe.mode === 'total' ? 'Solicitado total' : 'Solo despachable';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onCancel]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      className="animate-fade fixed inset-0 z-[60] flex items-end justify-center bg-primary/45 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
        className="animate-rise relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
              Restaurar simulación
            </p>
            <h2 id="restore-title" className="truncate text-headline-md text-primary">
              {detail.name}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {snapshot ? `Guardada el ${fmtDateTime(snapshot.takenAt)}` : 'Sin foto'} · {modeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancelar restauración"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          {preview.currentLines > 0 && (
            <p className="mb-space-sm flex items-start gap-space-sm rounded-xl border border-warning/40 bg-warning/10 px-space-sm py-space-xs text-body-md text-on-surface">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              Reemplazará el plan actual de {preview.currentLines} renglón(es) sin guardar.
            </p>
          )}

          <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
            <div className="grid grid-cols-3 gap-space-xs text-label-sm">
              <span />
              <span className="text-right font-semibold uppercase tracking-wider text-outline">Al guardar</span>
              <span className="text-right font-semibold uppercase tracking-wider text-primary">Hoy</span>

              <span className="text-on-surface-variant">Sacos</span>
              <span className="text-right tabular-nums text-on-surface-variant">{fmtQty(drift.before.sacks, 0)}</span>
              <span className="text-right font-bold tabular-nums text-primary">{fmtQty(drift.after.sacks, 0)}</span>

              <span className="text-on-surface-variant">Kg asignados</span>
              <span className="text-right tabular-nums text-on-surface-variant">{fmtQty(drift.before.assignedKg, 0)}</span>
              <span className="text-right font-bold tabular-nums text-secondary">{fmtQty(drift.after.assignedKg, 0)}</span>

              <span className="text-on-surface-variant">Kg faltantes</span>
              <span className="text-right tabular-nums text-on-surface-variant">{fmtQty(drift.before.missingKg, 0)}</span>
              <span className={`text-right font-bold tabular-nums ${drift.after.missingKg > 0 ? 'text-error' : 'text-outline'}`}>
                {fmtQty(drift.after.missingKg, 0)}
              </span>

              <span className="text-on-surface-variant">Cobertura</span>
              <span className="text-right tabular-nums text-on-surface-variant">{pct(drift.before.coverage)}</span>
              <span className={`text-right font-bold tabular-nums ${drift.after.coverage >= 1 ? 'text-success' : 'text-warning'}`}>
                {pct(drift.after.coverage)}
              </span>

              <span className="text-on-surface-variant">Cartera</span>
              <span className="text-right tabular-nums text-on-surface-variant">{drift.carteraBefore} rengl.</span>
              <span className="text-right font-bold tabular-nums text-primary">{drift.carteraAfter} rengl.</span>
            </div>
          </div>

          <div className="mt-space-sm flex flex-col gap-space-xs">
            {!drift.hasChanges ? (
              <p className="flex items-center gap-space-sm text-body-md text-success">
                <CheckCircle2 aria-hidden className="size-4" /> Los datos no cambiaron desde que la guardaste.
              </p>
            ) : (
              <>
                {drift.missing.length > 0 && (
                  <ChangeRow
                    tone="error"
                    text={`${drift.missing.length} renglón(es) ya no están en la cartera (pedido cerrado, cancelado o línea eliminada). Se omitirán.`}
                    items={drift.missing.slice(0, 4).map((line) => `${line.orderNumber} · ${line.productCode}`)}
                  />
                )}
                {drift.stockChanges.length > 0 && (
                  <ChangeRow
                    tone="warning"
                    text={`${drift.stockChanges.length} producto(s) cambiaron de existencia.`}
                    items={drift.stockChanges
                      .slice(0, 4)
                      .map((change) => `${change.productCode}: ${fmtQty(change.before, 0)} → ${fmtQty(change.after, 0)}`)}
                  />
                )}
                {drift.pendingChanges.length > 0 && (
                  <ChangeRow
                    tone="primary"
                    text={`${drift.pendingChanges.length} renglón(es) cambiaron de pendiente.`}
                    items={drift.pendingChanges
                      .slice(0, 4)
                      .map((change) => `${change.line.orderNumber} · ${change.line.productCode}: ${fmtQty(change.line.pendingQty, 0)} → ${fmtQty(change.after, 0)}`)}
                  />
                )}
                {drift.dateChanges.length > 0 && (
                  <ChangeRow
                    tone="primary"
                    text={`${drift.dateChanges.length} fecha(s) de entrega cambiaron; el turno del plan puede moverse.`}
                    items={drift.dateChanges
                      .slice(0, 4)
                      .map((change) => `${change.line.orderNumber} · ${change.line.productCode}: ${fmtDate(change.line.effectiveDate)} → ${fmtDate(change.after)}`)}
                  />
                )}
                {drift.carteraBefore !== drift.carteraAfter && (
                  <p className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
                    <CalendarClock aria-hidden className="size-4 shrink-0" />
                    La cartera pasó de {drift.carteraBefore} a {drift.carteraAfter} renglones.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm sm:px-space-lg">
          <span className="text-label-sm normal-case text-on-surface-variant">
            Se restaurarán {preview.keys.length} de {detail.payload.selected.length} renglón(es).
          </span>
          <div className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-9 rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || preview.keys.length === 0}
              className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RotateCcw aria-hidden className="size-4" />}
              Restaurar y recalcular
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ChangeRow({
  tone,
  text,
  items,
}: {
  tone: 'error' | 'warning' | 'primary';
  text: string;
  items: string[];
}) {
  const color = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-primary';
  return (
    <div className="rounded-xl border border-outline-variant/35 bg-surface-container-lowest px-space-sm py-space-xs">
      <p className={`flex items-start gap-space-sm text-body-md ${color}`}>
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{text}</span>
      </p>
      {items.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-space-md gap-y-0.5 pl-7 text-label-sm tabular-nums text-on-surface-variant">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

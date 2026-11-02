'use client';

// ============================================================
// Panel de cierres por nota de entrega (solo ADMIN).
//
// Muestra la última reconciliación, los pedidos cerrados recientemente y los
// que quedaron en revisión. Permite ejecutar la reconciliación (con dry-run)
// y reabrir un pedido si Profit lo cerró por error.
// ============================================================

import type { OrderLifecycleEvent, OrderLifecycleStatus } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Badge, Skeleton, fmtDate } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function reasonLabel(event: OrderLifecycleEvent): string {
  if (event.reason === 'NOTA_ENTREGA') return 'Nota de entrega';
  if (event.reason === 'CANCELADO') return 'Anulado en Profit';
  return event.reason;
}

function evidenceText(event: OrderLifecycleEvent): string {
  const evidence = event.evidence;
  if (!evidence) return 'Sin evidencia adicional';
  const status = evidence.cotizStatus ?? '—';
  const pending = evidence.pendingQty ?? '—';
  const anulada = evidence.anulada ? 'sí' : 'no';
  return `Profit: estado ${status} · pendiente ${pending} · anulada ${anulada}`;
}

export interface OrderLifecycleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Se llama después de reconciliar o reabrir para refrescar Pedidos. */
  onChanged?: () => void;
}

export function OrderLifecycleDialog({ open, onClose, onChanged }: OrderLifecycleDialogProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, error } = useQuery<OrderLifecycleStatus>({
    queryKey: ['order-lifecycle'],
    queryFn: () => apiFetch<OrderLifecycleStatus>('/orders/lifecycle?limit=20'),
    enabled: open,
    retry: false,
    refetchInterval: open ? 30_000 : false,
  });

  useEffect(() => {
    if (!open) return;
    setActionError(null);
    setReopenId(null);
    setReason('');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function runReconcile(dryRun: boolean) {
    if (busy) return;
    setBusy(dryRun ? 'dry' : 'run');
    setActionError(null);
    try {
      await apiFetch('/orders/lifecycle/reconcile', {
        method: 'POST',
        body: JSON.stringify({ dryRun }),
      });
      await queryClient.invalidateQueries({ queryKey: ['order-lifecycle'] });
      await queryClient.invalidateQueries({ queryKey: ['orders-grouped'] });
      await queryClient.invalidateQueries({ queryKey: ['scenario-draft'] });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      onChanged?.();
    } catch (error) {
      setActionError(messageOf(error, 'No se pudo ejecutar la reconciliación'));
    } finally {
      setBusy(null);
    }
  }

  async function reopen(orderId: string | null) {
    if (!orderId || !reason.trim() || busy) return;
    setBusy(`reopen-${orderId}`);
    setActionError(null);
    try {
      await apiFetch(`/orders/${orderId}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setReopenId(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['order-lifecycle'] });
      await queryClient.invalidateQueries({ queryKey: ['orders-grouped'] });
      await queryClient.invalidateQueries({ queryKey: ['scenario-draft'] });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      onChanged?.();
    } catch (error) {
      setActionError(messageOf(error, 'No se pudo reabrir el pedido'));
    } finally {
      setBusy(null);
    }
  }

  const lastRun = data?.lastRun ?? null;
  const recent = data?.recent ?? [];
  const review = data?.review ?? [];

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="animate-fade fixed inset-0 z-[60] flex items-end justify-center bg-primary/45 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifecycle-title"
        className="animate-rise flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-hero"
      >
        <div aria-hidden className="h-1 w-full shrink-0 bg-secondary-container" />

        <header className="flex shrink-0 items-start justify-between gap-space-md border-b border-outline-variant/30 px-space-md py-space-md sm:px-space-lg">
          <div className="min-w-0">
            <p className="flex items-center gap-space-xs text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
              <ShieldCheck aria-hidden className="size-4" /> Solo administradores
            </p>
            <h2 id="lifecycle-title" className="text-headline-md text-primary">
              Cierres por nota de entrega
            </h2>
            <p className="text-body-md text-on-surface-variant">
              Pedidos que salieron de la cartera porque Profit los convirtió en nota de entrega. Si uno se cerró por error,
              puedes reabrirlo con un motivo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar cierres recientes"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-space-md sm:p-space-lg">
          {isLoading && (
            <div className="flex flex-col gap-space-sm">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          )}

          {error && !isLoading && (
            <p role="alert" className="flex items-center gap-space-sm rounded-xl bg-error/10 px-space-sm py-space-xs text-body-md text-error">
              <AlertTriangle aria-hidden className="size-4" /> {messageOf(error, 'No se pudo cargar el panel')}
            </p>
          )}

          {!isLoading && !error && (
            <>
              <section className="grid gap-space-sm sm:grid-cols-3">
                <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Cerrados hoy</p>
                  <p className="text-data-tabular-lg font-bold text-primary">{data?.closedToday ?? 0}</p>
                  <p className="text-label-sm text-on-surface-variant">por nota de entrega</p>
                </div>
                <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Requieren revisión</p>
                  <p className="text-data-tabular-lg font-bold text-warning">{data?.pendingReview ?? 0}</p>
                  <p className="text-label-sm text-on-surface-variant">no se cerraron solos</p>
                </div>
                <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low/50 p-space-sm">
                  <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Última corrida</p>
                  <p className="text-title-md font-semibold text-primary">{lastRun ? fmtDateTime(lastRun.startedAt) : '—'}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    {lastRun
                      ? `${lastRun.checked} revisados · ${lastRun.closed} cerrados · ${lastRun.canceled} anulados`
                      : 'Aún no se ha ejecutado'}
                  </p>
                </div>
              </section>

              <div className="mt-space-md flex flex-wrap items-center gap-space-sm">
                <button
                  type="button"
                  onClick={() => void runReconcile(false)}
                  disabled={Boolean(busy)}
                  className="flex h-9 items-center gap-space-xs rounded-pill bg-primary-container px-space-md font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-40"
                >
                  {busy === 'run' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
                  Revisar ahora
                </button>
                <button
                  type="button"
                  onClick={() => void runReconcile(true)}
                  disabled={Boolean(busy)}
                  title="Calcula el resultado sin cerrar pedidos"
                  className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                >
                  {busy === 'dry' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden className="size-4" />}
                  Simular sin escribir
                </button>
                {lastRun?.dryRun && <Badge tone="warning" dot>última fue simulacro</Badge>}
              </div>

              {actionError && (
                <p role="alert" className="mt-space-sm rounded-lg bg-error/10 px-space-sm py-space-xs text-body-md text-error">
                  {actionError}
                </p>
              )}

              <section className="mt-space-lg">
                <h3 className="mb-space-sm text-title-md font-semibold text-primary">Cierres recientes</h3>
                {recent.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-outline-variant/50 p-space-md text-body-md text-on-surface-variant">
                    Todavía no hay cierres automáticos. Cuando un pedido pase a nota de entrega aparecerá aquí.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-space-xs">
                    {recent.map((event) => (
                      <li key={event.id} className="rounded-xl border border-outline-variant/35 bg-surface-container-lowest p-space-sm">
                        <div className="flex flex-wrap items-start justify-between gap-space-sm">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-space-xs">
                              <span className="font-semibold text-primary">Pedido {event.orderNumber}</span>
                              <Badge tone={event.reason === 'NOTA_ENTREGA' ? 'success' : 'danger'} dot>
                                {reasonLabel(event)}
                              </Badge>
                              <span className="text-label-sm text-on-surface-variant">{fmtDateTime(event.detectedAt)}</span>
                            </div>
                            <p className="text-body-md text-on-surface">
                              {event.customerName ?? event.customerCode ?? 'Cliente sin nombre'}
                            </p>
                            <p className="text-label-sm text-on-surface-variant">{evidenceText(event)}</p>
                          </div>
                          {event.orderId && (
                            <button
                              type="button"
                              onClick={() => {
                                setReopenId(reopenId === event.orderId ? null : event.orderId);
                                setReason('');
                              }}
                              disabled={Boolean(busy)}
                              className="flex h-8 items-center gap-space-xs rounded-pill border border-outline-variant/50 px-space-sm font-semibold text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                            >
                              <RotateCcw aria-hidden className="size-3.5" /> Reabrir
                            </button>
                          )}
                        </div>
                        {reopenId === event.orderId && (
                          <form
                            onSubmit={(submit) => {
                              submit.preventDefault();
                              void reopen(event.orderId);
                            }}
                            className="mt-space-sm flex flex-wrap items-end gap-space-sm rounded-lg border border-warning/30 bg-warning/5 p-space-sm"
                          >
                            <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                              <span className="font-semibold uppercase tracking-wider text-label-sm text-outline">Motivo de la reapertura</span>
                              <input
                                autoFocus
                                value={reason}
                                onChange={(input) => setReason(input.target.value.slice(0, 240))}
                                maxLength={240}
                                placeholder="Ej. Profit lo cerró por error; sigue pendiente de despacho"
                                className="h-9 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-space-sm text-body-md outline-none focus:border-primary-container"
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={!reason.trim() || Boolean(busy)}
                              className="flex h-9 items-center gap-space-xs rounded-pill bg-warning px-space-md font-semibold text-on-primary disabled:opacity-40"
                            >
                              {busy === `reopen-${event.orderId}` ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RotateCcw aria-hidden className="size-4" />}
                              Confirmar reapertura
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-space-lg">
                <h3 className="mb-space-sm text-title-md font-semibold text-primary">Requieren revisión</h3>
                {review.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-outline-variant/50 p-space-md text-body-md text-on-surface-variant">
                    Todo limpio: ningún pedido quedó en revisión.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-space-xs">
                    {review.map((order) => (
                      <li key={order.id} className="rounded-xl border border-warning/30 bg-warning/5 p-space-sm">
                        <div className="flex flex-wrap items-center justify-between gap-space-xs">
                          <div>
                            <p className="font-semibold text-primary">
                              Pedido {order.externalNumber} · {order.customerName ?? order.customerCode ?? '—'}
                            </p>
                            <p className="text-label-sm text-on-surface-variant">
                              {order.reviewReason ?? 'Sin motivo registrado'} · entrega {fmtDate(order.requestedDate)}
                            </p>
                          </div>
                          <Badge tone="warning" dot>revisar</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-outline-variant/30 bg-surface-container-low/60 px-space-md py-space-sm text-label-sm normal-case text-on-surface-variant sm:px-space-lg">
          El cierre es automático y nunca escribe en Profit. Un pedido cerrado conserva sus renglones y su historial aunque
          desaparezca de la cartera.
        </footer>
      </div>
    </div>
  );
}

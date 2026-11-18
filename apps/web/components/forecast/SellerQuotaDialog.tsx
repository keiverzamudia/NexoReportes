'use client';

// ============================================================
// Cuotas mensuales de activación de un vendedor.
//
// Solo se abre con el permiso `vendedor_cuotas:update`. El servidor vuelve a
// validar el permiso y que el mes no esté cerrado. Las cuotas son locales:
// no se escriben en Profit.
// ============================================================

import type { ForecastSellerQuota, ForecastSellerRow } from '@nexo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCcw, Target, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../lib/api';
import { monthLabel } from '../../lib/sales-report';

function parseQuota(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function quotaText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function SellerQuotaDialog({
  open,
  seller,
  year,
  month,
  quota,
  onClose,
}: {
  open: boolean;
  seller: ForecastSellerRow;
  year: number;
  month: number;
  quota: ForecastSellerQuota | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [reactivation, setReactivation] = useState(quotaText(quota?.reactivationQuota));
  const [newClients, setNewClients] = useState(quotaText(quota?.newClientsQuota));

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setReactivation(quotaText(quota?.reactivationQuota));
    setNewClients(quotaText(quota?.newClientsQuota));
  }, [open, seller.sellerCode, year, month, quota?.reactivationQuota, quota?.newClientsQuota]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const save = useMutation<ForecastSellerQuota, Error, void>({
    mutationFn: () =>
      apiFetch<ForecastSellerQuota>('/forecast/sellers/quotas', {
        method: 'PUT',
        body: JSON.stringify({
          sellerCode: seller.sellerCode,
          year,
          month,
          reactivationQuota: parseQuota(reactivation),
          newClientsQuota: parseQuota(newClients),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-quotas', year, month] });
      onClose();
    },
  });

  useEffect(() => {
    if (open) save.reset();
    // `save.reset` es estable; se limpia el error al reabrir el diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !mounted) return null;

  const reactivationValue = parseQuota(reactivation);
  const newClientsValue = parseQuota(newClients);
  const invalidReactivation = reactivation.trim() !== '' && reactivationValue === null;
  const invalidNewClients = newClients.trim() !== '' && newClientsValue === null;
  const dirty =
    reactivationValue !== (quota?.reactivationQuota ?? null) ||
    newClientsValue !== (quota?.newClientsQuota ?? null);

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-primary/35 p-space-sm backdrop-blur-sm sm:items-center sm:p-space-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-quota-title"
        className="animate-rise w-full max-w-md overflow-hidden rounded-t-2xl border border-outline-variant/35 bg-surface-container-lowest shadow-hero sm:rounded-2xl"
      >
        <div aria-hidden className="h-1 w-full bg-secondary-container" />
        <header className="flex items-start justify-between gap-space-sm border-b border-outline-variant/30 px-space-md py-space-sm">
          <div className="flex min-w-0 items-start gap-space-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-container text-secondary-container">
              <Target aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
                Cuotas de activación
              </p>
              <h2 id="seller-quota-title" className="truncate text-title-md text-primary">
                {seller.sellerName}
              </h2>
              <p className="text-label-sm text-on-surface-variant">
                {monthLabel(year, month)} · cartera actual de Profit
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar cuotas de activación"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <form
          className="flex flex-col gap-space-md p-space-md"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || invalidReactivation || invalidNewClients || save.isPending) return;
            save.mutate();
          }}
        >
          <p className="text-label-sm text-on-surface-variant">
            Este mes lleva{' '}
            <strong className="tabular-nums text-on-surface">
              {seller.activation.reactivatedClients} reactivado
              {seller.activation.reactivatedClients === 1 ? '' : 's'}
            </strong>{' '}
            y{' '}
            <strong className="tabular-nums text-on-surface">
              {seller.activation.newClients} nuevo{seller.activation.newClients === 1 ? '' : 's'}
            </strong>
            .
          </p>

          <label className="flex flex-col gap-space-2xs">
            <span className="flex items-center gap-1.5 text-label-md font-semibold text-on-surface">
              <RefreshCcw aria-hidden className="size-3.5 text-secondary" />
              Cuota de reactivación
            </span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={reactivation}
              onChange={(event) => setReactivation(event.target.value)}
              placeholder="Sin cuota"
              className="h-10 rounded-xl border border-outline-variant/50 bg-surface px-space-sm text-body-md tabular-nums text-on-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70"
            />
            <span className="text-label-sm text-outline">
              Clientes de su cartera sin compras en los últimos 3 meses que vuelven a comprar este mes.
              Déjalo vacío para quitar la cuota.
            </span>
            {invalidReactivation && (
              <span role="alert" className="text-label-sm text-error">
                Usa un número entero mayor o igual a 0.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-space-2xs">
            <span className="flex items-center gap-1.5 text-label-md font-semibold text-on-surface">
              <UserPlus aria-hidden className="size-3.5 text-primary" />
              Cuota de clientes nuevos
            </span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={newClients}
              onChange={(event) => setNewClients(event.target.value)}
              placeholder="Sin cuota"
              className="h-10 rounded-xl border border-outline-variant/50 bg-surface px-space-sm text-body-md tabular-nums text-on-surface focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70"
            />
            <span className="text-label-sm text-outline">
              Clientes sin compras en los 12 meses previos que compran este mes. Déjalo vacío para quitar
              la cuota.
            </span>
            {invalidNewClients && (
              <span role="alert" className="text-label-sm text-error">
                Usa un número entero mayor o igual a 0.
              </span>
            )}
          </label>

          {save.error && (
            <p role="alert" className="flex items-start gap-1.5 text-label-md text-error">
              <X aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {save.error.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-space-sm border-t border-outline-variant/30 pt-space-sm">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!dirty || invalidReactivation || invalidNewClients || save.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-container px-space-md text-label-md font-semibold text-on-primary transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Target aria-hidden className="size-4" />}
              {save.isPending ? 'Guardando…' : 'Guardar cuotas'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

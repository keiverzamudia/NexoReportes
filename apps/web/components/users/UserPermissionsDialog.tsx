'use client';

import type { UserPermissionsResponse } from '@nexo/contracts';
import { permissionKey } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { hasPermission } from '../../lib/permissions';
import { cx } from '../ui';
import { PermissionMatrix, OverrideCycle } from './PermissionMatrix';

// ============================================================
// Excepciones de permisos de un usuario sobre su rol.
// Heredado = lo del rol; Permitir/Denegar = excepción explícita (gana).
// ============================================================

interface UserLite {
  id: string;
  displayName: string;
  profitCode: string;
  role: string;
  roleName?: string;
  protected?: boolean;
}

export function UserPermissionsDialog({
  user,
  permissions,
  onClose,
}: {
  user: UserLite;
  /** Permisos de la sesión que administra. */
  permissions: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = hasPermission(permissions, 'usuarios', 'update');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError } = useQuery<UserPermissionsResponse>({
    queryKey: ['user-permissions', user.id],
    queryFn: () => apiFetch<UserPermissionsResponse>(`/users/${user.id}/permissions`),
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const row of data.overrides) next[permissionKey(row.module, row.action)] = row.allowed;
    setOverrides(next);
  }, [data]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rolePermissions = useMemo(() => data?.rolePermissions ?? [], [data]);
  const isAdmin = data?.role === 'ADMIN' || user.role === 'ADMIN';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['user-permissions', user.id] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const save = useMutation<UserPermissionsResponse, Error, Record<string, boolean>>({
    mutationFn: (value) =>
      apiFetch<UserPermissionsResponse>(`/users/${user.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({
          overrides: Object.entries(value).map(([key, allowed]) => {
            const [module, action] = key.split(':');
            return { module: module ?? '', action, allowed };
          }),
        }),
      }),
    onSuccess: (response) => {
      const next: Record<string, boolean> = {};
      for (const row of response.overrides) next[permissionKey(row.module, row.action)] = row.allowed;
      setOverrides(next);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const reset = useMutation<UserPermissionsResponse, Error, void>({
    mutationFn: () =>
      apiFetch<UserPermissionsResponse>(`/users/${user.id}/permissions`, { method: 'DELETE' }),
    onSuccess: () => {
      setOverrides({});
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const cycle = (module: string, action: string, next: OverrideCycle) => {
    const key = permissionKey(module, action);
    setOverrides((current) => {
      const copy = { ...current };
      if (next === 'inherit') delete copy[key];
      else copy[key] = next === 'allow';
      return copy;
    });
  };

  const overrideCount = Object.keys(overrides).length;

  // Vista previa local de lo efectivo (el servidor vuelve a calcularlo).
  const effective = useMemo(() => {
    const set = new Set(rolePermissions);
    for (const [key, allowed] of Object.entries(overrides)) {
      if (allowed) set.add(key);
      else set.delete(key);
    }
    return set;
  }, [rolePermissions, overrides]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-on-surface/40 p-space-md backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Permisos de ${user.displayName}`}
        className="my-space-lg w-full max-w-3xl rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-float"
      >
        <header className="flex items-start justify-between gap-space-md border-b border-surface-container p-space-md">
          <div>
            <h2 className="flex items-center gap-space-xs text-title-md text-primary">
              <ShieldCheck aria-hidden className="size-5" /> Permisos de {user.displayName}
            </h2>
            <p className="text-label-sm text-on-surface-variant">
              <span className="font-mono">{user.profitCode}</span> · Rol{' '}
              <strong>{data?.roleName ?? user.roleName ?? user.role}</strong> · {effective.size} permiso(s) efectivo(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 place-items-center rounded-full text-outline hover:bg-surface-container-low hover:text-on-surface"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        {isLoading && <p className="p-space-md text-body-md text-on-surface-variant">Cargando permisos…</p>}

        {(queryError || error) && (
          <p role="alert" className="flex items-center gap-space-sm p-space-md text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {error ?? (queryError instanceof Error ? queryError.message : 'No se pudieron cargar los permisos')}
          </p>
        )}

        {data && (
          <>
            {isAdmin ? (
              <p className="m-space-md flex items-center gap-space-sm rounded-lg bg-primary-fixed/40 px-space-md py-space-sm text-body-md text-primary">
                <ShieldCheck aria-hidden className="size-4" />
                El rol ADMIN es de sistema: siempre tiene todos los permisos y no admite excepciones.
              </p>
            ) : (
              <div className="border-b border-surface-container p-space-md">
                <div className="mb-space-sm flex flex-wrap items-center justify-between gap-space-sm">
                  <h3 className="font-semibold text-on-surface">Excepciones sobre el rol</h3>
                  <span className="text-label-sm text-on-surface-variant">
                    {overrideCount === 0
                      ? 'Sin excepciones: hereda todo del rol'
                      : `${overrideCount} excepción(es) configurada(s)`}
                  </span>
                </div>
                <PermissionMatrix
                  mode="user"
                  granted={rolePermissions}
                  overrides={overrides}
                  disabled={!canEdit || save.isPending || reset.isPending}
                  onCycleOverride={cycle}
                />
              </div>
            )}

            <footer className="flex flex-wrap items-center justify-end gap-space-sm p-space-md">
              <button
                type="button"
                onClick={() => reset.mutate()}
                disabled={!canEdit || overrideCount === 0 || reset.isPending || isAdmin}
                title="Volver a heredar todos los permisos del rol"
                className="flex h-9 items-center gap-space-xs rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw aria-hidden className="size-4" /> Restablecer al rol
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
              >
                Cerrar
              </button>
              {!isAdmin && (
                <button
                  type="button"
                  onClick={() => save.mutate(overrides)}
                  disabled={!canEdit || save.isPending || reset.isPending}
                  className={cx(
                    'h-9 rounded-lg bg-primary-container px-space-lg font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60',
                  )}
                >
                  {save.isPending ? 'Guardando…' : 'Aplicar excepciones'}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

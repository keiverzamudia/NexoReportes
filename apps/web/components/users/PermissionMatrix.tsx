'use client';

import { APP_MODULES, PERMISSION_ACTIONS, permissionKey } from '@nexo/contracts';
import { Check, Minus, X } from 'lucide-react';
import { cx } from '../ui';

// ============================================================
// Matriz módulo × acción compartida por el editor de roles y el diálogo de
// excepciones por usuario.
//
// · mode="role": checkbox (concedido / no concedido).
// · mode="user": tri-estado — Heredado (del rol) → Permitir → Denegar → Heredado.
// ============================================================

export type OverrideCycle = 'inherit' | 'allow' | 'deny';

const ACTION_LABEL: Record<(typeof PERMISSION_ACTIONS)[number], string> = {
  read: 'Ver',
  create: 'Crear',
  update: 'Editar',
  delete: 'Eliminar',
};

export interface PermissionMatrixProps {
  mode: 'role' | 'user';
  /** Permisos del rol (en modo user se usan como base heredada). */
  granted: string[];
  /** Excepciones del usuario: clave «modulo:accion» → allowed. */
  overrides?: Record<string, boolean>;
  disabled?: boolean;
  onToggle?: (key: string, next: boolean) => void;
  onCycleOverride?: (module: string, action: string, next: OverrideCycle) => void;
}

export function PermissionMatrix({
  mode,
  granted,
  overrides = {},
  disabled = false,
  onToggle,
  onCycleOverride,
}: PermissionMatrixProps) {
  const roleGrants = new Set(granted);
  const overrideMap = new Map(Object.entries(overrides));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-body-md">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface-container-lowest pb-space-xs pr-space-md text-left font-semibold text-on-surface-variant">
              Módulo
            </th>
            {PERMISSION_ACTIONS.map((action) => (
              <th
                key={action}
                className="px-space-2xs pb-space-xs text-center font-semibold uppercase tracking-wide text-label-sm text-outline"
              >
                {ACTION_LABEL[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {APP_MODULES.map((module) => (
            <tr key={module.key} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 border-t border-surface-container bg-surface-container-lowest py-space-sm pr-space-md text-left font-semibold text-on-surface"
              >
                <span className="block">{module.label}</span>
                <span className="block font-mono text-label-sm font-normal text-outline">{module.key}</span>
              </th>
              {PERMISSION_ACTIONS.map((action) => {
                const definition = module.actions.find((entry) => entry.action === action);
                if (!definition) {
                  return (
                    <td key={action} className="border-t border-surface-container text-center text-outline/50">
                      ·
                    </td>
                  );
                }

                const key = permissionKey(module.key, action);
                const base = roleGrants.has(key);
                const override = overrideMap.get(key);
                const state: OverrideCycle =
                  override === undefined ? 'inherit' : override ? 'allow' : 'deny';
                const effective = override ?? base;

                // En modo usuario el ciclo va del heredado al contrario de la
                // base (así el primer clic siempre cambia algo) y luego alterna.
                const next: OverrideCycle =
                  state === 'inherit' ? (base ? 'deny' : 'allow') : state === 'allow' ? 'deny' : 'inherit';

                const label =
                  mode === 'role'
                    ? `${definition.label} en ${module.label}`
                    : `${definition.label} en ${module.label}: ${
                        state === 'inherit'
                          ? `heredado (${base ? 'permitido' : 'denegado'})`
                          : state === 'allow'
                            ? 'permitido por excepción'
                            : 'denegado por excepción'
                      }`;

                return (
                  <td key={action} className="border-t border-surface-container py-space-xs text-center">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={effective}
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        if (mode === 'role') onToggle?.(key, !base);
                        else onCycleOverride?.(module.key, action, next);
                      }}
                      className={cx(
                        'mx-auto grid size-7 place-items-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        state === 'deny'
                          ? 'border-error/40 bg-error/10 text-error'
                          : effective
                            ? 'border-secondary-container bg-secondary-container text-on-secondary'
                            : 'border-outline-variant/60 bg-surface text-outline hover:border-primary hover:text-primary',
                        state === 'inherit' && 'border-dashed',
                      )}
                    >
                      {state === 'deny' ? (
                        <X aria-hidden className="size-4" />
                      ) : state === 'inherit' ? (
                        <Minus aria-hidden className="size-4" />
                      ) : (
                        <Check aria-hidden className="size-4" />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'user' && (
        <p className="mt-space-sm flex flex-wrap items-center gap-space-md text-label-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-space-2xs">
            <span className="grid size-5 place-items-center rounded border border-dashed border-outline-variant text-outline">
              <Minus aria-hidden className="size-3" />
            </span>
            Heredado
          </span>
          <span className="inline-flex items-center gap-space-2xs">
            <span className="grid size-5 place-items-center rounded bg-secondary-container text-on-secondary">
              <Check aria-hidden className="size-3" />
            </span>
            Permitir
          </span>
          <span className="inline-flex items-center gap-space-2xs">
            <span className="grid size-5 place-items-center rounded bg-error/10 text-error">
              <X aria-hidden className="size-3" />
            </span>
            Denegar
          </span>
          <span>Clic para alternar: heredado → excepción → heredado.</span>
        </p>
      )}
    </div>
  );
}

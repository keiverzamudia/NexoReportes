'use client';

import {
  APP_MODULES,
  MODULE_GROUPS,
  permissionKey,
  type AppModuleDefinition,
  type PermissionAction,
} from '@nexo/contracts';
import { Check, Minus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '../ui';

// ============================================================
// Matriz módulo × acción compartida por el editor de roles y el diálogo de
// excepciones por usuario.
//
// · mode="role": interruptor (concedido / no concedido).
// · mode="user": tri-estado — Heredado (del rol) → Permitir → Denegar → Heredado.
//
// La vista es por tarjetas (un módulo por tarjeta) en vez de una tabla ancha:
// cada acción se lee con su etiqueta y una explicación corta, sin columnas
// verticales ni celdas vacías.
// ============================================================

export type OverrideCycle = 'inherit' | 'allow' | 'deny';

const ACTION_HINT: Record<PermissionAction, string> = {
  read: 'Entrar al módulo y consultar la información.',
  create: 'Crear registros nuevos.',
  update: 'Modificar registros existentes.',
  upload: 'Subir o reemplazar las fotos de los documentos y marcar la llegada en Romana.',
  validate: 'Validar documentos y borrar las fotos de la llegada.',
  change_date: 'Mover la fecha de entrega. Escribe en Profit.',
  delete: 'Eliminar o anular registros.',
  view_all:
    'Ver los datos de todas las personas. Sin este permiso solo ve los propios (su cartera o su ámbito asignado).',
  override: 'Quitar selecciones o asignaciones hechas por otros usuarios.',
  view_summary: 'Ver ventas, indicadores y totales agregados.',
  view_history: 'Ver el historial de movimientos.',
  view_removals: 'Ver los retiros de simulación.',
  optimize: 'Ejecutar la optimización de fórmulas y producción.',
  view_costs: 'Ver costos y márgenes.',
  export: 'Exportar el contenido del módulo.',
  nutrition: 'Editar nutrición y especificaciones.',
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
  /** Cambia varias claves de una vez (botones «Marcar/Quitar lo visible»). */
  onBulkToggle?: (keys: string[], next: boolean) => void;
}

export function PermissionMatrix({
  mode,
  granted,
  overrides = {},
  disabled = false,
  onToggle,
  onCycleOverride,
  onBulkToggle,
}: PermissionMatrixProps) {
  const [query, setQuery] = useState('');
  const roleGrants = useMemo(() => new Set(granted), [granted]);
  const overrideMap = useMemo(() => new Map(Object.entries(overrides)), [overrides]);

  const needle = query.trim().toLowerCase();
  const matches = (module: AppModuleDefinition) => {
    if (!needle) return true;
    const haystack = [
      module.label,
      module.key,
      module.description,
      ...module.actions.flatMap((entry) => [entry.label, ACTION_HINT[entry.action]]),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  };

  const grouped = MODULE_GROUPS.map((group) => ({
    group,
    modules: APP_MODULES.filter((module) => module.group === group && matches(module)),
  })).filter((entry) => entry.modules.length > 0);

  const visibleModules = grouped.flatMap((entry) => entry.modules);
  const visibleKeys = visibleModules.flatMap((module) =>
    module.actions.map((entry) => permissionKey(module.key, entry.action)),
  );
  const totalActions = visibleModules.reduce((total, module) => total + module.actions.length, 0);
  const grantedVisible = visibleKeys.filter((key) => {
    if (mode === 'user') return overrideMap.has(key) ? overrideMap.get(key) : roleGrants.has(key);
    return roleGrants.has(key);
  }).length;

  return (
    <div className="space-y-space-md">
      <div className="flex flex-wrap items-center gap-space-sm">
        <label className="relative min-w-[12rem] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-outline"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar módulo o permiso…"
            aria-label="Buscar módulo o permiso"
            className="h-9 w-full rounded-lg border border-outline-variant/50 bg-surface pl-9 pr-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
          />
        </label>
        {mode === 'role' && onBulkToggle && (
          <div className="flex items-center gap-space-2xs">
            <button
              type="button"
              disabled={disabled || visibleKeys.length === 0}
              onClick={() => onBulkToggle(visibleKeys, true)}
              className="h-9 rounded-lg border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
            >
              Marcar lo visible
            </button>
            <button
              type="button"
              disabled={disabled || visibleKeys.length === 0}
              onClick={() => onBulkToggle(visibleKeys, false)}
              className="h-9 rounded-lg border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
            >
              Quitar lo visible
            </button>
          </div>
        )}
        <span className="rounded-full bg-surface-container px-space-sm py-1 text-label-sm font-semibold text-on-surface-variant">
          {grantedVisible}/{totalActions} activos
        </span>
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-lg border border-dashed border-outline-variant/60 px-space-md py-space-lg text-center text-body-md text-on-surface-variant">
          No hay módulos ni permisos que coincidan con «{query}».
        </p>
      ) : (
        grouped.map((entry) => (
          <section key={entry.group} className="space-y-space-sm">
            <h4 className="text-label-sm font-semibold uppercase tracking-wide text-outline">{entry.group}</h4>
            <div className="grid gap-space-sm md:grid-cols-2">
              {entry.modules.map((module) => {
                const moduleKeys = module.actions.map((action) => permissionKey(module.key, action.action));
                const activeCount = moduleKeys.filter((key) => {
                  if (mode === 'user') {
                    return overrideMap.has(key) ? overrideMap.get(key) : roleGrants.has(key);
                  }
                  return roleGrants.has(key);
                }).length;

                return (
                  <div
                    key={module.key}
                    className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-lowest"
                  >
                    <header className="flex items-start justify-between gap-space-sm border-b border-surface-container px-space-sm py-space-xs">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-space-2xs text-body-md font-semibold text-on-surface">
                          {module.label}
                          <code className="rounded bg-surface-container px-1 py-0.5 font-mono text-[10px] font-normal text-outline">
                            {module.key}
                          </code>
                        </p>
                        <p className="text-label-sm leading-snug text-on-surface-variant">
                          {module.description}
                        </p>
                      </div>
                      <span
                        className={cx(
                          'shrink-0 rounded-full px-space-xs py-0.5 text-label-sm font-semibold tabular-nums',
                          activeCount > 0
                            ? 'bg-primary-container/10 text-primary'
                            : 'bg-surface-container text-outline',
                        )}
                      >
                        {activeCount}/{module.actions.length}
                      </span>
                    </header>

                    <ul>
                      {module.actions.map((action, index) => {
                        const key = permissionKey(module.key, action.action);
                        const base = roleGrants.has(key);
                        const override = overrideMap.get(key);
                        const state: OverrideCycle =
                          override === undefined ? 'inherit' : override ? 'allow' : 'deny';
                        const effective = override ?? base;

                        // En modo usuario el ciclo va del heredado al contrario de
                        // la base (así el primer clic siempre cambia algo).
                        const next: OverrideCycle =
                          state === 'inherit'
                            ? base
                              ? 'deny'
                              : 'allow'
                            : state === 'allow'
                              ? 'deny'
                              : 'inherit';

                        const label =
                          mode === 'role'
                            ? `${action.label} en ${module.label}`
                            : `${action.label} en ${module.label}: ${
                                state === 'inherit'
                                  ? `heredado (${base ? 'permitido' : 'denegado'})`
                                  : state === 'allow'
                                    ? 'permitido por excepción'
                                    : 'denegado por excepción'
                              }`;
                        const nextLabel = label;

                        return (
                          <li
                            key={action.action}
                            className={cx(index > 0 && 'border-t border-surface-container')}
                          >
                            <button
                              type="button"
                              disabled={disabled}
                              role="switch"
                              aria-checked={effective}
                              aria-label={nextLabel}
                              title={nextLabel}
                              onClick={() => {
                                if (mode === 'role') onToggle?.(key, !base);
                                else onCycleOverride?.(module.key, action.action, next);
                              }}
                              className="flex w-full items-center gap-space-sm px-space-sm py-space-xs text-left transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-body-md font-medium text-on-surface">
                                  {action.label}
                                </span>
                                <span className="block text-label-sm leading-snug text-on-surface-variant">
                                  {ACTION_HINT[action.action]}
                                </span>
                              </span>

                              {mode === 'role' ? (
                                <span
                                  aria-hidden
                                  className={cx(
                                    'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                                    base ? 'bg-primary' : 'bg-surface-container-high',
                                  )}
                                >
                                  <span
                                    className={cx(
                                      'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
                                      base ? 'translate-x-[1.15rem]' : 'translate-x-0.5',
                                    )}
                                  />
                                </span>
                              ) : (
                                <span
                                  className={cx(
                                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-space-xs py-0.5 text-label-sm font-semibold',
                                    state === 'deny'
                                      ? 'border-error/40 bg-error/10 text-error'
                                      : state === 'allow'
                                        ? 'border-success-container bg-success-container text-on-success-container'
                                        : 'border-dashed border-outline-variant text-outline',
                                  )}
                                >
                                  {state === 'deny' ? (
                                    <X aria-hidden className="size-3" />
                                  ) : state === 'inherit' ? (
                                    <Minus aria-hidden className="size-3" />
                                  ) : (
                                    <Check aria-hidden className="size-3" />
                                  )}
                                  {state === 'deny' ? 'Denegar' : state === 'allow' ? 'Permitir' : 'Heredado'}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {mode === 'user' && (
        <p className="flex flex-wrap items-center gap-space-md text-label-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-space-2xs">
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-outline-variant px-space-xs py-0.5 text-label-sm font-semibold text-outline">
              <Minus aria-hidden className="size-3" /> Heredado
            </span>
            Lo que concede el rol
          </span>
          <span className="inline-flex items-center gap-space-2xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-container px-space-xs py-0.5 text-label-sm font-semibold text-on-success-container">
              <Check aria-hidden className="size-3" /> Permitir
            </span>
            Excepción que concede
          </span>
          <span className="inline-flex items-center gap-space-2xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-space-xs py-0.5 text-label-sm font-semibold text-error">
              <X aria-hidden className="size-3" /> Denegar
            </span>
            Excepción que quita
          </span>
          <span>Clic para alternar: heredado → excepción → heredado.</span>
        </p>
      )}

      {mode === 'role' && (
        <p className="flex flex-wrap items-center gap-space-md text-label-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-space-2xs">
            <span aria-hidden className="relative inline-flex h-5 w-9 rounded-full bg-primary">
              <span className="absolute top-0.5 size-4 translate-x-[1.15rem] rounded-full bg-white shadow" />
            </span>
            Permitido
          </span>
          <span className="inline-flex items-center gap-space-2xs">
            <span aria-hidden className="relative inline-flex h-5 w-9 rounded-full bg-surface-container-high">
              <span className="absolute top-0.5 size-4 translate-x-0.5 rounded-full bg-white shadow" />
            </span>
            No permitido
          </span>
          <span>
            Un permiso «Ver todos» habilita la vista completa; sin él, el usuario queda limitado a sus propios
            datos cuando el módulo lo admita.
          </span>
        </p>
      )}
    </div>
  );
}

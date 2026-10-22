'use client';

import type { Role, RoleSummary } from '@nexo/contracts';
import { APP_MODULES, ROLES, zRoleInput } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, Pencil, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { hasPermission } from '../../lib/permissions';
import { Badge, Card, Column, DataTable, EmptyState, Select, cx } from '../ui';
import { PermissionMatrix } from './PermissionMatrix';

// ============================================================
// Pestaña «Roles»: CRUD de roles dinámicos + matriz de permisos.
// ADMIN es de sistema: se puede consultar, nunca editar ni borrar.
// ============================================================

interface RoleFormState {
  mode: 'create' | 'edit' | 'view';
  code: string;
  name: string;
  description: string;
  baseRole: Role;
  permissions: Set<string>;
}

interface RolesPanelProps {
  /** Permisos efectivos de la sesión (gobiernan los botones). */
  permissions: string[];
}

const BASE_ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENCIA: 'Gerencia',
  PLANIFICADOR: 'Planificador',
  ALMACEN: 'Almacén',
  CONSULTA: 'Consulta',
};

function toForm(role: RoleSummary, mode: RoleFormState['mode']): RoleFormState {
  return {
    mode,
    code: role.code,
    name: role.name,
    description: role.description ?? '',
    baseRole: role.baseRole,
    permissions: new Set(role.permissions),
  };
}

export function RolesPanel({ permissions }: RolesPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoleFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCreate = hasPermission(permissions, 'usuarios', 'create');
  const canUpdate = hasPermission(permissions, 'usuarios', 'update');
  const canDelete = hasPermission(permissions, 'usuarios', 'delete');

  const { data: roles = [], isLoading, error: queryError } = useQuery<RoleSummary[]>({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleSummary[]>('/roles'),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['roles'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const save = useMutation<RoleSummary, Error, RoleFormState>({
    mutationFn: (value) => {
      const entries = [...value.permissions]
        .map((key) => {
          const [module, action] = key.split(':');
          return { module: module ?? '', action: action as 'read' | 'create' | 'update' | 'delete' };
        })
        .filter((entry) => entry.module);

      if (value.mode === 'create') {
        return apiFetch<RoleSummary>('/roles', {
          method: 'POST',
          body: JSON.stringify({
            code: value.code,
            name: value.name,
            description: value.description.trim() || null,
            baseRole: value.baseRole,
            permissions: entries,
          }),
        });
      }
      return apiFetch<RoleSummary>(`/roles/${encodeURIComponent(value.code)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: value.name,
          description: value.description.trim() || null,
          baseRole: value.baseRole,
          permissions: entries,
        }),
      });
    },
    onSuccess: () => {
      setForm(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const remove = useMutation<{ deleted: boolean }, Error, string>({
    mutationFn: (code) => apiFetch<{ deleted: boolean }>(`/roles/${encodeURIComponent(code)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const openCreate = () => {
    setError(null);
    setForm({
      mode: 'create',
      code: '',
      name: '',
      description: '',
      baseRole: 'CONSULTA',
      permissions: new Set(),
    });
  };

  const columns: Column<RoleSummary>[] = [
    {
      key: 'codigo',
      header: 'Código',
      kind: 'id',
      sortValue: (role) => role.code,
      render: (role) => (
        <span className="flex items-center gap-space-xs font-bold tabular-nums text-primary">
          {role.code}
          {role.isSystem && <Lock aria-hidden className="size-3.5 text-outline" />}
        </span>
      ),
    },
    {
      key: 'nombre',
      header: 'Nombre',
      sortValue: (role) => role.name,
      render: (role) => (
        <span className="block max-w-[18rem] truncate" title={role.name}>
          {role.name}
        </span>
      ),
    },
    {
      key: 'plantilla',
      header: 'Plantilla',
      kind: 'status',
      sortValue: (role) => role.baseRole,
      render: (role) => (
        <Badge tone={role.baseRole === 'ADMIN' ? 'primary' : 'muted'}>{BASE_ROLE_LABEL[role.baseRole]}</Badge>
      ),
    },
    {
      key: 'permisos',
      header: 'Permisos',
      align: 'center',
      sortValue: (role) => role.permissions.length,
      render: (role) => (
        <span className="tabular-nums text-on-surface-variant">
          {role.permissions.length}
          <span className="text-outline"> / {APP_MODULES.reduce((total, module) => total + module.actions.length, 0)}</span>
        </span>
      ),
    },
    {
      key: 'usuarios',
      header: 'Usuarios',
      align: 'center',
      sortValue: (role) => role.userCount,
      render: (role) => (
        <span className="inline-flex items-center gap-space-2xs tabular-nums text-on-surface-variant">
          <Users aria-hidden className="size-3.5" /> {role.userCount}
        </span>
      ),
    },
    {
      key: 'acciones',
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      render: (role) => (
        <div className="flex flex-wrap items-center justify-end gap-space-2xs">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setForm(toForm(role, role.isSystem || !canUpdate ? 'view' : 'edit'));
            }}
            className="flex h-8 items-center gap-space-2xs rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <Pencil aria-hidden className="size-3.5" /> {role.isSystem || !canUpdate ? 'Ver' : 'Editar'}
          </button>
          {!role.isSystem && !(ROLES as readonly string[]).includes(role.code) && (
            <button
              type="button"
              disabled={!canDelete || remove.isPending}
              onClick={() => {
                if (window.confirm(`¿Eliminar el rol ${role.code}? Esta acción no se puede deshacer.`)) {
                  remove.mutate(role.code);
                }
              }}
              title={canDelete ? 'Eliminar rol' : 'No tienes permiso para eliminar roles'}
              className="flex h-8 items-center gap-space-2xs rounded-md border border-error/30 px-space-sm text-label-sm font-semibold text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 aria-hidden className="size-3.5" /> Eliminar
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container px-space-md py-space-sm">
          <div>
            <h2 className="text-title-sm font-semibold text-on-surface">Roles y permisos</h2>
            <p className="text-label-sm text-on-surface-variant">
              La matriz define qué módulos y acciones ve cada rol. Los usuarios heredan su rol y pueden tener
              excepciones individuales.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            disabled={!canCreate}
            title={canCreate ? 'Crear un rol' : 'No tienes permiso para crear roles'}
            className="flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden className="size-4" /> Nuevo rol
          </button>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-space-sm border-b border-surface-container bg-error/5 px-space-md py-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {error}
          </p>
        )}

        <DataTable
          columns={columns}
          rows={roles}
          rowKey={(role) => role.code}
          loading={isLoading}
          empty={
            <EmptyState
              icon={ShieldCheck}
              title="Aún no hay roles"
              description="Crea el primer rol y define su matriz de permisos."
            />
          }
        />

        <div className="flex items-center gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
          <Lock aria-hidden className="size-4" />
          El rol ADMIN es de sistema: siempre tiene todos los permisos y no se puede editar ni eliminar. Los roles base
          (GERENCIA, PLANIFICADOR, ALMACEN, CONSULTA) se editan pero no se borran. Un rol con usuarios asignados tampoco
          se puede eliminar.
        </div>
      </Card>

      {queryError && (
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" />{' '}
          {queryError instanceof Error ? queryError.message : 'No se pudieron cargar los roles'}
        </p>
      )}

      {form && (
        <RoleDialog
          form={form}
          onChange={setForm}
          onClose={() => {
            setForm(null);
            setError(null);
          }}
          onSave={() => save.mutate(form)}
          saving={save.isPending}
          error={error}
        />
      )}
    </>
  );
}

function RoleDialog({
  form,
  onChange,
  onClose,
  onSave,
  saving,
  error,
}: {
  form: RoleFormState;
  onChange: (next: RoleFormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const readOnly = form.mode === 'view';
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = () => {
    const parsed = zRoleInput.safeParse({
      code: form.code.trim().toUpperCase(),
      name: form.name,
      description: form.description.trim() || null,
      baseRole: form.baseRole,
      permissions: [],
    });
    if (form.mode === 'create' && !parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? 'Revisa el código del rol');
      return;
    }
    if (!form.name.trim()) {
      setLocalError('El nombre es obligatorio');
      return;
    }
    setLocalError(null);
    onSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-on-surface/40 p-space-md backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={form.mode === 'create' ? 'Nuevo rol' : `Rol ${form.code}`}
        className="my-space-lg w-full max-w-3xl rounded-card border border-outline-variant/40 bg-surface-container-lowest shadow-float"
      >
        <header className="flex items-start justify-between gap-space-md border-b border-surface-container p-space-md">
          <div>
            <h2 className="text-title-md text-primary">
              {form.mode === 'create' ? 'Nuevo rol' : `Rol ${form.code}`}
            </h2>
            <p className="text-label-sm text-on-surface-variant">
              {form.mode === 'view'
                ? 'Vista de solo lectura (rol de sistema o sin permiso de edición).'
                : 'La plantilla conserva la semántica interna de Despacho; la matriz define los accesos.'}
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

        <div className="grid gap-space-md p-space-md md:grid-cols-2">
          <label className="flex flex-col gap-space-2xs">
            <span className="font-semibold uppercase text-label-sm text-outline">Código</span>
            <input
              value={form.code}
              disabled={form.mode !== 'create'}
              onChange={(event) => onChange({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="SUPERVISOR"
              className="h-9 rounded-lg border border-outline-variant/50 bg-surface px-space-sm font-mono text-body-md uppercase text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:opacity-60"
            />
            <span className="text-label-sm normal-case text-on-surface-variant">
              MAYÚSCULAS, números y guion bajo. No se puede cambiar después.
            </span>
          </label>

          <label className="flex flex-col gap-space-2xs">
            <span className="font-semibold uppercase text-label-sm text-outline">Nombre</span>
            <input
              value={form.name}
              disabled={readOnly}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Supervisor de almacén"
              className="h-9 rounded-lg border border-outline-variant/50 bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-space-2xs md:col-span-2">
            <span className="font-semibold uppercase text-label-sm text-outline">Descripción</span>
            <input
              value={form.description}
              disabled={readOnly}
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              placeholder="Para qué sirve este rol (opcional)"
              className="h-9 rounded-lg border border-outline-variant/50 bg-surface px-space-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-space-2xs md:col-span-2">
            <span className="font-semibold uppercase text-label-sm text-outline">Plantilla interna</span>
            <Select
              value={form.baseRole}
              onChange={(value) => onChange({ ...form, baseRole: value as Role })}
              options={ROLES.map((role) => ({ value: role, label: BASE_ROLE_LABEL[role] }))}
              ariaLabel="Plantilla interna del rol"
              disabled={readOnly}
            />
            <span className="text-label-sm normal-case text-on-surface-variant">
              Decide la bandeja y el reclamo de despachos (no concede accesos por sí sola).
            </span>
          </label>
        </div>

        <div className="border-t border-surface-container p-space-md">
          <h3 className="mb-space-sm font-semibold text-on-surface">Matriz de permisos</h3>
          <PermissionMatrix
            mode="role"
            granted={[...form.permissions]}
            disabled={readOnly}
            onToggle={(key, next) => {
              const permissions = new Set(form.permissions);
              if (next) permissions.add(key);
              else permissions.delete(key);
              onChange({ ...form, permissions });
            }}
          />
        </div>

        {(localError || error) && (
          <p role="alert" className="flex items-center gap-space-sm px-space-md pb-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" /> {localError ?? error}
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-space-sm border-t border-surface-container p-space-md">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant hover:bg-surface-container-low"
          >
            {readOnly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className={cx(
                'h-9 rounded-lg bg-primary-container px-space-lg font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60',
              )}
            >
              {saving ? 'Guardando…' : form.mode === 'create' ? 'Crear rol' : 'Guardar cambios'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

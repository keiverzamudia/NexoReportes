'use client';

// ============================================================
// Usuarios (solo con permiso `usuarios:read`) — submódulo de administración.
//
// · Pestaña Usuarios: padrón que viene de Profit. Aquí se administran el rol,
//   el acceso y las excepciones de permisos de cada persona.
// · Pestaña Roles: crear/editar roles dinámicos y su matriz módulo × acción.
//
// Los usuarios NO se crean aquí: se sincronizan desde Profit
// (MasterProfit.dbo.VUSUARIOS) y la contraseña se valida allí.
// ============================================================

import type { RoleSummary, UserSummary } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, RefreshCw, Search, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import {
  Badge,
  Card,
  Column,
  DataTable,
  EmptyState,
  Kpi,
  PageHeader,
  Segmented,
  Select,
  TextInput,
  cx,
} from '../../components/ui';
import { RolesPanel } from '../../components/users/RolesPanel';
import { UserPermissionsDialog } from '../../components/users/UserPermissionsDialog';
import { AuthRequiredError, apiFetch, currentUser } from '../../lib/api';
import { hasPermission } from '../../lib/permissions';

interface AdminUser {
  id: string;
  profitCode: string;
  displayName: string;
  role: string;
  roleName?: string;
  isActive: boolean;
  lastLoginAt: string | null;
  /** Administrador declarado por configuración (ADMIN_PROFIT_CODES). */
  protected: boolean;
}

interface UsersResponse {
  items: AdminUser[];
  total: number;
}

interface SyncResult {
  total: number;
  created: number;
  updated: number;
  admins: number;
}

const ACTIVE_OPTIONS = [
  { value: '', label: 'Acceso: Todos' },
  { value: 'true', label: 'Con acceso' },
  { value: 'false', label: 'Bloqueados' },
];

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<'usuarios' | 'roles'>('usuarios');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [permissionsUser, setPermissionsUser] = useState<AdminUser | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (role) params.set('role', role);
  if (active) params.set('active', active);

  const me = useQuery<UserSummary | null>({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 15_000,
    retry: false,
  });

  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ['users', tick, q, role, active],
    queryFn: () => apiFetch<UsersResponse>(`/users?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const rolesQuery = useQuery<RoleSummary[]>({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleSummary[]>('/roles'),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });
  const roles = rolesQuery.data ?? [];
  const sessionPermissions = me.data?.permissions ?? [];
  const canManage = hasPermission(sessionPermissions, 'usuarios', 'update');

  const sync = useMutation<SyncResult, Error, void>({
    mutationFn: () => apiFetch<SyncResult>('/users/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const update = useMutation<void, Error, { id: string; body: { role?: string; isActive?: boolean } }>({
    mutationFn: ({ id, body }) =>
      apiFetch<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // El rol de la propia sesión pudo cambiar: refrescar menú/permisos.
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const items = data?.items ?? [];
  const kpis = useMemo(
    () => ({
      total: items.length,
      activos: items.filter((user) => user.isActive).length,
      admins: items.filter((user) => user.role === 'ADMIN').length,
      roles: roles.length,
    }),
    [items, roles.length],
  );

  const roleOptions = [
    { value: '', label: 'Rol: Todos' },
    ...roles.map((entry) => ({ value: entry.code, label: entry.name })),
  ];

  const columns: Column<AdminUser>[] = [
    {
      key: 'codigo',
      header: 'Código',
      kind: 'id',
      sortValue: (user) => user.profitCode,
      render: (user) => <span className="font-bold tabular-nums text-primary">{user.profitCode}</span>,
    },
    {
      key: 'nombre',
      header: 'Nombre',
      sortValue: (user) => user.displayName,
      render: (user) => (
        <span className="block max-w-[18rem] truncate" title={user.displayName}>
          {user.displayName}
        </span>
      ),
    },
    {
      key: 'rol',
      header: 'Rol',
      kind: 'status',
      sortValue: (user) => user.roleName ?? user.role,
      render: (user) => (
        <span className="flex items-center gap-space-xs">
          <Badge tone={user.role === 'ADMIN' ? 'primary' : 'muted'}>{user.roleName ?? user.role}</Badge>
          {user.protected && (
            <span title="Administrador por configuración (ADMIN_PROFIT_CODES)">
              <Lock aria-hidden className="size-3.5 text-outline" />
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'acceso',
      header: 'Acceso',
      align: 'center',
      sortValue: (user) => (user.isActive ? 1 : 0),
      render: (user) => <Badge tone={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'Activo' : 'Bloqueado'}</Badge>,
    },
    {
      key: 'ultimo',
      header: 'Último ingreso',
      align: 'right',
      sortValue: (user) => user.lastLoginAt ?? '',
      render: (user) => <span className="text-on-surface-variant">{fmtDateTime(user.lastLoginAt)}</span>,
    },
    {
      key: 'acciones',
      header: 'Acciones',
      align: 'right',
      kind: 'action',
      render: (user) => (
        <div className="flex flex-wrap items-center justify-end gap-space-xs">
          <select
            value={user.role}
            onChange={(event) => update.mutate({ id: user.id, body: { role: event.target.value } })}
            disabled={user.protected || update.isPending || !canManage}
            aria-label={`Rol de ${user.displayName}`}
            title={
              user.protected
                ? 'Administrador por configuración: no se puede degradar'
                : canManage
                  ? 'Cambiar el rol'
                  : 'No tienes permiso para cambiar roles'
            }
            className="h-8 cursor-pointer rounded-md bg-surface px-space-xs text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!roles.some((entry) => entry.code === user.role) && (
              <option value={user.role}>{user.roleName ?? user.role}</option>
            )}
            {roles.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPermissionsUser(user)}
            title="Ver y ajustar las excepciones de permisos"
            className="flex h-8 items-center gap-space-2xs rounded-md border border-outline-variant px-space-sm text-label-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <ShieldCheck aria-hidden className="size-3.5" /> Permisos
          </button>
          <button
            onClick={() => update.mutate({ id: user.id, body: { isActive: !user.isActive } })}
            disabled={user.protected || update.isPending || !canManage}
            title={user.protected ? 'Administrador por configuración' : user.isActive ? 'Quitar el acceso' : 'Dar acceso'}
            className={cx(
              'flex h-8 items-center gap-space-2xs rounded-md border px-space-sm text-label-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              user.isActive
                ? 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                : 'border-secondary text-secondary hover:bg-success-container',
            )}
          >
            {user.isActive ? <UserX aria-hidden className="size-3.5" /> : <UserCheck aria-hidden className="size-3.5" />}
            {user.isActive ? 'Quitar acceso' : 'Dar acceso'}
          </button>
        </div>
      ),
    },
  ];

  if (error instanceof AuthRequiredError || me.error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((value) => value + 1)} />;
  }

  const hasFilters = Boolean(q || role || active);

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Administración · Usuarios de Profit y roles"
          icon={Users}
          title="Usuarios y roles"
          subtitle="El padrón se sincroniza desde Profit y la contraseña se valida allí. Aquí se define el rol, el acceso y la matriz de permisos por módulo."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Usuarios" value={String(kpis.total)} icon={Users} />
              <Kpi label="Con acceso" value={String(kpis.activos)} tone="success" />
              <Kpi label="Administradores" value={String(kpis.admins)} tone="primary" />
              <Kpi label="Roles" value={String(kpis.roles)} icon={ShieldCheck} />
            </div>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <Segmented
            ariaLabel="Sección de administración"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'usuarios', label: 'Usuarios' },
              { value: 'roles', label: 'Roles y permisos' },
            ]}
          />
          <p className="text-label-sm text-on-surface-variant">
            Los cambios de rol o de permisos aplican en la siguiente petición, sin cerrar sesión.
          </p>
        </div>

        {tab === 'usuarios' ? (
          <>
            <Card className="p-space-md">
              <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-12">
                <TextInput
                  className="lg:col-span-4"
                  icon={Search}
                  value={q}
                  onChange={setQ}
                  placeholder="Buscar por nombre o código…"
                  ariaLabel="Buscar usuario"
                />
                <Select className="lg:col-span-2" value={role} onChange={setRole} options={roleOptions} ariaLabel="Filtrar por rol" />
                <Select className="lg:col-span-2" value={active} onChange={setActive} options={ACTIVE_OPTIONS} ariaLabel="Filtrar por acceso" />
                <div className="flex flex-wrap items-center gap-space-sm lg:col-span-4">
                  <button
                    onClick={() => {
                      setQ('');
                      setRole('');
                      setActive('');
                    }}
                    disabled={!hasFilters}
                    className="h-9 rounded-lg border border-outline-variant px-space-md font-semibold text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-40"
                  >
                    Limpiar filtros
                  </button>
                  <button
                    onClick={() => sync.mutate()}
                    disabled={sync.isPending || !canManage}
                    className="flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60"
                    title={canManage ? 'Lee los usuarios de Profit y crea los que falten (no crea contraseñas)' : 'No tienes permiso para sincronizar'}
                  >
                    <RefreshCw aria-hidden className={cx('size-4', sync.isPending && 'animate-spin')} />
                    {sync.isPending ? 'Sincronizando…' : 'Sincronizar usuarios'}
                  </button>
                </div>
              </div>
              {sync.isSuccess && (
                <p className="mt-space-sm text-label-sm text-success">
                  Sincronizado: {sync.data.created} nuevo(s) · {sync.data.updated} actualizado(s) · {sync.data.total} en Profit.
                </p>
              )}
              {sync.error && (
                <p role="alert" className="mt-space-sm flex items-center gap-space-sm text-body-md text-error">
                  <AlertTriangle aria-hidden className="size-4" /> {sync.error.message}
                </p>
              )}
              {update.error && (
                <p role="alert" className="mt-space-sm flex items-center gap-space-sm text-body-md text-error">
                  <AlertTriangle aria-hidden className="size-4" /> {update.error.message}
                </p>
              )}
              {rolesQuery.error && (
                <p role="alert" className="mt-space-sm flex items-center gap-space-sm text-body-md text-error">
                  <AlertTriangle aria-hidden className="size-4" />{' '}
                  {rolesQuery.error instanceof Error ? rolesQuery.error.message : 'No se pudieron cargar los roles'}
                </p>
              )}
            </Card>

            {error && !(error instanceof AuthRequiredError) && (
              <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
                <AlertTriangle aria-hidden className="size-4" /> {error instanceof Error ? error.message : 'Error al consultar'}
              </p>
            )}

            <Card className="overflow-hidden">
              <DataTable
                columns={columns}
                rows={items}
                rowKey={(user) => user.id}
                loading={isLoading}
                empty={
                  <EmptyState
                    icon={Users}
                    title={hasFilters ? 'Sin usuarios para los filtros aplicados' : 'Aún no hay usuarios sincronizados'}
                    description="Usa «Sincronizar usuarios» para traer el padrón de Profit."
                  />
                }
              />
              <div className="flex items-center gap-space-sm border-t border-surface-container px-space-md py-space-sm text-label-sm text-on-surface-variant">
                <Lock aria-hidden className="size-4" />
                El candado marca a los administradores declarados por configuración: no se pueden degradar desde aquí.
                El botón «Permisos» permite conceder o denegar acciones puntuales sobre el rol.
              </div>
            </Card>
          </>
        ) : (
          <RolesPanel permissions={sessionPermissions} />
        )}
      </main>

      {permissionsUser && (
        <UserPermissionsDialog
          user={permissionsUser}
          permissions={sessionPermissions}
          onClose={() => setPermissionsUser(null)}
        />
      )}
    </>
  );
}

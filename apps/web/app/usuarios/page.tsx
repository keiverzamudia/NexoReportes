'use client';

// ============================================================
// Usuarios (solo ADMIN) — padrón que viene de Profit.
//
// · Los usuarios NO se crean aquí: se sincronizan desde Profit
//   (MasterProfit.dbo.VUSUARIOS).
// · La contraseña se valida en Profit (MasterProfit.dbo.autenticar):
//   la aplicación no guarda ninguna.
// · Aquí se administran el rol y si la persona puede entrar.
// ============================================================

import type { Role } from '@nexo/contracts';
import { ROLES } from '@nexo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, RefreshCw, Search, UserCheck, UserX, Users } from 'lucide-react';
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
  Select,
  TextInput,
  cx,
} from '../../components/ui';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface AdminUser {
  id: string;
  profitCode: string;
  displayName: string;
  role: string;
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

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  GERENCIA: 'Gerencia',
  PLANIFICADOR: 'Planificador',
  ALMACEN: 'Almacén',
  CONSULTA: 'Consulta',
};

const ROLE_OPTIONS = [
  { value: '', label: 'Rol: Todos' },
  ...ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] })),
];

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
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (role) params.set('role', role);
  if (active) params.set('active', active);

  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ['users', tick, q, role, active],
    queryFn: () => apiFetch<UsersResponse>(`/users?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  const sync = useMutation<SyncResult, Error, void>({
    mutationFn: () => apiFetch<SyncResult>('/users/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const update = useMutation<void, Error, { id: string; body: { role?: string; isActive?: boolean } }>({
    mutationFn: ({ id, body }) =>
      apiFetch<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const items = data?.items ?? [];
  const kpis = useMemo(
    () => ({
      total: items.length,
      activos: items.filter((user) => user.isActive).length,
      admins: items.filter((user) => user.role === 'ADMIN').length,
    }),
    [items],
  );

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
      sortValue: (user) => user.role,
      render: (user) => (
        <span className="flex items-center gap-space-xs">
          <Badge tone={user.role === 'ADMIN' ? 'primary' : 'muted'}>
            {ROLE_LABEL[user.role as Role] ?? user.role}
          </Badge>
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
            disabled={user.protected || update.isPending}
            aria-label={`Rol de ${user.displayName}`}
            title={
              user.protected
                ? 'Administrador por configuración: no se puede degradar'
                : 'Cambiar el rol'
            }
            className="h-8 cursor-pointer rounded-md bg-surface px-space-xs text-label-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]}
              </option>
            ))}
          </select>
          <button
            onClick={() => update.mutate({ id: user.id, body: { isActive: !user.isActive } })}
            disabled={user.protected || update.isPending}
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

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((value) => value + 1)} />;
  }

  const hasFilters = Boolean(q || role || active);

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-lg md:p-space-xl">
        <PageHeader
          eyebrow="Administración · Usuarios de Profit"
          icon={Users}
          title="Usuarios"
          subtitle="El padrón se sincroniza desde Profit y la contraseña se valida allí: la aplicación no guarda contraseñas. Aquí se define el rol y quién puede entrar."
          actions={
            <div className="flex flex-wrap items-center gap-space-sm">
              <Kpi label="Usuarios" value={String(kpis.total)} icon={Users} />
              <Kpi label="Con acceso" value={String(kpis.activos)} tone="success" />
              <Kpi label="Administradores" value={String(kpis.admins)} tone="primary" />
            </div>
          }
        />

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
            <Select className="lg:col-span-2" value={role} onChange={setRole} options={ROLE_OPTIONS} ariaLabel="Filtrar por rol" />
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
                disabled={sync.isPending}
                className="flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60"
                title="Lee los usuarios de Profit y crea los que falten (no crea contraseñas)"
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
            El bloqueo del candado marca a los administradores declarados por configuración: no se pueden degradar
            desde aquí.
          </div>
        </Card>
      </main>
    </>
  );
}

'use client';

// ============================================================
// Shell de la aplicación (login compartido + navegación + sincronizar).
// Cada módulo operativo reutiliza LoginScreen y AppNav para que la
// navegación y el estado de sincronización sean coherentes.
// ============================================================

import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, LogIn, LogOut, RefreshCw, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { apiFetch, clearSession, login as apiLogin } from '../lib/api';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiLogin(email, password);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-sm flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-xl shadow-card"
    >
      <h2 className="text-title-md text-primary">Iniciar sesión</h2>
      <label className="flex flex-col gap-space-xs font-semibold uppercase text-label-md text-on-surface-variant">
        Correo
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 rounded-lg bg-surface px-space-sm text-body-md normal-case text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
          placeholder="admin@nexo.local"
        />
      </label>
      <label className="flex flex-col gap-space-xs font-semibold uppercase text-label-md text-on-surface-variant">
        Contraseña
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9 rounded-lg bg-surface px-space-sm text-body-md normal-case text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container"
        />
      </label>
      {error && (
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" /> {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex h-9 items-center justify-center gap-space-sm rounded-lg bg-primary-container px-space-lg font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60"
      >
        <LogIn aria-hidden className="size-4" />
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
      <p className="text-label-sm normal-case text-on-surface-variant">
        Acceso con tu usuario de Nexo Producción (mismos roles del API).
      </p>
    </form>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-space-xl p-space-xl">
      <header className="text-center">
        <h1 className="text-display-lg italic text-primary">Nexo Producción</h1>
        <p className="text-body-md text-on-surface-variant">Corp. Agropecuaria Venezolana</p>
      </header>
      <LoginForm onSuccess={onSuccess} />
    </main>
  );
}

const NAV_LINKS = [
  { href: '/disponibilidad', label: 'Disponibilidad', icon: Boxes },
  { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { href: '/clientes', label: 'Clientes', icon: Users },
] as const;

// Botón "Sincronizar": dispara una sincronización completa contra Profit y
// refresca todos los datos de la interfaz.
export function SyncButton() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  async function run() {
    setState('running');
    setMessage('');
    try {
      const result = await apiFetch<{ totalRead: number; totalErrors: number; failedDomains: string[]; domains: { status: string }[] }>(
        '/sync/run-all',
        { method: 'POST' },
      );
      const ok = result.domains.filter((d) => d.status === 'EXITOSA').length;
      setState('ok');
      setMessage(`${ok}/${result.domains.length} dominios · ${result.totalRead} filas leídas`);
      await queryClient.invalidateQueries();
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : 'Error al sincronizar');
    }
  }

  return (
    <div className="flex items-center gap-space-sm">
      <button
        onClick={run}
        disabled={state === 'running'}
        className="flex h-9 items-center gap-space-xs rounded-lg bg-primary-container px-space-md font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60"
        title="Sincronizar datos desde Profit"
      >
        <RefreshCw aria-hidden className={`size-4 ${state === 'running' ? 'animate-spin' : ''}`} />
        {state === 'running' ? 'Sincronizando…' : 'Sincronizar'}
      </button>
      {message && (
        <span className={`hidden text-label-sm lg:inline ${state === 'error' ? 'text-error' : 'text-success'}`}>{message}</span>
      )}
    </div>
  );
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest/95 shadow-card backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-space-md px-space-xl py-space-md">
        <Link href="/disponibilidad" className="flex items-baseline gap-space-sm">
          <span className="text-title-md italic text-primary-container">Nexo</span>
          <span className="font-semibold uppercase tracking-wider text-label-md text-on-surface-variant">Producción</span>
        </Link>

        <nav aria-label="Módulos" className="flex items-center gap-space-2xs">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 items-center gap-space-sm rounded-lg px-space-md text-body-md transition-colors ${
                  active
                    ? 'bg-primary-container font-semibold text-on-primary shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-space-sm">
          <SyncButton />
          <button
            onClick={() => {
              clearSession();
              window.location.reload();
            }}
            className="flex h-9 items-center gap-space-xs rounded-lg border border-outline-variant px-space-md text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <LogOut aria-hidden className="size-4" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </header>
  );
}

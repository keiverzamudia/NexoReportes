'use client';

// ============================================================
// Shell de la aplicación: login compartido + navegación + sincronizar.
//
// Responsive real, no escalado:
//  · ≥md  → barra superior con los módulos en línea.
//  · <md  → barra inferior de pestañas (alcance del pulgar, safe-area) y las
//           acciones (sincronizar / salir) quedan como iconos arriba.
// Los módulos, su orden y su etiqueta son los mismos en ambos contextos.
// ============================================================

import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, CalendarRange, LogIn, LogOut, RefreshCw, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { apiFetch, clearSession, login as apiLogin } from '../lib/api';
import { Button, cx } from './ui';

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
      className="animate-rise flex w-full max-w-sm flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-xl shadow-card"
    >
      <div>
        <h2 className="text-title-md text-primary">Iniciar sesión</h2>
        <p className="mt-space-2xs text-body-md text-on-surface-variant">Usa tu usuario de Nexo Producción.</p>
      </div>

      <label className="flex flex-col gap-space-xs text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">
        Correo
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-lg bg-surface-container-low px-space-sm text-base normal-case tracking-normal text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container md:h-9 md:text-body-md"
          placeholder="admin@nexo.local"
        />
      </label>

      <label className="flex flex-col gap-space-xs text-label-md font-semibold uppercase tracking-wide text-on-surface-variant">
        Contraseña
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 rounded-lg bg-surface-container-low px-space-sm text-base normal-case tracking-normal text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container md:h-9 md:text-body-md"
        />
      </label>

      {error && (
        <p role="alert" className="flex items-center gap-space-sm rounded-lg bg-critical-container px-space-md py-space-sm text-body-md text-on-critical-container">
          <AlertTriangle aria-hidden className="size-4 shrink-0" /> {error}
        </p>
      )}

      <Button variant="primary" type="submit" icon={LogIn} disabled={busy} fullWidth>
        {busy ? 'Entrando…' : 'Entrar'}
      </Button>

      <p className="text-label-sm text-on-surface-variant">Los roles y permisos son los mismos del API.</p>
    </form>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-space-xl p-space-lg md:p-space-2xl">
      <header className="text-center">
        <p className="text-headline-lg italic tracking-tight text-primary-container">Nexo</p>
        <h1 className="text-title-md font-semibold uppercase tracking-[0.18em] text-on-surface-variant">Producción</h1>
        <p className="mt-space-sm text-body-md text-on-surface-variant">Corp. Agropecuaria Venezolana</p>
      </header>
      <LoginForm onSuccess={onSuccess} />
    </main>
  );
}

const NAV_LINKS = [
  { href: '/disponibilidad', label: 'Disponibilidad', short: 'Disponib.', icon: Boxes },
  { href: '/forca', label: 'Forca', short: 'Forca', icon: CalendarRange },
  { href: '/pedidos', label: 'Pedidos', short: 'Pedidos', icon: ShoppingCart },
  { href: '/clientes', label: 'Clientes', short: 'Clientes', icon: Users },
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
      setState(result.totalErrors > 0 ? 'error' : 'ok');
      setMessage(`${ok}/${result.domains.length} dominios · ${result.totalRead} filas leídas`);
      await queryClient.invalidateQueries();
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : 'Error al sincronizar');
    }
  }

  return (
    <div className="flex items-center gap-space-sm">
      <Button
        variant="primary"
        icon={RefreshCw}
        onClick={run}
        disabled={state === 'running'}
        title="Sincronizar datos desde Profit"
        ariaLabel="Sincronizar datos desde Profit"
      >
        <span className="hidden sm:inline">{state === 'running' ? 'Sincronizando…' : 'Sincronizar'}</span>
      </Button>
      <span
        aria-live="polite"
        className={cx('hidden max-w-[22rem] truncate text-label-sm xl:inline', state === 'error' ? 'text-critical' : 'text-success')}
      >
        {message}
      </span>
    </div>
  );
}

export function AppNav() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-outline-variant/70 bg-surface-container-lowest/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-space-md px-space-md py-space-sm md:px-space-xl md:py-space-md">
          <Link href="/disponibilidad" className="flex shrink-0 items-baseline gap-space-xs rounded-md" aria-label="Nexo Producción — ir a Disponibilidad">
            <span className="text-title-md italic tracking-tight text-primary-container">Nexo</span>
            <span className="hidden font-semibold uppercase tracking-wider text-label-md text-on-surface-variant sm:inline">
              Producción
            </span>
          </Link>

          <nav aria-label="Módulos" className="hidden items-center gap-space-2xs md:flex">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-9 items-center gap-space-sm rounded-lg px-space-md text-body-md transition-colors',
                    active
                      ? 'bg-primary-container font-semibold text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-space-xs">
            <SyncButton />
            <Button
              variant="outline"
              icon={LogOut}
              ariaLabel="Cerrar sesión"
              title="Cerrar sesión"
              onClick={() => {
                clearSession();
                window.location.reload();
              }}
            >
              <span className="hidden lg:inline">Cerrar sesión</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Barra inferior: sólo en teléfono, dentro del alcance del pulgar. */}
      <nav
        aria-label="Módulos"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant/70 bg-surface-container-lowest/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-4">
          {NAV_LINKS.map(({ href, label, short, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-[3.25rem] flex-col items-center justify-center gap-space-2xs px-space-xs py-space-xs text-label-sm transition-colors',
                    active ? 'font-bold text-primary-container' : 'text-on-surface-variant',
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  <span className="truncate">{short}</span>
                  <span
                    aria-hidden
                    className={cx('h-0.5 w-6 rounded-full transition-colors', active ? 'bg-primary-container' : 'bg-transparent')}
                  />
                  <span className="sr-only">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

'use client';

// ============================================================
// Shell de la aplicación (login compartido + navegación).
// Cada módulo operativo reutiliza LoginScreen y AppNav para que
// la demo tenga navegación coherente entre pantallas.
// ============================================================

import { AlertTriangle, Boxes, LogIn, LogOut, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { clearSession, login as apiLogin } from '../lib/api';

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
      className="mx-auto flex w-full max-w-sm flex-col gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-space-xl"
    >
      <h2 className="text-title-md">Iniciar sesión</h2>
      <label className="flex flex-col gap-space-xs text-label-md uppercase text-on-surface-variant">
        Correo
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-outline-variant bg-surface px-space-md py-space-sm text-body-md normal-case text-on-surface"
          placeholder="admin@nexo.local"
        />
      </label>
      <label className="flex flex-col gap-space-xs text-label-md uppercase text-on-surface-variant">
        Contraseña
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-outline-variant bg-surface px-space-md py-space-sm text-body-md normal-case text-on-surface"
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
        className="flex items-center justify-center gap-space-sm rounded bg-primary-container px-space-lg py-space-md text-body-md font-semibold text-on-primary disabled:opacity-60"
      >
        <LogIn aria-hidden className="size-4" />
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
      <p className="text-label-md normal-case text-on-surface-variant">
        Acceso con tu usuario de Nexo Producción (mismos roles del API).
      </p>
    </form>
  );
}

// Pantalla de login a página completa (cuando no hay sesión válida).
export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-space-xl p-space-xl">
      <header className="text-center">
        <h1 className="text-headline-lg italic">Nexo Producción</h1>
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

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-space-md px-space-xl py-space-md">
        <Link href="/disponibilidad" className="flex items-baseline gap-space-sm">
          <span className="text-title-md italic text-primary-container">Nexo</span>
          <span className="text-label-md uppercase text-on-surface-variant">Producción</span>
        </Link>

        <nav aria-label="Módulos" className="flex items-center gap-space-2xs">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-space-sm rounded px-space-md py-space-sm text-body-md ${
                  active
                    ? 'bg-primary-container font-semibold text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => {
            clearSession();
            window.location.reload();
          }}
          className="flex items-center gap-space-sm rounded border border-outline-variant px-space-md py-space-sm text-body-md text-on-surface-variant hover:bg-surface-container-low"
        >
          <LogOut aria-hidden className="size-4" />
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}

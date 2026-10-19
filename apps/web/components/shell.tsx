'use client';

// ============================================================
// Shell de la aplicación (login compartido + navegación + sincronizar).
// Cada módulo operativo reutiliza LoginScreen y AppNav para que la
// navegación y el estado de sincronización sean coherentes.
// ============================================================

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CalendarRange,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { LoginCandidate } from '@nexo/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch, currentUser, login as apiLogin, logout, searchLoginCandidates } from '../lib/api';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<LoginCandidate | null>(null);
  const [candidates, setCandidates] = useState<LoginCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  // Autocompletado en el servidor: solo usuarios activos de Profit. Se
  // descartan las respuestas viejas para que no pisen la última búsqueda.
  useEffect(() => {
    if (selected || text.trim().length < 2) {
      setCandidates([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    const mine = ++requestId.current;
    const timer = setTimeout(() => {
      searchLoginCandidates(text.trim())
        .then((rows) => {
          if (requestId.current !== mine) return;
          setCandidates(rows);
          setOpen(true);
        })
        .catch(() => {
          if (requestId.current === mine) setCandidates([]);
        })
        .finally(() => {
          if (requestId.current === mine) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, selected]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      // La contraseña va a Profit y se descarta: aquí solo queda la cookie.
      await apiLogin(selected.id, password);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'h-9 w-full rounded-lg bg-surface px-space-sm text-body-md normal-case text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container';

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-sm flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-xl shadow-card"
    >
      <h2 className="text-title-md text-primary">Iniciar sesión</h2>

      <label className="flex flex-col gap-space-xs font-semibold uppercase text-label-md text-on-surface-variant">
        Usuario
        <div className="relative">
          <input
            value={selected ? selected.displayName : text}
            onChange={(e) => {
              setSelected(null);
              setText(e.target.value);
              setError(null);
            }}
            placeholder="Escribe tu nombre…"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls="login-usuarios"
            aria-autocomplete="list"
            className={inputClass}
          />
          {open && candidates.length > 0 && (
            <ul
              id="login-usuarios"
              role="listbox"
              aria-label="Usuarios encontrados"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg bg-surface-container-lowest p-space-2xs shadow-card ring-1 ring-surface-container"
            >
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setSelected(candidate);
                      setText('');
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-space-sm rounded-md px-space-sm py-space-2xs text-left text-body-md text-on-surface hover:bg-surface-container-low"
                  >
                    <span className="truncate">{candidate.displayName}</span>
                    <span className="shrink-0 font-mono text-label-sm text-outline">{candidate.profitCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      {searching && <span className="text-label-sm normal-case text-on-surface-variant">Buscando…</span>}

      <label className="flex flex-col gap-space-xs font-semibold uppercase text-label-md text-on-surface-variant">
        Contraseña
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!selected || busy}
            placeholder={selected ? 'Contraseña de Profit' : 'Elige tu usuario primero'}
            className={`${inputClass} pr-10 disabled:opacity-60`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-outline hover:bg-surface-container-low"
          >
            {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
      </label>

      {error && (
        <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
          <AlertTriangle aria-hidden className="size-4" /> {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !selected || !password}
        className="flex h-9 items-center justify-center gap-space-sm rounded-lg bg-primary-container px-space-lg font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-60"
      >
        <LogIn aria-hidden className="size-4" />
        {busy ? 'Verificando…' : 'Entrar'}
      </button>
      <p className="text-label-sm normal-case text-on-surface-variant">
        Acceso con tu usuario y tu contraseña de Profit.
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
  { href: '/forca', label: 'Forca', icon: CalendarRange },
  { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { href: '/clientes', label: 'Clientes', icon: Users },
] as const;

// Solo visible para ADMIN (el API igual valida el rol).
const ADMIN_LINK = { href: '/usuarios', label: 'Usuarios', icon: ShieldCheck } as const;

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
  const queryClient = useQueryClient();
  // Quién soy y qué rol tengo: define si aparece el módulo Usuarios.
  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const links = sessionUser?.role === 'ADMIN' ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;

  return (
    <header className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest/95 shadow-card backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-space-md px-space-xl py-space-md">
        <Link href="/disponibilidad" className="flex items-baseline gap-space-sm">
          <span className="text-title-md italic text-primary-container">Nexo</span>
          <span className="font-semibold uppercase tracking-wider text-label-md text-on-surface-variant">Producción</span>
        </Link>

        <nav aria-label="Módulos" className="flex items-center gap-space-2xs">
          {links.map(({ href, label, icon: Icon }) => {
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
            onClick={async () => {
              await logout();
              queryClient.clear();
              window.location.assign('/');
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

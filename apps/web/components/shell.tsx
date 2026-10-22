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
  ClipboardList,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoginCandidate, SyncStatusResponse } from '@nexo/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, currentUser, login as apiLogin, logout, searchLoginCandidates } from '../lib/api';
import { humanAge } from '../lib/dispatch-sheet';
import { hasPermission } from '../lib/permissions';
import { Logo } from './Logo';
import { NotificationsBell } from './NotificationsBell';
import { cx } from './ui';

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
    'h-10 w-full rounded-xl border border-outline-variant/50 bg-surface px-space-sm text-body-md normal-case text-on-surface transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70';

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-sm flex-col gap-space-md rounded-card border border-outline-variant/40 bg-surface-container-lowest p-space-xl shadow-float"
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
        className="flex h-10 items-center justify-center gap-space-sm rounded-xl bg-primary-container px-space-lg font-semibold text-on-primary shadow-soft transition-all hover:-translate-y-0.5 hover:bg-primary disabled:translate-y-0 disabled:opacity-60"
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
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-space-xl overflow-hidden p-space-xl">
      <span aria-hidden className="pointer-events-none absolute -top-52 left-1/2 size-[38rem] -translate-x-1/2 rounded-full bg-primary-fixed/40 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-40 right-0 size-[26rem] rounded-full bg-secondary-container/20 blur-3xl" />
      <header className="relative text-center">
        <span className="inline-flex items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest/80 px-space-md py-1 text-label-sm font-semibold uppercase tracking-[0.14em] text-primary backdrop-blur">
          <ShieldCheck aria-hidden className="size-3.5" />
          Sincronizado con Profit
        </span>
        <span className="mt-space-md flex items-center justify-center">
          <Logo width={30} height={33} />
        </span>
        <h1 className="mt-space-sm text-display-lg uppercase tracking-[0.06em] text-primary">San Luis</h1>
        <p className="text-body-md text-on-surface-variant">Corp. Agropecuaria Venezolana</p>
      </header>
      <div className="relative w-full">
        <LoginForm onSuccess={onSuccess} />
      </div>
    </main>
  );
}

// Navegación por permisos: cada módulo aparece si la sesión tiene
// `modulo:read`. El API valida exactamente lo mismo, así que ocultar el
// enlace es solo la capa visual.
interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  module: string;
}

const NAV_LINKS: NavLink[] = [
  { href: '/disponibilidad', label: 'Disponibilidad', icon: Boxes, module: 'disponibilidad' },
  { href: '/forecast', label: 'Forecast', icon: CalendarRange, module: 'forecast' },
  { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart, module: 'pedidos' },
  { href: '/despacho', label: 'Despacho', icon: ClipboardList, module: 'despacho' },
  { href: '/clientes', label: 'Clientes', icon: Users, module: 'clientes' },
  { href: '/usuarios', label: 'Usuarios', icon: ShieldCheck, module: 'usuarios' },
];

export function linksFor(permissions: string[] | undefined): NavLink[] {
  return NAV_LINKS.filter((link) => hasPermission(permissions, link.module, 'read'));
}

// Botón "Sincronizar": dispara una sincronización completa contra Profit y
// refresca todos los datos de la interfaz. Al lado muestra la FRESCURA real
// (la edad del dato más viejo y cada cuánto se refresca cada dominio).
export function SyncButton({ enabled = true }: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const { data: status } = useQuery<SyncStatusResponse>({
    queryKey: ['sync-status'],
    queryFn: () => apiFetch<SyncStatusResponse>('/sync/status'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  // El chip sigue al dominio que mueve la operación (existencias) y se pone
  // ámbar solo si está VENCIDO respecto a su propio intervalo. Mostrar el más
  // viejo en absoluto alarmaría por ALMACENES o PRODUCTOS, que por diseño son
  // lentos.
  const domains = status?.domains ?? [];
  const withAge = domains.filter((domain) => domain.ageSeconds !== null);
  const stock = withAge.find((domain) => domain.domain === 'EXISTENCIAS') ?? null;
  const tracked =
    stock ?? (withAge.length > 0 ? withAge.reduce((a, b) => ((a.ageSeconds ?? 0) > (b.ageSeconds ?? 0) ? a : b)) : null);
  const late = tracked
    ? tracked.intervalSeconds > 0
      ? (tracked.ageSeconds ?? 0) > tracked.intervalSeconds * 2
      : (tracked.ageSeconds ?? 0) > 3600
    : false;
  const freshnessTitle =
    domains
      .map(
        (domain) =>
          `${domain.domain}: ${humanAge(domain.ageSeconds)}${
            domain.intervalSeconds > 0 ? ` · cada ${humanAge(domain.intervalSeconds).replace('hace ', '')}` : ' · solo manual'
          }`,
      )
      .join('\n') || 'Sin información de sincronización';

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
      {enabled && (
        <button
          onClick={run}
          disabled={state === 'running'}
          className="flex h-9 items-center gap-space-xs rounded-pill border border-outline-variant/50 bg-surface-container-lowest px-space-md font-semibold text-body-md text-primary shadow-soft transition-colors hover:bg-surface-container-low disabled:opacity-60"
          title="Sincronizar datos desde Profit"
        >
          <RefreshCw aria-hidden className={`size-4 ${state === 'running' ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{state === 'running' ? 'Sincronizando…' : 'Sincronizar'}</span>
        </button>
      )}
      {tracked && (
        <span
          title={freshnessTitle}
          className={cx(
            'hidden items-center gap-space-xs rounded-pill px-space-sm py-1 text-label-sm font-semibold tabular-nums lg:flex',
            late ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container text-on-surface-variant',
          )}
        >
          {tracked.domain.toLowerCase()} {humanAge(tracked.ageSeconds)}
        </span>
      )}
      {message && (
        <span className={`hidden text-label-sm xl:inline ${state === 'error' ? 'text-error' : 'text-success'}`}>{message}</span>
      )}
    </div>
  );
}

function initialsOf(name: string | undefined): string {
  if (!name) return '··';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Quién soy y qué permisos tengo: define el menú y el acceso por URL.
  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 15_000,
    retry: false,
  });
  const permissionList = useMemo(() => sessionUser?.permissions ?? [], [sessionUser?.permissions]);
  const links = useMemo(() => linksFor(permissionList), [permissionList]);
  const home = links[0]?.href ?? '/pedidos';

  // Acceso directo por URL a un módulo sin `modulo:read`: se devuelve al
  // primer módulo permitido (el API responde 403 de todos modos).
  useEffect(() => {
    if (!sessionUser || links.length === 0) return;
    const allowed = links.some((link) => pathname === link.href || pathname.startsWith(`${link.href}/`));
    if (!allowed) router.replace(links[0]!.href);
  }, [sessionUser, links, pathname, router]);

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/35 bg-surface-container-lowest/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-space-md px-space-md py-space-sm md:px-space-xl">
        <Link href={home} className="flex shrink-0 items-center gap-space-sm" aria-label="San Luis — inicio">
          <Logo width={25} height={29} />
          <span className="text-title-md font-extrabold uppercase tracking-[0.12em] text-primary">San Luis</span>
        </Link>

        <nav aria-label="Módulos" className="order-3 w-full md:order-none md:w-auto md:flex-1">
          <div className="flex items-center gap-1 overflow-x-auto rounded-pill bg-surface-container-low/80 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-9 shrink-0 items-center gap-space-xs rounded-pill px-space-md text-body-md transition-all duration-200',
                    active
                      ? 'bg-primary-container font-semibold text-on-primary shadow-soft'
                      : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-primary',
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-space-sm">
          {sessionUser && <NotificationsBell />}
          <SyncButton enabled={hasPermission(permissionList, 'sincronizacion', 'update')} />
          {sessionUser && (
            <div className="hidden items-center gap-space-sm rounded-pill border border-outline-variant/50 bg-surface-container-lowest py-1 pl-1 pr-space-md shadow-soft lg:flex">
              <span className="grid size-7 place-items-center rounded-full bg-primary-fixed text-label-sm font-black text-primary">
                {initialsOf(sessionUser.displayName)}
              </span>
              <span className="flex flex-col leading-none">
                <span className="max-w-[10rem] truncate text-label-md font-semibold text-on-surface">{sessionUser.displayName}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-outline">
                  {sessionUser.roleName ?? sessionUser.role}
                </span>
              </span>
            </div>
          )}
          <button
            onClick={async () => {
              await logout();
              queryClient.clear();
              window.location.assign('/');
            }}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="flex size-9 items-center justify-center rounded-full border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant shadow-soft transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            <LogOut aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

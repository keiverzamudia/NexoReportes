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
  DoorOpen,
  Eye,
  EyeOff,
  Factory,
  HandCoins,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Trophy,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoginCandidate, SyncStatusResponse, SystemMetaResponse, UserSummary } from '@nexo/contracts';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, currentUser, login as apiLogin, logout, searchLoginCandidates } from '../lib/api';
import { humanAge } from '../lib/dispatch-sheet';
import { canSeePedidos, hasPermission } from '../lib/permissions';
import { Logo } from './Logo';
import { NotificationsBell } from './NotificationsBell';
import { clearAnnouncementDismissals, SystemAnnouncementsModal, SystemVersionDialog } from './SystemAnnouncementsModal';
import { useLoadingOverlay } from './loading/LoadingOverlayProvider';
import { cx } from './ui';

export function LoginForm({ onSuccess }: { onSuccess: (user: UserSummary) => void }) {
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
      const auth = await apiLogin(selected.id, password);
      // Una API anterior puede no incluir los permisos en el login; /auth/me
      // los trae y evita aterrizar en «sin módulos» por una versión vieja.
      const logged = auth.user.permissions ? auth.user : ((await currentUser()) ?? auth.user);
      // No mezclar datos de una sesión anterior (p. ej. tras expirar la cookie).
      queryClient.clear();
      clearAnnouncementDismissals();
      queryClient.setQueryData(['me'], logged);
      onSuccess(logged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'h-11 w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-body-md text-on-surface placeholder:text-outline transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-secondary-container/70 disabled:opacity-60';
  const labelClass = 'flex flex-col gap-space-xs text-body-md font-semibold text-on-surface-variant';

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-space-lg">
      <div className="mb-space-xs flex flex-col gap-space-xs">
        <h2 className="font-display text-headline-lg leading-tight text-primary">Iniciar sesión</h2>
        <p className="text-body-md text-on-surface-variant">Acceso con tu usuario y contraseña de Profit.</p>
      </div>

      <label className={labelClass}>
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
              className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-space-2xs shadow-lift"
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
                    className="flex w-full items-center justify-between gap-space-sm rounded-lg px-space-sm py-space-sm text-left text-body-md text-on-surface hover:bg-surface-container-low"
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
      {searching && <span className="-mt-space-sm text-label-sm normal-case text-outline">Buscando…</span>}

      <label className={labelClass}>
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
            className={`${inputClass} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-outline transition-colors hover:bg-surface-container-low hover:text-primary"
          >
            {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
      </label>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-space-sm rounded-xl border border-error-container/30 bg-error-container px-space-md py-space-sm text-body-md text-on-error-container"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !selected || !password}
        className="flex h-11 items-center justify-center gap-space-sm rounded-xl bg-primary-container px-space-lg font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogIn aria-hidden className="size-4" />
        {busy ? 'Verificando…' : 'Entrar'}
      </button>
    </form>
  );
}

// Estado breve mientras la puerta de sesión (`/`) consulta la cookie.
function LoginChecking() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[18rem] w-full flex-col items-center justify-center gap-space-sm text-center"
    >
      <Loader2 aria-hidden className="size-6 animate-spin text-primary" />
      <p className="font-semibold text-primary">Comprobando sesión…</p>
      <p className="max-w-[16rem] text-label-sm normal-case text-on-surface-variant">
        Estamos viendo si ya tienes una sesión activa.
      </p>
    </div>
  );
}

export function LoginScreen({
  onSuccess,
  checking = false,
}: {
  onSuccess: (user: UserSummary) => void;
  checking?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Tras autenticar, el usuario solo se queda si el módulo actual está en sus
  // permisos; si no, entra por el primero que sí puede ver.
  function handleSuccess(user: UserSummary) {
    const links = linksFor(user.permissions);
    const current = pathname ?? '/';
    const allowed = links.some((link) => current === link.href || current.startsWith(`${link.href}/`));
    onSuccess(user);
    if (!allowed) router.replace(links[0]?.href ?? '/');
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] bg-surface-container-lowest lg:grid-cols-2 lg:grid-rows-1">
      <h1 className="sr-only">Iniciar sesión — Corpoagro</h1>

      {/* Mitad de marca: navy plano, sin degradados. En móvil queda como banda. */}
      <aside className="relative flex items-center justify-center bg-primary-container px-space-lg py-space-xl lg:p-space-2xl">
        <Logo
          size="full"
          variant="negative"
          height={104}
          heightClassName="h-14 lg:h-20 xl:h-[6.5rem]"
          priority
        />
        <p className="absolute inset-x-0 bottom-space-lg hidden text-center text-label-sm normal-case text-white/40 lg:block">
          Corpoagro · Nutrición Animal
        </p>
      </aside>

      {/* Formulario sobre blanco, alineado al lenguaje de los módulos. */}
      <section className="flex flex-col items-center justify-center px-space-lg py-space-2xl sm:px-space-2xl">
        <div className="animate-fade flex w-full max-w-[23rem] flex-col">
          <span className="mb-space-md inline-flex w-fit items-center gap-space-2xs rounded-pill bg-primary-container/10 px-space-sm py-1 text-label-sm font-bold uppercase tracking-[0.14em] text-primary">
            <ShieldCheck aria-hidden className="size-3.5" />
            Acceso al sistema
          </span>

          {checking ? <LoginChecking /> : <LoginForm onSuccess={handleSuccess} />}

          <p className="mt-space-lg text-center text-label-sm normal-case text-outline lg:hidden">
            Corpoagro · Nutrición Animal
          </p>
        </div>
      </section>
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
  { href: '/produccion', label: 'Producción', icon: Factory, module: 'produccion' },
  { href: '/vendedor', label: 'Vendedor', icon: Trophy, module: 'vendedor' },
  { href: '/por-cobrar', label: 'CXC', icon: HandCoins, module: 'cxc' },
  { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart, module: 'pedidos' },
  { href: '/despacho', label: 'Despacho', icon: ClipboardList, module: 'despacho' },
  { href: '/pcp', label: 'PCP', icon: DoorOpen, module: 'pcp' },
  { href: '/clientes', label: 'Clientes', icon: Users, module: 'clientes' },
  { href: '/usuarios', label: 'Usuarios', icon: ShieldCheck, module: 'usuarios' },
];

export function linksFor(permissions: string[] | undefined): NavLink[] {
  return NAV_LINKS.filter((link) =>
    link.module === 'pedidos'
      ? canSeePedidos(permissions)
      : hasPermission(permissions, link.module, 'read'),
  );
}

/** Spinner localizado en el enlace que está navegando (Next 15). */
function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null;
}

// Botón "Sincronizar": dispara una sincronización completa contra Profit y
// refresca todos los datos de la interfaz. Al lado muestra la FRESCURA real
// (la edad del dato más viejo y cada cuánto se refresca cada dominio).
export function SyncButton({ enabled = true }: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const { runWithOverlay } = useLoadingOverlay();
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
      const result = await runWithOverlay('Sincronizando', async () => {
        const response = await apiFetch<{
          totalRead: number;
          totalErrors: number;
          failedDomains: string[];
          domains: { status: string }[];
        }>('/sync/run-all', { method: 'POST' });
        await queryClient.invalidateQueries();
        return response;
      });
      const ok = result.domains.filter((d) => d.status === 'EXITOSA').length;
      setState('ok');
      setMessage(`${ok}/${result.domains.length} dominios · ${result.totalRead} filas leídas`);
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
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  // Quién soy y qué permisos tengo: define el menú y el acceso por URL.
  const { data: sessionUser } = useQuery({
    queryKey: ['me'],
    queryFn: currentUser,
    staleTime: 15_000,
    retry: false,
  });
  const { data: systemMeta } = useQuery<SystemMetaResponse>({
    queryKey: ['system-meta'],
    queryFn: () => apiFetch<SystemMetaResponse>('/system/meta'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const isAdmin = sessionUser?.role === 'ADMIN';
  const permissionList = useMemo(() => sessionUser?.permissions ?? [], [sessionUser?.permissions]);
  const links = useMemo(() => linksFor(permissionList), [permissionList]);
  const home = links[0]?.href ?? '/';

  // Acceso directo por URL a un módulo sin `modulo:read`: se devuelve al
  // primer módulo permitido (el API responde 403 de todos modos). Sin ningún
  // módulo, la puerta de sesión muestra la pantalla de «sin acceso».
  useEffect(() => {
    if (!sessionUser) return;
    if (links.length === 0) {
      router.replace('/');
      return;
    }
    const allowed = links.some((link) => pathname === link.href || pathname.startsWith(`${link.href}/`));
    if (!allowed) router.replace(links[0]!.href);
  }, [sessionUser, links, pathname, router]);

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-outline-variant/35 bg-surface-container-lowest/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-space-md px-space-md py-space-sm md:px-space-xl">
        <div className="flex shrink-0 items-center gap-space-xs">
          <Link
            href={home}
            prefetch
            onMouseEnter={() => router.prefetch(home)}
            onFocus={() => router.prefetch(home)}
            className="flex shrink-0 items-center gap-space-sm"
            aria-label="Corpoagro — inicio"
          >
            <Logo size="compact" height={28} />
          </Link>
          {systemMeta?.version &&
            (isAdmin ? (
              <button
                type="button"
                onClick={() => setVersionDialogOpen(true)}
                title="Versión del sistema (clic para editar)"
                className="rounded-pill border border-outline-variant/40 bg-surface-container-low px-2 py-0.5 font-mono text-[11px] font-semibold text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-primary-fixed/40 hover:text-primary"
              >
                {systemMeta.version}
              </button>
            ) : (
              <span
                title={`Versión del sistema: ${systemMeta.version}`}
                className="rounded-pill border border-outline-variant/40 bg-surface-container-low px-2 py-0.5 font-mono text-[11px] font-semibold text-on-surface-variant"
              >
                {systemMeta.version}
              </span>
            ))}
        </div>

        <nav aria-label="Módulos" className="order-3 w-full md:order-none md:w-auto md:flex-1">
          <div className="flex items-center gap-1 overflow-x-auto rounded-pill bg-surface-container-low/80 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  onMouseEnter={() => router.prefetch(href)}
                  onFocus={() => router.prefetch(href)}
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
                  <NavPending />
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
    {sessionUser && <SystemAnnouncementsModal announcements={systemMeta?.activeAnnouncements ?? []} />}
    {versionDialogOpen && systemMeta && (
      <SystemVersionDialog currentVersion={systemMeta.version} onClose={() => setVersionDialogOpen(false)} />
    )}
    </>
  );
}

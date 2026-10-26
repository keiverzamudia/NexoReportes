'use client';

// ============================================================
// Puerta de sesión de la aplicación.
//
// `/` es siempre lo primero: consulta la cookie HttpOnly contra /auth/me.
//   · Sin sesión → muestra el login (nada de módulos antes de autenticar).
//   · Con sesión → entra al primer módulo que el usuario puede ver.
//   · Sin módulos → pantalla de «sin acceso» con opción de cerrar sesión.
//
// Antes esta página redirigía a /disponibilidad antes de comprobar la sesión,
// por eso el login tardaba y los usuarios sin permiso veían Disponibilidad.
// ============================================================

import type { UserSummary } from '@nexo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Logo } from '../components/Logo';
import { LoginScreen } from '../components/shell';
import { currentUser, logout } from '../lib/api';
import { firstAllowedHref } from '../lib/permissions';

export default function Home() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<UserSummary | null>({
    queryKey: ['me'],
    queryFn: currentUser,
    // La cookie manda: se revalida en cada entrada a `/`.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  const home = user ? firstAllowedHref(user.permissions) : null;

  useEffect(() => {
    if (home) router.replace(home);
  }, [home, router]);

  function handleLogin(logged: UserSummary) {
    queryClient.setQueryData(['me'], logged);
  }

  // Mientras se consulta la cookie se ve la pantalla de login con un aviso;
  // nunca se renderiza un módulo antes de saber si hay sesión.
  if (isLoading) return <LoginScreen checking onSuccess={handleLogin} />;
  if (!user) return <LoginScreen onSuccess={handleLogin} />;
  if (!home) return <NoAccess user={user} />;

  // Sesión válida: el efecto está navegando al módulo.
  return <LoginScreen checking onSuccess={handleLogin} />;
}

function NoAccess({ user }: { user: UserSummary }) {
  const queryClient = useQueryClient();

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-space-lg">
      <div className="flex w-full max-w-md flex-col items-center gap-space-md rounded-card border border-outline-variant/40 bg-surface-container-lowest p-space-xl text-center shadow-float">
        <Logo size="full" height={56} priority />
        <h1 className="text-title-md text-primary">Sin módulos asignados</h1>
        <p className="text-body-md text-on-surface-variant">
          <strong className="text-on-surface">{user.displayName}</strong>, tu usuario no tiene ningún módulo
          habilitado. Pide acceso a un administrador.
        </p>
        <button
          type="button"
          onClick={async () => {
            await logout();
            queryClient.clear();
            window.location.assign('/');
          }}
          className="flex h-10 items-center gap-space-sm rounded-xl border border-outline-variant/50 px-space-lg font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <LogOut aria-hidden className="size-4" /> Cerrar sesión
        </button>
      </div>
    </main>
  );
}

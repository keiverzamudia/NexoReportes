'use client';

// ============================================================
// Barra de progreso de navegación.
//
// El overlay de carga de TanStack Query solo aparece cuando el módulo
// destino ya montó y disparó su consulta. En dev (y en la primera visita
// a una ruta) el tiempo entre el clic y ese montaje se siente «pegado».
// Esta barra arranca en el clic y se apaga al cambiar la ruta, así el
// usuario ve que la acción sí se disparó.
// ============================================================

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// Si la navegación falla o se cancela, la barra no queda encendida.
const SAFETY_MS = 15_000;

export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    stop();
  }, [pathname, stop]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Misma ruta y query: no hay navegación que esperar.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      setActive(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setActive(false);
      }, SAFETY_MS);
    };

    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[130] h-[3px] overflow-hidden transition-opacity duration-200 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span
        className={`block h-full w-2/5 rounded-pill bg-secondary-container ${
          active ? 'animate-nav-progress' : ''
        }`}
      />
    </div>
  );
}

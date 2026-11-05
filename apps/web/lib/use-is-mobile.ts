'use client';

import { useSyncExternalStore } from 'react';

// ============================================================
// Detección de teléfono para la vista dedicada.
//
// · menos de 768 px (breakpoint md de Tailwind), o
// · pantalla táctil sin hover (pointer: coarse)
//
// SSR-safe: en el servidor devuelve false y el primer render del cliente se
// corrige en el mismo ciclo con useSyncExternalStore.
// ============================================================

const QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)';

function subscribe(callback: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

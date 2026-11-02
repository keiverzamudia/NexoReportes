'use client';

// Preferencia del usuario para la fila de explicaciones de las tablas.
// Apagada por defecto: la pantalla se ve igual que siempre; quien la activa la
// conserva entre visitas.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nexo:help-row';

export function useHelpRow(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Navegación privada o almacenamiento bloqueado: se queda apagada.
    }
  }, []);

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Sin persistencia, pero el cambio sí se aplica en esta sesión.
    }
  }, []);

  return [enabled, update];
}

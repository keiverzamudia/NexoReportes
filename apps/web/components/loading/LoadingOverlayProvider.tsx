'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { cx } from '../ui';
import { LoadingAgroindustrial } from './LoadingAgroindustrial';

// El indicador aparece solo si la operación real tarda más que este umbral,
// para no parpadear en cargas instantáneas. No hay tiempo mínimo artificial:
// en cuanto la operación termina o falla, comienza el desvanecido.
const OVERLAY_DELAY_MS = 150;
const OVERLAY_EXIT_MS = 150;

interface ActiveOperation {
  id: number;
  label: string;
}

type RunWithOverlay = <T>(label: string, task: () => Promise<T>) => Promise<T>;

interface LoadingOverlayContextValue {
  runWithOverlay: RunWithOverlay;
}

const LoadingOverlayContext = createContext<LoadingOverlayContextValue | null>(null);

export function useLoadingOverlay(): LoadingOverlayContextValue {
  const value = useContext(LoadingOverlayContext);
  if (!value) {
    throw new Error('useLoadingOverlay debe usarse dentro de LoadingOverlayProvider');
  }
  return value;
}

function Overlay({ visible, label }: { visible: boolean; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible) return;
    const prevent = (event: Event) => event.preventDefault();
    root.addEventListener('wheel', prevent, { passive: false });
    root.addEventListener('touchmove', prevent, { passive: false });
    return () => {
      root.removeEventListener('wheel', prevent);
      root.removeEventListener('touchmove', prevent);
    };
  }, [visible]);

  return (
    <div
      ref={rootRef}
      className={cx(
        'fixed inset-0 z-[120] flex items-center justify-center bg-slate-50/80 transition-opacity duration-150',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!visible}
    >
      <LoadingAgroindustrial label={label} />
    </div>
  );
}

export function LoadingOverlayProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveOperation[]>([]);
  const [mounted, setMounted] = useState(false);
  const [render, setRender] = useState(false);
  const [visible, setVisible] = useState(false);
  const nextId = useRef(0);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cargas de página: consultas que aún no tienen datos. Los refetch de
  // fondo (la consulta ya tiene datos) no muestran el indicador.
  const pendingQueries = useIsFetching({
    predicate: (query) => query.state.status === 'pending' && query.state.fetchStatus === 'fetching',
  });
  // Mutaciones: cubre las acciones que usan useMutation sin envolverlas a mano.
  const pendingMutations = useIsMutating();
  const busy = pendingQueries > 0 || pendingMutations > 0 || active.length > 0;

  const latestOperation = active[active.length - 1];
  const label = latestOperation?.label ?? 'Cargando';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const clear = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (busy) {
      clear(exitTimer);
      if (!render) {
        if (showTimer.current === null) {
          showTimer.current = setTimeout(() => {
            setRender(true);
            setVisible(true);
            showTimer.current = null;
          }, OVERLAY_DELAY_MS);
        }
      } else {
        clear(showTimer);
        setVisible(true);
      }
    } else if (render) {
      clear(showTimer);
      if (exitTimer.current === null) {
        setVisible(false);
        exitTimer.current = setTimeout(() => {
          setRender(false);
          exitTimer.current = null;
        }, OVERLAY_EXIT_MS);
      }
    }

    return () => {
      clear(showTimer);
      clear(exitTimer);
    };
  }, [busy, render]);

  const runWithOverlay = useCallback<RunWithOverlay>(async (operationLabel, task) => {
    const id = ++nextId.current;
    setActive((current) => [...current, { id, label: operationLabel }]);
    try {
      return await task();
    } finally {
      setActive((current) => current.filter((operation) => operation.id !== id));
    }
  }, []);

  const value = useMemo(() => ({ runWithOverlay }), [runWithOverlay]);

  return (
    <LoadingOverlayContext.Provider value={value}>
      {children}
      {mounted && render ? createPortal(<Overlay visible={visible} label={label} />, document.body) : null}
    </LoadingOverlayContext.Provider>
  );
}

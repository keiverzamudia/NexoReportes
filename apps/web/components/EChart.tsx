'use client';

// ============================================================
// Envoltura de ECharts para React/Next.
//
// ECharts mide su contenedor al inicializarse: si en ese momento el
// contenedor aún no tiene tamaño (primer render, cambio de pestaña, layout
// que se asienta después) la gráfica queda aplastada y el área de dibujo no
// se recupera sola. Aquí:
//   1. se espera a que el contenedor tenga tamaño real (ResizeObserver),
//   2. se re-dimensiona ante cualquier cambio de tamaño (no sólo `window`),
//   3. se re-mide tras aplicar la opción y al rotar el teléfono,
//   4. se libera el chart al desmontar para no filtrar listeners ni canvas.
//
// Interacción opcional por índice del eje X (`onIndexHover` / `onIndexClick`):
// se resuelve con `convertFromPixel`, así funciona en cualquier punto del
// área de dibujo y no sólo sobre la línea de la serie.
// ============================================================

import { useEffect, useRef } from 'react';

interface EChartProps {
  option: Record<string, unknown>;
  height?: number | string;
  ariaLabel?: string;
  className?: string;
  /** Índice del eje X bajo el puntero (null al salir del área). */
  onIndexHover?: (index: number | null) => void;
  /** Índice del eje X donde se hizo clic. */
  onIndexClick?: (index: number) => void;
}

export function EChart({ option, height = 240, ariaLabel, className, onIndexHover, onIndexClick }: EChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<import('echarts').EChartsType | null>(null);
  const hoverRef = useRef<((index: number | null) => void) | null>(null);
  const clickRef = useRef<((index: number) => void) | null>(null);
  const countRef = useRef(0);
  const lastHover = useRef<number | null>(null);

  // Los callbacks cambian en cada render: se guardan en refs para no
  // re-vincular los listeners del chart (ni resetear la opción) por eso.
  useEffect(() => {
    hoverRef.current = onIndexHover ?? null;
    clickRef.current = onIndexClick ?? null;
  }, [onIndexHover, onIndexClick]);

  // Cantidad de categorías del eje X: la usan los listeners ya vinculados.
  useEffect(() => {
    const xAxis = (option as { xAxis?: { data?: unknown[] } }).xAxis;
    countRef.current = Array.isArray(xAxis?.data) ? xAxis.data.length : 0;
    lastHover.current = null;
  }, [option]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    void (async () => {
      const echarts = await import('echarts');
      if (disposed || !container.current) return;

      const indexAt = (offsetX: number, offsetY: number): number | null => {
        const instance = chart.current;
        if (!instance) return null;
        try {
          if (!instance.containPixel('grid', [offsetX, offsetY])) return null;
          // Solo el eje X: `convertFromPixel` devuelve el rango de la categoría.
          const converted = instance.convertFromPixel({ xAxisIndex: 0 }, offsetX);
          const index = typeof converted === 'number' ? Math.round(converted) : Number(converted);
          if (!Number.isFinite(index)) return null;
          const count = countRef.current;
          if (count > 0 && (index < 0 || index > count - 1)) return null;
          return index;
        } catch {
          return null;
        }
      };

      // Se vincula UNA sola vez, al crear la instancia: `zr.off(evento)` sin
      // handler borraría también los listeners internos de ECharts.
      const bindPointer = (instance: import('echarts').EChartsType) => {
        const zr = instance.getZr();

        zr.on('mousemove', (event: unknown) => {
          const { offsetX, offsetY } = event as { offsetX: number; offsetY: number };
          const index = indexAt(offsetX, offsetY);
          if (index === lastHover.current) return;
          lastHover.current = index;
          hoverRef.current?.(index);
        });

        zr.on('click', (event: unknown) => {
          const { offsetX, offsetY } = event as { offsetX: number; offsetY: number };
          const index = indexAt(offsetX, offsetY);
          if (index !== null) clickRef.current?.(index);
        });

        zr.on('globalout', () => {
          if (lastHover.current === null) return;
          lastHover.current = null;
          hoverRef.current?.(null);
        });
      };

      const init = () => {
        if (disposed || !container.current) return false;
        const { clientWidth, clientHeight } = container.current;
        if (clientWidth < 8 || clientHeight < 8) return false; // aún sin layout
        if (!chart.current) {
          chart.current = echarts.init(container.current, undefined, { renderer: 'svg' });
          bindPointer(chart.current);
        } else {
          chart.current.resize();
        }
        chart.current.setOption(option as never, true);
        return true;
      };

      if (!init()) {
        // El contenedor todavía no tiene tamaño: reintenta en el próximo frame.
        const raf = requestAnimationFrame(() => void init());
        observer = new ResizeObserver(() => {
          if (init() && chart.current) chart.current.resize();
        });
        observer.observe(node);
        return () => cancelAnimationFrame(raf);
      }

      // A partir de aquí, cualquier cambio de tamaño re-dimensiona la gráfica
      // (incluye cambios de pestaña, de columna y la rotación del teléfono).
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(node);
      chart.current?.resize();
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [option]);

  // Libera el chart sólo al desmontar de verdad (no en cada cambio de opción).
  useEffect(
    () => () => {
      chart.current?.dispose();
      chart.current = null;
    },
    [],
  );

  return (
    <div
      ref={container}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className={`w-full overflow-hidden ${className ?? ''}`}
    />
  );
}

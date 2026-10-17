'use client';

// ============================================================
// Envoltura de ECharts para React/Next.
//
// ECharts mide su contenedor al inicializarse: si en ese momento el
// contenedor a├║n no tiene tama├▒o (primer render, cambio de pesta├▒a, layout
// que se asienta despu├®s) la gr├ífica queda aplastada y el ├írea de dibujo no
// se recupera sola. Aqu├¡:
//   1. se espera a que el contenedor tenga tama├▒o real (ResizeObserver),
//   2. se re-dimensiona ante cualquier cambio de tama├▒o (no s├│lo `window`),
//   3. se re-mide tras aplicar la opci├│n y al rotar el tel├®fono,
//   4. se libera el chart al desmontar para no filtrar listeners ni canvas.
// ============================================================

import { useEffect, useRef } from 'react';

export function EChart({
  option,
  height = 240,
  ariaLabel,
  className,
}: {
  option: Record<string, unknown>;
  height?: number | string;
  ariaLabel?: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<import('echarts').EChartsType | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    void (async () => {
      const echarts = await import('echarts');
      if (disposed || !container.current) return;

      const init = () => {
        if (disposed || !container.current) return false;
        const { clientWidth, clientHeight } = container.current;
        if (clientWidth < 8 || clientHeight < 8) return false; // a├║n sin layout
        if (!chart.current) {
          chart.current = echarts.init(container.current, undefined, { renderer: 'svg' });
        } else {
          chart.current.resize();
        }
        chart.current.setOption(option as never, true);
        return true;
      };

      if (!init()) {
        // El contenedor todav├¡a no tiene tama├▒o: reintenta en el pr├│ximo frame.
        const raf = requestAnimationFrame(() => void init());
        observer = new ResizeObserver(() => {
          if (init() && chart.current) chart.current.resize();
        });
        observer.observe(node);
        return () => cancelAnimationFrame(raf);
      }

      // A partir de aqu├¡, cualquier cambio de tama├▒o re-dimensiona la gr├ífica
      // (incluye cambios de pesta├▒a, de columna y la rotaci├│n del tel├®fono).
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(node);
      chart.current?.resize();
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [option]);

  // Libera el chart s├│lo al desmontar de verdad (no en cada cambio de opci├│n).
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

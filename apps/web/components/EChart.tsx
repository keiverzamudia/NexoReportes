'use client';

// Envoltura mínima de ECharts para React/Next.
// Carga ECharts de forma diferida (solo en el cliente) y usa el renderer SVG.

import { useEffect, useRef } from 'react';

export function EChart({
  option,
  height = 220,
  ariaLabel,
}: {
  option: Record<string, unknown>;
  height?: number;
  ariaLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<import('echarts').EChartsType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const echarts = await import('echarts');
      if (cancelled || !container.current) return;
      if (!chart.current) {
        chart.current = echarts.init(container.current, undefined, { renderer: 'svg' });
      }
      chart.current.setOption(option as never, true);
    })();
    return () => {
      cancelled = true;
    };
  }, [option]);

  useEffect(() => {
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  return <div ref={container} role="img" aria-label={ariaLabel} style={{ height }} className="w-full" />;
}

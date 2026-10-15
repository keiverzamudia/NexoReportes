'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@nexo/contracts';
import { Activity, AlertTriangle, Database, FlaskConical } from 'lucide-react';

// Pantalla de arranque de la Fase 1: verifica el estado real de la API.
// Los módulos operativos (Resumen ejecutivo, Disponibilidad, Simulador,
// Plan de producción) se construyen en las fases siguientes con el mismo shell.
export default function HomePage() {
  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('API no disponible');
      return response.json() as Promise<HealthResponse>;
    },
  });

  const profitLabel: Record<HealthResponse['profit'], string> = {
    connected: 'Conectado a Profit (solo lectura)',
    fixtures: 'Modo fixtures (datos de desarrollo, NO reales)',
    unreachable: 'Profit inaccesible',
    not_configured: 'Profit sin configurar',
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-space-xl p-space-xl">
      <header className="flex items-center gap-space-md">
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary-container text-on-primary">
          <Activity aria-hidden className="size-6" />
        </div>
        <div>
          <h1 className="text-headline-lg italic">Nexo Producción</h1>
          <p className="text-label-md uppercase text-on-surface-variant">Corp. Agropecuaria Venezolana</p>
        </div>
      </header>

      <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-space-lg">
        <h2 className="text-title-md">Estado del sistema (Fase 1 — Fundamentos)</h2>
        {isLoading && <p className="mt-space-md text-body-md text-on-surface-variant">Consultando /api/health…</p>}
        {error && (
          <p className="mt-space-md flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />
            No se pudo consultar la API. Verifica que esté arrancada (pnpm dev).
          </p>
        )}
        {data && (
          <dl className="mt-space-md grid gap-space-sm text-body-md sm:grid-cols-2">
            <div className="flex items-center justify-between gap-space-sm rounded border border-outline-variant px-space-md py-space-sm">
              <dt className="flex items-center gap-space-xs text-on-surface-variant">
                <Database aria-hidden className="size-4" /> Base de datos interna
              </dt>
              <dd className="font-semibold">{data.database === 'up' ? 'Operativa' : 'Caída'}</dd>
            </div>
            <div className="flex items-center justify-between gap-space-sm rounded border border-outline-variant px-space-md py-space-sm">
              <dt className="flex items-center gap-space-xs text-on-surface-variant">
                <FlaskConical aria-hidden className="size-4" /> Profit
              </dt>
              <dd className="font-semibold">{profitLabel[data.profit]}</dd>
            </div>
          </dl>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-space-md text-body-md text-on-surface-variant">
        <span>Integración con Profit: lectura por vistas SQL configurables. Ninguna simulación modifica el ERP.</span>
        <a
          href="/disponibilidad"
          className="rounded bg-primary-container px-space-lg py-space-sm font-semibold text-on-primary hover:opacity-90"
        >
          Ver disponibilidad →
        </a>
      </footer>
    </main>
  );
}

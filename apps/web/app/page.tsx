'use client';

// ============================================================
// Portada de arranque: verifica el estado real de la API (/api/health)
// y da acceso directo a los módulos operativos ya existentes.
// Contrato de UI: docs/design/DESIGN_SYSTEM.md
// ============================================================

import type { HealthResponse } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Boxes, CalendarRange, Database, FlaskConical, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { AppNav } from '../components/shell';
import { Card, CardHeader, ErrorNote, Kpi, PageHeader, Skeleton } from '../components/ui';

type ProfitState = HealthResponse['profit'];

// Etiqueta corta para la tira de KPIs; el detalle completo va en el estado del sistema.
const PROFIT_KPI: Record<ProfitState, string> = {
  connected: 'Conectado',
  fixtures: 'Fixtures',
  unreachable: 'Inaccesible',
  not_configured: 'Sin configurar',
};

const PROFIT_TONE: Record<ProfitState, 'success' | 'warning' | 'danger' | 'muted'> = {
  connected: 'success',
  fixtures: 'warning',
  unreachable: 'danger',
  not_configured: 'muted',
};

// Mismos módulos y mismas rutas que la navegación del shell (no se inventan otros).
const MODULES = [
  {
    href: '/disponibilidad',
    label: 'Disponibilidad',
    description: 'Existencia física frente a la demanda pendiente de los pedidos activos.',
    icon: Boxes,
  },
  {
    href: '/forca',
    label: 'Forca',
    description: 'Pronóstico mensual por artículo, repartido en las semanas del mes.',
    icon: CalendarRange,
  },
  {
    href: '/pedidos',
    label: 'Pedidos',
    description: 'Arma el plan de despacho con la existencia real, sin escribir en Profit.',
    icon: ShoppingCart,
  },
  {
    href: '/clientes',
    label: 'Clientes',
    description: 'Catálogo de clientes sincronizado y acceso directo a sus pedidos.',
    icon: Users,
  },
];

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

  const dbUp = data ? data.database === 'up' : null;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-space-lg p-space-md md:p-space-xl">
        <PageHeader
          icon={Activity}
          title="Nexo Producción"
          subtitle="Corp. Agropecuaria Venezolana · inventarios, pedidos y producción sincronizados con Profit por lectura de vistas SQL. Ninguna simulación modifica el ERP."
        />

        <div className="grid grid-cols-2 gap-space-sm md:grid-cols-4">
          <Kpi
            label="API"
            value={isLoading ? '—' : error ? 'Sin respuesta' : 'En línea'}
            tone={error ? 'danger' : 'success'}
            icon={Activity}
            hint={isLoading ? 'Consultando…' : undefined}
          />
          <Kpi
            label="Base de datos"
            value={dbUp === null ? '—' : dbUp ? 'Operativa' : 'Caída'}
            tone={dbUp === null ? 'muted' : dbUp ? 'success' : 'danger'}
            icon={Database}
          />
          <Kpi
            label="Profit"
            value={data ? PROFIT_KPI[data.profit] : '—'}
            tone={data ? PROFIT_TONE[data.profit] : 'muted'}
            icon={FlaskConical}
          />
          <Kpi label="Versión" value={data?.version ?? '—'} tone="default" />
        </div>

        <Card>
          <CardHeader title="Estado del sistema" description="Consulta en vivo de /api/health. Sin sesión válida los módulos pedirán iniciar sesión." />
          <div className="p-space-lg" aria-live="polite">
            {isLoading && (
              <div className="flex flex-col gap-space-sm">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            )}

            {error && !isLoading && <ErrorNote>No se pudo consultar la API. Verifica que esté arrancada (pnpm dev).</ErrorNote>}

            {data && !isLoading && (
              <dl className="flex flex-col divide-y divide-surface-container text-body-md">
                <div className="flex flex-col gap-space-2xs py-space-sm sm:flex-row sm:items-center sm:justify-between sm:gap-space-md">
                  <dt className="flex min-w-0 items-center gap-space-sm text-on-surface-variant">
                    <Database aria-hidden className="size-4 shrink-0" /> Base de datos interna
                  </dt>
                  <dd className={dbUp ? 'font-semibold text-success' : 'font-semibold text-critical'}>
                    {dbUp ? 'Operativa' : 'Caída'}
                  </dd>
                </div>
                <div className="flex flex-col gap-space-2xs py-space-sm sm:flex-row sm:items-center sm:justify-between sm:gap-space-md">
                  <dt className="flex min-w-0 items-center gap-space-sm text-on-surface-variant">
                    <FlaskConical aria-hidden className="size-4 shrink-0" /> Profit
                  </dt>
                  <dd className={data.profit === 'connected' ? 'font-semibold text-on-surface' : 'font-semibold text-warning'}>
                    {profitLabel[data.profit]}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Módulos" description="Los mismos módulos en teléfono y en escritorio; en la barra inferior del teléfono están a la vista." />
          <ul className="grid grid-cols-1 gap-space-md p-space-md sm:grid-cols-2 xl:grid-cols-4">
            {MODULES.map(({ href, label, description, icon: Icon }) => (
              <li key={href} className="min-w-0">
                <Link
                  href={href}
                  className="flex h-full items-start gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md transition-colors hover:bg-surface-container-low"
                >
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-space-xs font-semibold text-primary">
                      {label}
                      <ArrowRight aria-hidden className="size-4 shrink-0 text-primary-container" />
                    </span>
                    <span className="mt-space-2xs text-body-md text-on-surface-variant">{description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <p className="text-body-md text-on-surface-variant">
          Integración con Profit: lectura por vistas SQL configurables. Ninguna simulación modifica el ERP.
        </p>
      </main>
    </>
  );
}

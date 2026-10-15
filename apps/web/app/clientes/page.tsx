'use client';

// ============================================================
// Clientes (Fase 4): catálogo derivado de la vista de Profit.
// Tipo de cliente y vendedor no vienen en la vista actual → "—".
// ============================================================

import type { Customer } from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AppNav, LoginScreen } from '../../components/shell';
import { AuthRequiredError, apiFetch } from '../../lib/api';

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 50;

export default function ClientesPage() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<Paginated<Customer>>({
    queryKey: ['customers', tick, q, page],
    queryFn: () => apiFetch<Paginated<Customer>>(`/customers?${params.toString()}`),
    retry: (count, err) => !(err instanceof AuthRequiredError) && count < 2,
  });

  if (error instanceof AuthRequiredError) {
    return <LoginScreen onSuccess={() => setTick((t) => t + 1)} />;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <AppNav />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-space-lg p-space-xl">
        <header className="flex flex-wrap items-end justify-between gap-space-md">
          <div>
            <h1 className="text-headline-lg italic">Clientes</h1>
            <p className="text-body-md text-on-surface-variant">Catálogo de clientes con pedidos sincronizados desde Profit.</p>
          </div>
          <label className="flex items-center gap-space-sm rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm">
            <Search aria-hidden className="size-4 text-on-surface-variant" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por código o nombre…"
              className="w-64 bg-transparent text-body-md text-on-surface outline-none"
              aria-label="Buscar cliente"
            />
          </label>
        </header>

        {isLoading && <p className="text-body-md text-on-surface-variant">Consultando clientes…</p>}
        {error && !(error instanceof AuthRequiredError) && (
          <p role="alert" className="flex items-center gap-space-sm text-body-md text-error">
            <AlertTriangle aria-hidden className="size-4" />{' '}
            {error instanceof Error ? error.message : 'Error al consultar'}
          </p>
        )}

        {data && (
          <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
            <table className="w-full border-collapse text-data-tabular-md">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-md uppercase text-on-surface-variant">
                  <th scope="col" className="px-space-md py-space-sm">Código</th>
                  <th scope="col" className="px-space-md py-space-sm">Nombre</th>
                  <th scope="col" className="px-space-md py-space-sm">Tipo</th>
                  <th scope="col" className="px-space-md py-space-sm text-right">Pedidos activos</th>
                  <th scope="col" className="px-space-md py-space-sm" />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-space-md py-space-xl text-center text-body-md text-on-surface-variant">
                      Sin clientes{q ? ` para “${q}”` : ''}.
                    </td>
                  </tr>
                )}
                {data.items.map((customer) => (
                  <tr key={customer.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                    <td className="px-space-md py-space-sm font-semibold">{customer.externalCode}</td>
                    <td className="max-w-md truncate px-space-md py-space-sm" title={customer.name}>{customer.name}</td>
                    <td className="px-space-md py-space-sm">{customer.customerType ?? '—'}</td>
                    <td className="px-space-md py-space-sm text-right tabular-nums">{customer.ordersCount}</td>
                    <td className="px-space-md py-space-sm text-right">
                      {customer.ordersCount > 0 && (
                        <Link
                          href={`/pedidos?cliente=${encodeURIComponent(customer.externalCode)}`}
                          className="font-semibold text-primary-container hover:underline"
                        >
                          Ver pedidos
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > PAGE_SIZE && (
          <footer className="flex items-center justify-between text-body-md text-on-surface-variant">
            <span>
              {data.total} cliente{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
            </span>
            <div className="flex gap-space-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-outline-variant px-space-md py-space-sm hover:bg-surface-container-low disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-outline-variant px-space-md py-space-sm hover:bg-surface-container-low disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </footer>
        )}
      </main>
    </>
  );
}

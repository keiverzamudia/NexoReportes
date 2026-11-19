'use client';

import type {
  ForecastSellerProductClientRow,
  ForecastSellerProductClientsResponse,
  ForecastSellerProductRow,
  ForecastSellerRow,
  ForecastSellersResponse,
} from '@nexo/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, RefreshCw, Users } from 'lucide-react';
import { AuthRequiredError, apiFetch } from '../../lib/api';
import { fmtKg, monthLabel } from '../../lib/sales-report';
import { sellerPathCode } from '../../lib/seller-context';
import { Badge, EmptyState, Skeleton, fmtDate, fmtQty } from '../ui';

// ============================================================
// Drill-down de la pestaña Productos: al expandir un artículo se muestran
// los clientes que lo compraron en el mes, separados por cartera, firmado por
// el vendedor y otros. Los kg salen del mismo informe, así que cuadran con la
// fila del producto.
// ============================================================

export function SellerProductClientsDetail({
  seller,
  product,
  report,
  includeToday,
  onOpenClient,
}: {
  seller: ForecastSellerRow;
  product: ForecastSellerProductRow;
  report: ForecastSellersResponse;
  includeToday: boolean;
  onOpenClient: (client: ForecastSellerProductClientRow) => void;
}) {
  const { data, error, isPending, isFetching, refetch } =
    useQuery<ForecastSellerProductClientsResponse>({
      queryKey: [
        'seller-product-clients',
        seller.sellerCode,
        product.productCode,
        report.year,
        report.month,
        report.basis,
        includeToday,
        report.attribution,
        report.generatedAt,
      ],
      queryFn: () => {
        const params = new URLSearchParams({
          year: String(report.year),
          month: String(report.month),
          basis: report.basis,
          includeToday: includeToday ? 'true' : 'false',
          attribution: report.attribution,
        });
        return apiFetch<ForecastSellerProductClientsResponse>(
          `/forecast/sellers/${encodeURIComponent(sellerPathCode(seller.sellerCode))}/products/${encodeURIComponent(
            product.productCode,
          )}/clients?${params.toString()}`,
        );
      },
      staleTime: 60_000,
      retry: 1,
    });

  const message =
    error instanceof AuthRequiredError
      ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
      : error instanceof Error
        ? error.message
        : 'No se pudieron consultar los clientes del producto.';

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <p className="text-label-sm font-semibold uppercase tracking-[0.14em] text-outline">
            Clientes del producto
          </p>
          <p className="text-title-md font-bold text-on-surface">{product.description}</p>
          <p className="text-label-md text-on-surface-variant">
            {monthLabel(report.year, report.month)} · cartera, firmado por él y otros vendedores
          </p>
        </div>
        <div className="flex items-center gap-space-2xs">
          <Badge tone="muted">
            {data ? `${fmtQty(data.totals.clientCount, 0)} clientes` : 'Consultando…'}
          </Badge>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Actualizar clientes del producto"
            title="Actualizar clientes del producto"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-outline-variant/50 px-space-xs text-label-sm font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw aria-hidden className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-space-sm rounded-xl border border-critical/40 bg-critical-container/30 px-space-md py-space-sm text-label-md text-on-surface"
        >
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-error" />
          {message}
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-semibold text-primary hover:underline"
          >
            Reintentar
          </button>
        </p>
      )}

      {isPending && !data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : data ? (
        !data.available ? (
          <p className="rounded-xl border border-warning/40 bg-warning-container/40 px-space-md py-space-sm text-label-md text-on-warning-container">
            Profit no devolvió los clientes de este producto. No se muestran ceros como ventas.
          </p>
        ) : data.clients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin clientes para este producto"
            description="El artículo no tiene notas en el mes con los filtros actuales."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-outline-variant/35">
            <table className="w-full min-w-[42rem] border-collapse text-label-md">
              <caption className="sr-only">
                Clientes del producto {product.description} en {monthLabel(report.year, report.month)}
              </caption>
              <thead className="bg-surface-container-low/60">
                <tr className="text-label-sm uppercase tracking-[0.08em] text-outline">
                  <th scope="col" className="px-space-sm py-2 text-left font-semibold">Cliente</th>
                  <th scope="col" className="px-space-sm py-2 text-right font-semibold">Cartera</th>
                  <th scope="col" className="px-space-sm py-2 text-right font-semibold">Firmado por él</th>
                  <th scope="col" className="px-space-sm py-2 text-right font-semibold">Otros</th>
                  <th scope="col" className="px-space-sm py-2 text-right font-semibold">Notas</th>
                  <th scope="col" className="px-space-sm py-2 text-right font-semibold">Última</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {data.clients.map((client) => (
                  <tr key={client.clientCode || client.clientName} className="align-top">
                    <td className="px-space-sm py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (client.clientCode) onOpenClient(client);
                        }}
                        disabled={!client.clientCode}
                        title={
                          client.clientCode
                            ? `Ver las notas de ${client.clientName} en el mes`
                            : 'Cliente sin código en Profit'
                        }
                        className="group flex min-w-0 items-center gap-1 text-left disabled:cursor-default"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-on-surface group-hover:text-primary">
                            {client.clientName}
                          </span>
                          <span className="block text-label-sm tabular-nums text-outline">
                            {client.clientCode || 'sin código'}
                            {client.customerType ? ` · ${client.customerType}` : ''}
                          </span>
                        </span>
                        {client.clientCode && (
                          <ChevronRight
                            aria-hidden
                            className="size-3.5 shrink-0 text-outline transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                          />
                        )}
                      </button>
                    </td>
                    <td className="px-space-sm py-2 text-right tabular-nums text-on-surface">
                      {client.carteraKg > 0 ? `${fmtKg(client.carteraKg)} kg` : '—'}
                    </td>
                    <td className="px-space-sm py-2 text-right tabular-nums text-on-surface">
                      {client.ownKg > 0 ? `${fmtKg(client.ownKg)} kg` : '—'}
                    </td>
                    <td className="px-space-sm py-2 text-right tabular-nums">
                      {client.otherKg > 0 ? (
                        <span className="inline-flex flex-col items-end">
                          <span className="font-semibold text-warning">{fmtKg(client.otherKg)} kg</span>
                          {client.otherInternalKg > 0 && (
                            <span className="text-label-sm text-outline">
                              interna {fmtKg(client.otherInternalKg)}
                            </span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-space-sm py-2 text-right tabular-nums text-label-sm text-on-surface-variant">
                      <span className="block">{fmtQty(client.carteraNotes, 0)} cartera</span>
                      <span className="block text-outline">{fmtQty(client.ownNotes, 0)} firmadas</span>
                    </td>
                    <td className="px-space-sm py-2 text-right tabular-nums text-label-sm text-on-surface-variant">
                      {fmtDate(client.lastInvoiceDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-surface-container bg-surface-container-low/50 font-semibold text-on-surface">
                  <td className="px-space-sm py-2">
                    Total · {fmtQty(data.totals.noteClientCount, 0)} con notas
                  </td>
                  <td className="px-space-sm py-2 text-right tabular-nums">{fmtKg(data.totals.carteraKg)} kg</td>
                  <td className="px-space-sm py-2 text-right tabular-nums">{fmtKg(data.totals.ownKg)} kg</td>
                  <td className="px-space-sm py-2 text-right tabular-nums text-warning">
                    {fmtKg(data.totals.otherKg)} kg
                  </td>
                  <td className="px-space-sm py-2 text-right tabular-nums text-label-sm text-on-surface-variant">
                    {fmtQty(data.totals.carteraNotes, 0)} cartera
                  </td>
                  <td className="px-space-sm py-2 text-right tabular-nums text-label-sm text-on-surface-variant">
                    {fmtDate(data.totals.lastInvoiceDate)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

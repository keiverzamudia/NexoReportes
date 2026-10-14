// Divide el esquema de dominios de sync en un contrato pequeño y testeable.
export const SYNC_DOMAINS = [
  'PRODUCTOS',
  'CLIENTES',
  'PEDIDOS',
  'PEDIDOS_DETALLE',
  'EXISTENCIAS',
  'ALMACENES',
] as const;

export type SyncDomain = (typeof SYNC_DOMAINS)[number];

// Orden en que el worker debe ejecutar los dominios: los dependientes van
// después de sus prerequisites (p. ej. PEDIDOS_DETALLE requiere PEDIDOS).
export const SYNC_ORDER: readonly SyncDomain[] = [
  'ALMACENES',
  'PRODUCTOS',
  'CLIENTES',
  'PEDIDOS',
  'PEDIDOS_DETALLE',
  'EXISTENCIAS',
];

// Asegra que un valor arbitrario sea un dominio válido, o undefined si no lo es.
export function coerceDomain(value: unknown): SyncDomain | undefined {
  return SYNC_DOMAINS.includes(value as SyncDomain) ? (value as SyncDomain) : undefined;
}

// Contrato de la ayuda contextual de tablas.
//
// Cada columna con ayuda declara un `HelpTerm`; el mismo objeto alimenta el
// popover del encabezado, la fila de explicaciones y el glosario del módulo.
// Así la definición vive en un solo sitio y no se desincroniza de la tabla.

export type HelpTerm = {
  /** Identificador estable (normalmente la clave de la columna). */
  id: string;
  /** Título visible en el popover. */
  title: string;
  /** Frase corta para la fila de explicaciones (≤ ~40 caracteres). */
  short: string;
  /** Qué significa la columna, en una frase. */
  what: string;
  /** Fórmula legible, sin SQL. */
  formula?: string;
  /** Origen del dato o regla que lo condiciona. */
  source?: string;
};

export type HelpModule = {
  title: string;
  /** Reglas transversales del informe. */
  rules: string[];
  terms: HelpTerm[];
};

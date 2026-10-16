# Nexo Producción — Sistema de diseño (contrato de UI)

> Fuente de verdad para cualquier cambio de interfaz. Si algo se ve igual en dos
> vistas, **vive en `apps/web/components/ui.tsx`**; ninguna vista duplica tablas,
> tarjetas, badges ni controles.
>
> El look actual del sistema es la autoridad (no el mockup de Stitch). Se
> conservan: superficies claras, tarjetas sin borde con sombra suave, radio 12px,
> Rubik, y la paleta azul `#003366` / lima `#95C800`.

## 1. Modelo de la interfaz

Modo **Operate**: el usuario completa una tarea (planificar, despachar,
consultar). Prioridades, en orden: escaneabilidad → consistencia → certeza del
dato → expresión de marca en detalles precisos.

**Regla dura:** cero cambios en cálculos, contratos Zod, backend o datos. Sólo
presentación. Los números que ya validamos no se tocan.

## 2. Tokens (`app/globals.css`)

| Token | Uso |
|---|---|
| `bg-surface` / `bg-surface-container-low` | lienzo y pozos secundarios |
| `bg-surface-container-lowest` | superficies de trabajo (tarjetas) |
| `text-on-surface` / `text-on-surface-variant` | texto principal / secundario |
| `text-primary` / `bg-primary-container` | marca azul: títulos y acción primaria |
| `bg-secondary-container` | acción afirmativa / acento lima |
| `critical` `warning` `success` (+ `-container`, `-on-...-container`) | semáforo |
| `--spacing-space-2xs…2xl` | espaciado (usar **siempre** estos, no `p-4`) |
| `text-label-sm/md`, `text-body-md/lg`, `text-title-md`, `text-headline-md/lg`, `text-display-lg` | escala tipográfica |

Semáforo, sin excepción: **falta → `critical` (rojo)** · **parcial → `warning`
(ámbar)** · **cubre → `success` (verde)** · **sin dato → `muted`**. Nunca
`text-error`/`text-green-500` sueltos.

Números: `tabular-nums` (la clase ya existe) vía `align="right"` en `Td`/`Column`.
Cantidades enteras con `fmtInt`; `fmtQty(v, n)` sólo si hay decimales reales.
**`—` es «sin dato»; `0` se muestra como `0`.**

## 3. Primitivas (`components/ui.tsx`)

`PageHeader` · `Card` · `CardHeader` · `Toolbar` · `FilterBar` · `Kpi` · `Badge`
(`tone`, `dot`) · `Button` (`primary | accent | outline | ghost | danger`) ·
`Segmented` · `TextInput` · `Select` · `DateInput` · `DataTable` · `EmptyState`
· `ErrorNote` · `Skeleton` · `CoverageBar` · `cx` · `fmtInt` · `fmtQty` ·
`fmtDate` · `fmtDateTime`.

- **`PageHeader`**: `icon`, `title` y `subtitle`. **Sin eyebrow/kicker**: el
  título carga su propio peso; el contexto va en el subtítulo.
- **`Button`**: altura 44px en phone / 36px en escritorio (automático). Acción
  primaria = `primary`; confirmaciones afirmativas = `accent`.
- **Campos**: `TextInput`/`Select`/`DateInput` ya traen el tamaño y el
  `placeholder` correctos. No crear inputs a mano.
- **Estados**: toda vista tiene vacío (`EmptyState`), cargando (`DataTable`
  `loading` o `Skeleton`) y error (`ErrorNote`).

### `DataTable` — una sola implementación, dos caras

```tsx
const columns: Column<Row>[] = [
  { key: 'code', header: 'Código', kind: 'id', render: (r) => r.code, sortValue: (r) => r.code },
  { key: 'desc', header: 'Descripción', render: (r) => r.description, title: (r) => r.description },
  { key: 'stock', header: 'Existencia', align: 'right', kind: 'metric', render: (r) => fmtInt(r.stock), sortValue: (r) => r.stock },
  { key: 'status', header: 'Estado', kind: 'status', render: (r) => <Badge tone={tone(r)}>{label(r)}</Badge> },
  { key: 'action', header: 'Acciones', kind: 'action', render: (r) => <Button ... /> },
  { key: 'extra', header: 'Neto', align: 'right', kind: 'detail', render: (r) => fmtInt(r.net) },
];

<DataTable
  columns={columns}
  rows={rows}
  rowKey={(r) => r.code}
  loading={isLoading}
  empty={<EmptyState ... />}
  footer={<TotalsRow>…</TotalsRow>}
  mobileSummary={<div className="px-space-lg py-space-sm">…</div>}
/>
```

- **≥md**: tabla densa (filas ~34px), encabezado y **primera columna anclados**,
  orden por clic en columnas con `sortValue`, scroll interno.
- **<md**: una tarjeta por fila — `id` arriba, `status` a la derecha, `metric`
  como cifras grandes, `field` como label/valor, `detail` plegado en «Ver más» y
  `action` como botones a lo ancho.
- `kind` por defecto es `field`. **Toda columna debe declarar su `kind`.**

## 4. Responsive (phone y PC: todo se puede hacer en ambos)

- Breakpoints: **<768px = teléfono** (tarjetas, barra inferior) · **768–1279px =
  tablet** (tabla, filtros en línea) · **≥1280px** = escritorio.
- **Prohibido esconder funcionalidad en teléfono.** Si importa, se adapta.
- Área táctil ≥44px y campos a 16px en puntero grueso: ya lo garantiza
  `globals.css` (`@media (pointer: coarse)`). **No lo sobre-escribas.**
- Nada depende de `hover`: la información del `title` debe estar también visible
  en la tarjeta del teléfono.
- Las acciones primarias de un formulario van **a lo ancho** en phone.
- Charts: `<EChart option={…} height={240} ariaLabel="…" />`. Usar los colores
  del sistema en las series; la gráfica ya se auto-dimensiona.

## 5. Accesibilidad (mínimo, no negociable)

- Foco visible (ya global). Todo control tiene nombre accesible (`ariaLabel` o
  `<label>`).
- Encabezados de tabla con `scope`/`aria-sort` (los pone `DataTable`).
- Mensajes de error con `role="alert"`; estados vivos con `aria-live="polite"`.
- Contraste ≥4.5:1 en texto de cuerpo. No usar gris sobre fondo de color.
- Respetar `prefers-reduced-motion` (ya global).

## 6. Escritura de la interfaz (copy)

Español, vocabulario del negocio (forca, existencia, demanda, a producir,
excedente, despacho). Los controles **nombran su acción** («Fijar mes»,
«Guardar semanа», «Exportar plan»); los errores **nombran el problema y la
salida**. Nada de «OK»/«Aceptar» genéricos.

## 7. Antes de entregar

1. `pnpm typecheck` y `pnpm build` en verde.
2. Revisar la vista a **390px** y a **1440px** (ambas, siempre).
3. Sin `hover`-only, sin texto recortado sin `title`, sin ceros ambiguos.

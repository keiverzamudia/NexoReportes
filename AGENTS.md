# AGENTS.md

Reglas de trabajo para el agente en este repo (`nexo-produccion`, pnpm + turbo).

## Verificación: solo cuando el usuario lo pida

El usuario decide cuándo se prueban los cambios. Por defecto **no** ejecutar pruebas, lint, typecheck ni build.

- Cambio pequeño (UI, textos, estilos, labels, ajustes de layout): editar y mostrar el diff. **Cero comandos de verificación.**
- Cambio de lógica/props/estado: editar. Como máximo `pnpm --filter @nexo/web typecheck` si hay riesgo real de tipos.
- Verificación completa (`pnpm typecheck` → `pnpm test` → `pnpm build`): solo al cerrar un lote, antes de commit, o cuando el usuario lo pida explícitamente.
- Excepción: si el cambio toca DB, sincronización con Profit, auth o contratos de API, avisar del riesgo y proponer verificación (sin ejecutarla sin permiso).
- Nunca repetir pruebas ya pasadas por ajustes cosméticos.

## Estilo de trabajo

- Cambios pequeños, quirúrgicos y acertados. Nada de refactors no pedidos ni relleno.
- Reutilizar componentes/utilidades existentes antes de crear nuevos.
- Responder corto: qué se cambió y en qué archivo. Sin narrar pruebas que no se hicieron.

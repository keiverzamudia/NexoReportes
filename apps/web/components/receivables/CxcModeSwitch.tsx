'use client';

// ============================================================
// Selector de modo de CXC. No es una pestaña de ruta: cambia el dataset y
// todo el tablero. El estado vive en la página para que ambos modos compartan
// el mismo punto de entrada.
// ============================================================

import { Card, Segmented } from '../ui';

export type CxcMode = 'cartera' | 'ventas';

const OPTIONS: Array<{ value: CxcMode; label: string }> = [
  { value: 'cartera', label: 'Cartera' },
  { value: 'ventas', label: 'Ventas + cartera' },
];

export function CxcModeSwitch({
  mode,
  onChange,
}: {
  mode: CxcMode;
  onChange: (mode: CxcMode) => void;
}) {
  return (
    <Card className="flex flex-col gap-space-sm border-outline-variant/30 bg-surface-container-lowest/80 px-space-md py-space-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-space-sm">
        <span className="text-label-sm font-semibold uppercase tracking-wide text-outline">Modo</span>
        <Segmented
          ariaLabel="Modo de la vista de Cuentas por cobrar"
          value={mode}
          onChange={onChange}
          options={OPTIONS}
        />
      </div>
      <p className="text-label-sm normal-case text-on-surface-variant">
        {mode === 'cartera'
          ? 'Saldos, mora y cobranza de hoy.'
          : 'Venta del año cruzada con la deuda de hoy.'}
      </p>
    </Card>
  );
}

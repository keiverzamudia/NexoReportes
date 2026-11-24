'use client';

import { useState } from 'react';
import { CarteraView } from '../../components/receivables/CarteraView';
import { SalesCrossView } from '../../components/receivables/SalesCrossView';
import type { CxcMode } from '../../components/receivables/CxcModeSwitch';

// ============================================================
// CxC tiene dos modos sobre la misma ruta: la cartera de hoy y el cruce
// ventas + cartera. El switch cambia todo el tablero, no una pestaña interna.
// ============================================================

export default function ReceivablesPage() {
  const [mode, setMode] = useState<CxcMode>('cartera');

  function changeMode(next: CxcMode) {
    setMode(next);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return mode === 'cartera' ? (
    <CarteraView mode={mode} onModeChange={changeMode} />
  ) : (
    <SalesCrossView mode={mode} onModeChange={changeMode} />
  );
}

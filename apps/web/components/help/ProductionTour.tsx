'use client';

// ============================================================
// Recorrido guiado del módulo de Producción con Driver.js.
//
// El recorrido explica el flujo (periodo → pestañas → plan → pedidos →
// materiales → recetas → escenarios) y cambia de pestaña cuando el paso
// apunta a un ancla que vive en otra sección. Driver.js se carga solo al
// pulsar «Guía» para no sumarlo al primer render.
// ============================================================

import type { DriveStep, Driver } from 'driver.js';
import { Compass } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ProductionTab } from '../../content/help/production';

type TourStep = {
  /** Selector `data-tour` del elemento a resaltar. Sin él, el paso va centrado. */
  element?: string;
  /** Pestaña que debe estar activa para que exista el elemento. */
  tab?: ProductionTab;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
};

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Producción en un minuto',
    description:
      'Profit aporta los datos y Nexo calcula el plan, las compras y el riesgo. Te muestro dónde está cada cosa; puedes salir con Esc.',
  },
  {
    element: '[data-tour="prod-controls"]',
    title: 'El periodo manda',
    description:
      'Mes, semana, política y moneda recalculan todo el módulo. La política decide qué demanda se cubre.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-tabs"]',
    title: 'Una pestaña por pregunta',
    description:
      'Resumen: qué producir y qué comprar · Plan: el detalle · Selección: qué pedidos atender · Explosión: materiales · Fórmulas y Nutrición: receta · Escenarios: comparar.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-summary"]',
    tab: 'summary',
    title: 'Resumen ejecutivo',
    description:
      'Estado del plan, cumplimiento del forecast, top de compras y clientes. Los detalles viven en cada pestaña.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-plan"]',
    tab: 'plan',
    title: 'El plan',
    description:
      'Cada fila calcula el faltante, lo redondea a lotes y estima el costo. Doble clic abre la ficha; «Ajustar cantidades» simula sin escribir en Profit.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-selection"]',
    tab: 'selection',
    title: 'Selecciona pedidos',
    description:
      'Marca pedidos o líneas y simula: el plan y la explosión se recalculan solo con esa cartera.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-explosion"]',
    tab: 'explosion',
    title: 'Explosión de materiales',
    description:
      'Cuánto material se necesita y cuánto comprar después de descontar stock y compras en tránsito.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-formulas"]',
    tab: 'formulas',
    title: 'Fórmulas y costos',
    description:
      'Cédula principal, componentes, costo por kg/saco y empaque. La pestaña Nutrición usa la misma receta.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-scenarios"]',
    tab: 'scenarios',
    title: 'Escenarios',
    description:
      'Guarda una foto del plan y compárala contra otro periodo, política o moneda.',
    side: 'bottom',
  },
  {
    element: '[data-tour="prod-help"]',
    title: 'Dudas en el camino',
    description:
      'Cada encabezado con línea punteada tiene su explicación. El botón de ayuda abre el detalle de la pestaña activa.',
    side: 'left',
  },
];

export function ProductionTour({
  activeTab,
  onTabChange,
}: {
  activeTab: ProductionTab;
  onTabChange: (tab: ProductionTab) => void;
}) {
  const driverRef = useRef<Driver | null>(null);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    },
    [],
  );

  async function startTour() {
    if (driverRef.current?.isActive()) return;

    const { driver } = await import('driver.js');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let navigating = false;

    /**
     * Cambia de pestaña antes de avanzar y espera a que exista el ancla.
     * Driver.js resuelve el `element` del paso al entrar, así que la pestaña
     * debe estar montada antes de `moveNext()`/`movePrevious()`.
     */
    const moveWithTab = (target: TourStep | undefined, move: () => void) => {
      if (navigating) return;
      navigating = true;
      const run = () => {
        navigating = false;
        move();
      };
      const tab = target?.tab;
      if (!tab || activeTabRef.current === tab) {
        run();
        return;
      }
      activeTabRef.current = tab;
      onTabChange(tab);
      const selector = target?.element;
      let tries = 0;
      const attempt = () => {
        if (!selector || document.querySelector(selector) || tries >= 24) {
          run();
          return;
        }
        tries += 1;
        window.requestAnimationFrame(attempt);
      };
      window.requestAnimationFrame(attempt);
    };

    const steps: DriveStep[] = TOUR_STEPS.map((step) => ({
      element: step.element,
      data: { tab: step.tab },
      disableActiveInteraction: step.element ? 'clicks' : undefined,
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
        align: step.align,
      },
    }));

    driverRef.current?.destroy();
    driverRef.current = driver({
      steps,
      animate: !reduced,
      duration: reduced ? 1 : 260,
      overlayColor: '#081d2c',
      overlayOpacity: 0.45,
      stagePadding: 8,
      stageRadius: 14,
      smoothScroll: true,
      scrollIntoView: { block: 'center' },
      allowClose: true,
      showProgress: true,
      progressText: 'Paso {{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Atrás',
      doneBtnText: 'Listo',
      closeBtnLabel: 'Cerrar guía',
      popoverClass: 'nexo-tour',
      onNextClick: (_element, _step, { driver: instance }) => {
        const index = instance.getState().activeIndex ?? 0;
        moveWithTab(TOUR_STEPS[index + 1], () => instance.moveNext());
      },
      onPrevClick: (_element, _step, { driver: instance }) => {
        const index = instance.getState().activeIndex ?? 0;
        moveWithTab(TOUR_STEPS[index - 1], () => instance.movePrevious());
      },
      onDestroyed: () => {
        driverRef.current = null;
      },
    });
    driverRef.current.drive();
  }

  return (
    <button
      type="button"
      data-tour="prod-tour"
      onClick={() => void startTour()}
      title="Recorrido guiado por el módulo"
      aria-label="Abrir guía rápida del módulo de Producción"
      className="inline-flex h-10 items-center gap-space-2xs rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-space-md text-label-md font-semibold text-on-surface-variant transition-colors hover:border-primary-container/40 hover:text-primary"
    >
      <Compass aria-hidden className="size-4" />
      Guía
    </button>
  );
}

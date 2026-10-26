'use client';

import { cx } from '../ui';

// ============================================================
// Indicador de carga agroindustrial: saco de alimento + espiga
// dentro de un círculo azul grisáceo, con un aro segmentado que
// gira alrededor. Todo es SVG + CSS, sin imágenes ni dependencias.
// El saco permanece estable; solo gira el aro.
// ============================================================

export function LoadingAgroindustrial({
  label = 'Cargando',
  className,
}: {
  /** Texto accesible; no se muestra en pantalla. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      aria-label={label}
      className={cx('relative grid size-32 place-items-center select-none', className)}
    >
      {/* Aro segmentado: es lo único que rota. */}
      <svg
        className="agro-loader-ring absolute inset-0 size-full"
        viewBox="0 0 120 120"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="60" cy="60" r="55" stroke="#cbd5e1" strokeWidth="2.5" />
        <circle
          cx="60"
          cy="60"
          r="55"
          stroke="#64748b"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="6.5 22.3"
        />
      </svg>

      {/* Círculo central con el saco dibujado en línea blanca. */}
      <div className="relative grid size-24 place-items-center rounded-full bg-[#475569] shadow-[0_10px_30px_-12px_rgba(15,23,42,0.65)] ring-1 ring-white/10">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          className="size-16"
          aria-hidden="true"
          focusable="false"
        >
          {/* Cuerpo del saco */}
          <path
            d="M23 24.5H41L43.5 47.5C43.8 50.8 41.1 53.5 37.8 53.5H26.2C22.9 53.5 20.2 50.8 20.5 47.5L23 24.5Z"
            fill="rgba(255,255,255,0.06)"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />

          {/* Banda superior doblada */}
          <rect
            x="18.5"
            y="18"
            width="27"
            height="6.5"
            rx="3.25"
            stroke="#ffffff"
            strokeWidth="2.2"
          />

          {/* Boca abierta y granos */}
          <path
            d="M24 18C25 13.8 39 13.8 40 18"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <g fill="#ffffff">
            <ellipse cx="24.5" cy="14.8" rx="1.3" ry="1.9" transform="rotate(-24 24.5 14.8)" />
            <ellipse cx="29.8" cy="12.9" rx="1.4" ry="2" transform="rotate(-8 29.8 12.9)" />
            <ellipse cx="35.5" cy="13.2" rx="1.4" ry="2" transform="rotate(9 35.5 13.2)" />
            <ellipse cx="40.5" cy="15.4" rx="1.3" ry="1.9" transform="rotate(24 40.5 15.4)" />
          </g>

          {/* Costuras laterales e inferior */}
          <path
            d="M23.5 27V47.5M40.5 27V47.5"
            stroke="#ffffff"
            strokeOpacity="0.5"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M22 47.5C25 49.5 39 49.5 42 47.5"
            stroke="#ffffff"
            strokeOpacity="0.5"
            strokeWidth="1.2"
            strokeLinecap="round"
          />

          {/* Espiga de trigo */}
          <path d="M32 44V29" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
          <g stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M32 40C28.4 39.4 26 37 26 34.4C29.2 34.4 32 36.6 32 40Z" />
            <path d="M32 40C35.6 39.4 38 37 38 34.4C34.8 34.4 32 36.6 32 40Z" />
            <path d="M32 34.5C28.4 33.9 26 31.5 26 28.9C29.2 28.9 32 31.1 32 34.5Z" />
            <path d="M32 34.5C35.6 33.9 38 31.5 38 28.9C34.8 28.9 32 31.1 32 34.5Z" />
          </g>
          <ellipse cx="32" cy="26.6" rx="1.6" ry="2.4" fill="#ffffff" />
        </svg>
      </div>
    </div>
  );
}

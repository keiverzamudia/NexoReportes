// ============================================================
// Marca CORPOAGRO — isologo oficial.
//
// Los SVG de `public/brand/` se extrajeron vectorialmente de la Guía de
// Identidad Gráfica Corpoagro (no son capturas): colores #003366 / #95C800,
// mismas formas y contraformas. Hay tres versiones (color, negativo para
// fondos oscuros, monocromo) y dos recortes (completo con la razón social y
// compacto para la navegación).
// ============================================================

export type LogoVariant = 'color' | 'negative' | 'mono';
export type LogoSize = 'full' | 'compact';

const SOURCES: Record<LogoSize, Record<LogoVariant, string>> = {
  full: {
    color: '/brand/corpoagro-logo.svg',
    negative: '/brand/corpoagro-logo-negativo.svg',
    mono: '/brand/corpoagro-logo-mono.svg',
  },
  compact: {
    color: '/brand/corpoagro-logo-compacto.svg',
    negative: '/brand/corpoagro-logo-compacto-negativo.svg',
    mono: '/brand/corpoagro-logo-compacto-mono.svg',
  },
};

// Relación de aspecto real del artwork (viewBox), para reservar el espacio
// antes de que cargue la imagen y no provocar saltos de layout.
const RATIO: Record<LogoSize, number> = {
  full: 406.8 / 99.4,
  compact: 406.8 / 80.7,
};

export function Logo({
  height = 28,
  size = 'compact',
  variant = 'color',
  className,
  priority = false,
}: {
  height?: number;
  size?: LogoSize;
  variant?: LogoVariant;
  className?: string;
  /** true en el login: la marca está sobre el pliegue. */
  priority?: boolean;
}) {
  const width = Math.round(height * RATIO[size]);
  return (
    <img
      src={SOURCES[size][variant]}
      width={width}
      height={height}
      alt="Corpoagro"
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      // eslint-disable-next-line @next/next/no-img-element
      className={`w-auto shrink-0 ${className ?? ''}`}
      style={{ height }}
    />
  );
}

/** Solo las hojas: para favicon, avatares y espacios muy pequeños. */
export function Isotype({ height = 28, variant = 'color', className }: { height?: number; variant?: LogoVariant; className?: string }) {
  const source =
    variant === 'negative'
      ? '/brand/corpoagro-isotipo-negativo.svg'
      : variant === 'mono'
        ? '/brand/corpoagro-isotipo-mono.svg'
        : '/brand/corpoagro-isotipo.svg';
  const width = Math.round(height * (246.6 / 204.9));
  return (
    <img
      src={source}
      width={width}
      height={height}
      alt="Corpoagro"
      // eslint-disable-next-line @next/next/no-img-element
      className={`w-auto shrink-0 ${className ?? ''}`}
      style={{ height }}
    />
  );
}

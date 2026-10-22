// ============================================================
// Marca "SAN LUIS" — SVG corporativo (Grupo San Luis).
// Medidas del prototipo corporativo: login 26×30, navegación 25×29.
// ============================================================
export function Logo({ width = 25, height = 29 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 112 124"
      role="img"
      aria-label="San Luis"
      focusable="false"
      className="shrink-0"
    >
      <g transform="translate(11,0) skewX(-8)">
        <rect x="8" y="8" width="88" height="108" rx="26" fill="#fff" stroke="#003366" strokeWidth="7" />
        <polygon points="30,28 74,28 74,44 46,44 46,76 30,76" fill="#95C800" />
        <polygon
          points="30,76 30,96 74,96 74,52 58,52 58,62 48,62 48,72 58,72 58,80 46,80 46,76"
          fill="#003366"
        />
      </g>
    </svg>
  );
}

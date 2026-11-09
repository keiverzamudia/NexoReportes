import Link from 'next/link';

// 404 del App Router. Next 15.5 falla al generar `/_not-found` cuando el
// proyecto no define esta página y hay rutas de metadatos (icon.svg).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-space-md p-space-lg text-center">
      <p className="text-label-sm font-semibold uppercase tracking-wider text-outline">Error 404</p>
      <h1 className="text-headline-sm font-bold text-primary">No encontramos esta página</h1>
      <p className="text-body-md text-on-surface-variant">
        Puede que el enlace haya cambiado o que no tengas acceso a este módulo.
      </p>
      <Link
        href="/"
        className="mt-space-sm inline-flex h-10 items-center rounded-pill bg-primary-container px-space-lg font-semibold text-on-primary transition-all hover:-translate-y-0.5 hover:bg-primary"
      >
        Volver al inicio
      </Link>
    </main>
  );
}

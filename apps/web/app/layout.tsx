import type { Metadata } from 'next';
import { Anton, Asap } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// Tipografías de la Guía de Identidad Gráfica Corpoagro:
//   · Asap  → tipografía principal (interfaz y textos).
//   · Anton → tipografía secundaria, solo para display (títulos y cifras).
const asap = Asap({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-asap',
});

const anton = Anton({
  subsets: ['latin'],
  display: 'swap',
  weight: '400',
  variable: '--font-anton',
});

export const metadata: Metadata = {
  title: 'Corpoagro · San Luis — Gestión de producción',
  description:
    'Sistema de gestión de producción de San Luis (Corpoagro · Nutrición Animal): inventarios, pedidos, despacho, llegadas de clientes y reportes sincronizados con Profit.',
  applicationName: 'Corpoagro · San Luis',
  openGraph: {
    title: 'Corpoagro · San Luis — Gestión de producción',
    description: 'Inventarios, pedidos, despacho y llegadas de clientes sincronizados con Profit.',
    images: [{ url: '/brand/corpoagro-og.jpg', width: 1200, height: 630, alt: 'Corpoagro' }],
    locale: 'es_VE',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${asap.variable} ${anton.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

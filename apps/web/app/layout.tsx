import type { Metadata } from 'next';
import { Rubik } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const rubik = Rubik({
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
  variable: '--font-rubik',
});

export const metadata: Metadata = {
  title: 'Nexo Producción — Molinos San Luis',
  description:
    'Sistema inteligente de producción alimenticia, inventarios, pedidos, simulación y reportes sincronizado con Profit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={rubik.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

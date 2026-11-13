import { redirect } from 'next/navigation';

// El módulo se renombró a «Vendedor» (`/vendedor`). Se conserva esta ruta para
// no romper enlaces y marcadores antiguos.
export default function LegacySellersPage() {
  redirect('/vendedor');
}

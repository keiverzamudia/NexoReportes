import { redirect } from 'next/navigation';

// La entrada de la aplicación es el login: `/` no muestra ninguna pantalla
// intermedia. Si no hay sesión, Disponibilidad pide el login (cookie HttpOnly);
// si la hay, se entra directo al primer módulo.
export default function Home() {
  redirect('/disponibilidad');
}

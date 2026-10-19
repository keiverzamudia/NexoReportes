// ============================================================
// Seed de Nexo Producción.
//
// Ya NO crea usuarios internos: los usuarios vienen de Profit
// (`MasterProfit.dbo.VUSUARIOS`) y su contraseña se valida contra
// `MasterProfit.dbo.autenticar`. Los roles se administran en el módulo
// «Usuarios» de la aplicación.
//
// Este archivo existe solo como recordatorio y para que `prisma db seed`
// no falle ni recree una cuenta con contraseña local.
// ============================================================

async function main() {
  console.log(
    'Nada que sembrar: los usuarios se sincronizan desde Profit (botón «Sincronizar usuarios»).',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

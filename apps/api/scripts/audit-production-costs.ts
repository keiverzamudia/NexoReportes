// Auditoría de costos de producción (solo lectura).
//
// Uso, desde apps/api:
//   pnpm production:audit ABABOV28
//
// Imprime, para la cédula principal del producto: cantidad y costo unitario de
// cada materia prima (USD de Profit «Último OM»), la suma, el empaque, el
// costo por kg/saco y la comparación con el costo del artículo en Profit.
// Sirve para confirmar que la ficha de Fórmulas no está inventando valores.

import * as sql from 'mssql';
import {
  componentCost,
  displayCost,
  Formula,
  FormulaComponent,
  formulaCostPerKg,
  formulaOutputKg,
  isBulkPresentation,
  sackCostFromKg,
} from '../src/modules/production/production.types';

interface ComponentRow {
  line: number;
  code: string;
  description: string;
  type: string;
  uom: string;
  qty: number;
  kg_per_uom: number | null;
  last_bs: number;
  avg_bs: number;
  last_usd: number;
  avg_usd: number;
  rep_bs: number;
}

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const productCode = (process.argv[2] ?? '').trim().toUpperCase();
  if (!productCode) {
    console.error('Uso: pnpm production:audit <código de producto>');
    process.exit(1);
  }
  process.loadEnvFile('.env');

  const pool = await sql.connect({
    server: process.env.PROFIT_DB_SERVER ?? '',
    database: process.env.PROFIT_DB_DATABASE ?? '',
    user: process.env.PROFIT_DB_USER ?? '',
    password: process.env.PROFIT_DB_PASSWORD ?? '',
    options: { trustServerCertificate: true, encrypt: false },
    connectionTimeout: 15_000,
    requestTimeout: 120_000,
  });

  try {
    const rate = n(
      (
        await pool
          .request()
          .query("SELECT TOP 1 tasa_v FROM dbo.tasas WHERE RTRIM(co_mone) = 'US$' ORDER BY fecha DESC")
      ).recordset[0]?.tasa_v,
    );

    const product = (
      await pool.request().query(`
        SELECT RTRIM(a.co_art) AS code, RTRIM(a.art_des) AS description,
               RTRIM(a.uni_venta) AS uom, a.uni_relac AS kg_per_uom,
               a.ult_cos_un AS last_bs, a.ult_cos_om AS last_usd, a.ult_cos_do AS last_do
        FROM dbo.art a WHERE RTRIM(a.co_art) = '${productCode.replace(/'/g, "''")}'
      `)
    ).recordset[0];
    if (!product) throw new Error(`No existe el artículo ${productCode} en Profit.`);

    // Presentación (BASE) o cédula maestra del propio producto.
    const ace = (
      await pool.request().query(`
        SELECT r.co_ced AS formula_id
        FROM dbo.reng_ace r JOIN dbo.spced c ON c.co_ced = r.co_ced
        WHERE RTRIM(r.co_art) = '${productCode.replace(/'/g, "''")}'
          AND c.dias = 0 AND c.horas >= 2
      `)
    ).recordset[0];
    const formulaId =
      ace?.formula_id ??
      (
        await pool.request().query(`
          SELECT TOP 1 co_ced AS formula_id FROM dbo.spced
          WHERE RTRIM(co_art) = '${productCode.replace(/'/g, "''")}'
            AND dias = 0 AND horas >= 2
          ORDER BY estandar DESC, co_ced DESC
        `)
      ).recordset[0]?.formula_id;
    if (!formulaId) throw new Error(`No hay cédula maestra para ${productCode}.`);

    const master = (
      await pool.request().query(`
        SELECT c.co_ced AS formula_id, RTRIM(c.ced_des) AS name,
               c.cantidad AS output_qty, RTRIM(c.co_uni) AS output_uom,
               RTRIM(c.campo1) AS batch_raw
        FROM dbo.spced c WHERE c.co_ced = ${Number(formulaId)}
      `)
    ).recordset[0];

    const rows: ComponentRow[] = (
      await pool.request().query(`
        SELECT m.reng_num AS line, RTRIM(m.co_art) AS code, RTRIM(a.art_des) AS description,
               RTRIM(a.co_subl) AS type, RTRIM(m.co_uni) AS uom, m.cantidad AS qty,
               a.uni_relac AS kg_per_uom, a.ult_cos_un AS last_bs, a.cos_pro_un AS avg_bs,
               a.ult_cos_om AS last_usd, a.cos_pro_om AS avg_usd, a.cos_merc AS rep_bs
        FROM dbo.spced c JOIN dbo.reng_mce m ON m.co_ced = c.co_ced
             JOIN dbo.art a ON a.co_art = m.co_art
        WHERE c.co_ced = ${Number(formulaId)} ORDER BY m.reng_num
      `)
    ).recordset.map((row: Record<string, unknown>) => ({
      line: n(row.line),
      code: String(row.code).trim(),
      description: String(row.description).trim(),
      type: String(row.type).trim(),
      uom: String(row.uom).trim(),
      qty: n(row.qty),
      kg_per_uom: row.kg_per_uom === null ? null : n(row.kg_per_uom),
      last_bs: n(row.last_bs),
      avg_bs: n(row.avg_bs),
      last_usd: n(row.last_usd),
      avg_usd: n(row.avg_usd),
      rep_bs: n(row.rep_bs),
    }));

    const components: FormulaComponent[] = rows.map((row) => ({
      line: row.line,
      code: row.code,
      description: row.description,
      type: row.type,
      uom: row.uom,
      qty: row.qty,
      kgPerUom: row.kg_per_uom,
      lastCost: row.last_bs || null,
      avgCost: row.avg_bs || null,
      lastCostUsd: row.last_usd || null,
      avgCostUsd: row.avg_usd || null,
      replacementCost: row.rep_bs || null,
      inactive: false,
    }));

    const appliesToUom = String(product.uom).trim();
    const presentationKg = product.kg_per_uom === null ? null : n(product.kg_per_uom);
    const formula: Formula = {
      id: n(master.formula_id),
      kind: 'MASTER',
      name: String(master.name ?? '').trim(),
      productCode,
      productDescription: String(product.description).trim(),
      appliesToProductCode: productCode,
      appliesToDescription: String(product.description).trim(),
      appliesToUom,
      appliesToKgPerUom: presentationKg,
      outputQty: n(master.output_qty) || 1,
      outputUom: String(master.output_uom).trim(),
      batchKg: n(String(master.batch_raw ?? '').replace(',', '.')) || null,
      hoursPerBatch: null,
      isStandard: true,
      updatedAt: null,
      baseProductCode: null,
      baseProductDescription: null,
      components,
    };

    const bulk = isBulkPresentation(appliesToUom, presentationKg);
    const ingredientPerKg = formulaCostPerKg(formula, presentationKg, 'LAST', rate);
    const outputKg = formulaOutputKg(formula, presentationKg);

    const packaging = (
      await pool.request().query(`
        SELECT TOP 1 RTRIM(m.co_art) AS code, RTRIM(a.art_des) AS description,
               a.ult_cos_un AS last_bs, a.cos_pro_un AS avg_bs,
               a.ult_cos_om AS last_usd, a.cos_pro_om AS avg_usd, COUNT(*) AS uses
        FROM dbo.spced c JOIN dbo.reng_mce m ON m.co_ced = c.co_ced
             JOIN dbo.art a ON a.co_art = m.co_art
        WHERE (c.dias = 1 OR c.horas < 2) AND RTRIM(c.co_art) = '${productCode.replace(/'/g, "''")}'
          AND RTRIM(a.co_subl) = 'EMPAQ'
        GROUP BY RTRIM(m.co_art), RTRIM(a.art_des), a.ult_cos_un, a.cos_pro_un, a.ult_cos_om, a.cos_pro_om
        ORDER BY COUNT(*) DESC
      `)
    ).recordset[0];
    const packagingUsd = packaging
      ? n(packaging.last_usd) > 0
        ? n(packaging.last_usd)
        : rate > 0
          ? n(packaging.last_bs) / rate
          : null
      : null;
    const packagingPerKg = !bulk && packagingUsd !== null && presentationKg && presentationKg > 1
      ? packagingUsd / presentationKg
      : null;
    const totalPerKg = ingredientPerKg !== null && packagingPerKg !== null
      ? ingredientPerKg + packagingPerKg
      : ingredientPerKg;
    const totalPerSack = bulk ? null : sackCostFromKg(totalPerKg, presentationKg);

    console.log(`\n${productCode} · ${product.description}`);
    console.log(`Cédula ${formula.id} · salida ${formula.outputQty} ${formula.outputUom} · kg de salida ${outputKg ?? '—'}`);
    console.log(`Tasa US$: ${rate} · moneda base: USD («Último OM») y Bs = USD × tasa\n`);
    console.log('Línea  Código         Cantidad UOM   Costo unit.    Total USD   Total Bs');
    let sumUsd = 0;
    for (const component of components) {
      const unitUsd = componentCost(component, 'LAST', rate);
      const totalUsd = unitUsd === null ? null : component.qty * unitUsd;
      if (totalUsd !== null) sumUsd += totalUsd;
      const bs = totalUsd === null ? null : displayCost(totalUsd, 'BS', rate);
      console.log(
        [
          String(component.line).padStart(5),
          component.code.padEnd(14),
          component.qty.toFixed(6).padStart(9),
          component.uom.padEnd(5),
          (unitUsd === null ? '—' : unitUsd.toFixed(6)).padStart(12),
          (totalUsd === null ? '—' : totalUsd.toFixed(4)).padStart(12),
          (bs === null ? '—' : bs.toFixed(2)).padStart(12),
        ].join(' '),
      );
    }
    console.log(`\nΣ componentes: ${sumUsd.toFixed(6)} USD · ${displayCost(sumUsd, 'BS', rate)?.toFixed(2)} Bs`);
    console.log(
      `Costo/kg: ${ingredientPerKg === null ? '—' : ingredientPerKg.toFixed(6)} USD componentes` +
        (packagingPerKg === null
          ? ' · sin empaque aparte'
          : ` + ${packagingPerKg.toFixed(6)} USD empaque`) +
        (totalPerKg === null ? '' : ` = ${totalPerKg.toFixed(6)} USD/kg (${displayCost(totalPerKg, 'BS', rate)?.toFixed(2)} Bs/kg)`),
    );
    if (!bulk) {
      console.log(
        `Costo/saco (${presentationKg} kg): ${totalPerSack === null ? '—' : totalPerSack.toFixed(4)} USD · ${
          displayCost(totalPerSack, 'BS', rate)?.toFixed(2) ?? '—'
        } Bs`,
      );
      console.log(`Empaque: ${packaging ? `${packaging.code} · ${packaging.description}` : 'sin configurar'}`);
    } else {
      console.log('Granel: se vende por kg, no aplica costo por saco.');
    }
    console.log(
      `\nReferencia Profit (artículo): Último OM ${n(product.last_usd).toFixed(4)} USD · Anterior OM ${n(
        product.last_do,
      ).toFixed(4)} USD · Último Bs ${n(product.last_bs).toFixed(2)}`,
    );
    if (!bulk && totalPerSack !== null) {
      console.log(
        `Receta: ${totalPerSack.toFixed(4)} USD/saco. El costo del artículo se mantiene aparte en Profit; la receta no lo usa.`,
      );
    }
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

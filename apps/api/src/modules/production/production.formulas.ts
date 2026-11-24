import type {
  ProfitAceRow,
  ProfitFormulaRow,
  ProfitProductionData,
} from './production.profit';
import { Formula, FormulaComponent } from './production.types';

function componentFromRow(row: ProfitFormulaRow): FormulaComponent {
  return {
    line: row.lineNumber,
    code: row.componentCode,
    description: row.componentDescription,
    type: row.componentType,
    uom: row.componentUom,
    qty: row.componentQty,
    kgPerUom: row.componentKgPerUom,
    lastCost: row.lastCost,
    avgCost: row.avgCost,
    lastCostUsd: row.lastCostUsd,
    avgCostUsd: row.avgCostUsd,
    replacementCost: row.replacementCost,
    inactive: row.componentInactive,
  };
}

function groupByFormula(rows: ProfitFormulaRow[]): Map<number, ProfitFormulaRow[]> {
  const map = new Map<number, ProfitFormulaRow[]>();
  for (const row of rows) {
    if (!map.has(row.formulaId)) map.set(row.formulaId, []);
    map.get(row.formulaId)!.push(row);
  }
  return map;
}

export function buildMasterFormulas(rows: ProfitFormulaRow[]): Formula[] {
  const grouped = groupByFormula(rows);
  const result: Formula[] = [];
  for (const [formulaId, group] of grouped) {
    const first = group[0];
    if (!first) continue;
    const components = group
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map(componentFromRow);
    result.push({
      id: formulaId,
      kind: 'MASTER',
      name: first.formulaName || `Cédula ${formulaId}`,
      productCode: first.productCode,
      productDescription: first.productDescription,
      appliesToProductCode: first.productCode,
      appliesToDescription: first.productDescription,
      appliesToUom: first.productUom || first.outputUom,
      appliesToKgPerUom: first.productKgPerUom,
      outputQty: first.outputQty,
      outputUom: first.outputUom,
      batchKg: first.batchKg,
      hoursPerBatch: first.hoursPerBatch,
      isStandard: first.isStandard,
      updatedAt: first.updatedAt,
      baseProductCode: null,
      baseProductDescription: null,
      components,
    });
  }
  return result;
}

export function buildAceFormulas(
  aceRows: ProfitAceRow[],
  mastersById: Map<number, Formula>,
): Formula[] {
  const result: Formula[] = [];
  for (const ace of aceRows) {
    const master = mastersById.get(ace.formulaId);
    if (!master) continue;
    result.push({
      id: ace.formulaId,
      kind: 'BASE',
      name: master.name || `Cédula ${ace.formulaId}`,
      productCode: ace.baseProductCode,
      productDescription: ace.baseProductDescription,
      appliesToProductCode: ace.productCode,
      appliesToDescription: ace.productDescription,
      appliesToUom: ace.productUom,
      appliesToKgPerUom: ace.productKgPerUom,
      outputQty: ace.baseOutputQty,
      outputUom: ace.baseUom,
      batchKg: ace.batchKg ?? master.batchKg,
      hoursPerBatch: ace.hoursPerBatch ?? master.hoursPerBatch,
      isStandard: ace.isStandard,
      updatedAt: ace.updatedAt,
      baseProductCode: ace.baseProductCode,
      baseProductDescription: ace.baseProductDescription,
      components: master.components,
    });
  }
  return result;
}

export function buildBatchFormulas(rows: ProfitFormulaRow[]): Formula[] {
  const grouped = groupByFormula(rows);
  const result: Formula[] = [];
  for (const [formulaId, group] of grouped) {
    const first = group[0];
    if (!first) continue;
    const components = group
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map(componentFromRow);
    result.push({
      id: formulaId,
      kind: 'BATCH',
      name: first.formulaName || `Lote ${formulaId}`,
      productCode: first.productCode,
      productDescription: first.productDescription,
      appliesToProductCode: first.productCode,
      appliesToDescription: first.productDescription,
      appliesToUom: first.productUom || first.outputUom,
      appliesToKgPerUom: first.productKgPerUom,
      outputQty: first.outputQty,
      outputUom: first.outputUom,
      batchKg: first.batchKg,
      hoursPerBatch: first.hoursPerBatch,
      isStandard: first.isStandard,
      updatedAt: first.updatedAt,
      baseProductCode: null,
      baseProductDescription: null,
      components,
    });
  }
  return result;
}

export interface FormulaCatalog {
  all: Formula[];
  byProduct: Map<string, Formula[]>;
  mastersById: Map<number, Formula>;
}

export function buildFormulaCatalog(profit: ProfitProductionData): FormulaCatalog {
  const masters = buildMasterFormulas(profit.formulas);
  const mastersById = new Map(masters.map((formula) => [formula.id, formula]));
  const bases = buildAceFormulas(profit.ace, mastersById);
  const all = [...masters, ...bases];
  const byProduct = new Map<string, Formula[]>();
  for (const formula of all) {
    if (!byProduct.has(formula.appliesToProductCode)) byProduct.set(formula.appliesToProductCode, []);
    byProduct.get(formula.appliesToProductCode)!.push(formula);
  }
  return { all, byProduct, mastersById };
}

const KIND_ORDER: Record<Formula['kind'], number> = { MASTER: 0, BASE: 1, BATCH: 2 };

export function sortFormulas(formulas: Formula[]): Formula[] {
  return formulas.slice().sort((a, b) => {
    const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kind !== 0) return kind;
    if (a.isStandard !== b.isStandard) return a.isStandard ? -1 : 1;
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || b.id - a.id;
  });
}

export function resolveMainFormula(
  candidates: Formula[],
  preferredId: number | null | undefined,
): Formula | null {
  if (candidates.length === 0) return null;
  if (preferredId) {
    const preferred = candidates.find((formula) => formula.id === preferredId);
    if (preferred) return preferred;
  }
  const standardMaster = candidates.find((formula) => formula.kind === 'MASTER' && formula.isStandard);
  if (standardMaster) return standardMaster;
  const standardBase = candidates.find((formula) => formula.kind === 'BASE' && formula.isStandard);
  if (standardBase) return standardBase;
  const standardBatch = candidates.find((formula) => formula.kind === 'BATCH' && formula.isStandard);
  if (standardBatch) return standardBatch;
  return sortFormulas(candidates)[0] ?? null;
}

export function resolveBatchKg(candidates: Formula[], selected: Formula | null): number | null {
  if (selected?.batchKg && selected.batchKg > 0) return selected.batchKg;
  const withBatch = candidates.find((formula) => formula.batchKg !== null && formula.batchKg > 0);
  return withBatch?.batchKg ?? null;
}

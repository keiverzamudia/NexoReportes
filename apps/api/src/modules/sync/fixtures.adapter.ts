import { Injectable } from '@nestjs/common';
import { ProfitAdapter, ProfitConnectionTest } from './profit.adapter';

// Adaptador de fixtures: datos de DESARROLLO/PRUEBA deterministas.
// Nunca se usa en producción y siempre queda identificado como fixtures
// en la UI y en /api/health, para no presentar datos ficticios como reales.
@Injectable()
export class FixturesProfitAdapter implements ProfitAdapter {
  readonly dialect = 'fixtures' as const;

  async testConnection(): Promise<ProfitConnectionTest> {
    return { connected: true, message: 'Modo fixtures: sin conexión real a Profit' };
  }

  async listViews(): Promise<string[]> {
    return ['fixtures.vw_productos', 'fixtures.vw_clientes', 'fixtures.vw_pedidos', 'fixtures.vw_existencias', 'fixtures.vw_almacenes'];
  }

  async select(viewName: string, _params: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] =
      viewName === 'fixtures.vw_productos'
        ? [
            { codigo: 'HAR-PAN-001', descripcion: 'Harina Todo Uso Extra (Saco 45Kg)', um: 'SACO', familia: 'Harinas Industriales' },
            { codigo: 'PAS-COR-014', descripcion: 'Pasta Corta Dedales (Fardo 12x1Kg)', um: 'FARDO', familia: 'Pastas Alimenticias' },
            { codigo: 'TRG-022', descripcion: 'Alfalfa Deshidratada Peletizada 25kg', um: 'SACO', familia: 'Forrajes y Peletizados' },
          ]
        : [];
    return rows.slice(0, limit);
  }
}

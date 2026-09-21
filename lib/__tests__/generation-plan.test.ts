import { describe, expect, it } from 'vitest';
import {
  buildGenerationPlan,
  generateTableRows,
  PlanValidationError,
  type Dialect,
  type PkPools,
} from '../generation-plan';
import type { ValidatedSemanticMap, ValidatedTable } from '../schema-analysis';

const LIMITS = { baseParentRows: 15, maxRows: 10_000, minRows: 1 };

function table(
  name: string,
  opts: {
    columns: string[];
    columnTypes: Record<string, ValidatedTable['columnTypes'][string]>;
    primaryKey?: ValidatedTable['primaryKey'];
    foreignKeys?: ValidatedTable['foreignKeys'];
  }
): ValidatedTable {
  return {
    name,
    columns: opts.columns,
    columnTypes: opts.columnTypes,
    primaryKey: opts.primaryKey ?? { column: 'id', kind: 'integer' },
    foreignKeys: opts.foreignKeys ?? [],
  };
}

function mapOf(tables: ValidatedTable[], topology: string[]): ValidatedSemanticMap {
  return {
    topology,
    tables: Object.fromEntries(tables.map((t) => [t.name, t])),
    warnings: [],
  };
}

function runAll(pools: PkPools, plan: ReturnType<typeof buildGenerationPlan>, dialect: Dialect = 'postgres') {
  const rowsByTable: Record<string, Array<Record<string, string | number>>> = {};
  for (const tablePlan of plan.tables) {
    rowsByTable[tablePlan.table.name] = Array.from(generateTableRows(tablePlan, dialect, pools));
  }
  return rowsByTable;
}

describe('buildGenerationPlan validation', () => {
  const users = table('users', { columns: ['id', 'email'], columnTypes: { id: 'pk', email: 'email' } });

  it('builds a valid plan for a simple parent/child schema', () => {
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
    });
    const plan = buildGenerationPlan(mapOf([users, orders], ['users', 'orders']), 100, LIMITS);
    expect(plan.tables.map((t) => t.table.name)).toEqual(['users', 'orders']);
    expect(plan.tables[0].rowCount).toBe(LIMITS.baseParentRows);
    expect(plan.tables[1].rowCount).toBe(100 - LIMITS.baseParentRows);
  });

  it('rejects a topology entry with no matching table', () => {
    expect(() => buildGenerationPlan(mapOf([users], ['users', 'ghost']), 50, LIMITS)).toThrow(PlanValidationError);
  });

  it('rejects a foreign key that does not reference the parent primary key', () => {
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'email' }],
    });
    expect(() => buildGenerationPlan(mapOf([users, orders], ['users', 'orders']), 50, LIMITS)).toThrow(
      /not that table's primary key/
    );
  });

  it('rejects a foreign key whose parent is not ordered before the child', () => {
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
    });
    // topology is deliberately backwards
    expect(() => buildGenerationPlan(mapOf([users, orders], ['orders', 'users']), 50, LIMITS)).toThrow(
      /not ordered before/
    );
  });

  it('clamps requested rows with buildGenerationPlan\'s distribution: min/normal/max/multi-table', () => {
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
    });
    const items = table('order_items', {
      columns: ['id', 'order_id'],
      columnTypes: { id: 'pk', order_id: 'fk' },
      foreignKeys: [{ column: 'order_id', referencesTable: 'orders', referencesColumn: 'id' }],
    });
    const map = mapOf([users, orders, items], ['users', 'orders', 'order_items']);

    const min = buildGenerationPlan(map, 1, LIMITS);
    expect(min.tables.map((t) => t.rowCount)).toEqual([15, 15, 1]); // last table floors at minRows even if allocation exceeds request

    const normal = buildGenerationPlan(map, 1000, LIMITS);
    expect(normal.tables.map((t) => t.rowCount)).toEqual([15, 15, 970]);

    const max = buildGenerationPlan(map, 10_000, LIMITS);
    expect(max.totalRows).toBe(15 + 15 + (10_000 - 30));
  });
});

describe('generateTableRows: foreign-key pool invariants', () => {
  it('every generated FK value exists in the referenced parent PK pool (simple chain)', () => {
    const users = table('users', { columns: ['id'], columnTypes: { id: 'pk' } });
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
    });
    const plan = buildGenerationPlan(mapOf([users, orders], ['users', 'orders']), 200, LIMITS);
    const pools: PkPools = new Map();
    const rows = runAll(pools, plan);

    const userIds = new Set(pools.get('users'));
    for (const row of rows.orders) {
      expect(userIds.has(row.user_id as number)).toBe(true);
    }
  });

  it('every generated FK value is correct for a deep chain (A -> B -> C -> D)', () => {
    const a = table('a', { columns: ['id'], columnTypes: { id: 'pk' } });
    const b = table('b', {
      columns: ['id', 'a_id'],
      columnTypes: { id: 'pk', a_id: 'fk' },
      foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
    });
    const c = table('c', {
      columns: ['id', 'b_id'],
      columnTypes: { id: 'pk', b_id: 'fk' },
      foreignKeys: [{ column: 'b_id', referencesTable: 'b', referencesColumn: 'id' }],
    });
    const d = table('d', {
      columns: ['id', 'c_id'],
      columnTypes: { id: 'pk', c_id: 'fk' },
      foreignKeys: [{ column: 'c_id', referencesTable: 'c', referencesColumn: 'id' }],
    });
    const plan = buildGenerationPlan(mapOf([a, b, c, d], ['a', 'b', 'c', 'd']), 300, LIMITS);
    const pools: PkPools = new Map();
    const rows = runAll(pools, plan);

    expect(new Set(rows.d.map((r) => r.c_id))).toEqual(
      expect.any(Set) // sanity: just confirms the map was built; real check below
    );
    for (const row of rows.b) expect(pools.get('a')).toContain(row.a_id);
    for (const row of rows.c) expect(pools.get('b')).toContain(row.b_id);
    for (const row of rows.d) expect(pools.get('c')).toContain(row.c_id);
  });

  it('handles multiple foreign keys on one table, each resolved against its own parent (not the "previous table")', () => {
    // This is the exact bug from the audit: orders has TWO parents, and the
    // old implementation derived both FKs from whichever table came right
    // before "orders" in topology order — which is only ever one of the two.
    const users = table('users', { columns: ['id'], columnTypes: { id: 'pk' } });
    const companies = table('companies', { columns: ['id'], columnTypes: { id: 'pk' } });
    const orders = table('orders', {
      columns: ['id', 'user_id', 'company_id'],
      columnTypes: { id: 'pk', user_id: 'fk', company_id: 'fk' },
      foreignKeys: [
        { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' },
        { column: 'company_id', referencesTable: 'companies', referencesColumn: 'id' },
      ],
    });
    const plan = buildGenerationPlan(mapOf([users, companies, orders], ['users', 'companies', 'orders']), 500, LIMITS);
    const pools: PkPools = new Map();
    const rows = runAll(pools, plan);

    const userIds = new Set(pools.get('users'));
    const companyIds = new Set(pools.get('companies'));
    expect(userIds.size).toBe(15);
    expect(companyIds.size).toBe(15);
    for (const row of rows.orders) {
      expect(userIds.has(row.user_id as number)).toBe(true);
      expect(companyIds.has(row.company_id as number)).toBe(true);
    }
  });

  it('generates real UUID primary keys and matching UUID foreign keys', () => {
    const sessions = table('sessions', {
      columns: ['id'],
      columnTypes: { id: 'pk' },
      primaryKey: { column: 'id', kind: 'uuid' },
    });
    const events = table('events', {
      columns: ['id', 'session_id'],
      columnTypes: { id: 'pk', session_id: 'fk' },
      foreignKeys: [{ column: 'session_id', referencesTable: 'sessions', referencesColumn: 'id' }],
    });
    const plan = buildGenerationPlan(mapOf([sessions, events], ['sessions', 'events']), 50, LIMITS);
    const pools: PkPools = new Map();
    const rows = runAll(pools, plan);

    const uuidRe = /^'[0-9a-f-]{36}'$/;
    for (const row of rows.events) {
      expect(String(row.session_id)).toMatch(uuidRe);
      expect(pools.get('sessions')).toContain(String(row.session_id).replace(/'/g, ''));
    }
  });

  it('emits dialect-correct booleans', () => {
    const flags = table('flags', {
      columns: ['id', 'active'],
      columnTypes: { id: 'pk', active: 'boolean' },
    });
    const plan = buildGenerationPlan(mapOf([flags], ['flags']), 20, LIMITS);
    const pgRows = runAll(new Map(), plan, 'postgres');
    const myRows = runAll(new Map(), plan, 'mysql');
    expect(pgRows.flags.every((r) => r.active === 'TRUE' || r.active === 'FALSE')).toBe(true);
    expect(myRows.flags.every((r) => r.active === 0 || r.active === 1)).toBe(true);
  });
});

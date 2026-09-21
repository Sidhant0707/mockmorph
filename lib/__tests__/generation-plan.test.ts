import { describe, expect, it } from 'vitest';
import {
  buildGenerationPlan,
  generateTableRows,
  PlanValidationError,
  type Dialect,
  type PkPools,
} from '../generation-plan';
import type { ValidatedSemanticMap, ValidatedTable } from '../schema-analysis';
import { classifyColumnType, type ColumnTypeInfo } from '../sql-types';

const LIMITS = { baseParentRows: 15, maxRows: 10_000, minRows: 1 };

function table(
  name: string,
  opts: {
    columns: string[];
    columnTypes: Record<string, ValidatedTable['columnTypes'][string]>;
    /** Declared SQL types by column, e.g. { qty: 'INT' }. Omitted columns are "unknown" (semantic-only). */
    sqlTypes?: Record<string, string>;
    primaryKey?: ValidatedTable['primaryKey'];
    foreignKeys?: ValidatedTable['foreignKeys'];
  }
): ValidatedTable {
  return {
    name,
    columns: opts.columns,
    columnTypes: opts.columnTypes,
    columnInfo: Object.fromEntries(
      Object.entries(opts.sqlTypes ?? {}).map(([col, type]): [string, ColumnTypeInfo] => [col, classifyColumnType(type)])
    ),
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

describe('generateTableRows: values match the declared SQL type', () => {
  /** Generates `rows` rows for a single-table schema and returns just the named column's values. */
  function valuesOf(
    sqlType: string,
    opts: { semantic?: ValidatedTable['columnTypes'][string]; rows?: number; dialect?: Dialect } = {}
  ): Array<string | number> {
    const t = table('t', {
      columns: ['id', 'col'],
      columnTypes: { id: 'pk', col: opts.semantic ?? 'string' },
      sqlTypes: { col: sqlType },
    });
    const plan = buildGenerationPlan(mapOf([t], ['t']), opts.rows ?? 300, LIMITS);
    return runAll(new Map(), plan, opts.dialect).t.map((r) => r.col);
  }

  it('gives INT-like columns real integers (the original bug: they got string_val_N)', () => {
    for (const type of ['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'int(11)']) {
      const values = valuesOf(type);
      expect(values.every((v) => Number.isInteger(v))).toBe(true);
      expect(values.every((v) => (v as number) >= 1 && (v as number) <= 1000)).toBe(true);
    }
  });

  it('ignores a semantic type that contradicts the declared integer type', () => {
    const values = valuesOf('INT', { semantic: 'email' });
    expect(values.every((v) => Number.isInteger(v))).toBe(true);
  });

  it('keeps TINYINT inside the signed range', () => {
    expect(valuesOf('TINYINT(4)').every((v) => (v as number) <= 127)).toBe(true);
  });

  it('generates decimals that fit the declared precision and scale', () => {
    const cases: Array<[string, number, number]> = [
      ['DECIMAL(10,2)', 10, 2],
      ['NUMERIC(5,0)', 5, 0],
      ['DECIMAL(3,3)', 3, 3], // no integer digits at all: value must stay below 1
      ['NUMERIC(1,0)', 1, 0],
      ['NUMERIC(4,1)', 4, 1],
    ];
    for (const [type, precision, scale] of cases) {
      for (const v of valuesOf(type, { rows: 500 })) {
        const [intPart, fraction = ''] = String(v).split('.');
        expect(fraction.length).toBe(scale);
        const significant = intPart.replace(/^0+/, '').length + scale;
        expect(significant).toBeLessThanOrEqual(precision);
        expect(String(v)).not.toMatch(/e/i); // never scientific notation
      }
    }
  });

  it('generates floats as plain decimal numbers', () => {
    for (const type of ['REAL', 'DOUBLE PRECISION', 'FLOAT']) {
      expect(valuesOf(type).every((v) => /^\d+\.\d+$/.test(String(v)))).toBe(true);
    }
  });

  it('generates dialect-correct booleans from the declared type, not just the semantic type', () => {
    expect(valuesOf('BOOLEAN', { dialect: 'postgres' }).every((v) => v === 'TRUE' || v === 'FALSE')).toBe(true);
    expect(valuesOf('BOOLEAN', { dialect: 'mysql' }).every((v) => v === 0 || v === 1)).toBe(true);
    expect(valuesOf('TINYINT(1)', { dialect: 'mysql' }).every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('generates well-formed dates, timestamps and times', () => {
    expect(valuesOf('DATE').every((v) => /^'\d{4}-\d{2}-\d{2}'$/.test(String(v)))).toBe(true);
    for (const type of ['TIMESTAMP', 'TIMESTAMPTZ', 'TIMESTAMP WITH TIME ZONE', 'DATETIME']) {
      expect(valuesOf(type).every((v) => /^'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'$/.test(String(v)))).toBe(true);
    }
    expect(valuesOf('TIME').every((v) => /^'\d{2}:\d{2}:\d{2}'$/.test(String(v)))).toBe(true);
  });

  it('never produces an invalid calendar day or clock time', () => {
    for (const v of valuesOf('TIMESTAMP', { rows: 500 })) {
      const m = String(v).match(/^'(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})'$/);
      expect(m).not.toBeNull();
      const [month, day, hour, minute, second] = m!.slice(2).map(Number);
      expect(month).toBe(5);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(28);
      expect(hour).toBeLessThanOrEqual(23);
      expect(minute).toBeLessThanOrEqual(59);
      expect(second).toBeLessThanOrEqual(59);
    }
  });

  it('generates UUIDs, JSON and empty arrays', () => {
    expect(valuesOf('UUID').every((v) => /^'[0-9a-f-]{36}'$/.test(String(v)))).toBe(true);
    for (const v of valuesOf('JSONB')) {
      expect(() => JSON.parse(String(v).slice(1, -1))).not.toThrow();
    }
    expect(valuesOf('TEXT[]').every((v) => v === "'{}'")).toBe(true);
  });

  it('still uses the semantic type for text columns', () => {
    expect(valuesOf('VARCHAR(255)', { semantic: 'email' }).every((v) => /^'user\d+_\w+@obsidian\.corp'$/.test(String(v)))).toBe(true);
    expect(valuesOf('TEXT', { semantic: 'company' }).every((v) => /^'Syndicate \d+ LLC'$/.test(String(v)))).toBe(true);
  });

  it('quotes semantic values that are bare on other columns (price, boolean) when the column is text', () => {
    expect(valuesOf('VARCHAR(20)', { semantic: 'price' }).every((v) => /^'\d+\.\d{2}'$/.test(String(v)))).toBe(true);
    expect(valuesOf('TEXT', { semantic: 'boolean' }).every((v) => v === "'TRUE'" || v === "'FALSE'")).toBe(true);
  });

  it('truncates text to the declared VARCHAR / CHAR length and keeps it quoted', () => {
    for (const [type, max] of [['VARCHAR(5)', 5], ['CHAR(2)', 2], ['CHARACTER VARYING(8)', 8], ['CHAR', 1]] as const) {
      for (const v of valuesOf(type, { semantic: 'email' })) {
        const s = String(v);
        expect(s.startsWith("'") && s.endsWith("'")).toBe(true);
        expect(s.length - 2).toBeLessThanOrEqual(max);
      }
    }
  });

  it('falls back to the semantic template for a type it does not recognise (previous behaviour)', () => {
    expect(valuesOf('order_status').every((v) => /^'string_val_\d+'$/.test(String(v)))).toBe(true);
  });

  it('never changes primary-key or foreign-key values, whatever their declared type', () => {
    const parent = table('parent', { columns: ['id'], columnTypes: { id: 'pk' }, sqlTypes: { id: 'SERIAL' } });
    const child = table('child', {
      columns: ['id', 'parent_id'],
      columnTypes: { id: 'pk', parent_id: 'fk' },
      sqlTypes: { id: 'INT', parent_id: 'INT' },
      foreignKeys: [{ column: 'parent_id', referencesTable: 'parent', referencesColumn: 'id' }],
    });
    const pools: PkPools = new Map();
    const rows = runAll(pools, buildGenerationPlan(mapOf([parent, child], ['parent', 'child']), 100, LIMITS), 'postgres');
    for (const row of rows.child) expect(pools.get('parent')).toContain(row.parent_id);
    expect(rows.parent.map((r) => r.id)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});

describe('generateTableRows: sensible ranges for common integer column names', () => {
  /** Generates `rows` rows for a single-table schema and returns just the named column's values. */
  function valuesOfNamed(columnName: string, sqlType: string, rows = 300): Array<string | number> {
    const t = table('t', {
      columns: ['id', columnName],
      columnTypes: { id: 'pk', [columnName]: 'string' },
      sqlTypes: { [columnName]: sqlType },
    });
    const plan = buildGenerationPlan(mapOf([t], ['t']), rows, LIMITS);
    return runAll(new Map(), plan).t.map((r) => r[columnName]);
  }

  it('gives age a human range', () => {
    expect(valuesOfNamed('age', 'INT').every((v) => (v as number) >= 18 && (v as number) <= 90)).toBe(true);
  });

  it('gives quantity a small positive range', () => {
    expect(valuesOfNamed('quantity', 'INT').every((v) => (v as number) >= 1 && (v as number) <= 50)).toBe(true);
  });

  it('gives rating a 1-5 range', () => {
    expect(valuesOfNamed('rating', 'INT').every((v) => (v as number) >= 1 && (v as number) <= 5)).toBe(true);
  });

  it('gives year and count sensible ranges too', () => {
    expect(valuesOfNamed('year', 'INT').every((v) => (v as number) >= 1990 && (v as number) <= 2026)).toBe(true);
    expect(valuesOfNamed('count', 'INT').every((v) => (v as number) >= 0 && (v as number) <= 100)).toBe(true);
  });

  it('matches by whole word, not substring — "discount" and "account_id" are not "count"', () => {
    // Default range for a plain declared INT is 1-1000 (see the type-match tests above).
    const discount = valuesOfNamed('discount', 'INT', 500);
    expect(discount.some((v) => (v as number) > 100)).toBe(true);
  });

  it('matches a named word inside a snake_case or camelCase column name', () => {
    expect(valuesOfNamed('user_age', 'INT').every((v) => (v as number) >= 18 && (v as number) <= 90)).toBe(true);
    expect(valuesOfNamed('userAge', 'INT').every((v) => (v as number) >= 18 && (v as number) <= 90)).toBe(true);
    expect(valuesOfNamed('order_quantity', 'INT').every((v) => (v as number) >= 1 && (v as number) <= 50)).toBe(true);
  });

  it('never exceeds the declared type limit, even when the named range would', () => {
    // "year" (1990-2026) does not fit inside TINYINT's range (max 100 here), so this
    // must fall back to TINYINT's own default range rather than emitting an out-of-range value.
    expect(valuesOfNamed('year', 'TINYINT(4)').every((v) => (v as number) >= 1 && (v as number) <= 100)).toBe(true);
  });

  it('still fits a named range inside a narrower declared type when it does fit', () => {
    // "rating" (1-5) fits comfortably inside TINYINT's range, so the named range still applies.
    expect(valuesOfNamed('rating', 'TINYINT(4)').every((v) => (v as number) >= 1 && (v as number) <= 5)).toBe(true);
  });
});

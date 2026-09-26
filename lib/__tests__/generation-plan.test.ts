import { describe, expect, it } from 'vitest';
import {
  buildGenerationPlan,
  generateTableRows,
  PlanValidationError,
  type Dialect,
  type PkPools,
} from '../generation-plan';
import type { ValidatedSemanticMap, ValidatedTable } from '../schema-analysis';
import { classifyColumnType, TINYINT_MAX, type ColumnTypeInfo } from '../sql-types';

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
    /** Columns declared NOT NULL (the primary key always is). Every other column is nullable. */
    notNull?: string[];
    /** Columns with a single-column UNIQUE constraint (never the primary key). */
    uniqueColumns?: string[];
  }
): ValidatedTable {
  const primaryKey = opts.primaryKey ?? { column: 'id', kind: 'integer' as const };
  return {
    name,
    columns: opts.columns,
    columnTypes: opts.columnTypes,
    columnInfo: Object.fromEntries(
      Object.entries(opts.sqlTypes ?? {}).map(([col, type]): [string, ColumnTypeInfo] => [col, classifyColumnType(type)])
    ),
    notNull: Object.fromEntries(
      opts.columns.map((col) => [col, col === primaryKey.column || (opts.notNull ?? []).includes(col)])
    ),
    primaryKey,
    foreignKeys: opts.foreignKeys ?? [],
    uniqueColumns: opts.uniqueColumns ?? [],
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
      notNull: ['user_id'],
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

// ---------------------------------------------------------------------------
// Self-referencing foreign keys
// ---------------------------------------------------------------------------

describe('buildGenerationPlan: self-referencing foreign keys', () => {
  const selfFk = (column: string, referencesColumn = 'id') => ({
    column,
    referencesTable: 'employees',
    referencesColumn,
  });
  const employees = (foreignKeys: ValidatedTable['foreignKeys'], primaryKey?: ValidatedTable['primaryKey']) =>
    table('employees', {
      columns: ['id', 'manager_id'],
      columnTypes: { id: 'pk', manager_id: 'fk' },
      foreignKeys,
      primaryKey,
    });

  it('accepts a table that references its own primary key', () => {
    const plan = buildGenerationPlan(mapOf([employees([selfFk('manager_id')])], ['employees']), 50, LIMITS);
    expect(plan.tables.map((t) => t.table.name)).toEqual(['employees']);
    expect(plan.tables[0].rowCount).toBe(50);
  });

  it('accepts a self-reference next to a normal foreign key to an earlier parent', () => {
    const departments = table('departments', { columns: ['id'], columnTypes: { id: 'pk' } });
    const staff = table('employees', {
      columns: ['id', 'manager_id', 'department_id'],
      columnTypes: { id: 'pk', manager_id: 'fk', department_id: 'fk' },
      foreignKeys: [selfFk('manager_id'), { column: 'department_id', referencesTable: 'departments', referencesColumn: 'id' }],
    });
    const plan = buildGenerationPlan(mapOf([departments, staff], ['departments', 'employees']), 100, LIMITS);
    expect(plan.tables.map((t) => t.table.name)).toEqual(['departments', 'employees']);
  });

  it('rejects a self-reference to a column that is not the primary key', () => {
    const map = mapOf([employees([selfFk('manager_id', 'name')])], ['employees']);
    expect(() => buildGenerationPlan(map, 50, LIMITS)).toThrow(/not that table's primary key/);
    try {
      buildGenerationPlan(map, 50, LIMITS);
    } catch (error) {
      expect((error as PlanValidationError).kind).toBe('unsupported_fk_target');
    }
  });

  it('rejects a self-reference on a table that has no primary key', () => {
    const noPk = { ...employees([selfFk('manager_id')]), primaryKey: null };
    expect(() => buildGenerationPlan(mapOf([noPk], ['employees']), 50, LIMITS)).toThrow(PlanValidationError);
  });

  it('still rejects a two-table cycle, whichever way the topology is ordered', () => {
    const a = table('a', {
      columns: ['id', 'b_id'],
      columnTypes: { id: 'pk', b_id: 'fk' },
      foreignKeys: [{ column: 'b_id', referencesTable: 'b', referencesColumn: 'id' }],
      notNull: ['b_id'],
    });
    const b = table('b', {
      columns: ['id', 'a_id'],
      columnTypes: { id: 'pk', a_id: 'fk' },
      foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
      notNull: ['a_id'],
    });
    expect(() => buildGenerationPlan(mapOf([a, b], ['a', 'b']), 50, LIMITS)).toThrow(/not ordered before/);
    expect(() => buildGenerationPlan(mapOf([a, b], ['b', 'a']), 50, LIMITS)).toThrow(/not ordered before/);
  });

  it('still rejects a cycle that involves a table which also references itself', () => {
    const a = table('a', {
      columns: ['id', 'parent_id', 'b_id'],
      columnTypes: { id: 'pk', parent_id: 'fk', b_id: 'fk' },
      foreignKeys: [
        { column: 'parent_id', referencesTable: 'a', referencesColumn: 'id' },
        { column: 'b_id', referencesTable: 'b', referencesColumn: 'id' },
      ],
      notNull: ['b_id'],
    });
    const b = table('b', {
      columns: ['id', 'a_id'],
      columnTypes: { id: 'pk', a_id: 'fk' },
      foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
      notNull: ['a_id'],
    });
    // The self-edge on `a` must not excuse a's other, real ordering constraint.
    expect(() => buildGenerationPlan(mapOf([a, b], ['a', 'b']), 50, LIMITS)).toThrow(/a\.b_id references "b"/);
    expect(() => buildGenerationPlan(mapOf([a, b], ['b', 'a']), 50, LIMITS)).toThrow(/b\.a_id references "a"/);
  });

  it('accepts a nullable foreign key to a later table, and generates NULL for it', () => {
    const a = table('a', {
      columns: ['id', 'b_id'],
      columnTypes: { id: 'pk', b_id: 'fk' },
      foreignKeys: [{ column: 'b_id', referencesTable: 'b', referencesColumn: 'id' }],
    });
    const b = table('b', {
      columns: ['id', 'a_id'],
      columnTypes: { id: 'pk', a_id: 'fk' },
      foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
      notNull: ['a_id'],
    });
    const plan = buildGenerationPlan(mapOf([a, b], ['a', 'b']), 50, LIMITS);
    const rows = runAll(new Map() as PkPools, plan);
    expect(rows.a.every((r) => r.b_id === 'NULL')).toBe(true);
    const aIds = new Set(rows.a.map((r) => r.id));
    expect(rows.b.every((r) => aIds.has(r.a_id as number))).toBe(true);
  });
});

describe('generateTableRows: self-referencing foreign key invariants', () => {
  type Row = Record<string, string | number>;

  interface SelfTableOptions {
    pkKind?: 'integer' | 'uuid';
    /** Column order as declared; the primary key is always called "id". */
    columns?: string[];
    selfFks?: string[];
    notNull?: string[];
  }

  function selfTable(opts: SelfTableOptions = {}): ValidatedTable {
    const columns = opts.columns ?? ['id', 'name', 'manager_id'];
    const selfFks = opts.selfFks ?? ['manager_id'];
    return table('employees', {
      columns,
      columnTypes: Object.fromEntries(
        columns.map((c) => [c, c === 'id' ? 'pk' : selfFks.includes(c) ? 'fk' : 'fullname'])
      ) as ValidatedTable['columnTypes'],
      sqlTypes: { name: 'TEXT' },
      primaryKey: { column: 'id', kind: opts.pkKind ?? 'integer' },
      foreignKeys: selfFks.map((column) => ({ column, referencesTable: 'employees', referencesColumn: 'id' })),
      notNull: opts.notNull,
    });
  }

  function generate(t: ValidatedTable, rows: number, dialect: Dialect = 'postgres') {
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(mapOf([t], ['employees']), rows, LIMITS);
    return { rows: runAll(pools, plan, dialect).employees as Row[], pools };
  }

  /** The invariants the whole feature rests on; throws (via expect) on the first violation. */
  function expectSelfFkInvariants(rows: Row[], selfFks: string[], notNull: string[]): void {
    const earlier = new Set<string | number>();
    rows.forEach((row, index) => {
      for (const col of selfFks) {
        const value = row[col];
        const label = `row ${index + 1}, column ${col} = ${value}`;
        if (value === 'NULL') {
          expect(notNull.includes(col), `NULL in NOT NULL column: ${label}`).toBe(false);
        } else if (index === 0) {
          // The first row has no earlier row to point at: only a NOT NULL column may be filled, and only by itself.
          expect(notNull.includes(col), `first row of a nullable column must be NULL: ${label}`).toBe(true);
          expect(value, label).toBe(row.id);
        } else {
          expect(earlier.has(value), `not an earlier row's key: ${label}`).toBe(true);
          expect(value, `points at itself: ${label}`).not.toBe(row.id);
        }
      }
      earlier.add(row.id);
    });
  }

  const ITERATIONS = 100;
  const randomRowCount = () => 1 + Math.floor(Math.random() * 80);

  for (const pkKind of ['integer', 'uuid'] as const) {
    for (const notNullFk of [false, true]) {
      for (const columns of [
        ['id', 'name', 'manager_id'],
        ['manager_id', 'name', 'id'], // FK declared before the primary key
        ['name', 'manager_id', 'id'],
      ]) {
        it(`${pkKind} pk, ${notNullFk ? 'NOT NULL' : 'nullable'} self-FK, columns [${columns.join(', ')}]: ${ITERATIONS} random runs`, () => {
          const notNull = notNullFk ? ['manager_id'] : [];
          for (let i = 0; i < ITERATIONS; i++) {
            const { rows, pools } = generate(selfTable({ pkKind, columns, notNull }), randomRowCount());
            expectSelfFkInvariants(rows, ['manager_id'], notNull);
            expect(pools.get('employees')).toEqual(rows.map((r) => (typeof r.id === 'string' ? r.id.slice(1, -1) : r.id)));
          }
        });
      }
    }
  }

  it('a nullable self-FK gives the first row NULL and keeps about 20% of the rest NULL, the rest are real parents', () => {
    const { rows } = generate(selfTable(), 5000);
    const rest = rows.slice(1);
    const nullShare = rest.filter((r) => r.manager_id === 'NULL').length / rest.length;
    expect(nullShare).toBeGreaterThan(0.15);
    expect(nullShare).toBeLessThan(0.25);
    expect(rest.some((r) => r.manager_id !== 'NULL')).toBe(true);
  });

  it('a NOT NULL self-FK never emits NULL, and exactly one row (the first) references itself', () => {
    const { rows } = generate(selfTable({ notNull: ['manager_id'] }), 2000);
    expect(rows.filter((r) => r.manager_id === 'NULL')).toHaveLength(0);
    expect(rows.filter((r) => r.manager_id === r.id).map((r) => r.id)).toEqual([1]);
  });

  it('a single-row table is valid: NULL if nullable, itself if NOT NULL', () => {
    expect(generate(selfTable(), 1).rows[0].manager_id).toBe('NULL');
    expect(generate(selfTable({ notNull: ['manager_id'] }), 1).rows[0]).toMatchObject({ id: 1, manager_id: 1 });
  });

  it('treats a column with no NOT NULL information as NOT NULL, so it can never receive NULL', () => {
    const t = { ...selfTable(), notNull: {} };
    const { rows } = generate(t, 200);
    expect(rows.filter((r) => r.manager_id === 'NULL')).toHaveLength(0);
  });

  it('handles several self-FKs on one table independently (manager_id nullable, mentor_id NOT NULL)', () => {
    const columns = ['id', 'manager_id', 'name', 'mentor_id'];
    const notNull = ['mentor_id'];
    for (let i = 0; i < ITERATIONS; i++) {
      const { rows } = generate(selfTable({ columns, selfFks: ['manager_id', 'mentor_id'], notNull }), randomRowCount());
      expectSelfFkInvariants(rows, ['manager_id', 'mentor_id'], notNull);
    }
  });

  it('is the same for the mysql dialect', () => {
    const { rows } = generate(selfTable({ pkKind: 'uuid', notNull: ['manager_id'] }), 100, 'mysql');
    expectSelfFkInvariants(rows, ['manager_id'], ['manager_id']);
  });

  it('a self-FK next to an FK to another parent: the other FK is unchanged (real parent key, never NULL)', () => {
    const departments = table('departments', { columns: ['id'], columnTypes: { id: 'pk' } });
    const staff = table('employees', {
      columns: ['id', 'department_id', 'manager_id'],
      columnTypes: { id: 'pk', department_id: 'fk', manager_id: 'fk' },
      foreignKeys: [
        { column: 'department_id', referencesTable: 'departments', referencesColumn: 'id' },
        { column: 'manager_id', referencesTable: 'employees', referencesColumn: 'id' },
      ],
    });
    for (let i = 0; i < ITERATIONS; i++) {
      const pools: PkPools = new Map();
      const plan = buildGenerationPlan(mapOf([departments, staff], ['departments', 'employees']), randomRowCount() + 15, LIMITS);
      const rows = runAll(pools, plan);
      expectSelfFkInvariants(rows.employees as Row[], ['manager_id'], []);
      const departmentIds = new Set(pools.get('departments'));
      for (const row of rows.employees) expect(departmentIds.has(row.department_id as number)).toBe(true);
    }
  });

  it('a nullable non-self foreign key still never receives NULL', () => {
    const users = table('users', { columns: ['id'], columnTypes: { id: 'pk' } });
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
    });
    const rows = runAll(new Map(), buildGenerationPlan(mapOf([users, orders], ['users', 'orders']), 300, LIMITS));
    expect(rows.orders.filter((r) => r.user_id === 'NULL')).toHaveLength(0);
  });
});

describe('buildGenerationPlan: 1:1 tables (a primary key that is also a foreign key)', () => {
  const users = table('users', { columns: ['id', 'email'], columnTypes: { id: 'pk', email: 'email' } });
  const usersUuid = table('users', { columns: ['id', 'email'], columnTypes: { id: 'pk', email: 'email' }, primaryKey: { column: 'id', kind: 'uuid' } });

  const profiles = (opts: { primaryKey?: ValidatedTable['primaryKey']; extraFk?: ValidatedTable['foreignKeys'][number] } = {}) =>
    table('user_profiles', {
      columns: opts.extraFk ? ['user_id', 'bio', opts.extraFk.column] : ['user_id', 'bio'],
      columnTypes: opts.extraFk
        ? { user_id: 'pk', bio: 'fullname', [opts.extraFk.column]: 'fk' }
        : { user_id: 'pk', bio: 'fullname' },
      primaryKey: opts.primaryKey ?? { column: 'user_id', kind: 'integer' },
      foreignKeys: [
        { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' },
        ...(opts.extraFk ? [opts.extraFk] : []),
      ],
    });

  it('caps a 1:1 table at its parent row count and reports why', () => {
    // users (non-last) always gets LIMITS.baseParentRows = 15; user_profiles (last) would otherwise
    // absorb the remainder of the requested 500 rows.
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), 500, LIMITS);
    expect(plan.tables[0].rowCount).toBe(15);
    expect(plan.tables[1].rowCount).toBe(15);
    expect(plan.totalRows).toBe(30);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/user_profiles\.user_id/);
    expect(plan.warnings[0]).toMatch(/"users"/);
    expect(plan.warnings[0]).toMatch(/capped at 15 row/);
    expect(plan.warnings[0]).toMatch(/instead of the requested 485/);
  });

  it('does not cap or warn when the requested count already fits within the parent', () => {
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), 20, LIMITS);
    expect(plan.tables[1].rowCount).toBe(5); // 20 - 15, still <= parent's 15
    expect(plan.warnings).toHaveLength(0);
  });

  it('does not cap or warn for an ordinary (non-1:1) foreign key, even a NOT NULL one', () => {
    const orders = table('orders', {
      columns: ['id', 'user_id'],
      columnTypes: { id: 'pk', user_id: 'fk' },
      foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }],
      notNull: ['user_id'],
    });
    const plan = buildGenerationPlan(mapOf([users, orders], ['users', 'orders']), 5000, LIMITS);
    expect(plan.tables[1].rowCount).toBe(5000 - 15); // unchanged: an ordinary FK may repeat parent keys
    expect(plan.warnings).toHaveLength(0);
  });

  it('every row of a capped 1:1 table gets a distinct key that really exists in the parent', () => {
    for (let i = 0; i < 50; i++) {
      const requested = 20 + Math.floor(Math.random() * 2000);
      const pools: PkPools = new Map();
      const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), requested, LIMITS);
      const rows = runAll(pools, plan);
      const userIds = new Set(pools.get('users'));
      expect(rows.user_profiles.length).toBeLessThanOrEqual(15);
      const seen = new Set<string | number>();
      for (const row of rows.user_profiles) {
        expect(userIds.has(row.user_id as number)).toBe(true);
        expect(seen.has(row.user_id)).toBe(false); // distinct: sampled without replacement
        seen.add(row.user_id);
      }
    }
  });

  it('works with UUID keys, still sampling real parent UUIDs without repeats', () => {
    const uuidProfiles = profiles({ primaryKey: { column: 'user_id', kind: 'uuid' } });
    const pools: PkPools = new Map();
    // parent (users, non-last) always gets baseParentRows=15; requesting baseParentRows+12 gives the
    // last table (user_profiles) exactly 12 rows, well within the parent's 15 — no cap involved here.
    const plan = buildGenerationPlan(mapOf([usersUuid, uuidProfiles], ['users', 'user_profiles']), LIMITS.baseParentRows + 12, LIMITS);
    const rows = runAll(pools, plan);
    const userIds = new Set(pools.get('users'));
    expect(rows.user_profiles).toHaveLength(12);
    const seen = new Set<string | number>();
    for (const row of rows.user_profiles) {
      const rawId = (row.user_id as string).slice(1, -1); // strip the SQL string quotes
      expect(userIds.has(rawId)).toBe(true);
      expect(seen.has(rawId)).toBe(false);
      seen.add(rawId);
    }
  });

  it('a chain (a <- b <- c) keeps each pool a subset of its parent\'s, and caps the last one that needs it', () => {
    const a = table('a', { columns: ['id'], columnTypes: { id: 'pk' } });
    const b = table('b', {
      columns: ['id'],
      columnTypes: { id: 'pk' },
      foreignKeys: [{ column: 'id', referencesTable: 'a', referencesColumn: 'id' }],
    });
    const c = table('c', {
      columns: ['id'],
      columnTypes: { id: 'pk' },
      foreignKeys: [{ column: 'id', referencesTable: 'b', referencesColumn: 'id' }],
    });
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(mapOf([a, b, c], ['a', 'b', 'c']), 1000, LIMITS);
    const rows = runAll(pools, plan);
    expect(plan.tables.map((t) => t.rowCount)).toEqual([15, 15, 15]); // a and b are non-last (=15); c is last, capped to b's 15
    const aIds = pools.get('a')!;
    const bIds = pools.get('b')!;
    const cIds = pools.get('c')!;
    expect(bIds.every((id) => aIds.includes(id))).toBe(true);
    expect(cIds.every((id) => bIds.includes(id))).toBe(true);
    expect(new Set(rows.b.map((r) => r.id)).size).toBe(rows.b.length);
    expect(new Set(rows.c.map((r) => r.id)).size).toBe(rows.c.length);
  });

  it('picks the first k parent keys in the parent\'s own generation order (documented, simplest choice)', () => {
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), LIMITS.baseParentRows + 10, LIMITS);
    const rows = runAll(pools, plan);
    // users are sequential integer keys 1..15; requesting 10 rows of user_profiles should take 1..10.
    expect(rows.user_profiles.map((r) => r.user_id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a 1:1 table can also have an ordinary FK to a different parent; both are correct at once', () => {
    const companies = table('companies', { columns: ['id'], columnTypes: { id: 'pk' } });
    const withCompany = profiles({ extraFk: { column: 'company_id', referencesTable: 'companies', referencesColumn: 'id' } });
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(mapOf([users, companies, withCompany], ['users', 'companies', 'user_profiles']), 12, LIMITS);
    const rows = runAll(pools, plan);
    const userIds = new Set(pools.get('users'));
    const companyIds = new Set(pools.get('companies'));
    expect(rows.user_profiles.length).toBeGreaterThan(0);
    for (const row of rows.user_profiles) {
      expect(userIds.has(row.user_id as number)).toBe(true);
      expect(companyIds.has(row.company_id as number)).toBe(true);
    }
  });

  it('composite primary keys stay rejected as unsupported, unaffected by this feature', () => {
    // schema-analysis (not generation-plan) rejects composite PKs before a ValidatedTable can even
    // exist; buildGenerationPlan never sees one. This is a smoke check that nothing here assumes a
    // single-column primaryKey.column can be absent — pkForeignKey simply returns undefined.
    const noPk = { ...profiles(), primaryKey: null };
    const plan = buildGenerationPlan(mapOf([users, noPk], ['users', 'user_profiles']), 50, LIMITS);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.tables[1].rowCount).toBe(50 - 15);
  });

  it('generateTableRows refuses to fabricate a key if a parent pool is missing (defensive hard stop)', () => {
    // Bypasses buildGenerationPlan's own cap/ordering guarantees to exercise the guard directly.
    const plan = { table: profiles(), rowCount: 5 };
    expect(() => Array.from(generateTableRows(plan, 'postgres', new Map()))).toThrow(/no generated primary keys yet/);
  });

  it('is the same for the mysql dialect', () => {
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), 500, LIMITS);
    const rows = runAll(pools, plan, 'mysql');
    const userIds = new Set(pools.get('users'));
    expect(rows.user_profiles).toHaveLength(15);
    for (const row of rows.user_profiles) expect(userIds.has(row.user_id as number)).toBe(true);
  });
});

describe('buildGenerationPlan & generateTableRows: UNIQUE value-only columns', () => {
  function single(sqlType: string, opts: { rows?: number; semantic?: ValidatedTable['columnTypes'][string] } = {}) {
    const t = table('t', {
      columns: ['id', 'col'],
      columnTypes: { id: 'pk', col: opts.semantic ?? 'string' },
      sqlTypes: { col: sqlType },
      uniqueColumns: ['col'],
    });
    const plan = buildGenerationPlan(mapOf([t], ['t']), opts.rows ?? 300, LIMITS);
    const rows = runAll(new Map(), plan).t;
    return { plan, values: rows.map((r) => r.col) };
  }

  it('gives a plain INT UNIQUE column distinct values within its 1..1000 domain', () => {
    const { plan, values } = single('INT', { rows: 300 });
    expect(plan.warnings).toEqual([]);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000)).toBe(true);
  });

  it('caps a BOOLEAN UNIQUE column at 2 rows and reports why', () => {
    const { plan, values } = single('BOOLEAN', { rows: 500 });
    expect(plan.tables[0].rowCount).toBe(2);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/t\.col/);
    expect(plan.warnings[0]).toMatch(/room for 2 distinct value/);
    expect(plan.warnings[0]).toMatch(/capped at 2 row/);
    expect(new Set(values)).toEqual(new Set(['TRUE', 'FALSE']));
  });

  it('caps a TINYINT UNIQUE column at its real range (matches TINYINT_MAX) and reports why', () => {
    const { plan, values } = single('TINYINT', { rows: 500 });
    expect(plan.tables[0].rowCount).toBe(TINYINT_MAX);
    expect(plan.warnings[0]).toMatch(new RegExp(`room for ${TINYINT_MAX} distinct value`));
    expect(new Set(values).size).toBe(TINYINT_MAX);
  });

  it('caps a narrow VARCHAR(2) UNIQUE column at its base-36 domain (36^2 = 1296) and reports why', () => {
    const { plan, values } = single('VARCHAR(2)', { rows: 5000, semantic: 'phone' });
    expect(plan.tables[0].rowCount).toBe(1296);
    expect(plan.warnings[0]).toMatch(/room for 1296 distinct value/);
    expect(new Set(values).size).toBe(1296);
    expect(values.every((v) => typeof v === 'string' && /^'[0-9a-z]{1,2}'$/.test(v))).toBe(true);
  });

  it('UNIQUE text values survive truncation to the declared VARCHAR(n) length — no post-truncation collisions', () => {
    const { plan, values } = single('VARCHAR(3)', { rows: 2000, semantic: 'email' });
    // 36^3 = 46656, comfortably above 2000.
    expect(plan.tables[0].rowCount).toBe(2000);
    for (const v of values) {
      const raw = String(v).slice(1, -1); // strip quotes
      expect(raw.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('generates distinct DECIMAL UNIQUE values that fit (precision, scale)', () => {
    const { plan, values } = single('DECIMAL(4,2)', { rows: 3000 });
    // intDigits=2 -> 100 whole-number values * 100 fractional values = 10,000 capacity.
    expect(plan.warnings).toEqual([]);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      const [intPart, fracPart] = String(v).split('.');
      expect(intPart.length + (fracPart?.length ?? 0)).toBeLessThanOrEqual(4);
      expect(fracPart).toHaveLength(2);
    }
  });

  it('a DECIMAL with a very large scale (fracRange would overflow to Infinity) still terminates and produces finite values', () => {
    // NUMERIC(1000,999): scale=999 makes 10**scale overflow to Infinity if left uncapped, which
    // then made sampleDistinctIndices spin forever trying to fill a Set with Math.random()*Infinity
    // (always Infinity, so the Set's size never grows past 1). This must complete quickly, not hang.
    const { plan, values } = single('NUMERIC(1000,999)', { rows: 50 });
    expect(plan.tables[0].rowCount).toBe(50);
    for (const v of values) {
      expect(Number.isFinite(v) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))).toBe(true);
    }
    expect(new Set(values).size).toBe(values.length);
  }, 5000);

  it('generates distinct FLOAT, DATE, TIMESTAMP, TIME and UUID UNIQUE values at several thousand rows', () => {
    for (const [sqlType, semantic] of [
      ['REAL', undefined],
      ['DATE', undefined],
      ['TIMESTAMP', undefined],
      ['TIME', undefined],
      ['UUID', undefined],
    ] as const) {
      const { plan, values } = single(sqlType, { rows: 4000, semantic });
      expect(plan.warnings, `${sqlType} should not need capping at 4000 rows`).toEqual([]);
      expect(plan.tables[0].rowCount).toBe(4000);
      expect(new Set(values).size, `${sqlType} values should all be distinct`).toBe(4000);
    }
  });

  it('caps a table at the smallest of several simultaneous UNIQUE-column capacities', () => {
    const t = table('t', {
      columns: ['id', 'flag', 'code'],
      columnTypes: { id: 'pk', flag: 'boolean', code: 'string' },
      sqlTypes: { flag: 'BOOLEAN', code: 'VARCHAR(2)' }, // capacities 2 and 1296
      uniqueColumns: ['flag', 'code'],
    });
    const plan = buildGenerationPlan(mapOf([t], ['t']), 5000, LIMITS);
    expect(plan.tables[0].rowCount).toBe(2); // the smaller of the two binding constraints
    // Only the binding (flag) constraint is reported — code's larger capacity never bound anything.
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/t\.flag/);
  });

  it('does not cap or warn when capacity comfortably exceeds the requested rows', () => {
    const { plan } = single('INT', { rows: 100 });
    expect(plan.warnings).toEqual([]);
    expect(plan.tables[0].rowCount).toBe(100);
  });

  it('an ordinary (non-UNIQUE) column of the same type is unaffected — may repeat, never capped', () => {
    const t = table('t', {
      columns: ['id', 'flag'],
      columnTypes: { id: 'pk', flag: 'boolean' },
      sqlTypes: { flag: 'BOOLEAN' },
      // no uniqueColumns
    });
    const plan = buildGenerationPlan(mapOf([t], ['t']), 500, LIMITS);
    expect(plan.tables[0].rowCount).toBe(500);
    expect(plan.warnings).toEqual([]);
  });
});

describe('buildGenerationPlan & generateTableRows: UNIQUE foreign keys (not the primary key)', () => {
  const users = table('users', { columns: ['id', 'email'], columnTypes: { id: 'pk', email: 'email' } });

  function profiles(opts: { extraFk?: ValidatedTable['foreignKeys'][number] } = {}) {
    return table('user_profiles', {
      columns: opts.extraFk ? ['id', 'user_id', opts.extraFk.column] : ['id', 'user_id'],
      columnTypes: opts.extraFk
        ? { id: 'pk', user_id: 'fk', [opts.extraFk.column]: 'fk' }
        : { id: 'pk', user_id: 'fk' },
      foreignKeys: [
        { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' },
        ...(opts.extraFk ? [opts.extraFk] : []),
      ],
      uniqueColumns: ['user_id'],
    });
  }

  it('caps a UNIQUE (non-PK) FK at its parent row count and reports why', () => {
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), 500, LIMITS);
    expect(plan.tables[0].rowCount).toBe(15);
    expect(plan.tables[1].rowCount).toBe(15);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/user_profiles\.user_id/);
    expect(plan.warnings[0]).toMatch(/UNIQUE foreign key/);
    expect(plan.warnings[0]).toMatch(/"users"/);
    expect(plan.warnings[0]).toMatch(/capped at 15 row/);
  });

  it('does not cap or warn when the requested count already fits within the parent', () => {
    const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), 20, LIMITS);
    expect(plan.warnings).toEqual([]);
  });

  it('every row gets a distinct key that really exists in the parent (sampled without replacement)', () => {
    for (let i = 0; i < 30; i++) {
      const requested = 20 + Math.floor(Math.random() * 2000);
      const pools: PkPools = new Map();
      const plan = buildGenerationPlan(mapOf([users, profiles()], ['users', 'user_profiles']), requested, LIMITS);
      const rows = runAll(pools, plan);
      const userIds = new Set(pools.get('users'));
      const seen = new Set<string | number>();
      for (const row of rows.user_profiles) {
        expect(userIds.has(row.user_id as number)).toBe(true);
        expect(seen.has(row.user_id)).toBe(false);
        seen.add(row.user_id);
      }
    }
  });

  it('a UNIQUE FK combined with an ordinary FK to a different parent: both correct at once', () => {
    const companies = table('companies', { columns: ['id'], columnTypes: { id: 'pk' } });
    const withCompany = profiles({
      extraFk: { column: 'company_id', referencesTable: 'companies', referencesColumn: 'id' },
    });
    const pools: PkPools = new Map();
    const plan = buildGenerationPlan(
      mapOf([users, companies, withCompany], ['users', 'companies', 'user_profiles']),
      300,
      LIMITS
    );
    const rows = runAll(pools, plan);
    const userIds = new Set(pools.get('users'));
    const companyIds = new Set(pools.get('companies'));
    const seenUserIds = new Set<string | number>();
    expect(rows.user_profiles.length).toBeGreaterThan(0);
    for (const row of rows.user_profiles) {
      expect(userIds.has(row.user_id as number)).toBe(true); // unique FK: sampled without replacement
      expect(seenUserIds.has(row.user_id)).toBe(false);
      seenUserIds.add(row.user_id);
      expect(companyIds.has(row.company_id as number)).toBe(true); // ordinary FK: unaffected, may repeat
    }
  });

  it('a nullable UNIQUE FK to a later table (cycle break) is always NULL — not capped, no warning', () => {
    const a = table('a', {
      columns: ['id', 'b_id'],
      columnTypes: { id: 'pk', b_id: 'fk' },
      foreignKeys: [{ column: 'b_id', referencesTable: 'b', referencesColumn: 'id' }],
      uniqueColumns: ['b_id'],
    });
    const b = table('b', {
      columns: ['id', 'a_id'],
      columnTypes: { id: 'pk', a_id: 'fk' },
      foreignKeys: [{ column: 'a_id', referencesTable: 'a', referencesColumn: 'id' }],
      notNull: ['a_id'],
    });
    const plan = buildGenerationPlan(mapOf([a, b], ['a', 'b']), 50, LIMITS);
    expect(plan.warnings).toEqual([]);
    expect(plan.tables[0].rowCount).toBe(15); // unchanged: NULLs never collide, so nothing to cap
    const rows = runAll(new Map() as PkPools, plan);
    expect(rows.a.every((r) => r.b_id === 'NULL')).toBe(true);
  });
});

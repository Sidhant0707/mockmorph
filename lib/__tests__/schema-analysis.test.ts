import { describe, expect, it } from 'vitest';
import { analyzeStructure, buildValidatedSemanticMap, SchemaAnalysisError } from '../schema-analysis';

const USERS_ORDERS = `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT
  );
  CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    total DECIMAL(10,2)
  );
`;

describe('analyzeStructure', () => {
  it('computes a correct local topology for a simple schema', () => {
    const { order } = analyzeStructure(USERS_ORDERS);
    expect(order).toEqual(['users', 'orders']);
  });

  it('throws a SchemaAnalysisError for an unparseable schema', () => {
    expect(() => analyzeStructure('not sql at all')).toThrow(SchemaAnalysisError);
  });

  it('accepts a cycle that a nullable foreign key can break, and warns that the column is generated as NULL', () => {
    const { order, warnings } = analyzeStructure(`
      CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INTEGER NOT NULL REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INTEGER REFERENCES a(id));
    `);
    expect(order).toEqual(['b', 'a']); // the NOT NULL edge decides the order
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('b.a_id is nullable');
  });

  it('treats a foreign key on a column with no NOT NULL information as a hard edge', () => {
    // Table-level FK on a column that is not declared: nullability is unknown, so the cycle stays an error.
    expect(() =>
      analyzeStructure(`
        CREATE TABLE a (id SERIAL PRIMARY KEY, FOREIGN KEY (b_id) REFERENCES b(id));
        CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a(id));
      `)
    ).toThrow(/Circular foreign-key dependency/);
  });

  it('throws with kind "circular_dependency" for a cyclic schema', () => {
    const cyclic = `
      CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INTEGER NOT NULL REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a(id));
    `;
    try {
      analyzeStructure(cyclic);
      expect.unreachable('expected analyzeStructure to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaAnalysisError);
      expect((error as SchemaAnalysisError).kind).toBe('circular_dependency');
    }
  });

  it('throws with kind "missing_parent_table" when a FK targets a nonexistent table', () => {
    const bad = `CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES nonexistent(id));`;
    try {
      analyzeStructure(bad);
      expect.unreachable('expected analyzeStructure to throw');
    } catch (error) {
      expect((error as SchemaAnalysisError).kind).toBe('missing_parent_table');
    }
  });

  it('rejects a malicious table identifier before it can reach generated SQL', () => {
    const malicious = `CREATE TABLE "users); DROP TABLE users;--" (id SERIAL PRIMARY KEY);`;
    try {
      analyzeStructure(malicious);
      expect.unreachable('expected analyzeStructure to throw');
    } catch (error) {
      expect((error as SchemaAnalysisError).kind).toBe('unsafe_identifier');
    }
  });
});

describe('buildValidatedSemanticMap (with a cached classification, so no network call is made)', () => {
  it('always uses the locally computed topology, never anything the cache might claim', async () => {
    const map = await buildValidatedSemanticMap(USERS_ORDERS, {
      users: { email: 'email' },
      orders: { total: 'price' },
    });
    expect(map.topology).toEqual(['users', 'orders']);
    expect(map.tables.orders.columnTypes.user_id).toBe('fk'); // structural fact, not from the cache
    expect(map.tables.users.columnTypes.id).toBe('pk');
    expect(map.tables.orders.columnTypes.total).toBe('price'); // taken from the cache
  });

  it('coerces an unrecognized cached semantic type to "string" instead of failing', async () => {
    const map = await buildValidatedSemanticMap(USERS_ORDERS, {
      users: { email: 'not_a_real_type' },
      orders: {},
    });
    expect(map.tables.users.columnTypes.email).toBe('string');
  });

  it('rejects a schema whose primary key is an unsupported type', async () => {
    const badPk = `CREATE TABLE legacy (code VARCHAR(20) PRIMARY KEY, name TEXT);`;
    await expect(buildValidatedSemanticMap(badPk, { legacy: {} })).rejects.toMatchObject({
      kind: 'unsupported_primary_key_type',
    });
  });

  it('rejects a schema with a composite primary key', async () => {
    const composite = `
      CREATE TABLE order_items (
        order_id INTEGER,
        product_id INTEGER,
        PRIMARY KEY (order_id, product_id)
      );
    `;
    await expect(buildValidatedSemanticMap(composite, { order_items: {} })).rejects.toMatchObject({
      kind: 'unsupported_primary_key',
    });
  });

  it('handles a malformed (non-object) cache by falling through cleanly (still rejects malformed array cache)', async () => {
    // A cache that isn't a plausible object at all should not blow up the
    // structural pass; buildValidatedTables just won't find any typed
    // columns for it, everything defaults to 'string'.
    const map = await buildValidatedSemanticMap(USERS_ORDERS, { users: 'not-an-object', orders: null });
    expect(map.tables.users.columnTypes.email).toBe('string');
  });
});

describe('declared SQL types reach the generator', () => {
  it('records what each column can hold, separately from its semantic type', async () => {
    const map = await buildValidatedSemanticMap(
      `CREATE TABLE items (
         id SERIAL PRIMARY KEY,
         quantity INT NOT NULL,
         price DECIMAL(10,2),
         label VARCHAR(30)
       );`,
      { items: { quantity: 'string', price: 'price', label: 'product' } }
    );
    const { columnInfo, columnTypes } = map.tables.items;
    expect(columnInfo.quantity).toMatchObject({ kind: 'integer' });
    expect(columnInfo.price).toMatchObject({ kind: 'decimal', precision: 10, scale: 2 });
    expect(columnInfo.label).toMatchObject({ kind: 'text', maxLength: 30 });
    // The semantic classification is untouched.
    expect(columnTypes.label).toBe('product');
  });

  it('warns about a column type it cannot generate a value for', async () => {
    const map = await buildValidatedSemanticMap(
      'CREATE TABLE t (id SERIAL PRIMARY KEY, status order_status, n INT);',
      { t: {} }
    );
    expect(map.warnings.some((w) => w.includes('t.status') && w.includes('order_status'))).toBe(true);
    expect(map.warnings.some((w) => w.includes('t.n'))).toBe(false);
  });

  it('does not warn about key columns, whose values come from the key pools', async () => {
    const map = await buildValidatedSemanticMap(USERS_ORDERS, { users: {}, orders: {} });
    expect(map.warnings.filter((w) => w.includes('not recognized'))).toEqual([]);
  });
});

describe('UNIQUE columns reach the validated table', () => {
  it('threads uniqueColumns through, excluding the primary key', async () => {
    const map = await buildValidatedSemanticMap(
      `CREATE TABLE t (id SERIAL PRIMARY KEY, code INT UNIQUE, email TEXT, UNIQUE (email));`,
      { t: {} }
    );
    expect(map.tables.t.uniqueColumns.sort()).toEqual(['code', 'email']);
  });

  it('warns about a UNIQUE column of a kind generation cannot enforce distinctness for', async () => {
    const map = await buildValidatedSemanticMap('CREATE TABLE t (id SERIAL PRIMARY KEY, tags JSONB UNIQUE);', {
      t: {},
    });
    expect(map.tables.t.uniqueColumns).toEqual(['tags']);
    expect(map.warnings.some((w) => w.includes('t.tags') && w.includes('UNIQUE'))).toBe(true);
  });

  it('warns about a UNIQUE self-referencing foreign key instead of silently allowing duplicates', async () => {
    const map = await buildValidatedSemanticMap(
      'CREATE TABLE t (id SERIAL PRIMARY KEY, parent_code INT UNIQUE REFERENCES t(id));',
      { t: {} }
    );
    expect(map.warnings.some((w) => w.includes('t.parent_code') && w.includes('self-referencing'))).toBe(true);
  });

  it('does not warn about an ordinary UNIQUE integer/text column', async () => {
    const map = await buildValidatedSemanticMap(
      'CREATE TABLE t (id SERIAL PRIMARY KEY, code INT UNIQUE, email VARCHAR(50) UNIQUE);',
      { t: {} }
    );
    expect(map.warnings.filter((w) => !w.includes('cached semantic classification'))).toEqual([]);
  });
});

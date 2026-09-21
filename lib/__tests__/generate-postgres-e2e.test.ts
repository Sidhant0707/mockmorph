/**
 * End-to-end check against a REAL Postgres engine (PGlite = Postgres compiled
 * to WASM, running in-process).
 *
 * Unit tests can only assert what we *think* Postgres accepts. This file calls
 * the actual POST /api/generate handler, captures the SQL it streams, and runs
 * that SQL in Postgres against the schema it was generated from. If a column
 * gets a value of the wrong type or length, Postgres itself rejects the INSERT
 * and the test fails with Postgres's own error message.
 *
 * Only the pieces that need infrastructure are mocked: the database (history
 * saving) and the login session. Parsing, ordering, planning and value
 * generation are all the real code. No Groq call is made — the request supplies
 * a cached semantic classification, exactly as the web UI does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

vi.mock('@/lib/prisma', () => ({
  prisma: { generation: { create: vi.fn().mockResolvedValue({}) } },
}));
vi.mock('@/lib/session', () => ({
  getSessionUserId: vi.fn().mockResolvedValue('test-user'),
}));

import { POST } from '@/app/api/generate/route';

// The route deliberately streams with small delays, and Postgres-in-WASM is slow to start on some machines.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

async function postGenerate(
  schema: string,
  opts: { rows?: number; dialect?: 'postgres' | 'mysql'; cachedColumnTypes?: unknown } = {}
): Promise<Response> {
  return POST(
    new Request('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        rawSchema: schema,
        config: { rowCount: opts.rows ?? 40, dialect: opts.dialect ?? 'postgres' },
        cachedColumnTypes: opts.cachedColumnTypes ?? {},
      }),
    })
  );
}

async function generateSql(
  schema: string,
  opts: { rows?: number; dialect?: 'postgres' | 'mysql'; cachedColumnTypes?: unknown } = {}
): Promise<string> {
  const response = await postGenerate(schema, opts);
  expect(response.status).toBe(200);
  const sql = await response.text();
  expect(sql).not.toContain('[FATAL ERROR]');
  return sql;
}

// Starting a Postgres engine takes a few seconds, so one instance is shared and
// wiped clean before each test.
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});

/** Creates the schema, then runs the generated INSERTs. Throws Postgres's own error if any row is rejected. */
async function loadIntoPostgres(schema: string, sql: string): Promise<void> {
  await db.exec(schema);
  await db.exec(sql);
}

async function count(table: string): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return result.rows[0].n;
}

// ---------------------------------------------------------------------------

describe('generated SQL is accepted by real Postgres', () => {
  it('a plain `quantity INT` column gets an integer, not a string (the original bug)', async () => {
    const schema = `
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        quantity INT NOT NULL
      );`;
    const sql = await generateSql(schema);
    // The old output was (1, 'string_val_1', 'string_val_1'): a string in the INT slot.
    expect(sql).not.toMatch(/'string_val_\d+', 'string_val_\d+'\)/);
    await loadIntoPostgres(schema, sql);
    expect(await count('products')).toBe(40);
    const bad = await db.query('SELECT 1 FROM products WHERE quantity IS NULL OR quantity < 1 OR quantity > 1000');
    expect(bad.rows).toHaveLength(0);
  });

  it('gives common column names (age, quantity, rating, year, count) sensible ranges', async () => {
    const schema = `
      CREATE TABLE stats (
        id SERIAL PRIMARY KEY,
        age INT,
        quantity INT,
        rating INT,
        year INT,
        count INT,
        unrelated INT
      );`;
    const sql = await generateSql(schema, { rows: 200 });
    await loadIntoPostgres(schema, sql);
    expect(await count('stats')).toBe(200);
    const outOfRange = await db.query(`
      SELECT 1 FROM stats WHERE
        age NOT BETWEEN 18 AND 90 OR
        quantity NOT BETWEEN 1 AND 50 OR
        rating NOT BETWEEN 1 AND 5 OR
        year NOT BETWEEN 1990 AND 2026 OR
        count NOT BETWEEN 0 AND 100
    `);
    expect(outOfRange.rows).toHaveLength(0);
  });

  it('every common Postgres column type in one table', async () => {
    const schema = `
      CREATE TABLE customers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        full_name TEXT,
        country_code CHAR(2),
        nickname VARCHAR(8),
        age INT,
        views INTEGER,
        loyalty_points BIGINT,
        rating SMALLINT,
        balance NUMERIC(10,2),
        whole DECIMAL(5,0),
        ratio DECIMAL(3,3),
        tiny NUMERIC(1,0),
        anything NUMERIC,
        weight REAL,
        score DOUBLE PRECISION,
        is_active BOOLEAN,
        born_on DATE,
        created_at TIMESTAMP,
        updated_at TIMESTAMPTZ,
        last_login TIMESTAMP WITH TIME ZONE,
        no_tz TIMESTAMP(3) WITHOUT TIME ZONE,
        opens_at TIME,
        external_id UUID,
        preferences JSONB,
        raw_payload JSON,
        long_name CHARACTER VARYING(12),
        code CHARACTER(3)
      );`;
    const sql = await generateSql(schema, {
      cachedColumnTypes: {
        customers: { email: 'email', full_name: 'fullname', nickname: 'fullname', country_code: 'company' },
      },
    });
    await loadIntoPostgres(schema, sql);
    expect(await count('customers')).toBe(40);
  });

  it('a parent/child schema with typed columns and foreign keys, in real dependency order', async () => {
    const schema = `
      CREATE TABLE customers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255),
        age INT
      );
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT,
        stock INT,
        weight_kg REAL
      );
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        customer_id INT REFERENCES customers(id),
        placed_at TIMESTAMP NOT NULL,
        shipped BOOLEAN NOT NULL,
        total DECIMAL(12,2)
      );
      CREATE TABLE order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id),
        product_id INT REFERENCES products(id),
        quantity INT NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL
      );`;
    const sql = await generateSql(schema, { rows: 100 });
    await loadIntoPostgres(schema, sql);
    // Foreign keys are enforced by Postgres, so this also proves FK integrity.
    expect(await count('order_items')).toBeGreaterThan(0);
    const orphans = await db.query(
      `SELECT 1 FROM order_items i LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL`
    );
    expect(orphans.rows).toHaveLength(0);
  });

  it('text semantic types still apply to text columns', async () => {
    const schema = `CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255), company TEXT);`;
    const sql = await generateSql(schema, {
      cachedColumnTypes: { users: { email: 'email', company: 'company' } },
    });
    expect(sql).toContain('@obsidian.corp');
    expect(sql).toContain('Syndicate');
    await loadIntoPostgres(schema, sql);
    expect(await count('users')).toBe(40);
  });

  it('a semantic type never overrides the declared SQL type', async () => {
    // A cached/AI classification says "email" for an INT column and "price" for
    // a VARCHAR(3). The declared type wins for the former; the length limit
    // wins for the latter.
    const schema = `CREATE TABLE odd (id SERIAL PRIMARY KEY, n INT, short VARCHAR(3));`;
    const sql = await generateSql(schema, {
      cachedColumnTypes: { odd: { n: 'email', short: 'price' } },
    });
    await loadIntoPostgres(schema, sql);
    const result = await db.query<{ max_len: number }>(`SELECT max(length(short))::int AS max_len FROM odd`);
    expect(result.rows[0].max_len).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------

describe('self-referencing foreign keys', () => {
  interface Hierarchy {
    total: number;
    roots: number;
    reached: number;
    maxDepth: number;
  }

  /**
   * Walks the loaded data from its root(s) down with a recursive CTE. A root is
   * a row whose parent is NULL, or (NOT NULL columns) that is its own parent.
   * `reached === total` proves every row hangs off a root: no orphans, no cycles.
   */
  async function hierarchy(table: string, fk: string, pk = 'id'): Promise<Hierarchy> {
    const t = `"${table}"`;
    const result = await db.query<Hierarchy>(`
      WITH RECURSIVE tree AS (
        SELECT "${pk}" AS id, 1 AS depth FROM ${t} WHERE "${fk}" IS NULL OR "${fk}" = "${pk}"
        UNION ALL
        SELECT c."${pk}", tree.depth + 1 FROM ${t} c JOIN tree ON c."${fk}" = tree.id WHERE c."${fk}" <> c."${pk}"
      )
      SELECT
        (SELECT count(*)::int FROM ${t}) AS total,
        (SELECT count(*)::int FROM ${t} WHERE "${fk}" IS NULL OR "${fk}" = "${pk}") AS roots,
        count(DISTINCT id)::int AS reached,
        max(depth)::int AS "maxDepth"
      FROM tree
    `);
    return result.rows[0];
  }

  it('employees with a nullable manager_id: a valid forest, parents always come first', async () => {
    const schema = `
      CREATE TABLE employees (
        id SERIAL PRIMARY KEY,
        name TEXT,
        manager_id INT REFERENCES employees(id)
      );`;
    const sql = await generateSql(schema, { rows: 300 });
    expect(sql).toMatch(/\(1, '[^']*', NULL\)/); // the first row is a root
    await loadIntoPostgres(schema, sql);

    const h = await hierarchy('employees', 'manager_id');
    expect(h.total).toBe(300);
    expect(h.reached).toBe(h.total);
    expect(h.roots).toBeGreaterThan(1); // a forest, not a single chain
    expect(h.maxDepth).toBeGreaterThan(1);
    const backwards = await db.query('SELECT 1 FROM employees WHERE manager_id >= id');
    expect(backwards.rows).toHaveLength(0);
  });

  it('categories with a NOT NULL parent_id: the first row is its own root, nothing is NULL', async () => {
    const schema = `
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        name TEXT,
        parent_id INT NOT NULL REFERENCES categories(id)
      );`;
    const sql = await generateSql(schema, { rows: 300 });
    expect(sql).not.toContain('NULL');
    await loadIntoPostgres(schema, sql); // Postgres itself accepts a row that references itself
    const h = await hierarchy('categories', 'parent_id');
    expect(h).toMatchObject({ total: 300, roots: 1, reached: 300 });
    const selfRows = await db.query<{ id: number }>('SELECT id FROM categories WHERE parent_id = id');
    expect(selfRows.rows).toEqual([{ id: 1 }]);
  });

  it('uuid primary keys, nullable and NOT NULL, inline and table-level FOREIGN KEY', async () => {
    const schema = `
      CREATE TABLE nodes (
        id UUID PRIMARY KEY,
        label TEXT,
        parent_id UUID REFERENCES nodes(id)
      );
      CREATE TABLE folders (
        id UUID,
        parent_id UUID NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders(id)
      );`;
    // Both tables are independent, so rows are spread 15 / rest by the plan's distribution.
    const sql = await generateSql(schema, { rows: 200 });
    await loadIntoPostgres(schema, sql);
    for (const [table, roots] of [
      ['folders', 1],
      ['nodes', null],
    ] as const) {
      const h = await hierarchy(table, 'parent_id');
      expect(h.reached).toBe(h.total);
      if (roots !== null) expect(h.roots).toBe(roots);
    }
  });

  it('a self-FK plus a foreign key to another parent, and two self-FKs on one table', async () => {
    const schema = `
      CREATE TABLE departments (id SERIAL PRIMARY KEY, name TEXT);
      CREATE TABLE employees (
        id SERIAL PRIMARY KEY,
        name TEXT,
        department_id INT NOT NULL REFERENCES departments(id),
        manager_id INT REFERENCES employees(id),
        mentor_id INT NOT NULL REFERENCES employees(id)
      );`;
    const sql = await generateSql(schema, { rows: 400 });
    expect(sql.indexOf('INSERT INTO "departments"')).toBeLessThan(sql.indexOf('INSERT INTO "employees"'));
    await loadIntoPostgres(schema, sql);
    expect(await count('departments')).toBe(15);
    expect(await count('employees')).toBe(385);
    for (const fk of ['manager_id', 'mentor_id']) {
      const h = await hierarchy('employees', fk);
      expect(h.reached).toBe(h.total);
    }
    const orphans = await db.query(
      'SELECT 1 FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE d.id IS NULL'
    );
    expect(orphans.rows).toHaveLength(0);
  });

  it('does not depend on column order, and handles quoted identifiers', async () => {
    const schema = `
      CREATE TABLE "Staff" (
        "manager_id" INT REFERENCES "Staff"("id"),
        "label" TEXT,
        "id" SERIAL PRIMARY KEY
      );
      CREATE TABLE "Areas" (
        "parent_id" INT NOT NULL,
        "id" INT,
        PRIMARY KEY ("id"),
        FOREIGN KEY ("parent_id") REFERENCES "Areas" ("id")
      );`;
    const sql = await generateSql(schema, { rows: 120 });
    await loadIntoPostgres(schema, sql);
    for (const [table, fk] of [
      ['Staff', 'manager_id'],
      ['Areas', 'parent_id'],
    ]) {
      const h = await hierarchy(table, fk);
      expect(h.reached).toBe(h.total);
    }
  });

  it('stress: several thousand rows load and form a valid hierarchy', async () => {
    const schema = `
      CREATE TABLE employees (id SERIAL PRIMARY KEY, name TEXT, manager_id INT REFERENCES employees(id));
      CREATE TABLE categories (id UUID PRIMARY KEY, parent_id UUID NOT NULL REFERENCES categories(id));`;
    // Tables are alphabetical when independent: categories (15 rows) then employees (the rest).
    const sql = await generateSql(schema, { rows: 6000 });
    await loadIntoPostgres(schema, sql);
    const employees = await hierarchy('employees', 'manager_id');
    expect(employees.total).toBe(5985);
    expect(employees.reached).toBe(employees.total);
    const categories = await hierarchy('categories', 'parent_id');
    expect(categories).toMatchObject({ total: 15, roots: 1, reached: 15 });

    const stress = `
      CREATE TABLE big (id SERIAL PRIMARY KEY, parent_id INT NOT NULL REFERENCES big(id));`;
    const bigSql = await generateSql(stress, { rows: 8000 });
    await loadIntoPostgres(stress, bigSql);
    expect(await hierarchy('big', 'parent_id')).toMatchObject({ total: 8000, roots: 1, reached: 8000 });
  });

  it('a mutual cycle is still rejected with a clear message', async () => {
    const response = await postGenerate(`
      CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INT NOT NULL REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INT NOT NULL REFERENCES a(id));`);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; kind: string };
    expect(body.kind).toBe('circular_dependency');
    expect(body.error).toContain('Circular foreign-key dependency detected among: a, b');
  });

  it('a mutual cycle is still rejected when one of its tables also references itself', async () => {
    const response = await postGenerate(`
      CREATE TABLE a (id SERIAL PRIMARY KEY, parent_id INT REFERENCES a(id), b_id INT NOT NULL REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INT NOT NULL REFERENCES a(id));`);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain('Circular foreign-key dependency');
  });

  // Postgres cannot CREATE two tables that reference each other in one go, so the DDL used to load
  // the data adds the first foreign key afterwards. The schema sent to the route is the mutual one.
  const mutualDdl = (aFk: string, bFk: string) => `
    CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INT ${aFk});
    CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INT ${bFk} REFERENCES a(id));
    ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id);`;

  it('a cycle with one nullable foreign key is accepted: that column is NULL, the other side is real', async () => {
    const schema = `
      CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INT NOT NULL REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INT REFERENCES a(id));`;
    const sql = await generateSql(schema, { rows: 60 });
    // a.b_id is NOT NULL, so b is generated first and b.a_id (its parent comes later) is always NULL.
    expect(sql.indexOf('INSERT INTO "b"')).toBeLessThan(sql.indexOf('INSERT INTO "a"'));
    await db.exec(mutualDdl('NOT NULL', ''));
    await db.exec(sql);
    expect((await db.query<{ n: number }>('SELECT count(a_id)::int AS n FROM b')).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>('SELECT count(b_id)::int AS n FROM a')).rows[0].n).toBe(await count('a'));
  });

  it('a cycle where every foreign key is nullable is accepted: exactly one side is generated as NULL', async () => {
    const schema = `
      CREATE TABLE a (id SERIAL PRIMARY KEY, b_id INT REFERENCES b(id));
      CREATE TABLE b (id SERIAL PRIMARY KEY, a_id INT REFERENCES a(id));`;
    const sql = await generateSql(schema, { rows: 60 });
    await db.exec(mutualDdl('', ''));
    await db.exec(sql);
    const nonNull = await db.query<{ a: number; b: number }>(
      'SELECT (SELECT count(b_id)::int FROM a) AS a, (SELECT count(a_id)::int FROM b) AS b'
    );
    const { a, b } = nonNull.rows[0];
    expect([a === 0, b === 0].filter(Boolean)).toHaveLength(1);
    expect(a + b).toBeGreaterThan(0);
  });

  it('a self-FK to a non-primary-key column is still rejected (in the stream, with the FK named)', async () => {
    const response = await postGenerate(`
      CREATE TABLE employees (id SERIAL PRIMARY KEY, code TEXT, boss_code TEXT REFERENCES employees(code));`);
    const text = await response.text();
    expect(text).toContain('[FATAL ERROR]');
    expect(text).toContain("employees.boss_code references employees.code, which is not that table's primary key");
    expect(text).not.toContain('INSERT INTO');
  });
});

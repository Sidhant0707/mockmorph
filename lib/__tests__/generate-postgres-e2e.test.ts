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

async function generateSql(
  schema: string,
  opts: { rows?: number; dialect?: 'postgres' | 'mysql'; cachedColumnTypes?: unknown } = {}
): Promise<string> {
  const response = await POST(
    new Request('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        rawSchema: schema,
        config: { rowCount: opts.rows ?? 40, dialect: opts.dialect ?? 'postgres' },
        cachedColumnTypes: opts.cachedColumnTypes ?? {},
      }),
    })
  );
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

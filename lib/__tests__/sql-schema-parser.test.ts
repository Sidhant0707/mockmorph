import { describe, expect, it } from 'vitest';
import { parseSchema } from '../sql-schema-parser';

describe('parseSchema', () => {
  it('extracts an inline primary key', () => {
    const { tables } = parseSchema(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL
      );
    `);
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('users');
    expect(tables[0].primaryKey).toEqual({ column: 'id', kind: 'integer' });
    expect(tables[0].hasCompositePrimaryKey).toBe(false);
  });

  it('extracts a table-level primary key', () => {
    const { tables } = parseSchema(`
      CREATE TABLE users (
        id INTEGER,
        email TEXT,
        PRIMARY KEY (id)
      );
    `);
    expect(tables[0].primaryKey).toEqual({ column: 'id', kind: 'integer' });
  });

  it('extracts an inline REFERENCES foreign key', () => {
    const { tables } = parseSchema(`
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id)
      );
    `);
    expect(tables[0].foreignKeys).toEqual([
      { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' },
    ]);
  });

  it('extracts a table-level FOREIGN KEY clause', () => {
    const { tables } = parseSchema(`
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `);
    expect(tables[0].foreignKeys).toEqual([
      { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' },
    ]);
  });

  it('extracts multiple foreign keys on one table', () => {
    const { tables } = parseSchema(`
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        company_id INTEGER REFERENCES companies(id)
      );
    `);
    expect(tables[0].foreignKeys).toHaveLength(2);
    expect(tables[0].foreignKeys.map((f) => f.referencesTable).sort()).toEqual(['companies', 'users']);
  });

  it('handles multiple CREATE TABLE statements, including types with commas inside parens', () => {
    const { tables } = parseSchema(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        price DECIMAL(10,2) NOT NULL
      );
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id)
      );
    `);
    expect(tables.map((t) => t.name)).toEqual(['products', 'orders']);
    expect(tables[0].columns.find((c) => c.name === 'price')?.rawType.toLowerCase()).toBe('decimal(10,2)');
  });

  it('flags a composite primary key instead of silently picking one column', () => {
    const { tables } = parseSchema(`
      CREATE TABLE order_items (
        order_id INTEGER,
        product_id INTEGER,
        PRIMARY KEY (order_id, product_id)
      );
    `);
    expect(tables[0].hasCompositePrimaryKey).toBe(true);
    expect(tables[0].primaryKey).toBeNull();
  });

  it('classifies a UUID primary key distinctly from an unsupported type', () => {
    const { tables } = parseSchema(`
      CREATE TABLE sessions (
        id UUID PRIMARY KEY,
        label TEXT
      );
    `);
    expect(tables[0].primaryKey).toEqual({ column: 'id', kind: 'uuid' });
  });

  it('classifies a non-integer, non-UUID primary key as unsupported', () => {
    const { tables } = parseSchema(`
      CREATE TABLE legacy (
        code VARCHAR(20) PRIMARY KEY
      );
    `);
    expect(tables[0].primaryKey).toEqual({ column: 'code', kind: 'unsupported' });
  });

  it('strips -- and block comments without corrupting parsing', () => {
    const { tables } = parseSchema(`
      -- users table
      CREATE TABLE users ( /* the id */ id SERIAL PRIMARY KEY, email TEXT );
    `);
    expect(tables[0].name).toBe('users');
    expect(tables[0].primaryKey?.column).toBe('id');
  });

  it('returns an empty table list with a warning for schema with no CREATE TABLE', () => {
    const { tables, warnings } = parseSchema('ALTER TABLE foo ADD COLUMN bar INT;');
    expect(tables).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('warns on an unsupported table-level constraint instead of crashing', () => {
    const { tables, warnings } = parseSchema(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT,
        UNIQUE (email)
      );
    `);
    expect(tables[0].columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(warnings.some((w) => w.includes('UNIQUE'))).toBe(true);
  });
});

describe('declared column types (rawType)', () => {
  const rawTypes = (ddl: string): Record<string, string> => {
    const { tables } = parseSchema(ddl);
    return Object.fromEntries(tables[0].columns.map((c) => [c.name, c.rawType]));
  };

  it('keeps multi-word Postgres types whole instead of cutting them at the first word', () => {
    const types = rawTypes(`
      CREATE TABLE t (
        a DOUBLE PRECISION NOT NULL,
        b CHARACTER VARYING(50),
        c TIMESTAMP WITH TIME ZONE DEFAULT now(),
        d TIMESTAMP(3) WITHOUT TIME ZONE,
        e TIME WITH TIME ZONE
      );
    `);
    expect(types.a).toBe('DOUBLE PRECISION');
    expect(types.b).toBe('CHARACTER VARYING(50)');
    expect(types.c).toBe('TIMESTAMP WITH TIME ZONE');
    expect(types.d).toBe('TIMESTAMP(3) WITHOUT TIME ZONE');
    expect(types.e).toBe('TIME WITH TIME ZONE');
  });

  it('keeps array suffixes', () => {
    const types = rawTypes(`CREATE TABLE t (tags TEXT[] NOT NULL, grid INTEGER[3][3], names VARCHAR(10)[]);`);
    expect(types.tags).toBe('TEXT[]');
    expect(types.grid).toBe('INTEGER[3][3]');
    expect(types.names).toBe('VARCHAR(10)[]');
  });

  it('does not swallow modifiers that follow a plain type', () => {
    const types = rawTypes(`
      CREATE TABLE t (
        a INT NOT NULL,
        b VARCHAR(20) DEFAULT 'x',
        c TIMESTAMP DEFAULT now(),
        d CHARACTER(3) NOT NULL,
        e DECIMAL(10, 2) NOT NULL
      );
    `);
    expect(types).toEqual({ a: 'INT', b: 'VARCHAR(20)', c: 'TIMESTAMP', d: 'CHARACTER(3)', e: 'DECIMAL(10, 2)' });
  });

  it('still classifies a serial primary key as an integer key', () => {
    const { tables } = parseSchema('CREATE TABLE t (id SERIAL PRIMARY KEY, n INT);');
    expect(tables[0].primaryKey).toEqual({ column: 'id', kind: 'integer' });
  });
});

describe('NOT NULL detection', () => {
  const notNullByColumn = (sql: string) =>
    Object.fromEntries(parseSchema(sql).tables[0].columns.map((c) => [c.name, c.notNull]));

  it('records column-level NOT NULL; everything else is nullable', () => {
    const result = notNullByColumn(`
      CREATE TABLE t (
        id SERIAL PRIMARY KEY,
        a INT NOT NULL,
        b INT,
        c INT NULL,
        d INT REFERENCES t(id) NOT NULL,
        e INT NOT NULL REFERENCES t(id),
        f TEXT not
          null DEFAULT 'x',
        "g" INT Not Null
      );`);
    expect(result).toEqual({ id: true, a: true, b: false, c: false, d: true, e: true, f: true, g: true });
  });

  it('treats primary-key columns as NOT NULL even when declared without it', () => {
    expect(notNullByColumn('CREATE TABLE t (id INT PRIMARY KEY, n INT);')).toEqual({ id: true, n: false });
    // Table-level PRIMARY KEY, with and without a CONSTRAINT name.
    expect(notNullByColumn('CREATE TABLE t (id INT, n INT, PRIMARY KEY (id));')).toEqual({ id: true, n: false });
    expect(notNullByColumn('CREATE TABLE t (id INT, n INT, CONSTRAINT pk PRIMARY KEY ("id"));')).toEqual({
      id: true,
      n: false,
    });
  });
});

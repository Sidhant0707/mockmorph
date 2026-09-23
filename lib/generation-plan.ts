/**
 * Turns a ValidatedSemanticMap into a concrete, fully-validated generation
 * plan BEFORE any row is generated or streamed. A structural problem (a
 * foreign key that doesn't actually point at a primary key, a topology
 * that's inconsistent with the FK graph) is caught here, once, up front —
 * never discovered mid-stream after some INSERT statements have already
 * been sent to the client.
 *
 * This is also where the foreign-key bug identified in the forensic audit
 * is fixed: generateTableRows tracks each table's actually-generated
 * primary-key pool in a Map keyed by table name, and every foreign key
 * looks up its own referenced table's pool by name — never "whichever
 * table happened to be generated immediately before this one."
 *
 * A 1:1 table — one whose primary key is also a foreign key, e.g.
 * `user_id INT PRIMARY KEY REFERENCES users(id)` — is a special case of
 * that same lookup: see pkForeignKey below. Its row count is capped to its
 * parent's actual row count here, and generateTableRows draws its keys
 * from the parent's pool instead of minting fresh ones, so it can never
 * plan or generate more rows than the parent has primary keys.
 */

import { randomUUID } from 'crypto';
import type { ValidatedSemanticMap, ValidatedTable } from './schema-analysis';
import type { SemanticType } from './groq';
import { TINYINT_MAX, type ColumnTypeInfo } from './sql-types';

export type Dialect = 'postgres' | 'mysql';

export interface TablePlan {
  table: ValidatedTable;
  rowCount: number;
}

export interface GenerationPlan {
  /** In topological order — parents before children. */
  tables: TablePlan[];
  totalRows: number;
  /** Non-fatal notices about the plan itself (e.g. a row-count cap). Emitted as SQL comments by the caller. */
  warnings: string[];
}

/**
 * A table's primary key can also be a foreign key (a 1:1 table, e.g.
 * `user_id INT PRIMARY KEY REFERENCES users(id)`). Returns that foreign key,
 * or undefined for an ordinary primary key. A self-reference (a PK column
 * that points at its own table) is deliberately excluded here — that is a
 * different, already-handled case (see generateTableRows' self-reference
 * branch) and must keep generating its own fresh keys.
 */
function pkForeignKey(table: ValidatedTable): ValidatedTable['foreignKeys'][number] | undefined {
  if (!table.primaryKey) return undefined;
  return table.foreignKeys.find((fk) => fk.column === table.primaryKey!.column && fk.referencesTable !== table.name);
}

export class PlanValidationError extends Error {
  readonly kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.name = 'PlanValidationError';
    this.kind = kind;
  }
}

export interface RowDistributionLimits {
  baseParentRows: number;
  maxRows: number;
  minRows: number;
}

/**
 * Row distribution policy is unchanged from the original implementation:
 * every table but the last in topology gets a fixed base row count; the
 * last absorbs the remainder up to the requested total. That behaviour is
 * a deliberate, documented product choice, not something this refactor set
 * out to change — what changes here is that it now runs against a topology
 * that is actually guaranteed correct, and is validated before use.
 */
export function buildGenerationPlan(
  map: ValidatedSemanticMap,
  requestedRows: number,
  limits: RowDistributionLimits
): GenerationPlan {
  if (map.topology.length === 0) {
    throw new PlanValidationError('Schema produced no generatable tables.', 'empty_topology');
  }

  const positionOf = new Map(map.topology.map((name, i) => [name, i]));

  for (const name of map.topology) {
    const table = map.tables[name];
    if (!table) {
      throw new PlanValidationError(`Topology references unknown table "${name}".`, 'topology_table_mismatch');
    }
    for (const fk of table.foreignKeys) {
      const parent = map.tables[fk.referencesTable];
      if (!parent) {
        throw new PlanValidationError(
          `${name}.${fk.column} references "${fk.referencesTable}", which has no generation plan.`,
          'missing_parent_table'
        );
      }
      if (!parent.primaryKey || parent.primaryKey.column !== fk.referencesColumn) {
        throw new PlanValidationError(
          `${name}.${fk.column} references ${fk.referencesTable}.${fk.referencesColumn}, which is not that table's primary key. Only foreign keys that reference a primary key are currently supported.`,
          'unsupported_fk_target'
        );
      }
      // A table may reference its own primary key (a hierarchy such as employees.manager_id).
      // That is not an ordering problem: generateTableRows only lets such a key point at rows it
      // has already generated. The primary-key check above has already run, so this is only ever
      // a self-reference to the primary key. Every other FK still needs its parent ordered first.
      if (fk.referencesTable === name) continue;
      const parentPos = positionOf.get(fk.referencesTable);
      const childPos = positionOf.get(name);
      if (parentPos === undefined || childPos === undefined) {
        throw new PlanValidationError(
          `${name}.${fk.column} references "${fk.referencesTable}", which is not part of the resolved topology.`,
          'topology_order_violation'
        );
      }
      if (parentPos >= childPos) {
        // A nullable FK may point at a table generated later (it breaks a circular dependency):
        // generateTableRows emits NULL for it. A NOT NULL FK still needs its parent ordered first.
        if (table.notNull[fk.column] === false) continue;
        throw new PlanValidationError(
          `${name}.${fk.column} references "${fk.referencesTable}", which is not ordered before "${name}" in the resolved topology.`,
          'topology_order_violation'
        );
      }
    }
  }

  const rowCounts = map.topology.map((_, i) => (i === map.topology.length - 1 ? -1 : limits.baseParentRows));
  const allocated = rowCounts.filter((n) => n !== -1).reduce((sum, n) => sum + n, 0);
  const lastIndex = rowCounts.length - 1;
  rowCounts[lastIndex] = Math.max(limits.minRows, requestedRows - allocated);

  // A 1:1 table (its primary key is also a foreign key to another table) can never have more rows
  // than its parent: every row's key must be a distinct key that actually exists in the parent. The
  // ordering check above already guarantees the parent is processed first (its PK column is always
  // NOT NULL, so a 1:1 FK can never use the nullable-cycle exception), so by the time a table is
  // reached here its parent's rowCounts entry is already final — chains (a <- b <- c) cap correctly
  // because each step caps against its own parent's already-capped count.
  const warnings: string[] = [];
  for (let i = 0; i < map.topology.length; i++) {
    const name = map.topology[i];
    const table = map.tables[name];
    const fk = pkForeignKey(table);
    if (!fk) continue;
    const parentPos = positionOf.get(fk.referencesTable);
    if (parentPos === undefined) continue; // already reported as missing_parent_table above
    const parentRows = rowCounts[parentPos];
    if (parentRows < rowCounts[i]) {
      warnings.push(
        `${name}.${fk.column} is a foreign key to "${fk.referencesTable}".${fk.referencesColumn} that is also ${name}'s primary key, so ${name} is capped at ${parentRows} row(s) (matching "${fk.referencesTable}"'s row count) instead of the requested ${rowCounts[i]}.`
      );
      rowCounts[i] = parentRows;
    }
  }

  const tables: TablePlan[] = map.topology.map((name, i) => ({
    table: map.tables[name],
    rowCount: rowCounts[i],
  }));

  return { tables, totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0), warnings };
}

// ---------------------------------------------------------------------------
// Value generation
// ---------------------------------------------------------------------------

interface ValueContext {
  index: number;
  dialect: Dialect;
}

const randomToken = (): string => Math.random().toString(36).substring(2, 9);

type ScalarType = Exclude<SemanticType, 'pk' | 'fk'>;
type ScalarGenerator = (ctx: ValueContext) => string | number;

/**
 * Same fixed template values as the original VALUE_GENERATORS — this
 * refactor did not touch what the fake data looks like, only how table
 * order and foreign keys are derived. Typed as Record<ScalarType, ...> so
 * adding a semantic type in lib/groq.ts fails to compile here until a
 * generator exists for it.
 */
const SCALAR_GENERATORS: Record<ScalarType, ScalarGenerator> = {
  email: ({ index }) => `'user${index}_${randomToken()}@obsidian.corp'`,
  fullname: () => `'Operative ${randomToken().toUpperCase()}'`,
  price: () => (Math.random() * 5000 + 0.01).toFixed(2),
  product: ({ index }) => `'Cyber-Asset MK-${String(index).padStart(3, '0')}'`,
  company: ({ index }) => `'Syndicate ${index} LLC'`,
  phone: () => `'555-01${String(Math.floor(10 + Math.random() * 90)).padStart(2, '0')}'`,
  date: ({ index }) => `'2026-05-${String(((index - 1) % 28) + 1).padStart(2, '0')}'`,
  boolean: ({ dialect }) => {
    const value = Math.random() > 0.5;
    if (dialect === 'mysql') return value ? 1 : 0;
    return value ? 'TRUE' : 'FALSE';
  },
  string: ({ index }) => `'string_val_${index}'`,
};

// ---------------------------------------------------------------------------
// Type-correct values
//
// The declared SQL type decides the SHAPE of a value (an INT column must get
// an integer; a VARCHAR(8) must get at most 8 characters). The semantic type
// above only decides the flavor of TEXT columns. See lib/sql-types.ts.
// ---------------------------------------------------------------------------

const randInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const pad2 = (n: number): string => String(n).padStart(2, '0');

const UNKNOWN_COLUMN: ColumnTypeInfo = { kind: 'unknown', raw: '' };

/**
 * A plain declared-integer column with no useful semantic type still fell
 * back to a flat 1-1000 range (see the module docstring above), so e.g. an
 * `age` column could come out as 876. This maps a short list of common,
 * unambiguous column names to a sensible range. Matching is by whole word
 * (see columnNameTokens), not substring, so "discount" or "account" never
 * match "count".
 *
 * "year" and "count" have no single obvious real-world range; these are
 * picked to be plausible defaults, not authoritative.
 */
const NAMED_INTEGER_RANGES: Record<string, [number, number]> = {
  age: [18, 90],
  quantity: [1, 50],
  rating: [1, 5],
  year: [1990, 2026],
  count: [0, 100],
};

/** Splits a snake_case or camelCase identifier into lowercase word tokens. */
function columnNameTokens(columnName: string): string[] {
  return columnName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A sensible [min, max] for this column name. `maxInt` is only a genuine
 * hard database limit when it's TINYINT_MAX — every other declared integer
 * kind (INT, BIGINT, SMALLINT, SERIAL, ...) shares one maxInt (1000) that is
 * merely this generator's own default ceiling when no name matches, not the
 * column's real capacity, so a named range isn't clamped against it. TINYINT
 * is genuinely narrow, so its named range (e.g. "year", which doesn't fit)
 * is clamped, falling back to undefined — the caller then uses the type's
 * own default range — rather than emitting an out-of-range value.
 */
function namedIntegerRange(columnName: string, maxInt: number): [number, number] | undefined {
  for (const token of columnNameTokens(columnName)) {
    const range = NAMED_INTEGER_RANGES[token];
    if (!range) continue;
    const [min, max] = range;
    if (maxInt > TINYINT_MAX) return [min, max];
    const clampedMax = Math.min(max, maxInt);
    return clampedMax >= min ? [min, clampedMax] : undefined;
  }
  return undefined;
}

/** A DECIMAL/NUMERIC value that fits (precision, scale) — never rounds up past the column's limit. */
function decimalValue(info: ColumnTypeInfo): string {
  const scale = info.scale ?? 2;
  const intDigits = info.precision === undefined ? 4 : info.precision - scale;
  // Postgres 15+ allows scale > precision; then only a tiny fraction fits, and zero always does.
  if (intDigits < 0) return scale === 0 ? '0' : `0.${'0'.repeat(scale)}`;
  // Keep the integer part small (<= 5000) and inside the column's integer digits.
  const intPart = intDigits === 0 ? 0 : randInt(0, Math.min(5000, 10 ** Math.min(intDigits, 4) - 1));
  if (scale === 0) return String(intPart);
  const fraction = Array.from({ length: scale }, () => randInt(0, 9)).join('');
  return `${intPart}.${fraction}`;
}

/**
 * Wraps a semantic generator's output as a string literal that fits the
 * column's declared length. Semantic generators return already-quoted text
 * ('...') for most types but bare numbers/keywords for price and boolean —
 * on a text column all of those must be plain quoted strings.
 */
function toTextLiteral(value: string | number, maxLength: number | undefined): string {
  let text = String(value);
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1);
  if (maxLength !== undefined) text = text.slice(0, maxLength);
  return `'${text.replace(/'/g, "''")}'`;
}

function semanticGenerator(type: SemanticType | undefined): ScalarGenerator {
  return (SCALAR_GENERATORS as Record<string, ScalarGenerator | undefined>)[type ?? ''] ?? SCALAR_GENERATORS.string;
}

function generateColumnValue(
  semanticType: SemanticType | undefined,
  info: ColumnTypeInfo,
  ctx: ValueContext,
  columnName: string
): string | number {
  switch (info.kind) {
    case 'integer': {
      const maxInt = info.maxInt ?? 1000;
      const [min, max] = namedIntegerRange(columnName, maxInt) ?? [1, maxInt];
      return randInt(min, max);
    }
    case 'decimal':
      return decimalValue(info);
    case 'float':
      return (Math.random() * 1000).toFixed(2);
    case 'boolean':
      return SCALAR_GENERATORS.boolean(ctx);
    case 'date':
      return SCALAR_GENERATORS.date(ctx);
    case 'timestamp': {
      const day = pad2(((ctx.index - 1) % 28) + 1);
      return `'2026-05-${day} ${pad2(randInt(0, 23))}:${pad2(randInt(0, 59))}:${pad2(randInt(0, 59))}'`;
    }
    case 'time':
      return `'${pad2(randInt(0, 23))}:${pad2(randInt(0, 59))}:${pad2(randInt(0, 59))}'`;
    case 'uuid':
      return `'${randomUUID()}'`;
    case 'json':
      return `'{"value": ${randInt(1, 1000)}}'`;
    case 'array':
      return `'{}'`;
    case 'text':
      return toTextLiteral(semanticGenerator(semanticType)(ctx), info.maxLength);
    case 'unknown':
    default:
      // Unrecognised type: keep the previous behaviour (semantic template).
      // schema-analysis records a warning for these columns.
      return semanticGenerator(semanticType)(ctx);
  }
}

export type PkPools = Map<string, (number | string)[]>;

/** The SQL literal for a primary-key value taken from a pool: uuids are quoted, integers are not. */
const keyLiteral = (pk: number | string): string | number => (typeof pk === 'string' ? `'${pk}'` : pk);

/** Share of a nullable self-referencing column that is NULL (after the first row), so the data is a forest, not one tree. */
const SELF_REFERENCE_NULL_SHARE = 0.2;

/**
 * The value of a column that references its own table's primary key.
 *
 * It may only point at a row generated EARLIER in the same table (`earlierPks`). InnoDB checks foreign
 * keys row by row inside a multi-row INSERT, while Postgres checks at the end of the statement, so
 * "earlier rows only" is valid on both. Because no row can point forward, the data can never contain
 * a cycle.
 *
 *   - nullable column: the first row is a root (NULL); later rows are NULL about 20% of the time
 *   - NOT NULL column: the first row points at itself (Postgres accepts that; MySQL's behavior for
 *     a self-referencing first row has not been verified); later rows point at an earlier row
 */
function selfReferenceValue(
  earlierPks: readonly (number | string)[],
  ownPk: number | string,
  nullable: boolean
): string | number {
  if (earlierPks.length === 0) return nullable ? 'NULL' : keyLiteral(ownPk);
  if (nullable && Math.random() < SELF_REFERENCE_NULL_SHARE) return 'NULL';
  return keyLiteral(earlierPks[Math.floor(Math.random() * earlierPks.length)]);
}

/**
 * Generates one table's rows, mutating `pkPools` with this table's newly
 * generated primary keys as it goes. A foreign key's value is chosen by
 * looking up `pkPools.get(fk.referencesTable)` — the actual referenced
 * table, resolved by name — never an adjacent or "previous" table. Because
 * buildGenerationPlan already guarantees every FK's parent appears earlier
 * in `map.topology`, that parent's pool is always already populated by the
 * time a child table is generated, however many tables separate them.
 *
 * Two exceptions:
 *   - A foreign key that references this same table: its "parent" is the table's own pool, which
 *     only ever holds the rows generated so far (see selfReferenceValue).
 *   - A nullable foreign key whose parent is generated later (a cycle broken by a nullable column):
 *     the parent's pool is still empty, so the value is NULL.
 */
export function* generateTableRows(
  plan: TablePlan,
  dialect: Dialect,
  pkPools: PkPools
): Generator<Record<string, string | number>> {
  const { table, rowCount } = plan;
  const pool: (number | string)[] = [];
  pkPools.set(table.name, pool);

  // A 1:1 table's own primary key IS a foreign key to another table (see pkForeignKey in
  // buildGenerationPlan, which also guarantees rowCount <= the parent's actual pool size). Its rows
  // take the parent's first `rowCount` keys, in the parent's own generation order — the simplest
  // subset to pick: no extra sampling or shuffling step, and it keeps a chain (a <- b <- c) trivially
  // consistent, since each table's pool is then a prefix of its parent's.
  const oneToOnePkFk = pkForeignKey(table);
  let oneToOneParentPool: readonly (number | string)[] | undefined;
  if (oneToOnePkFk) {
    oneToOneParentPool = pkPools.get(oneToOnePkFk.referencesTable);
    if (!oneToOneParentPool) {
      // buildGenerationPlan's ordering check makes this unreachable for a PK-is-FK column (it is
      // always NOT NULL, so it never gets the nullable-cycle exception); kept as a hard stop rather
      // than silently generating a fresh, unrelated key instead of one that exists in the parent.
      throw new Error(
        `${table.name}.${table.primaryKey!.column} references "${oneToOnePkFk.referencesTable}", which has no generated primary keys yet.`
      );
    }
  }

  for (let i = 1; i <= rowCount; i++) {
    const row: Record<string, string | number> = {};

    // The row's own key is chosen before any column is filled in, so it does not matter where the key
    // column is declared (`manager_id` may come before `id`). It joins the pool only once the row is
    // complete, which is what keeps a self-reference from pointing at the current or a later row.
    let ownPk: number | string | undefined = table.primaryKey
      ? table.primaryKey.kind === 'uuid'
        ? randomUUID()
        : i
      : undefined;

    if (oneToOneParentPool) {
      if (oneToOneParentPool.length < i) {
        // buildGenerationPlan's cap makes this unreachable; kept as a hard stop rather than
        // fabricating a key that does not exist in the parent.
        throw new Error(
          `${table.name}.${table.primaryKey!.column} needs row ${i} of "${table.name}", but its parent only has ${oneToOneParentPool.length} generated primary key(s).`
        );
      }
      ownPk = oneToOneParentPool[i - 1];
    }

    for (const colName of table.columns) {
      if (table.primaryKey && colName === table.primaryKey.column) {
        row[colName] = keyLiteral(ownPk as number | string);
        continue;
      }

      const fk = table.foreignKeys.find((f) => f.column === colName);
      if (fk) {
        if (fk.referencesTable === table.name) {
          if (ownPk === undefined) {
            // buildGenerationPlan rejects a self-reference on a table with no primary key.
            throw new Error(`${table.name}.${colName} references its own table, which has no primary key.`);
          }
          row[colName] = selfReferenceValue(pool, ownPk, table.notNull[colName] === false);
          continue;
        }
        const parentPool = pkPools.get(fk.referencesTable) ?? [];
        if (parentPool.length === 0) {
          // A nullable FK to a later-generated parent (cycle broken by this column): NULL is the only valid value.
          if (table.notNull[colName] === false) {
            row[colName] = 'NULL';
            continue;
          }
          // buildGenerationPlan's ordering check makes this unreachable for a NOT NULL FK; kept as
          // a hard stop rather than emitting a fabricated value if that invariant is ever violated.
          throw new Error(
            `No generated primary keys available for "${fk.referencesTable}" when generating ${table.name}.${colName}.`
          );
        }
        row[colName] = keyLiteral(parentPool[Math.floor(Math.random() * parentPool.length)]);
        continue;
      }

      row[colName] = generateColumnValue(
        table.columnTypes[colName],
        table.columnInfo[colName] ?? UNKNOWN_COLUMN,
        { index: i, dialect },
        colName
      );
    }

    if (ownPk !== undefined) pool.push(ownPk);
    yield row;
  }
}
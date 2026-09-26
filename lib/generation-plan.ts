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

/**
 * UNIQUE foreign keys other than the table's own primary key — the common `user_id INT UNIQUE
 * REFERENCES users(id)` pattern. Like pkForeignKey, a self-reference is excluded: a self-FK
 * marked UNIQUE keeps its existing (unenforced) behavior — see the warning schema-analysis.ts
 * emits for that case — rather than a second sampling mechanism on top of selfReferenceValue.
 */
function uniqueForeignKeys(table: ValidatedTable): ValidatedTable['foreignKeys'] {
  return table.foreignKeys.filter(
    (fk) =>
      table.uniqueColumns.includes(fk.column) &&
      fk.referencesTable !== table.name &&
      !(table.primaryKey && fk.column === table.primaryKey.column)
  );
}

/**
 * UNIQUE columns that hold an ordinary generated value rather than a key: not the primary key,
 * and not any foreign key (an ordinary UNIQUE foreign key is handled by uniqueForeignKeys above;
 * a self-referencing one keeps its old, unenforced behavior — see uniqueForeignKeys).
 */
function valueOnlyUniqueColumns(table: ValidatedTable): string[] {
  return table.uniqueColumns.filter(
    (col) =>
      !(table.primaryKey && col === table.primaryKey.column) && !table.foreignKeys.some((fk) => fk.column === col)
  );
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

  // A table's row count can be capped for three reasons, all handled here in one pass, in
  // topology order (parents before children), so a chain (a <- b <- c) caps correctly at every
  // level — by the time a table is reached here, everything it could depend on (a parent's row
  // count) is already final:
  //   1. A 1:1 table (its primary key is also a foreign key to another table) can never have
  //      more rows than its parent: every row's key must be a distinct key that really exists
  //      in the parent.
  //   2. A UNIQUE foreign key that is not the primary key (e.g. `user_id INT UNIQUE REFERENCES
  //      users(id)`) is the same idea, generalized: it also samples the parent's keys without
  //      replacement, so it is capped the same way.
  //   3. A UNIQUE value-only column (no foreign key involved) is capped when its declared SQL
  //      type has too small a value space for the requested row count (e.g. BOOLEAN UNIQUE,
  //      a narrow VARCHAR(n) UNIQUE) — capping, rather than rejecting the whole request, is the
  //      same choice already made for (1) and (2), applied consistently here too.
  const warnings: string[] = [];
  for (let i = 0; i < map.topology.length; i++) {
    const name = map.topology[i];
    const table = map.tables[name];
    const reasons: { cap: number; message: string }[] = [];

    const pkFk = pkForeignKey(table);
    if (pkFk) {
      const parentPos = positionOf.get(pkFk.referencesTable);
      if (parentPos !== undefined) {
        // already reported as missing_parent_table above if undefined
        const parentRows = rowCounts[parentPos];
        reasons.push({
          cap: parentRows,
          message: `${name}.${pkFk.column} is a foreign key to "${pkFk.referencesTable}".${pkFk.referencesColumn} that is also ${name}'s primary key, so ${name} is capped at ${parentRows} row(s) (matching "${pkFk.referencesTable}"'s row count) instead of the requested ${rowCounts[i]}.`,
        });
      }
    }

    for (const uniqueFk of uniqueForeignKeys(table)) {
      const parentPos = positionOf.get(uniqueFk.referencesTable);
      if (parentPos === undefined) continue; // already reported as missing_parent_table above
      // A nullable FK whose parent is ordered after this table breaks a cycle and is always
      // generated as NULL (see analyzeStructure / generateTableRows); a NOT NULL FK can only
      // reach this point with its parent already ordered earlier (guaranteed by the ordering
      // check above), so this can only be that cycle-break case. NULLs never collide, so no cap.
      if (parentPos >= i) continue;
      const parentRows = rowCounts[parentPos];
      reasons.push({
        cap: parentRows,
        message: `${name}.${uniqueFk.column} is a UNIQUE foreign key to "${uniqueFk.referencesTable}".${uniqueFk.referencesColumn}, so ${name} is capped at ${parentRows} row(s) (matching "${uniqueFk.referencesTable}"'s row count) instead of the requested ${rowCounts[i]}.`,
      });
    }

    for (const colName of valueOnlyUniqueColumns(table)) {
      const info = table.columnInfo[colName] ?? UNKNOWN_COLUMN;
      // Dialect does not affect capacity (only how a value is formatted), so a fixed dialect is
      // fine here; generateTableRows recomputes the domain with the real dialect for the values.
      const domain = uniqueDomainForColumn(info, colName, 'postgres');
      if (!domain || domain.capacity >= rowCounts[i]) continue;
      reasons.push({
        cap: domain.capacity,
        message: `${name}.${colName} is UNIQUE, but its declared type only has room for ${domain.capacity} distinct value(s), so ${name} is capped at ${domain.capacity} row(s) instead of the requested ${rowCounts[i]}.`,
      });
    }

    if (reasons.length === 0) continue;
    const newCount = Math.min(rowCounts[i], ...reasons.map((r) => r.cap));
    if (newCount < rowCounts[i]) {
      for (const r of reasons) {
        if (r.cap === newCount) warnings.push(r.message);
      }
      rowCounts[i] = newCount;
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

// ---------------------------------------------------------------------------
// UNIQUE value generation
//
// generateColumnValue above picks each value independently, so nothing stops
// two rows from colliding — fine for an ordinary column, not for one declared
// UNIQUE. A UNIQUE column instead draws from a small, explicit "domain": the
// finite set of distinct values this generator is willing to produce for that
// SQL type. uniqueDomainForColumn reports that domain's size (its `capacity`)
// so buildGenerationPlan can cap a table's row count up front — the same
// choice it already makes for a 1:1 table's PK-that-is-FK — and reports a
// function from a distinct index to the row's actual SQL literal.
//
// UNIQUE text columns are a deliberate special case: generating within the
// declared VARCHAR(n)/CHAR(n) length from the start (rather than generating a
// normal semantic-flavored value and truncating it afterward) is the only way
// to guarantee two rows can't collide once Postgres itself truncates/compares
// them — the exact bug in the report (a `phone`/`email`-flavored value that
// only "happened" to stay distinct). The trade-off is that a UNIQUE text
// column loses its semantic flavor (no more obsidian.corp emails); applying
// that uniformly, regardless of length, was chosen over a second code path
// that only kicks in for narrow columns.
// ---------------------------------------------------------------------------

interface UniqueDomain {
  /** How many distinct values this generator can produce for this column. */
  capacity: number;
  /** Maps a distinct index in [0, capacity) to the row's SQL literal (quoted where needed). */
  valueAt: (index: number) => string | number;
}

/** Fixed alphabet for UNIQUE text values: digits + lowercase letters (base 36). */
const UNIQUE_TEXT_ALPHABET_SIZE = 36;
/**
 * Generation length used for a UNIQUE text column with no declared length, or one longer than
 * this. 36**10 (~3.66e15) is comfortably within a safe integer and gives a domain no realistic
 * row count will ever reach, while keeping the generated token short.
 */
const UNIQUE_TEXT_DEFAULT_LEN = 10;

function uniqueTextDomain(maxLength: number | undefined): UniqueDomain {
  const length = maxLength === undefined ? UNIQUE_TEXT_DEFAULT_LEN : Math.min(Math.max(maxLength, 0), UNIQUE_TEXT_DEFAULT_LEN);
  if (length === 0) return { capacity: 1, valueAt: () => `''` };
  const capacity = UNIQUE_TEXT_ALPHABET_SIZE ** length;
  return { capacity, valueAt: (index) => `'${index.toString(36).padStart(length, '0')}'` };
}

function uniqueIntegerDomain(info: ColumnTypeInfo, columnName: string): UniqueDomain {
  const maxInt = info.maxInt ?? 1000;
  const [min, max] = namedIntegerRange(columnName, maxInt) ?? [1, maxInt];
  return { capacity: max - min + 1, valueAt: (index) => min + index };
}

/** Same (precision, scale) reasoning as decimalValue, but as an enumerable, capacity-bounded space. */
function uniqueDecimalDomain(info: ColumnTypeInfo): UniqueDomain {
  const scale = info.scale ?? 2;
  const intDigits = info.precision === undefined ? 4 : info.precision - scale;
  if (intDigits < 0) {
    const onlyValue = scale === 0 ? '0' : `0.${'0'.repeat(scale)}`;
    return { capacity: 1, valueAt: () => onlyValue };
  }
  const intRange = intDigits === 0 ? 1 : Math.min(5001, 10 ** Math.min(intDigits, 4));
  const fracRange = scale === 0 ? 1 : 10 ** Math.min(scale, 4);
  return {
    capacity: intRange * fracRange,
    valueAt: (index) => {
      const intPart = Math.floor(index / fracRange);
      return scale === 0 ? String(intPart) : `${intPart}.${String(index % fracRange).padStart(scale, '0')}`;
    },
  };
}

/** Same 0.00-999.99 range as generateColumnValue's plain float generator, enumerated in cent steps. */
function uniqueFloatDomain(): UniqueDomain {
  return { capacity: 100_000, valueAt: (index) => (index / 100).toFixed(2) };
}

function uniqueBooleanDomain(dialect: Dialect): UniqueDomain {
  return {
    capacity: 2,
    valueAt: (index) => {
      if (dialect === 'mysql') return index === 0 ? 1 : 0;
      return index === 0 ? 'TRUE' : 'FALSE';
    },
  };
}

/**
 * A UNIQUE DATE column deliberately gets a much wider range than generateColumnValue's plain
 * dates (a fixed 28-day month): 20,000 days (~54 years) so realistic row counts are never capped,
 * while staying a real, finite domain rather than pretending it is unlimited.
 */
const UNIQUE_DATE_CAPACITY = 20_000;
const UNIQUE_DATE_BASE_MS = Date.UTC(2000, 0, 1);
function uniqueDateDomain(): UniqueDomain {
  return {
    capacity: UNIQUE_DATE_CAPACITY,
    valueAt: (index) => `'${new Date(UNIQUE_DATE_BASE_MS + index * 86_400_000).toISOString().slice(0, 10)}'`,
  };
}

/** One-second increments from a fixed epoch: ~1.5 years of distinct timestamps. */
const UNIQUE_TIMESTAMP_CAPACITY = 50_000_000;
const UNIQUE_TIMESTAMP_BASE_MS = Date.UTC(2000, 0, 1, 0, 0, 0);
function uniqueTimestampDomain(): UniqueDomain {
  return {
    capacity: UNIQUE_TIMESTAMP_CAPACITY,
    valueAt: (index) => {
      const iso = new Date(UNIQUE_TIMESTAMP_BASE_MS + index * 1000).toISOString();
      return `'${iso.slice(0, 10)} ${iso.slice(11, 19)}'`;
    },
  };
}

/** One-second increments across a single day. */
function uniqueTimeDomain(): UniqueDomain {
  return {
    capacity: 86_400,
    valueAt: (index) => `'${pad2(Math.floor(index / 3600))}:${pad2(Math.floor((index % 3600) / 60))}:${pad2(index % 60)}'`,
  };
}

/**
 * The UNIQUE domain for a column's declared kind, or null if this module cannot guarantee
 * distinct values for that kind (json, array, unknown — schema-analysis already warns about
 * these; the column keeps generateColumnValue's ordinary, unenforced behavior) or if the kind
 * has no meaningful capacity to cap on (uuid — see generateDistinctUuids instead, which sidesteps
 * this abstraction entirely since a UUID's "domain" isn't something worth enumerating).
 */
function uniqueDomainForColumn(info: ColumnTypeInfo, columnName: string, dialect: Dialect): UniqueDomain | null {
  switch (info.kind) {
    case 'integer':
      return uniqueIntegerDomain(info, columnName);
    case 'decimal':
      return uniqueDecimalDomain(info);
    case 'float':
      return uniqueFloatDomain();
    case 'boolean':
      return uniqueBooleanDomain(dialect);
    case 'date':
      return uniqueDateDomain();
    case 'timestamp':
      return uniqueTimestampDomain();
    case 'time':
      return uniqueTimeDomain();
    case 'text':
      return uniqueTextDomain(info.maxLength);
    case 'uuid':
    case 'json':
    case 'array':
    case 'unknown':
    default:
      return null;
  }
}

/**
 * `count` distinct indices drawn from [0, capacity). Below the threshold, a full shuffled
 * permutation is cheap and also correct when count is close to capacity (the domain-too-small
 * cap in buildGenerationPlan guarantees count <= capacity, so "close to capacity" does happen —
 * e.g. a BOOLEAN UNIQUE column always asks for all of its 2 values). Above the threshold,
 * materializing the full domain would be wasteful or impossible (a wide UNIQUE text column's
 * domain is in the trillions), but count is always tiny relative to capacity there, so random
 * retries with a Set converge immediately.
 */
const FULL_SHUFFLE_THRESHOLD = 200_000;
function sampleDistinctIndices(capacity: number, count: number): number[] {
  if (capacity <= FULL_SHUFFLE_THRESHOLD) {
    const indices = Array.from({ length: capacity }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count);
  }
  const seen = new Set<number>();
  while (seen.size < count) seen.add(Math.floor(Math.random() * capacity));
  return Array.from(seen);
}

/** `count` distinct UUIDs. Collisions are astronomically unlikely; guarded anyway for a real guarantee. */
function generateDistinctUuids(count: number): string[] {
  const seen = new Set<string>();
  while (seen.size < count) seen.add(randomUUID());
  return Array.from(seen, (id) => `'${id}'`);
}

/**
 * Pre-generates every value-only UNIQUE column's full set of distinct values for one table, up
 * front, before any row is built — the same reason PK pools and 1:1 parent pools are built ahead
 * of the per-row loop: an individual row can't know, by itself, whether its value collides with
 * a row generated later. `rowCount` is assumed already capacity-capped by buildGenerationPlan.
 */
function buildUniqueValuePools(table: ValidatedTable, rowCount: number, dialect: Dialect): Map<string, (string | number)[]> {
  const pools = new Map<string, (string | number)[]>();
  for (const colName of valueOnlyUniqueColumns(table)) {
    const info = table.columnInfo[colName] ?? UNKNOWN_COLUMN;
    if (info.kind === 'uuid') {
      pools.set(colName, generateDistinctUuids(rowCount));
      continue;
    }
    const domain = uniqueDomainForColumn(info, colName, dialect);
    if (!domain) continue; // unsupported kind — schema-analysis already warned; old behavior stands
    pools.set(colName, sampleDistinctIndices(domain.capacity, rowCount).map(domain.valueAt));
  }
  return pools;
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

  // Every value-only UNIQUE column's full, distinct value set — see buildUniqueValuePools.
  const uniqueValuePools = buildUniqueValuePools(table, rowCount, dialect);

  // Every UNIQUE (non-PK) foreign key's assignment: `rowCount` distinct parent keys, shuffled
  // once up front (buildGenerationPlan already guarantees rowCount <= the parent's pool size —
  // the same cap it applies to a 1:1 table's PK-that-is-FK). A nullable FK whose parent hasn't
  // been generated yet (the parent pool is still empty) is left out here on purpose: that is the
  // cycle-break case below, where every row of the column is NULL regardless, and NULLs never
  // collide, so there is nothing to sample.
  const uniqueFkPools = new Map<string, readonly (number | string)[]>();
  for (const uniqueFk of uniqueForeignKeys(table)) {
    const parentPool = pkPools.get(uniqueFk.referencesTable);
    if (!parentPool || parentPool.length === 0) continue;
    const shuffled = parentPool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    uniqueFkPools.set(uniqueFk.column, shuffled.slice(0, rowCount));
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
        const uniqueFkPool = uniqueFkPools.get(colName);
        if (uniqueFkPool) {
          row[colName] = keyLiteral(uniqueFkPool[i - 1]);
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

      const uniqueValuePool = uniqueValuePools.get(colName);
      row[colName] =
        uniqueValuePool !== undefined
          ? uniqueValuePool[i - 1]
          : generateColumnValue(table.columnTypes[colName], table.columnInfo[colName] ?? UNKNOWN_COLUMN, { index: i, dialect }, colName);
    }

    if (ownPk !== undefined) pool.push(ownPk);
    yield row;
  }
}
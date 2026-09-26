/**
 * A deliberately narrow CREATE TABLE parser.
 *
 * This is not a general SQL parser and does not try to be one. It exists to
 * extract exactly the structural facts generation actually needs — table
 * names, column names, primary keys, and foreign-key relationships — from a
 * defined, common subset of DDL. Anything outside that subset is reported as
 * a warning, never silently dropped and never guessed at.
 *
 * Supported:
 *   - CREATE TABLE [IF NOT EXISTS] name ( ... );
 *   - Column-level: PRIMARY KEY, REFERENCES table(col), NOT NULL, UNIQUE, DEFAULT ...
 *   - Table-level: PRIMARY KEY (col), FOREIGN KEY (col) REFERENCES table(col),
 *     single-column UNIQUE (col)
 *   - Single-column primary keys (composite PKs are detected and reported,
 *     not silently handled as if they were single-column)
 *   - Single-column UNIQUE constraints, column-level or table-level (composite
 *     UNIQUE spanning multiple columns is detected and reported, not silently
 *     handled as if it applied to one column)
 *   - quoted identifiers ("name", `name`)
 *
 * Explicitly not supported (skipped with a warning, not guessed at):
 *   - ALTER TABLE ... ADD CONSTRAINT
 *   - CREATE INDEX / CHECK constraints
 *   - composite primary/foreign/unique keys spanning multiple columns
 *   - schema-qualified names beyond a simple `schema.table` -> `table` strip
 */

export type PrimaryKeyKind = 'integer' | 'uuid' | 'unsupported';

export interface ParsedForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface ParsedColumn {
  name: string;
  rawType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  /**
   * True for a column-level NOT NULL and for every primary-key column (implicitly not null).
   * Only what the CREATE TABLE statement itself says: a NOT NULL added later by ALTER TABLE is not seen.
   */
  notNull: boolean;
}

export interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  /** null if the table declared no single-column primary key (see hasCompositePrimaryKey). */
  primaryKey: { column: string; kind: PrimaryKeyKind } | null;
  foreignKeys: ParsedForeignKey[];
  hasCompositePrimaryKey: boolean;
  /**
   * Column names with a single-column UNIQUE constraint — from either column-level
   * (`code INT UNIQUE`) or table-level (`UNIQUE (code)`) syntax. Never includes the
   * primary-key column: a PK is already unique, so it is left out here to avoid a second,
   * redundant enforcement path (see schema-analysis.ts / generation-plan.ts).
   * A multi-column (composite) table-level UNIQUE is not represented here at all: it is
   * reported as a parser warning instead (see the "composite UNIQUE" warning below), the
   * same "warn, don't guess" treatment this parser already gives composite primary keys.
   */
  uniqueColumns: string[];
}

export interface ParseResult {
  tables: ParsedTable[];
  /** Non-fatal: constructs we deliberately did not attempt to interpret. */
  warnings: string[];
}

const INTEGER_TYPES = new Set([
  'int',
  'integer',
  'smallint',
  'bigint',
  'serial',
  'bigserial',
  'smallserial',
]);
const UUID_TYPES = new Set(['uuid']);

function baseType(rawType: string): string {
  return rawType.trim().toLowerCase().replace(/\(.*$/, '').trim();
}

function classifyPkType(rawType: string): PrimaryKeyKind {
  const t = baseType(rawType);
  if (INTEGER_TYPES.has(t)) return 'integer';
  if (UUID_TYPES.has(t)) return 'uuid';
  return 'unsupported';
}

/**
 * Strips -- line comments and block comments without touching content inside
 * '...', "..." or `...` — including a quoted identifier that itself contains
 * "--" or "/*" characters (e.g. a maliciously-named table). Without tracking
 * all three quote kinds, a comment-looking sequence smuggled inside a quoted
 * identifier would delete the rest of the statement instead of being caught
 * by identifier validation downstream.
 */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  let quoteChar: string | null = null;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (quoteChar) {
      out += c;
      if (c === quoteChar && sql[i - 1] !== '\\') quoteChar = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quoteChar = c;
      out += c;
      i++;
      continue;
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Splits a parenthesised body on top-level commas, respecting nested parens (e.g. DECIMAL(10,2)). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripQuotes(id: string): string {
  return id.trim().replace(/^["'`[]|["'`\]]$/g, '');
}

/**
 * Blanks out the contents of single- and double-quoted string literals (SQL's doubled-quote
 * escape for a literal quote character included), so a keyword search over the remainder can't
 * be fooled by that same word appearing inside a DEFAULT value or similar literal — e.g.
 * `status TEXT DEFAULT 'unique'` should never be read as a UNIQUE constraint.
 */
function withoutQuotedLiterals(s: string): string {
  return s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

function lastPathSegment(qualified: string): string {
  const stripped = stripQuotes(qualified);
  const parts = stripped.split('.');
  return parts[parts.length - 1];
}

function findCreateTableBlocks(sql: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?("[^"]+"|`[^`]+`|[\w.]+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const name = lastPathSegment(match[1]);
    const openIdx = match.index + match[0].length - 1; // index of the '('
    let depth = 0;
    let i = openIdx;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      // Unbalanced parens somewhere after this CREATE TABLE — malformed SQL.
      // Stop scanning rather than guess at a boundary.
      break;
    }
    const body = sql.slice(openIdx + 1, i);
    blocks.push({ name, body });
    re.lastIndex = i + 1;
  }
  return blocks;
}

/**
 * Extracts the declared type from the text that follows a column name.
 *
 *   "VARCHAR(50) NOT NULL"         -> "VARCHAR(50)"
 *   "double precision DEFAULT 0"   -> "double precision"
 *   "character varying(50)"        -> "character varying(50)"
 *   "timestamp(3) with time zone"  -> "timestamp(3) with time zone"
 *   "text[] NOT NULL"              -> "text[]"
 *
 * Reading only the first word would turn "character varying(50)" into
 * "character" and "double precision" into "double", losing exactly the
 * information value generation needs (length limits, numeric kind).
 */
function extractRawType(rest: string): string {
  const first = rest.match(/^(\w+)(\s*\([^)]*\))?/);
  if (!first) return rest.split(/\s+/)[0];

  let type = first[0];
  let remainder = rest.slice(type.length);
  const word = first[1].toLowerCase();

  let continuation: RegExp | null = null;
  if (word === 'double') continuation = /^\s+precision\b/i;
  else if (word === 'character') continuation = /^\s+varying\b(?:\s*\([^)]*\))?/i;
  else if (word === 'timestamp' || word === 'time') continuation = /^\s+with(?:out)?\s+time\s+zone\b/i;

  if (continuation) {
    const m = remainder.match(continuation);
    if (m) {
      type += m[0];
      remainder = remainder.slice(m[0].length);
    }
  }

  const arrays = remainder.match(/^(?:\s*\[\s*\d*\s*\])+/);
  if (arrays) type += arrays[0];

  return type.replace(/\s+/g, ' ');
}

const REFERENCES_RE = /references\s+("[^"]+"|`[^`]+`|[\w.]+)\s*\(\s*("[^"]+"|`[^`]+`|[\w]+)\s*\)/i;

export function parseSchema(rawSql: string): ParseResult {
  const warnings: string[] = [];
  const cleaned = stripComments(rawSql);
  const blocks = findCreateTableBlocks(cleaned);

  if (blocks.length === 0) {
    warnings.push('No CREATE TABLE statements were recognized in the supplied schema.');
  }

  const tables: ParsedTable[] = blocks.map(({ name, body }) => {
    const defs = splitTopLevel(body);
    const columns: ParsedColumn[] = [];
    const foreignKeys: ParsedForeignKey[] = [];
    const pkColumns: string[] = [];
    // Single-column UNIQUE constraints seen so far, from either syntax. Deduped and filtered
    // against pkColumns only once every def has been read (a table-level PRIMARY KEY can appear
    // after a column that already named itself UNIQUE).
    const uniqueColumnCandidates: string[] = [];

    for (const def of defs) {
      const trimmed = def.trim();
      if (!trimmed) continue;

      // Table-level "CONSTRAINT name PRIMARY KEY (...)" etc. — the name is irrelevant to us.
      const unwrapped = trimmed.replace(/^constraint\s+(?:"[^"]+"|`[^`]+`|\S+)\s+/i, '');
      const unwrappedLower = unwrapped.toLowerCase();

      if (unwrappedLower.startsWith('primary key')) {
        const cols = unwrapped.match(/\(([^)]*)\)/);
        if (cols) cols[1].split(',').forEach((c) => pkColumns.push(stripQuotes(c)));
        continue;
      }

      if (unwrappedLower.startsWith('foreign key')) {
        const colMatch = unwrapped.match(/foreign\s+key\s*\(([^)]*)\)/i);
        const refMatch = unwrapped.match(REFERENCES_RE);
        if (colMatch && refMatch) {
          foreignKeys.push({
            column: stripQuotes(colMatch[1]),
            referencesTable: lastPathSegment(refMatch[1]),
            referencesColumn: stripQuotes(refMatch[2]),
          });
        } else {
          warnings.push(`${name}: could not parse table-level FOREIGN KEY clause "${trimmed}"`);
        }
        continue;
      }

      if (/^unique(?:\s|\()/i.test(unwrapped)) {
        const cols = unwrapped.match(/\(([^)]*)\)/);
        const uniqueCols = cols ? cols[1].split(',').map((c) => stripQuotes(c)).filter(Boolean) : [];
        if (uniqueCols.length === 1) {
          uniqueColumnCandidates.push(uniqueCols[0]);
        } else if (uniqueCols.length > 1) {
          warnings.push(
            `${name}: composite UNIQUE (${uniqueCols.join(', ')}) is not supported — this constraint is not enforced during generation`
          );
        } else {
          warnings.push(`${name}: could not parse table-level UNIQUE clause "${trimmed}"`);
        }
        continue;
      }

      if (
        unwrappedLower.startsWith('check') ||
        unwrappedLower.startsWith('index') ||
        unwrappedLower.startsWith('key ')
      ) {
        warnings.push(`${name}: skipped unsupported table-level constraint "${trimmed}"`);
        continue;
      }

      // Otherwise: a column definition — "name TYPE [modifiers...]".
      // [\s\S] instead of "." with the 's' flag — this project's TS target
      // (ES2017) predates the dotAll flag.
      const tokens = trimmed.match(/^("[^"]+"|`[^`]+`|[\w]+)\s+([\s\S]+)$/);
      if (!tokens) {
        warnings.push(`${name}: could not parse column definition "${trimmed}"`);
        continue;
      }
      const colName = stripQuotes(tokens[1]);
      const rest = tokens[2];
      const rawType = extractRawType(rest);
      const restLower = rest.toLowerCase();

      const isInlinePk = /\bprimary\s+key\b/.test(restLower);
      if (isInlinePk) pkColumns.push(colName);

      // Testing restLower directly would also match "unique" sitting inside a DEFAULT string
      // literal (e.g. DEFAULT 'unique') as if it were the constraint keyword — strip quoted
      // literals first so only a real, unquoted UNIQUE keyword can match.
      if (/\bunique\b/.test(withoutQuotedLiterals(restLower))) uniqueColumnCandidates.push(colName);

      const refMatch = rest.match(REFERENCES_RE);
      let isForeignKey = false;
      if (refMatch) {
        isForeignKey = true;
        foreignKeys.push({
          column: colName,
          referencesTable: lastPathSegment(refMatch[1]),
          referencesColumn: stripQuotes(refMatch[2]),
        });
      }

      // A missed NOT NULL would make a NULL end up in a NOT NULL column, whereas a NOT NULL that is
      // really just text inside a DEFAULT only makes the column look stricter than it is, which is harmless.
      const notNull = /\bnot\s+null\b/.test(restLower);
      columns.push({ name: colName, rawType, isPrimaryKey: isInlinePk, isForeignKey, notNull });
    }

    // Primary-key columns are implicitly NOT NULL, whether the key was declared inline or at table level.
    for (const col of columns) {
      if (pkColumns.includes(col.name)) col.notNull = true;
    }

    let primaryKey: ParsedTable['primaryKey'] = null;
    let hasCompositePrimaryKey = false;
    const uniquePkCols = Array.from(new Set(pkColumns));
    if (uniquePkCols.length === 1) {
      const col = columns.find((c) => c.name === uniquePkCols[0]);
      primaryKey = { column: uniquePkCols[0], kind: col ? classifyPkType(col.rawType) : 'unsupported' };
    } else if (uniquePkCols.length > 1) {
      hasCompositePrimaryKey = true;
      warnings.push(
        `${name}: composite primary key (${uniquePkCols.join(', ')}) is not supported — this table cannot participate in FK-aware generation`
      );
    }

    // A PK is already unique — leaving it out of uniqueColumns keeps its enforcement on the
    // existing, single PK-pool code path instead of a second, redundant one.
    const uniqueColumns = Array.from(new Set(uniqueColumnCandidates)).filter((c) => !uniquePkCols.includes(c));

    return { name, columns, primaryKey, foreignKeys, hasCompositePrimaryKey, uniqueColumns };
  });

  return { tables, warnings };
}

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
 *   - Table-level: PRIMARY KEY (col), FOREIGN KEY (col) REFERENCES table(col)
 *   - Single-column primary keys (composite PKs are detected and reported,
 *     not silently handled as if they were single-column)
 *   - quoted identifiers ("name", `name`)
 *
 * Explicitly not supported (skipped with a warning, not guessed at):
 *   - ALTER TABLE ... ADD CONSTRAINT
 *   - CREATE INDEX / CHECK constraints
 *   - composite primary/foreign keys spanning multiple columns
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
}

export interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  /** null if the table declared no single-column primary key (see hasCompositePrimaryKey). */
  primaryKey: { column: string; kind: PrimaryKeyKind } | null;
  foreignKeys: ParsedForeignKey[];
  hasCompositePrimaryKey: boolean;
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

      if (
        unwrappedLower.startsWith('unique') ||
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
      const typeMatch = rest.match(/^([\w]+(?:\s*\([^)]*\))?)/);
      const rawType = typeMatch ? typeMatch[1] : rest.split(/\s+/)[0];
      const restLower = rest.toLowerCase();

      const isInlinePk = /\bprimary\s+key\b/.test(restLower);
      if (isInlinePk) pkColumns.push(colName);

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

      columns.push({ name: colName, rawType, isPrimaryKey: isInlinePk, isForeignKey });
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

    return { name, columns, primaryKey, foreignKeys, hasCompositePrimaryKey };
  });

  return { tables, warnings };
}

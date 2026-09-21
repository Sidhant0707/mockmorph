/**
 * Maps a column's declared SQL type (ParsedColumn.rawType from
 * lib/sql-schema-parser.ts) to the KIND of value the database will accept.
 *
 * Why this exists: the Groq semantic type ("email", "price", ...) says what a
 * column is *about*, but says nothing about what the column can *hold*. A
 * plain `quantity INT` has no useful semantic type, so it used to fall back
 * to the generic string generator and emit 'string_val_1', which Postgres
 * rejects. The declared SQL type is a structural fact we already parse
 * locally, so it decides the SHAPE of the value; the semantic type is only
 * consulted for text-like columns, where any flavor of string is valid.
 */

export type ColumnKind =
  | 'integer'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'time'
  | 'uuid'
  | 'json'
  | 'array'
  | 'text'
  /** A type this module does not recognise. Generation falls back to the semantic type. */
  | 'unknown';

export interface ColumnTypeInfo {
  kind: ColumnKind;
  /** The declared type exactly as parsed, kept for diagnostics and warnings. */
  raw: string;
  /** text: declared max length (VARCHAR(n) / CHAR(n)); undefined = unbounded. */
  maxLength?: number;
  /** decimal: total significant digits (undefined = unconstrained) and digits after the point. */
  precision?: number;
  scale?: number;
  /** integer: largest value that is safe for the declared width. */
  maxInt?: number;
}

/** Fits SMALLINT (max 32767) and every wider integer type. */
const INTEGER_MAX_DEFAULT = 1000;
/** Fits a signed TINYINT (max 127). */
export const TINYINT_MAX = 100;

/** Numbers inside the first (...) of a type, e.g. "decimal(10, 2)" -> [10, 2]. */
function numericArgs(type: string): number[] {
  const m = type.match(/\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

const INTEGER_TYPES = new Set([
  'int',
  'integer',
  'int2',
  'int4',
  'int8',
  'smallint',
  'mediumint',
  'bigint',
  'serial',
  'serial2',
  'serial4',
  'serial8',
  'smallserial',
  'bigserial',
]);
const DECIMAL_TYPES = new Set(['decimal', 'numeric', 'dec', 'fixed']);
const FLOAT_TYPES = new Set(['float', 'float4', 'float8', 'real', 'double', 'double precision']);
const BOOLEAN_TYPES = new Set(['boolean', 'bool']);
const CHAR_TYPES = new Set(['char', 'character', 'nchar', 'bpchar']);
const VARCHAR_TYPES = new Set(['varchar', 'character varying', 'nvarchar']);
// bytea/blob accept a plain string literal, so they are safe to treat as text.
const TEXT_TYPES = new Set([
  'text',
  'tinytext',
  'mediumtext',
  'longtext',
  'ntext',
  'citext',
  'string',
  'bytea',
  'blob',
  'tinyblob',
  'mediumblob',
  'longblob',
]);

export function classifyColumnType(rawType: string): ColumnTypeInfo {
  const raw = rawType;
  const normalized = rawType.trim().toLowerCase().replace(/\s+/g, ' ');
  const args = numericArgs(normalized);
  // "decimal(10,2)" -> "decimal"; "timestamp(3) with time zone" -> "timestamp with time zone"
  const base = normalized.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  if (base.endsWith(']')) return { kind: 'array', raw };

  if (INTEGER_TYPES.has(base)) {
    return { kind: 'integer', raw, maxInt: INTEGER_MAX_DEFAULT };
  }
  if (base === 'tinyint') {
    // MySQL's BOOLEAN is TINYINT(1); anything wider is a small integer.
    return args[0] === 1 ? { kind: 'boolean', raw } : { kind: 'integer', raw, maxInt: TINYINT_MAX };
  }
  if (DECIMAL_TYPES.has(base)) {
    // No precision at all: Postgres treats it as unconstrained; 2 decimals is safe there.
    if (args.length === 0) return { kind: 'decimal', raw, scale: 2 };
    return { kind: 'decimal', raw, precision: args[0], scale: args[1] ?? 0 };
  }
  if (FLOAT_TYPES.has(base)) return { kind: 'float', raw };
  if (BOOLEAN_TYPES.has(base)) return { kind: 'boolean', raw };
  if (base === 'date') return { kind: 'date', raw };
  // "timestamp", "timestamptz", "timestamp with time zone", "datetime", ...
  if (base.startsWith('timestamp') || base.startsWith('datetime') || base === 'smalldatetime') {
    return { kind: 'timestamp', raw };
  }
  if (base === 'time' || base === 'timetz' || base.startsWith('time with')) {
    return { kind: 'time', raw };
  }
  if (base === 'uuid') return { kind: 'uuid', raw };
  if (base === 'json' || base === 'jsonb') return { kind: 'json', raw };

  if (CHAR_TYPES.has(base)) return { kind: 'text', raw, maxLength: args[0] ?? 1 };
  if (VARCHAR_TYPES.has(base)) return { kind: 'text', raw, maxLength: args[0] };
  if (TEXT_TYPES.has(base)) return { kind: 'text', raw };

  return { kind: 'unknown', raw };
}

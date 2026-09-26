/**
 * The single place "analysis" happens: turns raw SQL into a ValidatedSemanticMap.
 *
 * Structural facts — table order, primary keys, foreign-key relationships,
 * identifier safety — come ONLY from local parsing (sql-schema-parser.ts) and
 * local topological sorting (dependency-resolver.ts). None of it is parsing
 * or network work expensive enough to need caching, so it is recomputed from
 * the raw schema on every request, by both API routes, every time. There is
 * therefore nothing structural for a client to spoof: there is no "topology"
 * field a request body can supply at all.
 *
 * Groq is used for exactly one thing: assigning a semantic type (email,
 * price, ...) to each non-key column, purely to pick a more plausible-looking
 * value template at generation time. A client MAY cache and resupply that
 * classification to skip the network call — see buildValidatedSemanticMap's
 * `cachedColumnTypes` parameter — but a wrong or malicious value there can, at
 * worst, make one column's fake data look like the wrong "flavor" of string.
 * It cannot affect table order, foreign keys, or generated SQL identifiers.
 */

import { parseSchema, type ParsedTable, type PrimaryKeyKind } from './sql-schema-parser';
import { resolveGenerationOrder, type TableNode } from './dependency-resolver';
import { analyzeSchema as classifyWithGroq, toSemanticType, type SemanticType } from './groq';
import { isSafeIdentifier } from './identifier-safety';
import { classifyColumnType, type ColumnTypeInfo } from './sql-types';

export interface ValidatedTable {
  name: string;
  columns: string[];
  /** What each column is ABOUT (from Groq). Only decides the flavor of text columns. */
  columnTypes: Record<string, SemanticType>;
  /** What each column can HOLD (from the declared SQL type, parsed locally). Decides the shape of every value. */
  columnInfo: Record<string, ColumnTypeInfo>;
  /**
   * Whether each column is NOT NULL (primary-key columns always are). Generation only puts NULL into a column
   * that is explicitly recorded as `false` here; a column missing from this map is treated as NOT NULL.
   */
  notNull: Record<string, boolean>;
  primaryKey: { column: string; kind: Exclude<PrimaryKeyKind, 'unsupported'> } | null;
  foreignKeys: { column: string; referencesTable: string; referencesColumn: string }[];
  /**
   * Columns with a single-column UNIQUE constraint (see ParsedTable.uniqueColumns — the
   * primary-key column is never included). generation-plan.ts enforces this: a value-only
   * unique column gets distinct generated values (capped or rejected if its value space is
   * too small for the requested row count); a unique column that is also a foreign key
   * samples the parent's keys without replacement, the same way a 1:1 table's PK-as-FK does.
   */
  uniqueColumns: string[];
}

export interface ValidatedSemanticMap {
  /** Locally computed via Kahn's algorithm. Never the LLM's self-reported order. */
  topology: string[];
  tables: Record<string, ValidatedTable>;
  warnings: string[];
}

export class SchemaAnalysisError extends Error {
  readonly httpStatus: number;
  readonly kind: string;
  constructor(message: string, kind: string, httpStatus = 400) {
    super(message);
    this.name = 'SchemaAnalysisError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

/**
 * `skipNullable` drops every foreign key whose column is explicitly nullable. It is only used as a
 * second attempt after the strict sort reports a cycle: a nullable FK can be generated as NULL, so it
 * does not have to force an insert order. A column whose nullability is unknown keeps its edge.
 */
function toDependencyNodes(tables: ParsedTable[], skipNullable = false): TableNode[] {
  return tables.map((t) => {
    const notNullByColumn = new Map(t.columns.map((c) => [c.name, c.notNull]));
    return {
      name: t.name,
      foreignKeys: t.foreignKeys
        .filter((fk) => !skipNullable || notNullByColumn.get(fk.column) !== false)
        .map((fk) => ({
          column: fk.column,
          referencesTable: fk.referencesTable,
          referencesColumn: fk.referencesColumn,
        })),
    };
  });
}

interface StructuralResult {
  tables: ParsedTable[];
  order: string[];
  warnings: string[];
}

/**
 * Structural analysis only — pure, synchronous, no network call. This is the
 * function that has to run on every single request, cached or not, because
 * it's also what makes a client-supplied topology impossible to spoof: there
 * simply isn't a code path where a client-provided ordering is used.
 */
export function analyzeStructure(rawSql: string): StructuralResult {
  const { tables, warnings } = parseSchema(rawSql);

  if (tables.length === 0) {
    throw new SchemaAnalysisError(
      'No CREATE TABLE statements could be parsed from the supplied schema.',
      'unparseable_schema',
      400
    );
  }

  for (const t of tables) {
    if (!isSafeIdentifier(t.name)) {
      throw new SchemaAnalysisError(
        `Table name "${t.name}" is not a safe SQL identifier.`,
        'unsafe_identifier',
        400
      );
    }
    for (const c of t.columns) {
      if (!isSafeIdentifier(c.name)) {
        throw new SchemaAnalysisError(
          `Column name "${t.name}.${c.name}" is not a safe SQL identifier.`,
          'unsafe_identifier',
          400
        );
      }
    }
  }

  // Primary-key support is a purely structural fact, so it is checked here
  // (before any quota reservation or AI call), not after the Groq round-trip.
  for (const t of tables) {
    if (t.hasCompositePrimaryKey) {
      throw new SchemaAnalysisError(
        `Table "${t.name}" has a composite primary key, which is not currently supported for generation.`,
        'unsupported_primary_key',
        422
      );
    }
    if (t.primaryKey && t.primaryKey.kind === 'unsupported') {
      throw new SchemaAnalysisError(
        `Table "${t.name}" has a primary key column "${t.primaryKey.column}" of an unsupported type. Only integer and UUID primary keys are currently supported.`,
        'unsupported_primary_key_type',
        422
      );
    }
  }

  // Strict sort first: every FK is a hard edge. Only if that reports a cycle, retry once with nullable
  // FKs ignored. A cycle that still exists after that (all NOT NULL) stays an error.
  let order: string[];
  const strict = resolveGenerationOrder(toDependencyNodes(tables));
  if (strict.ok) {
    order = strict.order;
  } else {
    const issue = strict.issues[0];
    const relaxed =
      issue.type === 'circular_dependency' ? resolveGenerationOrder(toDependencyNodes(tables, true)) : null;
    if (!relaxed || !relaxed.ok) {
      throw new SchemaAnalysisError(issue.message, issue.type, 422);
    }
    order = relaxed.order;
  }

  // Nullable FKs whose parent ended up ordered after the child are generated as NULL.
  const position = new Map(order.map((name, i) => [name, i]));
  for (const t of tables) {
    const notNullByColumn = new Map(t.columns.map((c) => [c.name, c.notNull]));
    for (const fk of t.foreignKeys) {
      if (fk.referencesTable === t.name) continue;
      const parentPos = position.get(fk.referencesTable);
      const childPos = position.get(t.name);
      if (
        parentPos !== undefined &&
        childPos !== undefined &&
        parentPos >= childPos &&
        notNullByColumn.get(fk.column) === false
      ) {
        warnings.push(
          `${t.name}.${fk.column} is nullable and references "${fk.referencesTable}", which is generated after "${t.name}" to break a circular dependency, so it is generated as NULL.`
        );
      }
    }
  }

  return { tables, order, warnings };
}

/**
 * Loose on purpose: a wrong or malformed cache can only ever degrade one
 * column's fake-data "flavor" (see the module comment above), so this just
 * needs to be plausible enough to skip the network call — not perfectly
 * valid. Exported so callers (e.g. the /api/generate route) can decide
 * up front whether a Groq call — and therefore a rate-limit reservation —
 * is about to happen, before doing any other work.
 */
export function isPlausibleColumnTypeCache(value: unknown): value is Record<string, Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildValidatedTables(
  tables: ParsedTable[],
  semanticTypesByTable: Record<string, Record<string, unknown>>,
  warnings: string[]
): { validated: Record<string, ValidatedTable>; error: SchemaAnalysisError | null } {
  const validated: Record<string, ValidatedTable> = {};

  for (const t of tables) {
    if (t.hasCompositePrimaryKey) {
      return {
        validated,
        error: new SchemaAnalysisError(
          `Table "${t.name}" has a composite primary key, which is not currently supported for generation.`,
          'unsupported_primary_key',
          422
        ),
      };
    }
    if (t.primaryKey && t.primaryKey.kind === 'unsupported') {
      return {
        validated,
        error: new SchemaAnalysisError(
          `Table "${t.name}" has a primary key column "${t.primaryKey.column}" of an unsupported type. Only integer and UUID primary keys are currently supported.`,
          'unsupported_primary_key_type',
          422
        ),
      };
    }

    const semanticCols = semanticTypesByTable[t.name] ?? {};
    const columnTypes: Record<string, SemanticType> = {};
    const columnInfo: Record<string, ColumnTypeInfo> = {};
    const notNull: Record<string, boolean> = {};
    for (const c of t.columns) {
      const info = classifyColumnType(c.rawType);
      columnInfo[c.name] = info;
      notNull[c.name] = c.notNull;
      // Only value columns matter here: PK/FK values come from the key pools, not from the type.
      if (info.kind === 'unknown' && !c.isPrimaryKey && !c.isForeignKey) {
        warnings.push(
          `${t.name}.${c.name}: column type "${c.rawType}" is not recognized, so it is generated as text, which the database may reject.`
        );
      }
      if (c.isPrimaryKey) {
        columnTypes[c.name] = 'pk';
      } else if (c.isForeignKey) {
        columnTypes[c.name] = 'fk';
      } else {
        // Structural facts (PK/FK) always win over whatever the classifier
        // says; semantic typing only ever applies to plain value columns.
        columnTypes[c.name] = toSemanticType(semanticCols[c.name]);
      }
    }

    // UNIQUE enforcement only covers the column kinds generation-plan.ts knows how to generate
    // distinct values for (or, for a unique FK, sample without replacement for). A column of an
    // unsupported kind (json, array, unknown) keeps its old, unenforced behavior — reported here
    // rather than guessed at, the same treatment the parser already gives composite UNIQUE.
    for (const colName of t.uniqueColumns) {
      const kind = columnInfo[colName]?.kind;
      if (kind === 'json' || kind === 'array' || kind === 'unknown') {
        warnings.push(
          `${t.name}.${colName} is UNIQUE but of a type (${columnInfo[colName].raw || kind}) generation cannot guarantee distinct values for; it is generated as before, and duplicates are possible.`
        );
      }
      const fk = t.foreignKeys.find((f) => f.column === colName);
      if (fk && fk.referencesTable === t.name) {
        warnings.push(
          `${t.name}.${colName} is a UNIQUE self-referencing foreign key; uniqueness is not enforced for self-references, and duplicates are possible.`
        );
      }
    }

    validated[t.name] = {
      name: t.name,
      columns: t.columns.map((c) => c.name),
      columnTypes,
      columnInfo,
      notNull,
      primaryKey:
        t.primaryKey && t.primaryKey.kind !== 'unsupported'
          ? { column: t.primaryKey.column, kind: t.primaryKey.kind }
          : null,
      foreignKeys: t.foreignKeys.map((fk) => ({
        column: fk.column,
        referencesTable: fk.referencesTable,
        referencesColumn: fk.referencesColumn,
      })),
      uniqueColumns: t.uniqueColumns,
    };
  }

  return { validated, error: null };
}

/**
 * Full analysis: structure locally (always), semantics via Groq (unless a
 * plausible cached classification is supplied, in which case the network
 * call is skipped entirely).
 */
export async function buildValidatedSemanticMap(
  rawSql: string,
  cachedColumnTypes?: unknown
): Promise<ValidatedSemanticMap> {
  const { tables, order, warnings } = analyzeStructure(rawSql);

  let semanticTypesByTable: Record<string, Record<string, unknown>>;
  let usedCache = false;
  if (isPlausibleColumnTypeCache(cachedColumnTypes)) {
    semanticTypesByTable = cachedColumnTypes;
    usedCache = true;
  } else {
    const groqResult = await classifyWithGroq(rawSql);
    // groqResult.topology is intentionally read no further than this comment.
    // Only .tables (the semantic classification) is used below.
    if (JSON.stringify(groqResult.topology) !== JSON.stringify(order)) {
      warnings.push(
        'The AI-suggested table order differed from the locally computed dependency order; the locally computed order was used.'
      );
    }
    semanticTypesByTable = groqResult.tables;
  }

  const { validated, error } = buildValidatedTables(tables, semanticTypesByTable, warnings);
  if (error) throw error;

  if (usedCache) warnings.push('Used cached semantic classification; no AI call was made for this request.');

  return { topology: order, tables: validated, warnings };
}
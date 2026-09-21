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

export interface ValidatedTable {
  name: string;
  columns: string[];
  columnTypes: Record<string, SemanticType>;
  primaryKey: { column: string; kind: Exclude<PrimaryKeyKind, 'unsupported'> } | null;
  foreignKeys: { column: string; referencesTable: string; referencesColumn: string }[];
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

function toDependencyNodes(tables: ParsedTable[]): TableNode[] {
  return tables.map((t) => ({
    name: t.name,
    foreignKeys: t.foreignKeys.map((fk) => ({
      column: fk.column,
      referencesTable: fk.referencesTable,
      referencesColumn: fk.referencesColumn,
    })),
  }));
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

  const resolution = resolveGenerationOrder(toDependencyNodes(tables));
  if (!resolution.ok) {
    const issue = resolution.issues[0];
    throw new SchemaAnalysisError(issue.message, issue.type, 422);
  }

  return { tables, order: resolution.order, warnings };
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
  semanticTypesByTable: Record<string, Record<string, unknown>>
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
    for (const c of t.columns) {
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

    validated[t.name] = {
      name: t.name,
      columns: t.columns.map((c) => c.name),
      columnTypes,
      primaryKey:
        t.primaryKey && t.primaryKey.kind !== 'unsupported'
          ? { column: t.primaryKey.column, kind: t.primaryKey.kind }
          : null,
      foreignKeys: t.foreignKeys.map((fk) => ({
        column: fk.column,
        referencesTable: fk.referencesTable,
        referencesColumn: fk.referencesColumn,
      })),
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

  const { validated, error } = buildValidatedTables(tables, semanticTypesByTable);
  if (error) throw error;

  if (usedCache) warnings.push('Used cached semantic classification; no AI call was made for this request.');

  return { topology: order, tables: validated, warnings };
}

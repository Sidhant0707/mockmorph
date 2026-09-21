import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/session';
import { AnalysisError, GROQ_MODEL, MAX_SCHEMA_CHARS } from '@/lib/groq';
import {
  analyzeStructure,
  buildValidatedSemanticMap,
  isPlausibleColumnTypeCache,
  SchemaAnalysisError,
  type ValidatedSemanticMap,
} from '@/lib/schema-analysis';
import { reserveAiCallQuota, refundAiCallQuota } from '@/lib/rate-limit';
import {
  buildGenerationPlan,
  generateTableRows,
  PlanValidationError,
  type Dialect,
  type PkPools,
} from '@/lib/generation-plan';
import { quoteIdentifier } from '@/lib/identifier-safety';

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql'];

/** Everything here comes from the client, so it is typed `unknown` until validated. */
interface RequestBody {
  rawSchema?: unknown;
  config?: { rowCount?: unknown; dialect?: unknown };
  /**
   * Optional cached Groq classification from a prior /api/analyze call, in
   * the shape { [table]: { [column]: semanticType } }. This is the ONLY
   * thing a client can cache to skip AI work — there is no client-suppliable
   * topology field. Table order, primary keys, and foreign keys are always
   * recomputed locally from rawSchema on every request; see lib/schema-analysis.ts.
   */
  cachedColumnTypes?: unknown;
}

const LIMITS = {
  MAX_ROWS: 10_000,
  MIN_ROWS: 1,
  DEFAULT_ROWS: 50,
  BASE_PARENT_ROWS: 15,
} as const;

const STREAM = {
  ROW_DELAY_MS: 10,
  // The per-row delay is a "typing" effect. Past this many rows it only adds
  // latency (10,000 rows would spend 100+ seconds asleep), so rows go out instantly.
  MAX_ANIMATED_ROWS: 200,
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/** Clamps to [MIN_ROWS, MAX_ROWS]. Without this a client could request billions of rows. */
function parseRowCount(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return LIMITS.DEFAULT_ROWS;
  return Math.min(LIMITS.MAX_ROWS, Math.max(LIMITS.MIN_ROWS, Math.trunc(n)));
}

function parseDialect(value: unknown): Dialect {
  return DIALECTS.includes(value as Dialect) ? (value as Dialect) : 'postgres';
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Thrown internally to unwind the generation loop when the client disconnects. */
class StreamCancelledError extends Error {}

type GenerationStatus = 'completed' | 'failed' | 'cancelled';

interface GenerationOptions {
  userId: string;
  schema: string;
  map: ValidatedSemanticMap;
  requestedRows: number;
  dialect: Dialect;
  usedCache: boolean;
}

function createGenerationStream(options: GenerationOptions): ReadableStream<Uint8Array> {
  const { userId, schema, map, requestedRows, dialect, usedCache } = options;
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let cancelled = false;
  let status: GenerationStatus = 'completed';

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = async (text: string, delay = 0): Promise<void> => {
        if (cancelled) throw new StreamCancelledError();
        if (delay > 0) await sleep(delay);
        if (cancelled) throw new StreamCancelledError();
        lines.push(text);
        controller.enqueue(encoder.encode(`${text}\n`));
      };

      try {
        await send('-- [SYS] Initializing Local-First Dependency Engine...', 50);
        await send(
          usedCache
            ? '-- [SYS] Using cached semantic classification. No AI call for this request.'
            : `-- [AI] ${GROQ_MODEL} (Groq) classified column semantics.`,
          50
        );
        await send(
          `-- [LOCAL] Kahn's algorithm resolved dependency order: ${map.topology.join(' -> ')}`,
          50
        );

        // The full generation plan — row counts per table, and a check that
        // every FK actually targets a primary key ordered before it — is
        // built and validated BEFORE any row is generated. A structural
        // problem is impossible to discover mid-stream by construction.
        const plan = buildGenerationPlan(map, requestedRows, {
          baseParentRows: LIMITS.BASE_PARENT_ROWS,
          maxRows: LIMITS.MAX_ROWS,
          minRows: LIMITS.MIN_ROWS,
        });
        await send(`-- [LOCAL] Generation plan validated for ${dialect.toUpperCase()}.`, 100);
        await send('', 50);

        let totalGenerated = 0;
        const pkPools: PkPools = new Map();

        for (const tablePlan of plan.tables) {
          const { table, rowCount } = tablePlan;
          const columnList = table.columns.map((c) => quoteIdentifier(c, dialect)).join(', ');
          await send(`INSERT INTO ${quoteIdentifier(table.name, dialect)} (${columnList}) VALUES`, 50);

          let rowIndex = 0;
          for (const row of generateTableRows(tablePlan, dialect, pkPools)) {
            rowIndex++;
            const values = table.columns.map((c) => row[c]);
            const terminator = rowIndex === rowCount ? ';' : ',';
            const delay = totalGenerated < STREAM.MAX_ANIMATED_ROWS ? STREAM.ROW_DELAY_MS : 0;
            await send(`  (${values.join(', ')})${terminator}`, delay);
            totalGenerated++;
          }

          await send('', 20);
        }

        // Every FK value came from an actual generated parent PK pool (see
        // lib/generation-plan.ts) — this line is now a true statement about
        // what just happened, not a fixed string printed regardless of it.
        await send(
          `-- [COMPLETE] ${totalGenerated} rows generated across ${plan.tables.length} tables. Every foreign key resolved against its actual referenced parent's generated primary keys.`,
          50
        );
      } catch (error) {
        if (error instanceof StreamCancelledError) {
          status = 'cancelled';
        } else {
          status = 'failed';
          console.error('[generate] stream failed:', error);
          const message =
            error instanceof AnalysisError || error instanceof PlanValidationError || error instanceof SchemaAnalysisError
              ? error.message
              : 'Unexpected internal error';
          await send(`-- [FATAL ERROR] Core processing failure: ${message}`).catch(() => undefined);
        }
      } finally {
        // Saving history is best-effort in the sense that a DB hiccup while
        // saving becomes a warning, not a fatal error under a finished
        // result — but a failed or cancelled run is now recorded as such,
        // never silently stored as if it had completed successfully.
        try {
          await prisma.generation.create({
            data: { userId, schema, mockData: `${lines.join('\n')}\n`, status },
          });
        } catch (error) {
          console.error('[generate] failed to save generation:', error);
          if (!cancelled) {
            await send('-- [WARN] Output generated, but it could not be saved to your history.').catch(
              () => undefined
            );
          }
        }
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let quotaReserved = false;
  let userId: string | null = null;

  try {
    userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const { rawSchema, config, cachedColumnTypes } = body as RequestBody;

    const schema = typeof rawSchema === 'string' ? rawSchema.trim() : '';
    if (!schema) {
      return NextResponse.json({ error: 'A SQL schema is required' }, { status: 400 });
    }
    if (schema.length > MAX_SCHEMA_CHARS) {
      return NextResponse.json(
        { error: `Schema is too large (max ${MAX_SCHEMA_CHARS} characters)` },
        { status: 413 }
      );
    }

    // Local structural validation FIRST — no AI quota is touched for a
    // schema that's malformed, cyclic, references a nonexistent table, or
    // uses an unsupported primary-key type.
    analyzeStructure(schema);

    // This is the fix for the rate-limit gap: an AI call only happens (and
    // therefore only costs a quota slot) when no plausible cached
    // classification was supplied. Both /api/analyze and this fallback path
    // now share the exact same quota via lib/rate-limit.ts.
    const usedCache = isPlausibleColumnTypeCache(cachedColumnTypes);
    if (!usedCache) {
      const quota = await reserveAiCallQuota(userId);
      if (quota.status === 'no_user') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (quota.status === 'limited') {
        return NextResponse.json(
          {
            error:
              'AI analysis rate limit exceeded. Run /api/analyze first and reuse its result, or wait an hour.',
          },
          { status: 429 }
        );
      }
      quotaReserved = true;
    }

    let map: ValidatedSemanticMap;
    try {
      map = await buildValidatedSemanticMap(schema, cachedColumnTypes);
    } catch (error) {
      if (quotaReserved) await refundAiCallQuota(userId);
      throw error;
    }

    const stream = createGenerationStream({
      userId,
      schema,
      map,
      requestedRows: parseRowCount(config?.rowCount),
      dialect: parseDialect(config?.dialect),
      usedCache,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    console.error('[generate] request failed:', error);
    if (error instanceof SchemaAnalysisError) {
      return NextResponse.json({ error: error.message, kind: error.kind }, { status: error.httpStatus });
    }
    if (error instanceof PlanValidationError) {
      return NextResponse.json({ error: error.message, kind: error.kind }, { status: 422 });
    }
    if (error instanceof AnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

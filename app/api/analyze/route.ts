import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/session';
import {
  analyzeSchema,
  AnalysisError,
  GROQ_MODEL,
  MAX_SCHEMA_CHARS,
  normalizeSemanticMap,
  type SemanticSchemaMap,
  type SemanticType,
} from '@/lib/groq';

type Dialect = 'postgres' | 'mysql';
const DIALECTS: readonly Dialect[] = ['postgres', 'mysql'];

/** Everything here comes from the client, so it is typed `unknown` until validated. */
interface RequestBody {
  rawSchema?: unknown;
  config?: { rowCount?: unknown; dialect?: unknown };
  semanticMap?: unknown;
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
// Value generation
// ---------------------------------------------------------------------------

interface ValueContext {
  index: number;
  parentMaxId: number;
  dialect: Dialect;
}

const randomToken = (): string => Math.random().toString(36).substring(2, 9);

/**
 * Typed as Record<SemanticType, ...>, so adding a new semantic type in lib/groq.ts
 * fails to compile here until a generator exists for it.
 */
const VALUE_GENERATORS: Record<SemanticType, (ctx: ValueContext) => string | number> = {
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
  fk: ({ parentMaxId }) => (parentMaxId > 0 ? Math.floor(Math.random() * parentMaxId) + 1 : 1),
  pk: ({ index }) => index,
  string: ({ index }) => `'string_val_${index}'`,
};

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Thrown internally to unwind the generation loop when the client disconnects. */
class StreamCancelledError extends Error {}

interface GenerationOptions {
  userId: string;
  schema: string;
  providedMap: SemanticSchemaMap | null;
  requestedRows: number;
  dialect: Dialect;
}

function createGenerationStream(options: GenerationOptions): ReadableStream<Uint8Array> {
  const { userId, schema, providedMap, requestedRows, dialect } = options;
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = async (text: string, delay = 0): Promise<void> => {
        if (cancelled) throw new StreamCancelledError();
        if (delay > 0) await sleep(delay);
        // The client may have left while we slept; enqueue() on a closed stream throws.
        if (cancelled) throw new StreamCancelledError();
        lines.push(text);
        controller.enqueue(encoder.encode(`${text}\n`));
      };

      try {
        await send('-- [SYS] Initializing Hybrid LLM-Deterministic Edge Engine...', 50);

        // Use the client's cached map when valid, otherwise ask the model.
        let schemaMap: SemanticSchemaMap;
        if (providedMap) {
          await send('-- [SYS] Pre-verified Semantic Map received. Bypassing AI...', 50);
          schemaMap = providedMap;
        } else {
          await send(`-- [SYS] Handshake with ${GROQ_MODEL} (Groq LPU) established.`, 50);
          await send('-- [AI] Analyzing schema semantics on the fly...', 100);
          schemaMap = await analyzeSchema(schema);
        }

        const { topology, tables } = schemaMap;
        await send(`-- [AI] Topology Locked: ${topology.join(' -> ')}`, 50);
        await send(`-- [EDGE] Executing Kahn's Algorithm chunking for ${dialect.toUpperCase()}...`, 100);
        await send('', 50);

        let totalGenerated = 0;
        let parentMaxId: number = LIMITS.BASE_PARENT_ROWS;

        for (let t = 0; t < topology.length; t++) {
          // normalizeSemanticMap guarantees every topology entry exists in `tables` with >= 1 column.
          const tableName = topology[t];
          const columns = tables[tableName];
          const columnNames = Object.keys(columns);

          const isLastTable = t === topology.length - 1;
          const rowsToGenerate = isLastTable
            ? Math.max(1, requestedRows - totalGenerated)
            : LIMITS.BASE_PARENT_ROWS;

          await send(`INSERT INTO ${tableName} (${columnNames.join(', ')}) VALUES`, 50);

          for (let row = 1; row <= rowsToGenerate; row++) {
            const context: ValueContext = { index: row, parentMaxId, dialect };
            const values = columnNames.map((name) => VALUE_GENERATORS[columns[name]](context));
            const terminator = row === rowsToGenerate ? ';' : ',';
            const delay = totalGenerated < STREAM.MAX_ANIMATED_ROWS ? STREAM.ROW_DELAY_MS : 0;
            await send(`  (${values.join(', ')})${terminator}`, delay);
            totalGenerated++;
          }

          parentMaxId = rowsToGenerate;
          await send('', 20);
        }

        await send(
          `-- [COMPLETE] ${totalGenerated} semantic rows generated. 100% Referential Integrity maintained.`,
          50
        );

        // Saving history is best-effort: the user already has their data, so a DB
        // hiccup should be a warning, not a "fatal error" printed under a finished result.
        try {
          await prisma.generation.create({
            data: { userId, schema, mockData: `${lines.join('\n')}\n` },
          });
        } catch (error) {
          console.error('[generate] failed to save generation:', error);
          await send('-- [WARN] Output generated, but it could not be saved to your history.');
        }
      } catch (error) {
        if (!(error instanceof StreamCancelledError)) {
          console.error('[generate] stream failed:', error);
          const message = error instanceof AnalysisError ? error.message : 'Unexpected internal error';
          await send(`-- [FATAL ERROR] Core processing failure: ${message}`).catch(() => undefined);
        }
      } finally {
        // After cancel() the stream is already closed and close() would throw.
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
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const { rawSchema, config, semanticMap } = body as RequestBody;

    const schema = typeof rawSchema === 'string' ? rawSchema.trim() : '';
    if (schema.length > MAX_SCHEMA_CHARS) {
      return NextResponse.json(
        { error: `Schema is too large (max ${MAX_SCHEMA_CHARS} characters)` },
        { status: 413 }
      );
    }

    // The map is client-supplied, so it goes through the same validation as model output.
    // An invalid map is ignored and we fall back to AI analysis.
    const providedMap = normalizeSemanticMap(semanticMap);
    if (semanticMap != null && !providedMap) {
      console.warn('[generate] ignoring invalid semanticMap from client');
    }
    if (!providedMap && !schema) {
      return NextResponse.json({ error: 'Provide a SQL schema or a semantic map' }, { status: 400 });
    }

    const stream = createGenerationStream({
      userId,
      schema,
      providedMap,
      requestedRows: parseRowCount(config?.rowCount),
      dialect: parseDialect(config?.dialect),
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (error) {
    console.error('[generate] request failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
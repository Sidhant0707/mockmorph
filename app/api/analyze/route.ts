import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/session';
import { analyzeStructure, buildValidatedSemanticMap, SchemaAnalysisError } from '@/lib/schema-analysis';
import { AnalysisError, MAX_SCHEMA_CHARS } from '@/lib/groq';
import { reserveAiCallQuota, refundAiCallQuota } from '@/lib/rate-limit';

export async function POST(req: Request) {
  try {
    // 1. Authentication
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Input validation (before touching the quota: bad requests shouldn't cost a use)
    const body: unknown = await req.json().catch(() => null);
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const { rawSchema } = body as { rawSchema?: unknown };
    if (typeof rawSchema !== 'string' || !rawSchema.trim()) {
      return NextResponse.json({ error: 'Valid SQL schema is required' }, { status: 400 });
    }
    if (rawSchema.length > MAX_SCHEMA_CHARS) {
      return NextResponse.json(
        { error: `Schema is too large (max ${MAX_SCHEMA_CHARS} characters)` },
        { status: 413 }
      );
    }

    // 3. Local structural validation FIRST — cheap, synchronous, no network
    //    call. A malformed or cyclic schema fails here and never touches the
    //    AI quota. (buildValidatedSemanticMap below re-runs this same check;
    //    that's deliberate — it's pure computation, not worth threading
    //    through as a parameter just to avoid running it twice.)
    analyzeStructure(rawSchema);

    // 4. Rate limit (only reserved once we know we'll actually need Groq)
    const quota = await reserveAiCallQuota(userId);
    if (quota.status === 'no_user') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (quota.status === 'limited') {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait an hour before running another semantic analysis.' },
        { status: 429 }
      );
    }

    // 5. Structural analysis (local) + AI semantic classification (Groq)
    try {
      const map = await buildValidatedSemanticMap(rawSchema);
      return NextResponse.json({
        topology: map.topology,
        tables: Object.fromEntries(Object.entries(map.tables).map(([name, t]) => [name, t.columnTypes])),
        warnings: map.warnings,
        remaining: quota.remaining,
      });
    } catch (error) {
      await refundAiCallQuota(userId);
      throw error;
    }
  } catch (error) {
    console.error('[analyze] failed:', error);

    // Only messages we wrote ourselves go to the client; anything else (Prisma, network) stays in the logs.
    if (error instanceof SchemaAnalysisError) {
      return NextResponse.json({ error: error.message, kind: error.kind }, { status: error.httpStatus });
    }
    if (error instanceof AnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

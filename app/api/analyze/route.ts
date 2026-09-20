import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/session';
import { analyzeSchema, AnalysisError, MAX_SCHEMA_CHARS } from '@/lib/groq';

const RATE_LIMIT = 5;
const RESET_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

type QuotaResult =
  | { status: 'ok'; remaining: number }
  | { status: 'limited' }
  | { status: 'no_user' };

/**
 * Takes one analysis slot for the user.
 *
 * Each step is a single conditional UPDATE, so the check and the write happen
 * together in the database. The old read-then-write version let two parallel
 * requests both read "4 used" and both succeed, exceeding the limit.
 */
async function reserveQuota(userId: string): Promise<QuotaResult> {
  const now = new Date();

  // Window expired: start a new one. Only one concurrent request can win this update.
  const reset = await prisma.user.updateMany({
    where: { id: userId, lastResetTime: { lt: new Date(now.getTime() - RESET_INTERVAL_MS) } },
    data: { analyzesUsed: 1, lastResetTime: now },
  });
  if (reset.count === 1) {
    return { status: 'ok', remaining: RATE_LIMIT - 1 };
  }

  // Window still active: take a slot only if one is left.
  const taken = await prisma.user.updateMany({
    where: { id: userId, analyzesUsed: { lt: RATE_LIMIT } },
    data: { analyzesUsed: { increment: 1 } },
  });
  if (taken.count === 1) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { analyzesUsed: true },
    });
    return { status: 'ok', remaining: Math.max(0, RATE_LIMIT - (row?.analyzesUsed ?? RATE_LIMIT)) };
  }

  // Nothing updated: either the user doesn't exist or they're at the limit.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return exists ? { status: 'limited' } : { status: 'no_user' };
}

/** Gives the slot back when the analysis failed, so errors don't cost the user a try. */
async function refundQuota(userId: string): Promise<void> {
  try {
    await prisma.user.updateMany({
      where: { id: userId, analyzesUsed: { gt: 0 } },
      data: { analyzesUsed: { decrement: 1 } },
    });
  } catch (error) {
    // Never let a failed refund hide the original error.
    console.error('[analyze] failed to refund quota:', error);
  }
}

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

    // 3. Rate limit
    const quota = await reserveQuota(userId);
    if (quota.status === 'no_user') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (quota.status === 'limited') {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait an hour before running another semantic analysis.' },
        { status: 429 }
      );
    }

    // 4. AI analysis
    try {
      const { topology, tables } = await analyzeSchema(rawSchema);
      return NextResponse.json({ topology, tables, remaining: quota.remaining });
    } catch (error) {
      await refundQuota(userId);
      throw error;
    }
  } catch (error) {
    console.error('[analyze] failed:', error);

    // Only messages we wrote ourselves go to the client; anything else (Prisma, network) stays in the logs.
    if (error instanceof AnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
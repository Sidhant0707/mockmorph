/**
 * One quota, shared by every code path that can trigger a Groq call.
 *
 * Previously this lived only inside /api/analyze. /api/generate could also
 * trigger a Groq call (its fallback path, used whenever no cached semantic
 * classification is supplied) with no limit of its own — a client could
 * bypass the intended AI-cost control entirely by always omitting the
 * cache. Extracting the logic here and having both routes call it closes
 * that gap without duplicating (and risking desyncing) the rate-limit logic.
 */

import { prisma } from './prisma';

export const AI_CALL_RATE_LIMIT = 5;
export const AI_CALL_RESET_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type QuotaResult =
  | { status: 'ok'; remaining: number }
  | { status: 'limited' }
  | { status: 'no_user' };

/**
 * Takes one AI-call slot for the user.
 *
 * Each branch is a single conditional UPDATE, so the check and the write
 * happen together in the database. A read-then-write version would let two
 * concurrent requests both read "4 used" and both succeed, exceeding the
 * limit. This is race-safe because each UPDATE's WHERE clause is evaluated
 * against the current row and applied atomically by Postgres; of two
 * concurrent requests racing the same conditional update, only one can
 * match the row's pre-update state and have its write take effect — the
 * loser's WHERE clause simply matches zero rows.
 */
export async function reserveAiCallQuota(userId: string): Promise<QuotaResult> {
  const now = new Date();

  // Window expired: start a new one. Only one concurrent request can win this update.
  const reset = await prisma.user.updateMany({
    where: { id: userId, lastResetTime: { lt: new Date(now.getTime() - AI_CALL_RESET_INTERVAL_MS) } },
    data: { analyzesUsed: 1, lastResetTime: now },
  });
  if (reset.count === 1) {
    return { status: 'ok', remaining: AI_CALL_RATE_LIMIT - 1 };
  }

  // Window still active: take a slot only if one is left.
  const taken = await prisma.user.updateMany({
    where: { id: userId, analyzesUsed: { lt: AI_CALL_RATE_LIMIT } },
    data: { analyzesUsed: { increment: 1 } },
  });
  if (taken.count === 1) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { analyzesUsed: true } });
    return { status: 'ok', remaining: Math.max(0, AI_CALL_RATE_LIMIT - (row?.analyzesUsed ?? AI_CALL_RATE_LIMIT)) };
  }

  // Nothing updated: either the user doesn't exist or they're at the limit.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return exists ? { status: 'limited' } : { status: 'no_user' };
}

/** Gives the slot back when the call that consumed it failed, so errors don't cost the user a try. */
export async function refundAiCallQuota(userId: string): Promise<void> {
  try {
    await prisma.user.updateMany({
      where: { id: userId, analyzesUsed: { gt: 0 } },
      data: { analyzesUsed: { decrement: 1 } },
    });
  } catch (error) {
    console.error('[rate-limit] failed to refund quota:', error);
  }
}

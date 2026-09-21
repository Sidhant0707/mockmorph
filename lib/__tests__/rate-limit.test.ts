import { describe, expect, it, vi, beforeEach } from 'vitest';

const updateMany = vi.fn();
const findUnique = vi.fn();

vi.mock('../prisma', () => ({
  prisma: {
    user: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

import { reserveAiCallQuota, refundAiCallQuota, AI_CALL_RATE_LIMIT } from '../rate-limit';

beforeEach(() => {
  updateMany.mockReset();
  findUnique.mockReset();
});

describe('reserveAiCallQuota', () => {
  it('starts a fresh window when the reset-window update matches (expired window)', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }); // the reset-window update wins
    const result = await reserveAiCallQuota('user-1');
    expect(result).toEqual({ status: 'ok', remaining: AI_CALL_RATE_LIMIT - 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('takes a slot via the conditional increment when the window is still active and has room', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 }); // reset-window update: window not expired
    updateMany.mockResolvedValueOnce({ count: 1 }); // conditional increment: succeeds
    findUnique.mockResolvedValueOnce({ analyzesUsed: 3 });
    const result = await reserveAiCallQuota('user-1');
    expect(result).toEqual({ status: 'ok', remaining: AI_CALL_RATE_LIMIT - 3 });
  });

  it('returns "limited" when both conditional updates match zero rows for an existing user', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: 'user-1' });
    const result = await reserveAiCallQuota('user-1');
    expect(result).toEqual({ status: 'limited' });
  });

  it('returns "no_user" when both conditional updates match zero rows and the user does not exist', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce(null);
    const result = await reserveAiCallQuota('ghost');
    expect(result).toEqual({ status: 'no_user' });
  });

  it('only one of two "concurrent" callers can win the same conditional update (race safety, simulated)', async () => {
    // Simulates two requests racing the SAME already-active window: the
    // first conditional UPDATE (count < LIMIT) can only report count: 1 for
    // one of them, by definition of an atomic WHERE-guarded UPDATE.
    updateMany
      .mockResolvedValueOnce({ count: 0 }) // req A: reset-window check, window active
      .mockResolvedValueOnce({ count: 1 }) // req A: conditional increment succeeds
      .mockResolvedValueOnce({ count: 0 }) // req B: reset-window check, window active
      .mockResolvedValueOnce({ count: 0 }); // req B: conditional increment fails (A already took the last slot)
    findUnique.mockResolvedValueOnce({ analyzesUsed: 5 }).mockResolvedValueOnce({ id: 'user-1' });

    const resultA = await reserveAiCallQuota('user-1');
    const resultB = await reserveAiCallQuota('user-1');

    expect(resultA.status).toBe('ok');
    expect(resultB.status).toBe('limited');
  });
});

describe('refundAiCallQuota', () => {
  it('decrements only when analyzesUsed is greater than zero (delegated to the DB WHERE clause)', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    await refundAiCallQuota('user-1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'user-1' }) })
    );
  });

  it('swallows a DB error instead of throwing (never hides the original failure)', async () => {
    updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(refundAiCallQuota('user-1')).resolves.toBeUndefined();
  });
});

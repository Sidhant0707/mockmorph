import { describe, it, expect, vi, beforeEach } from 'vitest';

const groqCalls = vi.fn();
vi.mock('../groq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../groq')>();
  return {
    ...actual,
    analyzeSchema: async (...args: unknown[]) => {
      groqCalls(...args);
      return { topology: [], tables: {} };
    },
  };
});

import { buildValidatedSemanticMap } from '../schema-analysis';

beforeEach(() => groqCalls.mockClear());

// Regression guard: schemas that can never be generated must be rejected by
// the local structural check BEFORE any Groq call, otherwise the routes'
// refund-on-error logic turns them into unlimited free AI calls.
describe('unsupported schemas are rejected before any Groq call', () => {
  it('composite primary key', async () => {
    await expect(
      buildValidatedSemanticMap('CREATE TABLE t (a INT, b INT, PRIMARY KEY (a, b));')
    ).rejects.toThrow(/composite primary key/);
    expect(groqCalls).not.toHaveBeenCalled();
  });

  it('TEXT primary key', async () => {
    await expect(
      buildValidatedSemanticMap('CREATE TABLE t (code TEXT PRIMARY KEY, name TEXT);')
    ).rejects.toThrow(/unsupported type/);
    expect(groqCalls).not.toHaveBeenCalled();
  });
});

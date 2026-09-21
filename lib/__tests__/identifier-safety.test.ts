import { describe, expect, it } from 'vitest';
import { isSafeIdentifier, quoteIdentifier } from '../identifier-safety';

describe('isSafeIdentifier', () => {
  it('accepts ordinary snake_case identifiers', () => {
    expect(isSafeIdentifier('users')).toBe(true);
    expect(isSafeIdentifier('order_items')).toBe(true);
    expect(isSafeIdentifier('_private')).toBe(true);
  });

  it('rejects a malicious identifier attempting SQL injection via table name', () => {
    expect(isSafeIdentifier('users); DROP TABLE users;--')).toBe(false);
    expect(isSafeIdentifier('users" ; DROP TABLE users; --')).toBe(false);
    expect(isSafeIdentifier("users'; DROP TABLE users;--")).toBe(false);
  });

  it('rejects identifiers with spaces or punctuation', () => {
    expect(isSafeIdentifier('my table')).toBe(false);
    expect(isSafeIdentifier('table-name')).toBe(false);
    expect(isSafeIdentifier('table.name')).toBe(false);
  });

  it('rejects identifiers starting with a digit', () => {
    expect(isSafeIdentifier('1users')).toBe(false);
  });

  it('rejects reserved SQL keywords used bare', () => {
    expect(isSafeIdentifier('select')).toBe(false);
    expect(isSafeIdentifier('DROP')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeIdentifier(123)).toBe(false);
    expect(isSafeIdentifier(null)).toBe(false);
    expect(isSafeIdentifier(undefined)).toBe(false);
    expect(isSafeIdentifier({})).toBe(false);
  });

  it('rejects an identifier over 63 characters', () => {
    expect(isSafeIdentifier('a'.repeat(64))).toBe(false);
    expect(isSafeIdentifier('a'.repeat(63))).toBe(true);
  });
});

describe('quoteIdentifier', () => {
  it('quotes a safe identifier for postgres and mysql', () => {
    expect(quoteIdentifier('users', 'postgres')).toBe('"users"');
    expect(quoteIdentifier('users', 'mysql')).toBe('`users`');
  });

  it('throws rather than quoting an unsafe identifier', () => {
    expect(() => quoteIdentifier('users); DROP TABLE users;--', 'postgres')).toThrow();
  });
});

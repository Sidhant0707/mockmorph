import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../error-messages';

describe('extractErrorMessage', () => {
  it('extracts the message from a JSON error body', () => {
    expect(extractErrorMessage('{"error":"Schema is too large (max 50000 characters)"}', 'fallback')).toBe(
      'Schema is too large (max 50000 characters)'
    );
  });

  it('extracts the message even when the body has other fields, like kind', () => {
    expect(
      extractErrorMessage('{"error":"Unsupported primary-key type","kind":"unsupported_pk_type"}', 'fallback')
    ).toBe('Unsupported primary-key type');
  });

  it('falls back on an empty body', () => {
    expect(extractErrorMessage('', 'fallback')).toBe('fallback');
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
    expect(extractErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('falls back on a non-JSON body', () => {
    expect(extractErrorMessage('Internal Server Error', 'fallback')).toBe('fallback');
    expect(extractErrorMessage('<html><body>502 Bad Gateway</body></html>', 'fallback')).toBe('fallback');
  });

  it('falls back when the JSON body has no error field', () => {
    expect(extractErrorMessage('{"kind":"rate_limited"}', 'fallback')).toBe('fallback');
    expect(extractErrorMessage('{}', 'fallback')).toBe('fallback');
  });

  it('falls back when error is not a usable string', () => {
    expect(extractErrorMessage('{"error":null}', 'fallback')).toBe('fallback');
    expect(extractErrorMessage('{"error":42}', 'fallback')).toBe('fallback');
    expect(extractErrorMessage('{"error":"   "}', 'fallback')).toBe('fallback');
  });

  it('falls back on a bare JSON array or primitive (no error field to read)', () => {
    expect(extractErrorMessage('[1,2,3]', 'fallback')).toBe('fallback');
    expect(extractErrorMessage('"just a string"', 'fallback')).toBe('fallback');
  });
});

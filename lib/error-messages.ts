/**
 * Every route that can fail before it starts streaming a response (see
 * app/api/generate/route.ts and app/api/analyze/route.ts) sends a JSON body
 * shaped like { error, kind }. This extracts that message so the UI can
 * show what the server actually said instead of a generic status-code
 * message, falling back to that generic message whenever the body isn't
 * usable JSON with a non-empty string `error` field.
 *
 * Takes the raw response text (not a Response) so it's a plain, synchronous,
 * easily-testable function — callers do the one async `response.text()`
 * read themselves.
 */
export function extractErrorMessage(rawBody: string | null | undefined, fallbackMessage: string): string {
  if (!rawBody) return fallbackMessage;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fallbackMessage;
  }

  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) {
    return fallbackMessage;
  }

  const { error } = parsed as { error: unknown };
  if (typeof error !== 'string' || error.trim() === '') {
    return fallbackMessage;
  }

  return error;
}

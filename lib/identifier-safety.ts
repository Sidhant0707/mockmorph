/**
 * Table and column names end up interpolated directly into generated SQL
 * text (see generation-plan.ts). This is the single gate every identifier —
 * whether it came from the LLM, from locally parsed SQL, or from a
 * client-supplied cache — must pass through before it is allowed anywhere
 * near that interpolation.
 *
 * This closes the gap identified in the forensic audit: a client-supplied
 * semanticMap could previously reach the generated INSERT text with no
 * identifier validation at all.
 */

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

// A short, deliberately non-exhaustive list of reserved words rejected as
// bare identifiers, so a table genuinely named e.g. "order" or "select"
// can't produce SQL that parses in a surprising way.
const RESERVED = new Set([
  'select', 'insert', 'update', 'delete', 'drop', 'table', 'from', 'where',
  'union', 'join', 'order', 'group', 'grant', 'revoke', 'alter', 'create',
  'exec', 'execute', 'into', 'values', 'set',
]);

export function isSafeIdentifier(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (!SAFE_IDENTIFIER.test(name)) return false;
  if (RESERVED.has(name.toLowerCase())) return false;
  return true;
}

/**
 * Defense in depth: quotes an identifier for the given dialect, but only
 * after re-checking it against isSafeIdentifier. A caller that somehow
 * reaches this with an unsafe string gets a thrown error, not silently
 * emitted SQL.
 */
export function quoteIdentifier(name: string, dialect: 'postgres' | 'mysql'): string {
  if (!isSafeIdentifier(name)) {
    throw new Error(`Refusing to quote unsafe identifier: ${JSON.stringify(name)}`);
  }
  return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

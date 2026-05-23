/**
 * CEL/jq expression utilities for Baton SQL configs.
 *
 * Trait and map expressions in baton-sql configs use a jq-flavored CEL-like
 * syntax where `.column_name` references a row-level column. This module
 * provides a minimal extractor for those references.
 */

// Match `.identifier` where the dot is NOT preceded by an identifier character.
// This catches top-level refs like `.col` but not the second half of chains like
// `.profile.first_name` (where the second dot is preceded by 'e').
const COLUMN_REF_RE = /(?<![a-zA-Z0-9_])\.([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Extract top-level column references from a connector expression.
 *
 * Returns an array of unique column names referenced via `.col` syntax.
 * Order matches first-occurrence order in the input. Nested access like
 * `.profile.first_name` returns only `['profile']` — the chain `first_name`
 * is field-access on the column, not a separate column.
 *
 * @example
 *   extractColumnRefs('.login')                                  // ['login']
 *   extractColumnRefs('.first_name + " " + .last_name')          // ['first_name', 'last_name']
 *   extractColumnRefs('slugify(.email)')                         // ['email']
 *   extractColumnRefs('.profile.first_name')                     // ['profile']
 */
export function extractColumnRefs(expr: string): string[] {
  if (typeof expr !== 'string' || expr.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of expr.matchAll(COLUMN_REF_RE)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

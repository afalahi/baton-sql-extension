import { ValidationResult } from './types';
import { allValidationRules } from './rules';
import { hashString } from '../utils/stringUtils';
import { parseQuery } from './parsedQuery';
import { BatonDocument } from './document';

export type RuleErrorHandler = (ruleName: string, error: unknown) => void;

// Single-query cache. The production hot path no longer uses this — the server
// caches Diagnostic[] in documentCache. This cache exists for the validateSql
// shim, which is preserved as a public single-query entry point for tests and
// any external callers.
const validationCache = new Map<string, ValidationResult[]>();

/**
 * Validate a single SQL string. PRESERVED EXTERNAL SIGNATURE.
 *
 * Internally, builds a degraded BatonDocument containing only this one
 * ParsedQuery and runs every query-scope rule against it. Document-scope
 * rules are skipped because there's no full YAML document available.
 */
export function validateSql(
  sql: string,
  originalQuery: string,
  onRuleError?: RuleErrorHandler,
): ValidationResult[] {
  // Build the ParsedQuery first so the cache key uses `normalizedSql` —
  // matches the original validateSql, which hashed
  // `normalizeSQL(sql) + originalQuery`. Two raw SQLs that normalize to the
  // same string share a cache slot.
  const query = parseQuery({
    rawSql: sql,
    yamlPath: [],
    startOffset: 0,
    endOffset: sql.length,
    varsScope: new Map(),
  });
  const cacheKey = hashString(query.normalizedSql + originalQuery);
  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  // Build a single-query degraded BatonDocument. NOTE: `yamlContent` holds
  // raw `originalQuery` — in this back-compat path callers typically pass
  // `(sql, sql)`, so `yamlContent` is the SQL string itself, not YAML. Rules
  // that scan `yamlContent` for YAML-shape patterns will find nothing, which
  // is correct: there's no document context for single-query validation.
  const document: BatonDocument = {
    yaml: null,
    yamlContent: originalQuery,
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [query],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };

  const results: ValidationResult[] = [];
  for (const rule of allValidationRules) {
    if (rule.scope === 'document') continue;
    try {
      const out = rule.validate(query.normalizedSql, originalQuery, { query, document });
      const arr = Array.isArray(out) ? out : [out];
      for (const r of arr) {
        if (!r.isValid) {
          results.push({
            ...r,
            errorMessage: r.errorMessage || `Validation failed for rule: ${rule.name}`,
          });
        }
      }
    } catch (error) {
      if (onRuleError) {
        onRuleError(rule.name, error);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[baton-sql] rule '${rule.name}' threw: ${msg}`);
      }
    }
  }

  validationCache.set(cacheKey, results);
  return results;
}

export function clearValidationCache(): void {
  validationCache.clear();
}

export function getCacheSize(): number {
  return validationCache.size;
}

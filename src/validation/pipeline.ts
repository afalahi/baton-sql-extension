import { Diagnostic } from 'vscode-languageserver/node';
import { ValidationResult } from './types';
import { allValidationRules } from './rules';
import { BatonDocument, buildBatonDocument } from './document';
import { ParsedQuery } from './parsedQuery';

export type RuleErrorHandler = (ruleName: string, error: unknown) => void;

export interface PipelineResult {
  /** The validation result emitted by the rule. */
  result: ValidationResult;
  /** The query this result refers to (undefined for document-scope rules). */
  query?: ParsedQuery;
  /** Name of the rule that produced it (for logging / diagnostic.source). */
  ruleName: string;
}

/** Server-side cache of diagnostics keyed by content hash. */
export const documentCache = new Map<string, Diagnostic[]>();

/** Side index: which content hash a given URI currently corresponds to. */
export const uriToHash = new Map<string, string>();

/**
 * Remove a URI's reference to its cached diagnostics. Only drops the cache
 * entry if no other URI still references the same content hash — this matters
 * when multiple workspaces or duplicated files share identical content.
 */
export function evictUri(uri: string): void {
  const hash = uriToHash.get(uri);
  if (hash === undefined) return;
  uriToHash.delete(uri);
  // After this URI is gone, check whether any other URI still references the hash.
  let stillReferenced = false;
  for (const h of uriToHash.values()) {
    if (h === hash) { stillReferenced = true; break; }
  }
  if (!stillReferenced) {
    documentCache.delete(hash);
  }
}

/**
 * Build a BatonDocument, run every rule, return the document and the per-rule results.
 * Conversion to LSP Diagnostic and dedup happens in server.ts using the returned data.
 *
 * Loop order matters: queries-OUTER, rules-INNER. This mirrors today's
 * `for (queryInfo) { validateSql(...) }` from src/server/server.ts so the dedup
 * outcome (which keeps the first equal diagnostic) is byte-identical with v1.4.0.
 * Document-scope rules run after all query-scope iterations for the same reason.
 */
export function validateDocument(
  yamlContent: string,
  onRuleError?: RuleErrorHandler,
): { document: BatonDocument; results: PipelineResult[] } {
  const document = buildBatonDocument(yamlContent);
  const results: PipelineResult[] = [];

  const runRule = (rule: typeof allValidationRules[number], sql: string, query?: ParsedQuery) => {
    try {
      const out = rule.validate(sql, yamlContent, { query, document });
      const arr = Array.isArray(out) ? out : [out];
      for (const result of arr) {
        if (!result.isValid) {
          results.push({
            result: { ...result, errorMessage: result.errorMessage || `Validation failed for rule: ${rule.name}` },
            query,
            ruleName: rule.name,
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
  };

  // Queries OUTER, rules INNER (matches today's server.ts ordering).
  for (const query of document.queries) {
    for (const rule of allValidationRules) {
      if (rule.scope === 'document') continue;
      runRule(rule, query.normalizedSql, query);
    }
  }
  // Document-scope rules run after all query-scope iterations.
  for (const rule of allValidationRules) {
    if (rule.scope !== 'document') continue;
    runRule(rule, '', undefined);
  }

  return { document, results };
}

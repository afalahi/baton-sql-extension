import { ValidationResult, ValidationRule, SQLQueryInfo } from './types';
import { normalizeSQL } from '../utils/sqlUtils';
import { hashString } from '../utils/stringUtils';
import { allValidationRules } from './rules';

export type RuleErrorHandler = (ruleName: string, error: unknown) => void;

// Caching system to avoid reprocessing unchanged SQL
const validationCache = new Map<string, ValidationResult[]>();

/**
 * Validates a single SQL query using all validation rules.
 *
 * If a rule throws, the error is reported via `onRuleError` but validation
 * continues with the remaining rules — one bad rule must not break the others.
 */
export function validateSql(
  sql: string,
  originalQuery: string,
  onRuleError?: RuleErrorHandler
): ValidationResult[] {
  const normalizedSql = normalizeSQL(sql);
  const cacheKey = hashString(normalizedSql + originalQuery);

  // Check cache first
  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const results: ValidationResult[] = [];

  // Apply all validation rules
  for (const rule of allValidationRules) {
    try {
      const result = rule.validate(normalizedSql, originalQuery);
      if (!result.isValid) {
        results.push({
          ...result,
          errorMessage: result.errorMessage || `Validation failed for rule: ${rule.name}`
        });
      }
    } catch (error) {
      // A throwing rule must not break the others, but the error needs to
      // surface somewhere or bugs are invisible. Default: log to console.error.
      if (onRuleError) {
        onRuleError(rule.name, error);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[baton-sql] rule '${rule.name}' threw: ${msg}`);
      }
    }
  }

  // Cache the results
  validationCache.set(cacheKey, results);

  return results;
}

/**
 * Clears the validation cache (useful for testing or memory management)
 */
export function clearValidationCache(): void {
  validationCache.clear();
}

/**
 * Gets the current cache size (for debugging)
 */
export function getCacheSize(): number {
  return validationCache.size;
}
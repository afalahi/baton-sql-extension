import { ValidationResult, ValidationRule, SQLQueryInfo } from './types';
import { normalizeSQL } from '../utils/sqlUtils';
import { hashString } from '../utils/stringUtils';
import { allValidationRules } from './rules';

// Caching system to avoid reprocessing unchanged SQL
const validationCache = new Map<string, ValidationResult[]>();

/**
 * Validates a single SQL query using all validation rules
 */
export function validateSql(sql: string, originalQuery: string): ValidationResult[] {
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
      // Don't fail the whole validation if one rule has an error
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
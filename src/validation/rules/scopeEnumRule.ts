import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { areWordsSimilar } from '../../utils/stringUtils';

const VALID_SCOPES = new Set(['', 'cluster']);

/**
 * Validates the `scope:` field on list/entitlements/grants[]. Matches
 * baton-sql/pkg/bsql/validate.go's validateScope: only "" or "cluster" are
 * accepted. Anything else is a typo; if within Levenshtein distance 2 of
 * "cluster", surface a did-you-mean suggestion.
 */
export const scopeEnumRule: ValidationRule = {
  name: 'scope-enum',
  description: "Validate scope: field is empty or 'cluster'",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const checkScope = (scope: string | undefined, label: string) => {
      if (scope === undefined) return;
      if (VALID_SCOPES.has(scope)) return;
      const suggestion = areWordsSimilar(scope.toLowerCase(), 'cluster', 2)
        ? `Did you mean 'cluster'?`
        : `must be empty or 'cluster'.`;
      results.push({
        isValid: false,
        errorMessage: `Invalid scope '${scope}' on ${label}: ${suggestion}`,
        lineNumber: findScopeLineNumber(yamlContent, scope),
      });
    };

    for (const [rtId, rt] of doc.resourceTypes) {
      if (rt.list?.scope !== undefined) {
        checkScope(rt.list.scope, `resource_types.${rtId}.list.scope`);
      }
      if (rt.entitlements?.scope !== undefined) {
        checkScope(rt.entitlements.scope, `resource_types.${rtId}.entitlements.scope`);
      }
      for (let i = 0; i < rt.grants.length; i++) {
        if (rt.grants[i].scope !== undefined) {
          checkScope(rt.grants[i].scope, `resource_types.${rtId}.grants[${i}].scope`);
        }
      }
    }

    return results;
  },
};

/**
 * Locate the line in yamlContent that contains `scope: <bad-value>`.
 * Returns undefined when not found; caller's diagnostic anchors to the
 * default range in that case.
 */
function findScopeLineNumber(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue comes from typed BatonDocument, not user input through a vulnerable channel
  const pattern = new RegExp(`scope:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}

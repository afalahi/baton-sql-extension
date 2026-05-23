import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { looksLikeLiteralReference, areWordsSimilar, levenshteinDistance } from '../../utils/stringUtils';

/**
 * Flags grants[].map[].principal_type values that look like literal references
 * but don't name any defined resource_type. Expression-style values (with
 * dots, quotes, operators, etc.) are skipped to avoid false positives.
 */
export const principalTypeReferenceRule: ValidationRule = {
  name: 'principal-type-reference',
  description: 'Validate grants[].map[].principal_type references a defined resource_type',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const known = doc.knownResourceTypeIds;
    if (known.size === 0) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      for (let gi = 0; gi < rt.grants.length; gi++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const grant = rt.grants[gi];
        if (!Array.isArray(grant.map)) continue;

        for (let mi = 0; mi < grant.map.length; mi++) {
          // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
          const mapping = grant.map[mi];
          if (!mapping || typeof mapping !== 'object') continue;
          const value = mapping.principal_type;
          if (typeof value !== 'string' || value.length === 0) continue;
          if (!looksLikeLiteralReference(value)) continue;
          if (known.has(value)) continue;

          const suggestion = findClosestMatch(value, known);
          const message = suggestion
            ? `principal_type '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] is not a defined resource_type. Did you mean '${suggestion}'?`
            : `principal_type '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] is not a defined resource_type.`;

          results.push({
            isValid: false,
            errorMessage: message,
            lineNumber: findPrincipalTypeLine(yamlContent, value),
          });
        }
      }
    }

    return results;
  },
};

function findClosestMatch(value: string, candidates: Set<string>): string | undefined {
  const lower = value.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (!areWordsSimilar(lower, c.toLowerCase(), 2)) continue;
    const d = levenshteinDistance(lower, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function findPrincipalTypeLine(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue is matched as a fixed escaped string
  const pattern = new RegExp(`principal_type:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}

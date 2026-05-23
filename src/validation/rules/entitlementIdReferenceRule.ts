import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { looksLikeLiteralReference, areWordsSimilar, levenshteinDistance } from '../../utils/stringUtils';

/**
 * Flags grants[].map[].entitlement_id values that look like literal references
 * but don't match any id in static_entitlements (definedEntitlementIds.literal).
 *
 * Skipped when:
 *  - The value is expression-style (dots, quotes, operators).
 *  - The document defines no static_entitlements (literal set is empty) — every
 *    literal-looking value could legitimately be a column name or template
 *    output, so flagging would produce too many false positives.
 *
 * Spec deviation: the spec (line 270) calls for a "softer 'not verifiable' hint"
 * on documents whose entitlements come from CEL expressions. ValidationResult
 * has no severity field yet (every diagnostic ships as an error), so PR6 takes
 * the safest conservative interpretation: skip entirely rather than over-report.
 * A future PR can add severity + promote this to an info/hint diagnostic.
 */
export const entitlementIdReferenceRule: ValidationRule = {
  name: 'entitlement-id-reference',
  description: 'Validate grants[].map[].entitlement_id references a defined entitlement',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    const literalIds = doc.definedEntitlementIds.literal;
    if (literalIds.size === 0) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      for (let gi = 0; gi < rt.grants.length; gi++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const grant = rt.grants[gi];
        if (!Array.isArray(grant.map)) continue;

        for (let mi = 0; mi < grant.map.length; mi++) {
          // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
          const mapping = grant.map[mi];
          if (!mapping || typeof mapping !== 'object') continue;
          const value = mapping.entitlement_id;
          if (typeof value !== 'string' || value.length === 0) continue;
          if (!looksLikeLiteralReference(value)) continue;
          if (literalIds.has(value)) continue;

          const suggestion = findClosestMatch(value, literalIds);
          const message = suggestion
            ? `entitlement_id '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] does not match any defined entitlement. Did you mean '${suggestion}'?`
            : `entitlement_id '${value}' in resource_types.${rtId}.grants[${gi}].map[${mi}] does not match any defined entitlement.`;

          results.push({
            isValid: false,
            errorMessage: message,
            lineNumber: findEntitlementIdLine(yamlContent, value),
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

function findEntitlementIdLine(yamlContent: string, badValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // eslint-disable-next-line security/detect-non-literal-regexp -- badValue is matched as a fixed escaped string
  const pattern = new RegExp(`entitlement_id:\\s*['"]?${badValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}

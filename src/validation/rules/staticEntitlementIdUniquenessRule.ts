import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates that static_entitlements[].id values are unique within each
 * resource_type. The connector treats the (resource_type, id) pair as the
 * entitlement's primary key, so a duplicate id within one resource type
 * silently drops one of the two configs.
 */
export const staticEntitlementIdUniquenessRule: ValidationRule = {
  name: 'static-entitlement-uniqueness',
  description: 'Validate static_entitlements[].id values are unique within each resource_type',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const seen = new Set<string>();
      for (let i = 0; i < rt.staticEntitlements.length; i++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const se = rt.staticEntitlements[i];
        const id = se.id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (!seen.has(id)) {
          seen.add(id);
          continue;
        }
        results.push({
          isValid: false,
          errorMessage: `Duplicate static_entitlements id '${id}' in resource_types.${rtId} (index ${i}).`,
          lineNumber: findDuplicateIdLine(yamlContent, rtId, id, i),
        });
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: locate the n-th `id: <duplicate-value>` occurrence
 * under the named resource type's static_entitlements block.
 */
function findDuplicateIdLine(
  yamlContent: string,
  rtId: string,
  duplicateId: string,
  duplicateIndex: number,
): number | undefined {
  const lines = yamlContent.split('\n');
  let inRt = false;
  let inSE = false;
  let count = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith(`${rtId}:`)) {
      inRt = true;
      inSE = false;
      count = -1;
      continue;
    }
    if (!inRt) continue;

    if (trimmed === 'static_entitlements:') {
      inSE = true;
      continue;
    }
    if (!inSE) continue;

    // Match `- id: <duplicateId>` or `id: <duplicateId>` on its own line.
    const trimmedNoDash = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed;
    if (trimmedNoDash === `id: ${duplicateId}` || trimmedNoDash === `id: "${duplicateId}"` || trimmedNoDash === `id: '${duplicateId}'`) {
      count += 1;
      if (count === duplicateIndex) {
        return i;
      }
    }
  }

  return undefined;
}

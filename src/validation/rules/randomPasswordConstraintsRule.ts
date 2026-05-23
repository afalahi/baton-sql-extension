import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Mirrors bsql/validate.go's validatePasswordConstraints. Walks each
 * resource type's account_provisioning.credentials.random_password.constraints
 * and reports any entry with empty char_set or min_count <= 0.
 */
export const randomPasswordConstraintsRule: ValidationRule = {
  name: 'random-password-constraints',
  description: 'Validate account_provisioning.credentials.random_password.constraints',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const constraints = rt.accountProvisioning?.credentials?.random_password?.constraints;
      if (!Array.isArray(constraints)) continue;

      for (let i = 0; i < constraints.length; i++) {
        // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
        const c = constraints[i];
        if (!c || typeof c !== 'object') continue;

        const charSet = c.char_set;
        const minCount = c.min_count;

        if (typeof charSet !== 'string' || charSet === '') {
          results.push({
            isValid: false,
            errorMessage: `random password constraint[${i}] in resource_types.${rtId}: char_set must be non-empty.`,
            lineNumber: findConstraintLineNumber(yamlContent, rtId, i, 'char_set'),
          });
        }

        if (typeof minCount !== 'number' || minCount <= 0) {
          results.push({
            isValid: false,
            errorMessage: `random password constraint[${i}] in resource_types.${rtId}: min_count must be greater than zero.`,
            lineNumber: findConstraintLineNumber(yamlContent, rtId, i, 'min_count'),
          });
        }
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: walks yamlContent looking for the key (`char_set:`
 * or `min_count:`) under a constraints: block inside the named resource type's
 * random_password section. Returns undefined on failure so the server uses
 * its default range.
 */
function findConstraintLineNumber(
  yamlContent: string,
  rtId: string,
  constraintIndex: number,
  key: 'char_set' | 'min_count'
): number | undefined {
  const lines = yamlContent.split('\n');
  let inRt = false;
  let inConstraints = false;
  let dashCount = -1;

  // Exact-match check for the resource type key line. Matches `<rtId>:` exactly
  // or `<rtId>: <inline-value>` — not `<rtId-prefix>...:`.
  const matchesRtKey = (trimmed: string): boolean => {
    if (!trimmed.startsWith(rtId)) return false;
    const after = trimmed.slice(rtId.length);
    return after === ':' || after.startsWith(': ');
  };

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();

    if (matchesRtKey(trimmed)) {
      inRt = true;
      inConstraints = false;
      dashCount = -1;
      continue;
    }
    if (!inRt) continue;

    if (trimmed === 'constraints:') {
      inConstraints = true;
      dashCount = -1;
      continue;
    }
    if (!inConstraints) continue;

    if (trimmed.startsWith('- ')) {
      dashCount += 1;
      if (dashCount === constraintIndex && trimmed.includes(`${key}:`)) {
        return i;
      }
      continue;
    }
    if (dashCount === constraintIndex && trimmed.startsWith(`${key}:`)) {
      return i;
    }
  }

  return undefined;
}

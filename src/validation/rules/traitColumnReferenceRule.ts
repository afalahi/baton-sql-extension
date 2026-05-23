import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';
import { extractColumnRefs } from '../../utils/celUtils';
import { extractSelectColumns } from '../../utils/sqlUtils';

/**
 * Validates that every column referenced inside resource_types.<rt>.list.map.traits
 * is actually selected (or aliased) by the corresponding list.query. Skips when:
 *  - The list.query AST failed to parse (no ground truth to compare against).
 *  - The query uses SELECT * (every column might be present).
 *  - extractSelectColumns produces an empty set (unknown SELECT shape).
 *
 * Walks traits recursively (handles UserTraitMapping.profile which is an
 * arbitrary nested object, plus array-valued fields like emails/login_aliases).
 */
export const traitColumnReferenceRule: ValidationRule = {
  name: 'trait-column-reference',
  description: 'Validate trait expressions reference columns the list.query selects',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [rtId, rt] of doc.resourceTypes) {
      const ast = rt.list?.query?.ast;
      if (!ast) continue;
      const map = rt.list?.map;
      if (!map || typeof map !== 'object') continue;
      const traits = map.traits;
      if (!traits || typeof traits !== 'object') continue;

      const { columns, hasWildcard } = extractSelectColumns(ast);
      if (hasWildcard) continue;
      if (columns.size === 0) continue;

      for (const role of Object.keys(traits)) {
        // eslint-disable-next-line security/detect-object-injection -- role is iterating own keys
        const roleMap = traits[role];
        walkTraitValue(roleMap, [rtId, role], columns, yamlContent, results);
      }
    }

    return results;
  },
};

/**
 * Recursively walks a trait value (which may be string, array, or nested object)
 * and flags column refs not present in `columns`. The `path` array is used only
 * for diagnostic messages.
 */
function walkTraitValue(
  value: unknown,
  path: string[],
  columns: Set<string>,
  yamlContent: string,
  results: ValidationResult[],
): void {
  if (typeof value === 'string') {
    const refs = extractColumnRefs(value);
    for (const ref of refs) {
      if (columns.has(ref)) continue;
      results.push({
        isValid: false,
        errorMessage: `Trait at resource_types.${path[0]}.list.map.traits.${path.slice(1).join('.')} references '.${ref}', but that column is not selected by list.query.`,
        lineNumber: findReferenceLine(yamlContent, value),
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
      walkTraitValue(value[i], [...path, String(i)], columns, yamlContent, results);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      // eslint-disable-next-line security/detect-object-injection -- k is iterating own keys
      walkTraitValue((value as Record<string, unknown>)[k], [...path, k], columns, yamlContent, results);
    }
    return;
  }
}

/**
 * Best-effort line anchor: find the line containing the trait expression value.
 * Falls back to undefined when not located.
 */
function findReferenceLine(yamlContent: string, exprValue: string): number | undefined {
  const lines = yamlContent.split('\n');
  // Escape the expression for use as a fixed substring match.
  const needle = exprValue.trim();
  if (needle.length === 0) return undefined;
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (lines[i].includes(needle)) return i;
  }
  return undefined;
}

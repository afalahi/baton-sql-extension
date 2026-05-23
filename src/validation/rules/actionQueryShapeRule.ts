import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates each ActionConfig has exactly one of `query` (single SQL string)
 * or `queries` (array of SQL strings). Mirrors the schema's oneOf constraint
 * but provides a clearer message than Red Hat YAML's schema error output.
 */
export const actionQueryShapeRule: ValidationRule = {
  name: 'action-query-shape',
  description: "Validate each action has exactly one of 'query' or 'queries'",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [actionId, action] of doc.actions) {
      const hasQuery = action.query != null;
      const hasQueries = Array.isArray(action.queries) && action.queries.length > 0;

      if (hasQuery && hasQueries) {
        results.push({
          isValid: false,
          errorMessage: `actions.${actionId}: must specify exactly one of 'query' or 'queries', not both.`,
          lineNumber: findActionLineNumber(yamlContent, actionId),
        });
      } else if (!hasQuery && !hasQueries) {
        results.push({
          isValid: false,
          errorMessage: `actions.${actionId}: must specify either 'query' or 'queries'.`,
          lineNumber: findActionLineNumber(yamlContent, actionId),
        });
      }
    }

    return results;
  },
};

/**
 * Locate the line containing `<actionId>:` as a direct child of `actions:`.
 * Tracks the indent of the first child to avoid false-matching nested keys
 * that happen to share the action ID. Returns undefined when not found;
 * diagnostic falls back to the default range.
 */
function findActionLineNumber(yamlContent: string, actionId: string): number | undefined {
  const lines = yamlContent.split('\n');
  let inActions = false;
  let actionsIndent = -1;
  let childIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = line.length - line.trimStart().length;

    if (trimmed === 'actions:') {
      inActions = true;
      actionsIndent = indent;
      childIndent = -1;
      continue;
    }
    if (!inActions) continue;

    // Leaving the actions block when indent returns to actions level or above.
    if (indent <= actionsIndent) {
      inActions = false;
      continue;
    }

    // Lock to the first child indent. Only match action keys at exactly that level.
    if (childIndent < 0) childIndent = indent;
    if (indent !== childIndent) continue;

    if (trimmed.startsWith(actionId)) {
      const after = trimmed.slice(actionId.length);
      if (after === ':' || after.startsWith(': ')) {
        return i;
      }
    }
  }

  return undefined;
}

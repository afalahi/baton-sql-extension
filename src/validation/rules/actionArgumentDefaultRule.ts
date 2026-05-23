import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates that an action argument with `required: true` does not also
 * specify a `default` value. The two are semantically contradictory — if the
 * user must provide a value, a default is meaningless. The schema's
 * ArgumentConfig.default description notes this constraint but does not
 * structurally enforce it; this rule promotes it to a real check.
 */
export const actionArgumentDefaultRule: ValidationRule = {
  name: 'arg-required-default',
  description: "Validate action arguments don't combine required: true with default",
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const doc = ctx?.document;
    if (!doc) return results;

    for (const [actionId, action] of doc.actions) {
      const args = action.arguments;
      if (!args || typeof args !== 'object') continue;

      for (const [argName, arg] of Object.entries(args)) {
        if (!arg || typeof arg !== 'object') continue;
        const required = (arg as Record<string, unknown>).required;
        const defaultValue = (arg as Record<string, unknown>).default;

        if (required === true && defaultValue !== undefined) {
          results.push({
            isValid: false,
            errorMessage: `actions.${actionId}.arguments.${argName}: 'default' must not be set when 'required' is true.`,
            lineNumber: findArgDefaultLineNumber(yamlContent, actionId, argName),
          });
        }
      }
    }

    return results;
  },
};

/**
 * Best-effort line anchor: locate the `default:` key under the named argument
 * inside the named action. State machine tracks indent levels so it correctly
 * exits the action / arguments / arg block when indent drops, instead of
 * leaking into later siblings that happen to share an arg name. Falls back to
 * the argument name line if `default:` is not on its own line.
 */
function findArgDefaultLineNumber(
  yamlContent: string,
  actionId: string,
  argName: string
): number | undefined {
  const lines = yamlContent.split('\n');
  let actionsIndent = -1;
  let actionIndent = -1;
  let argsIndent = -1;
  let argIndent = -1;
  let inActions = false;
  let inAction = false;
  let inArguments = false;
  let inArg = false;
  let argLine = -1;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = line.length - line.trimStart().length;

    // Exit nested blocks when indent drops back to or above their parent level.
    if (inArg && indent <= argIndent) {
      inArg = false;
    }
    if (inArguments && indent <= argsIndent) {
      inArguments = false;
      inArg = false;
    }
    if (inAction && indent <= actionIndent) {
      inAction = false;
      inArguments = false;
      inArg = false;
    }
    if (inActions && indent <= actionsIndent && trimmed !== 'actions:') {
      inActions = false;
      inAction = false;
      inArguments = false;
      inArg = false;
    }

    if (trimmed === 'actions:') {
      inActions = true;
      actionsIndent = indent;
      continue;
    }
    if (!inActions) continue;

    if (!inAction && matchesKey(trimmed, actionId)) {
      inAction = true;
      actionIndent = indent;
      continue;
    }
    if (!inAction) continue;

    if (!inArguments && trimmed === 'arguments:') {
      inArguments = true;
      argsIndent = indent;
      continue;
    }
    if (!inArguments) continue;

    if (!inArg && matchesKey(trimmed, argName)) {
      inArg = true;
      argIndent = indent;
      argLine = i;
      continue;
    }
    if (!inArg) continue;

    if (trimmed.startsWith('default:')) {
      return i;
    }
  }

  return argLine >= 0 ? argLine : undefined;
}

function matchesKey(trimmed: string, key: string): boolean {
  if (!trimmed.startsWith(key)) return false;
  const after = trimmed.slice(key.length);
  return after === ':' || after.startsWith(': ');
}

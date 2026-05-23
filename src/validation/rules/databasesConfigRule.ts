import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Validates connect.databases (per-database iteration config): exactly one of
 * `static` (a non-empty array of database names) or `discovery_query` (a
 * non-empty SQL string). The JSON schema enforces the same constraint via
 * oneOf; this rule provides faster in-editor feedback.
 */
export const databasesConfigRule: ValidationRule = {
  name: 'databases-config',
  description: 'Validate connect.databases has exactly one of static or discovery_query',
  scope: 'document',
  validate: (_sql: string, yamlContent: string, ctx?: RuleContext): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const databases = ctx?.document?.connect?.databases;
    if (!databases) return results;

    const hasStatic = Array.isArray(databases.static) && databases.static.length > 0;
    const hasDiscovery =
      typeof databases.discovery_query === 'string' && databases.discovery_query.length > 0;

    if (hasStatic && hasDiscovery) {
      results.push({
        isValid: false,
        errorMessage:
          "connect.databases must specify exactly one of 'static' or 'discovery_query', not both.",
        lineNumber: findDatabasesLineNumber(yamlContent),
      });
    }

    return results;
  },
};

function findDatabasesLineNumber(yamlContent: string): number | undefined {
  const lines = yamlContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index from for-loop counter
    if (/^\s*databases:\s*$/.test(lines[i])) {
      return i;
    }
  }
  return undefined;
}

import { ValidationRule, ValidationResult } from '../types';

/**
 * Validates that variables defined in `vars` are used in the query,
 * and that variables used in the query with ?<variable> syntax are defined in `vars`.
 */
export const varsQueryMismatchRule: ValidationRule = {
  name: "vars-query-mismatch",
  description: "Check for mismatches between vars definitions and query parameter usage",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // This rule only applies when we have access to the YAML context
    // We need to check if there's a vars block and query in the same context

    // Extract all ?<variable> parameters from the SQL query
    const parameterPattern = /\?<(\w+)>/g;
    const usedParameters = new Set<string>();
    let match;

    while ((match = parameterPattern.exec(sql)) !== null) {
      usedParameters.add(match[1]);
    }

    // If no parameters are used, this rule doesn't apply
    if (usedParameters.size === 0) {
      return { isValid: true };
    }

    // Try to find vars block in the YAML context
    // Look for lines like "vars:" followed by "variable_name: value"
    const lines = originalQuery.split('\n');
    let inVarsBlock = false;
    let varsBlockIndent = 0;
    const definedVars = new Set<string>();
    let varsLineNumber = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check if we're entering a vars block
      if (trimmed === 'vars:') {
        inVarsBlock = true;
        varsLineNumber = i;
        varsBlockIndent = line.length - line.trimStart().length;
        continue;
      }

      // Check if we're still in the vars block
      if (inVarsBlock) {
        const currentIndent = line.length - line.trimStart().length;

        // If we hit a line with same or less indentation (and it's not empty), we've left the vars block
        if (trimmed && currentIndent <= varsBlockIndent) {
          inVarsBlock = false;
          continue;
        }

        // Parse variable definitions: "variable_name: value"
        const varMatch = trimmed.match(/^(\w+):\s*.+/);
        if (varMatch) {
          definedVars.add(varMatch[1]);
        }
      }
    }

    // Check for unused variables (defined in vars but not used in query)
    const unusedVars: string[] = [];
    for (const varName of definedVars) {
      if (!usedParameters.has(varName)) {
        unusedVars.push(varName);
      }
    }

    // Check for undefined variables (used in query but not defined in vars)
    const undefinedVars: string[] = [];
    for (const paramName of usedParameters) {
      if (!definedVars.has(paramName)) {
        undefinedVars.push(paramName);
      }
    }

    // Report unused variables
    if (unusedVars.length > 0 && varsLineNumber !== -1) {
      return {
        isValid: false,
        errorMessage: `Variable(s) defined in 'vars' but not used in query: ${unusedVars.join(', ')}. Either use them in the query with ?<${unusedVars[0]}> or remove them from vars.`,
        lineNumber: varsLineNumber,
      };
    }

    // Report undefined variables (more critical)
    if (undefinedVars.length > 0) {
      // Find the first line where the undefined variable is used
      let errorLineNumber = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`?<${undefinedVars[0]}>`)) {
          errorLineNumber = i;
          break;
        }
      }

      return {
        isValid: false,
        errorMessage: `Query uses parameter ?<${undefinedVars[0]}> but it's not defined in 'vars'. Add '${undefinedVars[0]}: <value>' to the vars block.`,
        lineNumber: errorLineNumber,
      };
    }

    return { isValid: true };
  },
};

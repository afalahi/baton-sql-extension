import { ValidationRule, ValidationResult } from '../types';
import { RuleContext } from '../context';

/**
 * Built-in vars per baton-sql/pkg/bsql/validate.go:validateVarsInQuery.
 * Queries may use these without declaring them in the resource type's
 * `vars:` block.
 */
const BUILTIN_VARS = new Set(['limit', 'offset', 'cursor']);

/**
 * Validates that variables defined in `vars` are used in the query,
 * and that variables used in the query with ?<variable> syntax are defined
 * in `vars` (or are built-in pagination vars).
 *
 * The rule prefers ctx.query.usedParams + ctx.query.varsScope when ctx is
 * set (production pipeline path). Without ctx (direct unit-test calls), it
 * falls back to scanning the sql arg for ?<name> patterns via matchAll and
 * the originalQuery arg for a `vars:` block — preserving existing tests.
 *
 * Diagnostic priority: when BOTH "undefined" and "unused" apply, the rule
 * reports undefined first. The connector errors on undefined; unused is our
 * UX guardrail. Unused fires only when undefined is empty.
 */
export const varsQueryMismatchRule: ValidationRule = {
  name: "vars-query-mismatch",
  description: "Check for mismatches between vars definitions and query parameter usage",
  validate: (sql: string, originalQuery: string, ctx?: RuleContext): ValidationResult => {
    // --- Step 1: collect usedParameters ---
    const usedParameters = new Set<string>();
    if (ctx?.query) {
      // Production path: usedParams was computed from rawSql by parseQuery.
      for (const name of ctx.query.usedParams) {
        usedParameters.add(name);
      }
    } else {
      // Fallback path: scan sql arg directly via matchAll.
      const parameterPattern = /\?<(\w+)>/g;
      for (const match of sql.matchAll(parameterPattern)) {
        usedParameters.add(match[1]);
      }
    }

    // If no parameters are used, this rule doesn't apply.
    if (usedParameters.size === 0) {
      return { isValid: true };
    }

    // --- Step 2: collect definedVars ---
    const definedVars = new Set<string>();
    let varsLineNumber = -1;
    if (ctx?.query) {
      // Production path: use the resolved scope from the document walker.
      for (const name of ctx.query.varsScope.keys()) {
        definedVars.add(name);
      }
      // varsLineNumber is only meaningful for the YAML-scan fallback; when
      // using ctx we don't have a usable per-line index. The unused-vars
      // diagnostic will be emitted without lineNumber in this mode.
    } else {
      // Fallback path: scan originalQuery for a `vars:` block.
      const lines = originalQuery.split('\n');
      let inVarsBlock = false;
      let varsBlockIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === 'vars:') {
          inVarsBlock = true;
          varsLineNumber = i;
          varsBlockIndent = line.length - line.trimStart().length;
          continue;
        }

        if (inVarsBlock) {
          const currentIndent = line.length - line.trimStart().length;
          if (trimmed && currentIndent <= varsBlockIndent) {
            inVarsBlock = false;
            continue;
          }
          const varMatch = trimmed.match(/^(\w+):\s*.+/);
          if (varMatch) {
            definedVars.add(varMatch[1]);
          }
        }
      }
    }

    // --- Step 3: compute unused + undefined, excluding built-ins ---
    const unusedVars: string[] = [];
    for (const varName of definedVars) {
      if (BUILTIN_VARS.has(varName)) continue;
      if (!usedParameters.has(varName)) {
        unusedVars.push(varName);
      }
    }

    const undefinedVars: string[] = [];
    for (const paramName of usedParameters) {
      if (BUILTIN_VARS.has(paramName)) continue;
      if (!definedVars.has(paramName)) {
        undefinedVars.push(paramName);
      }
    }

    // --- Step 4: report ---
    // Priority: undefined first (matches connector's validateVarsInQuery, which
    // errors on undefined vars; the connector doesn't check unused at all —
    // that's our UX guardrail). Unused fires only when undefined is empty.

    if (undefinedVars.length > 0) {
      // In ctx mode we don't have a usable per-line index for the param,
      // so omit lineNumber entirely — the server then anchors the diagnostic
      // to query.startOffset/endOffset (the query span), which is the right
      // place to underline. In fallback mode, scan the originalQuery YAML
      // for the line where the param is used.
      const result: ValidationResult = {
        isValid: false,
        errorMessage: `Query uses parameter ?<${undefinedVars[0]}> but it's not defined in 'vars'. Add '${undefinedVars[0]}: <value>' to the vars block.`,
      };
      if (!ctx?.query) {
        const lines = originalQuery.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`?<${undefinedVars[0]}>`)) {
            result.lineNumber = i;
            break;
          }
        }
      }
      return result;
    }

    if (unusedVars.length > 0) {
      // Emit in both modes. lineNumber is set only when we have a precise
      // YAML position (fallback mode); in ctx mode the diagnostic anchors
      // to the query span via the server's default range conversion.
      const result: ValidationResult = {
        isValid: false,
        errorMessage: `Variable(s) defined in 'vars' but not used in query: ${unusedVars.join(', ')}. Either use them in the query with ?<${unusedVars[0]}> or remove them from vars.`,
      };
      if (varsLineNumber !== -1) {
        result.lineNumber = varsLineNumber;
      }
      return result;
    }

    return { isValid: true };
  },
};

import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

// Helper function to check if SELECT is valid without FROM clause
function isValidSelectWithoutFrom(selectContent: string): boolean {
  const lowerContent = selectContent.toLowerCase().trim();

  // Valid patterns that don't need FROM:
  // 1. Literal values: SELECT 1, SELECT 'text', SELECT 42.5
  if (/^select\s+[\d'"]/.test(lowerContent)) {
    return true;
  }

  // 2. System functions and expressions
  const systemFunctions = [
    'current_date', 'current_time', 'current_timestamp', 'now()',
    'getdate()', 'sysdate', 'user', 'session_user', 'current_user',
    'database()', 'version()', 'connection_id()', 'last_insert_id()',
    'row_count()', 'found_rows()', 'uuid()', 'rand()', 'pi()',
    'abs(', 'ceil(', 'floor(', 'round(', 'sqrt(', 'power(', 'mod(',
    'length(', 'upper(', 'lower(', 'trim(', 'ltrim(', 'rtrim(',
    'substring(', 'concat(', 'coalesce(', 'nullif(', 'greatest(',
    'least(', 'case\\s+when'
  ];

  for (const func of systemFunctions) {
    if (lowerContent.includes(func)) {
      return true;
    }
  }

  // 3. Mathematical expressions: SELECT 2 + 3, SELECT (1 * 5)
  if (/select\s+[\d\s\+\-\*\/\(\)]+$/.test(lowerContent)) {
    return true;
  }

  // 4. Variable assignments or declarations (dialect-specific)
  if (/select\s+@\w+/.test(lowerContent) || /select\s+\$\w+/.test(lowerContent)) {
    return true;
  }

  return false;
}

export const missingFromRule: ValidationRule = {
  name: "missing-from",
  description: "Check for missing FROM clause in SELECT statements",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      if (
        ast &&
        typeof ast === 'object' &&
        'type' in ast &&
        ast.type === "select" &&
        (!('from' in ast) || !ast.from || (Array.isArray(ast.from) && ast.from.length === 0))
      ) {
        // Check if this is a valid SELECT without FROM
        if (isValidSelectWithoutFrom(sql)) {
          return { isValid: true };
        }

        const lineResult = findLineWithPattern(originalQuery, "select", { ignoreCase: true });
        return {
          isValid: false,
          errorMessage: "Missing FROM clause in SELECT statement. Add FROM clause or use system functions/literals if querying constants.",
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
        };
      }
      return { isValid: true };
    } catch (error: any) {
      // If parsing fails, fall back to string-based check
      if (
        sql.toLowerCase().startsWith("select") &&
        !sql.toLowerCase().includes(" from ")
      ) {
        // Check if this is a valid SELECT without FROM using string analysis
        if (isValidSelectWithoutFrom(sql)) {
          return { isValid: true };
        }

        const lineResult = findLineWithPattern(originalQuery, "select", { ignoreCase: true });
        return {
          isValid: false,
          errorMessage: "Missing FROM clause in SELECT statement. Add FROM clause or use system functions/literals if querying constants.",
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
        };
      }
      return { isValid: true };
    }
  },
};
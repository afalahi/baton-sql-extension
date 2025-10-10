import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';

export const unclosedParenthesesRule: ValidationRule = {
  name: "unclosed-parentheses",
  description: "Check for unclosed parentheses",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);
      // If parsing succeeds, parentheses are balanced
      return { isValid: true };
    } catch (error: any) {
      if (error.message?.includes("parenthesis")) {
        const lineNumber = error.location?.line;

        // Try to find where to add the closing parenthesis
        const lines = originalQuery.split('\n');
        let targetLine = lineNumber ? lineNumber - 1 : lines.length - 1;
        if (targetLine < 0) targetLine = 0;
        if (targetLine >= lines.length) targetLine = lines.length - 1;

        const line = lines[targetLine];
        const endOfLine = line.trimEnd().length;

        return {
          isValid: false,
          errorMessage: `${error.message}. Check that all opening parentheses '(' have matching closing parentheses ')'.`,
          lineNumber: lineNumber || undefined,
          suggestedFix: {
            range: {
              start: { line: targetLine, character: endOfLine },
              end: { line: targetLine, character: endOfLine }
            },
            newText: ")"
          }
        };
      }
      return { isValid: true };
    }
  },
};
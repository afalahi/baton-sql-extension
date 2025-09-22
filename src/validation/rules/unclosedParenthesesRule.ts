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
        return {
          isValid: false,
          errorMessage: `${error.message}. Check that all opening parentheses '(' have matching closing parentheses ')'.`,
          lineNumber: lineNumber || undefined,
        };
      }
      return { isValid: true };
    }
  },
};
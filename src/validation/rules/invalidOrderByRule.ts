import { ValidationRule, ValidationResult } from '../types';

export const invalidOrderByRule: ValidationRule = {
  name: "invalid-order-by",
  description: "Check for invalid ORDER BY references",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    const orderByMatch = sql.match(/\border\s+by\s+(\d+)\b/i);
    if (orderByMatch) {
      // Find the ORDER BY line in the original query
      if (originalQuery.includes("\n")) {
        const lines = originalQuery.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (
            lines[i].trim().toLowerCase().includes("order by") &&
            /\border\s+by\s+(\d+)\b/i.test(lines[i])
          ) {
            return {
              isValid: false,
              errorMessage:
                "Using position numbers in ORDER BY is not supported in some SQL dialects. Use column names instead: 'ORDER BY column_name ASC/DESC'.",
              lineNumber: i,
            };
          }
        }
      }

      return {
        isValid: false,
        errorMessage:
          "Using position numbers in ORDER BY is not supported in some SQL dialects. Use column names instead: 'ORDER BY column_name ASC/DESC'.",
        position: sql.indexOf(orderByMatch[0]),
      };
    }

    return { isValid: true };
  },
};
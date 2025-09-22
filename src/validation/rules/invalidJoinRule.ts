import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

export const invalidJoinRule: ValidationRule = {
  name: "invalid-join",
  description: "Check for invalid JOIN syntax",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      if (ast && typeof ast === 'object' && 'type' in ast && ast.type === "select") {
        // Recursively check all joins in the FROM clause
        const checkJoins = (fromClause: any): ValidationResult => {
          if (!fromClause) return { isValid: true };

          // Handle array of tables
          if (Array.isArray(fromClause)) {
            for (const table of fromClause) {
              const result = checkJoins(table);
              if (!result.isValid) return result;
            }
            return { isValid: true };
          }

          // Check if this is a join
          if (fromClause.join) {
            // Verify join has ON clause
            if (!fromClause.on) {
              const lineResult = findLineWithPattern(
                originalQuery,
                fromClause.join,
                { ignoreCase: true }
              );
              return {
                isValid: false,
                errorMessage: `${fromClause.join} statement missing ON clause. Add 'ON table1.column = table2.column' to specify join condition.`,
                lineNumber: lineResult ? lineResult.lineNumber : undefined,
              };
            }
          }

          // Recursively check subqueries
          if (fromClause.table && fromClause.table.type === "select") {
            return checkJoins(fromClause.table.from);
          }

          return { isValid: true };
        };

        return checkJoins((ast as any).from);
      }
      return { isValid: true };
    } catch (error: any) {
      // If parsing fails, fall back to string-based check
      if (sql.toLowerCase().includes(" join ")) {
        const lines = originalQuery.split("\n");
        let pendingJoins: number[] = [];

        for (let i = 0; i < lines.length; i++) {
          const trimmedLine = lines[i].trim().toLowerCase();
          if (!trimmedLine) continue;

          if (
            trimmedLine.includes(" join ") ||
            trimmedLine.startsWith("join ")
          ) {
            if (!trimmedLine.includes(" on ")) {
              pendingJoins.push(i);
            }
          }

          if (trimmedLine.includes(" on ")) {
            pendingJoins = pendingJoins.filter((j) => j !== i - 1);
          }
        }

        if (pendingJoins.length > 0) {
          return {
            isValid: false,
            errorMessage: "JOIN statement missing ON clause. Add 'ON table1.column = table2.column' to specify join condition.",
            lineNumber: pendingJoins[0],
          };
        }
      }
      return { isValid: true };
    }
  },
};
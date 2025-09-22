import { ValidationRule, ValidationResult } from '../types';
import { getParser, hasAggregateFunction, hasGroupBy } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

export const invalidGroupByRule: ValidationRule = {
  name: "invalid-group-by",
  description: "Check for aggregate functions without GROUP BY",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      if (ast && typeof ast === 'object' && 'type' in ast && ast.type === "select") {
        const selectAst = ast as any;
        // Check if there's a GROUP BY clause
        const hasGroupByClause = selectAst.groupby && selectAst.groupby.length > 0;

        // Analyze columns for aggregate functions
        let hasAggregates = false;
        let hasNonAggregates = false;

        if (Array.isArray(selectAst.columns)) {
          for (const column of selectAst.columns) {
            if (column.expr && column.expr.type === "aggr_func") {
              hasAggregates = true;
            } else if (column.expr && column.expr.type === "column_ref") {
              // This is a regular column reference
              hasNonAggregates = true;
            } else if (typeof column === "string" && column !== "*") {
              // Simple column name
              hasNonAggregates = true;
            }
          }
        }

        // If we have both aggregates and non-aggregates but no GROUP BY
        if (hasAggregates && hasNonAggregates && !hasGroupByClause) {
          const lineResult = findLineWithPattern(originalQuery, "select", { ignoreCase: true });
          return {
            isValid: false,
            errorMessage:
              "Mixing aggregate functions with non-aggregated columns requires GROUP BY. Add 'GROUP BY column_name' or use only aggregate functions.",
            lineNumber: lineResult ? lineResult.lineNumber : undefined,
          };
        }
      }
      return { isValid: true };
    } catch (error: any) {
      // Fall back to string-based check
      const hasAggregates = /(count|sum|avg|min|max|group_concat)\s*\(/i.test(sql);
      const hasGroupByClause = /\bgroup\s+by\b/i.test(sql);

      if (
        hasAggregates &&
        !hasGroupByClause &&
        !/\bcount\s*\(\s*\*\s*\)/i.test(sql)
      ) {
        // Has aggregate functions but no GROUP BY, and not just COUNT(*)
        const columns = sql
          .substring(
            sql.toLowerCase().indexOf("select") + 6,
            sql.toLowerCase().indexOf(" from ")
          )
          .split(",");

        // If there are both aggregates and non-aggregates, there should be a GROUP BY
        let hasNonAggregates = false;
        for (const col of columns) {
          if (!/(count|sum|avg|min|max|group_concat)\s*\(/i.test(col)) {
            hasNonAggregates = true;
            break;
          }
        }

        if (hasNonAggregates) {
          // Find the SELECT line in the original query
          if (originalQuery.includes("\n")) {
            const lines = originalQuery.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().toLowerCase().startsWith("select")) {
                return {
                  isValid: false,
                  errorMessage:
                    "Mixing aggregate functions with non-aggregated columns requires GROUP BY. Add 'GROUP BY column_name' or use only aggregate functions.",
                  lineNumber: i,
                };
              }
            }
          }

          return {
            isValid: false,
            errorMessage:
              "Mixing aggregate functions with non-aggregated columns requires GROUP BY. Add 'GROUP BY column_name' or use only aggregate functions.",
            position: sql.toLowerCase().indexOf("select"),
          };
        }
      }

      return { isValid: true };
    }
  },
};
import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

export const ambiguousColumnsRule: ValidationRule = {
  name: "ambiguous-columns",
  description: "Check for potentially ambiguous column references",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      if (ast && typeof ast === 'object' && 'type' in ast && ast.type === "select") {
        const selectAst = ast as any;
        // Check if we have multiple tables (FROM + JOINs)
        let tableCount = 0;
        const tables: string[] = [];

        // Count tables in FROM clause
        if (selectAst.from) {
          const fromTables = Array.isArray(selectAst.from) ? selectAst.from : [selectAst.from];
          tableCount += fromTables.length;

          // Extract table names/aliases for better error reporting
          fromTables.forEach((table: any) => {
            if (table.table) {
              tables.push(table.as || table.table);
            }

            // Check for JOINs in the table structure
            let current = table;
            while (current && current.join) {
              tableCount++;
              if (current.table) {
                tables.push(current.as || current.table);
              }
              const next = current.left || current.right;
              if (!next) break;
              current = next;
            }
          });
        }

        // If multiple tables, check for SELECT *
        if (tableCount > 1) {
          const columns = selectAst.columns;
          if (
            columns === "*" ||
            (Array.isArray(columns) &&
              columns.some((col: any) => col.expr === "*"))
          ) {
            const lineResult = findLineWithPattern(originalQuery, "select *", { ignoreCase: true });
            return {
              isValid: false,
              errorMessage: `Using * with multiple tables (${tables.join(
                ", "
              )}) can lead to ambiguous columns. Specify column names explicitly or use table prefixes like 'table1.*, table2.column_name'.`,
              lineNumber: lineResult ? lineResult.lineNumber : undefined,
            };
          }

          // Could also check for unqualified column references here
          // but that would require more complex AST analysis
        }
      }
      return { isValid: true };
    } catch (error: any) {
      // Fall back to string-based check
      const sqlLower = sql.toLowerCase();
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: no nested quantifiers, bounded by SQL query length
      const fromMatches = sqlLower.match(/\bfrom\b\s+(\w+)(?:\s+as\s+(\w+))?/i);
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: no nested quantifiers, bounded by SQL query length
      const joinMatches = sqlLower.match(/\bjoin\b\s+(\w+)(?:\s+as\s+(\w+))?/gi);

      if (fromMatches && joinMatches) {
        // Multiple tables, look for SELECT *
        const selectClause = sql
          .substring(0, sql.toLowerCase().indexOf(" from "))
          .trim();
        if (selectClause.toLowerCase().includes("select *")) {
          // Find the SELECT line in the original query
          if (originalQuery.includes("\n")) {
            const lines = originalQuery.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().toLowerCase().includes("select *")) {
                return {
                  isValid: false,
                  errorMessage:
                    "Using * with multiple tables can lead to ambiguous columns. Specify column names explicitly or use table prefixes.",
                  lineNumber: i,
                };
              }
            }
          }

          return {
            isValid: false,
            errorMessage:
              "Using * with multiple tables can lead to ambiguous columns. Specify column names explicitly or use table prefixes.",
            position: sql.toLowerCase().indexOf("select *"),
          };
        }
      }

      return { isValid: true };
    }
  },
};
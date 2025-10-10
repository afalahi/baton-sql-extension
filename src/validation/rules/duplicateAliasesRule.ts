import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

// Helper function to find position in original query
function findPositionInOriginalQuery(originalQuery: string, sql: string, sqlPosition: number): number {
  // This is a simplified version - in practice, you'd need more sophisticated mapping
  return sqlPosition;
}

export const duplicateAliasesRule: ValidationRule = {
  name: "duplicate-aliases",
  description: "Check for duplicate table aliases",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      const aliases = new Set<string>();

      if (ast && typeof ast === 'object' && 'type' in ast && ast.type === "select") {
        const selectAst = ast as any;
        // Check aliases in FROM clause
        if (selectAst.from) {
          // Extract all table references from the AST
          const extractTableAliases = (fromClause: any): { table: string; alias: string; type: string }[] => {
            const tables: { table: string; alias: string; type: string }[] = [];

            const traverse = (node: any) => {
              if (!node) return;

              // If this node has a table and alias, record it
              if (node.table && node.as) {
                const tableInfo = {
                  table: node.table,
                  alias: node.as.toLowerCase(),
                  type: node.join ? `${node.join} JOIN` : 'FROM'
                };
                tables.push(tableInfo);
              }

              // Traverse child nodes
              if (node.left) traverse(node.left);
              if (node.right) traverse(node.right);
            };

            // Handle both single table and array of tables
            const fromTables = Array.isArray(fromClause) ? fromClause : [fromClause];
            fromTables.forEach(table => traverse(table));

            return tables;
          };

          const tableAliases = extractTableAliases(selectAst.from);

          // Check for duplicates
          for (const tableInfo of tableAliases) {
            const alias = tableInfo.alias;

            if (aliases.has(alias)) {
              const lineResult = findLineWithPattern(
                originalQuery,
                alias,
                { ignoreCase: true }
              );
              return {
                isValid: false,
                errorMessage: `Duplicate table alias: ${alias}. Each table must have a unique alias. Use different names like '${alias}1', '${alias}2' or descriptive names.`,
                lineNumber: lineResult ? lineResult.lineNumber : undefined,
              };
            }

            aliases.add(alias);
          }
        }
      }

      return { isValid: true };

    } catch (error: any) {
      // Fall back to string-based check
      // eslint-disable-next-line security/detect-unsafe-regex -- Safe: no nested quantifiers, bounded by SQL query length
      const aliasRegex = /\b(?:from|join)\s+\w+\s+(?:as\s+)?(\w+)/gi;
      const aliases = new Set();
      const aliasPositions = new Map();
      let match;

      while ((match = aliasRegex.exec(sql)) !== null) {
        const alias = match[1].toLowerCase();

        if (aliases.has(alias)) {
          // Find the duplicate alias line in the original query
          if (originalQuery.includes("\n")) {
            const pos = findPositionInOriginalQuery(
              originalQuery,
              sql,
              match.index
            );
            const lines = originalQuery.substr(0, pos).split("\n");
            return {
              isValid: false,
              errorMessage: `Duplicate table alias: ${alias}. Each table must have a unique alias. Use different names like '${alias}1', '${alias}2' or descriptive names.`,
              lineNumber: lines.length - 1,
            };
          }

          return {
            isValid: false,
            errorMessage: `Duplicate table alias: ${alias}`,
            position: match.index,
          };
        }
        aliases.add(alias);
        aliasPositions.set(alias, match.index);
      }

      return { isValid: true };
    }
  },
};
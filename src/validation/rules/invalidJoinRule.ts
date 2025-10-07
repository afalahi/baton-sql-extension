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
      if (sql.toLowerCase().includes("join")) {
        return checkJoinStringBased(originalQuery);
      }
      return { isValid: true };
    }
  },
};

/**
 * String-based detection of JOINs missing ON clauses
 * Handles multi-line JOIN statements and missing ON keywords properly
 */
function checkJoinStringBased(originalQuery: string): ValidationResult {
  const lines = originalQuery.split("\n");
  let joinStructures: Array<{
    joinLineIndex: number;
    joinType: string;
    tableLineIndex?: number;
    tableName?: string;
    hasProperOnClause: boolean;
    hasMissingOnKeyword: boolean;
    conditionLineIndex?: number;
  }> = [];

  // First pass: identify all JOIN structures
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim().toLowerCase();
    if (!trimmedLine) continue;

    // Look for JOIN keywords (including various types and standalone JOINs)
    let joinType = "";
    if (trimmedLine === "join" || trimmedLine.startsWith("join ")) {
      joinType = "join";
    } else if (trimmedLine.includes(" join ") || trimmedLine.includes(" inner join ") ||
               trimmedLine.includes(" left join ") || trimmedLine.includes(" right join ") ||
               trimmedLine.includes(" full join ") || trimmedLine.includes(" outer join ")) {
      joinType = extractJoinType(trimmedLine);
    } else if (trimmedLine.includes(" cross join ")) {
      joinType = "cross join"; // Cross joins don't need ON clauses
    }

    if (joinType) {
      const joinStructure = {
        joinLineIndex: i,
        joinType: joinType,
        hasProperOnClause: false,
        hasMissingOnKeyword: false
      };

      // Look for table name and ON clause in the same line or following lines
      analyzeJoinStructure(lines, i, joinStructure);
      joinStructures.push(joinStructure);
    }
  }

  // Check each JOIN structure for errors
  for (const joinStructure of joinStructures) {
    // Skip CROSS JOINs
    if (joinStructure.joinType.includes("cross")) {
      continue;
    }

    if (joinStructure.hasMissingOnKeyword && joinStructure.conditionLineIndex !== undefined) {
      return {
        isValid: false,
        errorMessage: `JOIN statement missing ON keyword. Add 'ON' before the condition on line ${joinStructure.conditionLineIndex + 1}.`,
        lineNumber: joinStructure.conditionLineIndex,
      };
    }

    if (!joinStructure.hasProperOnClause && !joinStructure.hasMissingOnKeyword) {
      return {
        isValid: false,
        errorMessage: "JOIN statement missing ON clause. Add 'ON table1.column = table2.column' to specify join condition.",
        lineNumber: joinStructure.joinLineIndex,
      };
    }
  }

  return { isValid: true };
}

/**
 * Extract JOIN type from a line
 */
function extractJoinType(line: string): string {
  const lowerLine = line.toLowerCase();
  if (lowerLine.includes("inner join")) return "inner join";
  if (lowerLine.includes("left join")) return "left join";
  if (lowerLine.includes("right join")) return "right join";
  if (lowerLine.includes("full join")) return "full join";
  if (lowerLine.includes("outer join")) return "outer join";
  if (lowerLine.includes("cross join")) return "cross join";
  return "join";
}

/**
 * Analyze JOIN structure to find table names and ON clauses
 */
function analyzeJoinStructure(lines: string[], joinLineIndex: number, joinStructure: any): void {
  const joinLine = lines[joinLineIndex].trim();

  // Check if table name is on the same line as JOIN
  if (hasTableNameInLine(joinLine)) {
    joinStructure.tableName = extractTableName(joinLine);
    joinStructure.tableLineIndex = joinLineIndex;

    // Check if ON clause is also on the same line
    if (joinLine.toLowerCase().includes(" on ")) {
      joinStructure.hasProperOnClause = true;
      return;
    }
  }

  // Look for table name and ON clause in following lines
  for (let i = joinLineIndex + 1; i < Math.min(joinLineIndex + 5, lines.length); i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();

    if (!line) continue;

    // If we encounter another SQL keyword, stop looking
    if (lowerLine.match(/^(select|from|where|group\s+by|order\s+by|having|limit|union|join)/)) {
      if (!lowerLine.startsWith("join")) { // Don't stop on another JOIN
        break;
      }
    }

    // Look for proper ON clause
    if (lowerLine.includes(" on ") || lowerLine.startsWith("on ")) {
      joinStructure.hasProperOnClause = true;
      return;
    }

    // Look for conditions that look like JOIN conditions but are missing ON keyword
    if (isJoinConditionWithoutOn(line)) {
      joinStructure.hasMissingOnKeyword = true;
      joinStructure.conditionLineIndex = i;
      return;
    }

    // Remember table name if we haven't found one yet
    if (!joinStructure.tableName && hasTableNameInLine(line)) {
      joinStructure.tableName = extractTableName(line);
      joinStructure.tableLineIndex = i;
    }
  }
}

/**
 * Check if a line contains a table name (simple heuristic)
 */
function hasTableNameInLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  // Skip if it's just the JOIN keyword alone
  if (trimmed === "join" || trimmed.match(/^(inner|left|right|full|outer|cross)\s+join$/)) {
    return false;
  }
  // Look for patterns like "table_name alias" or just "table_name"
  return trimmed.match(/^[a-zA-Z_][a-zA-Z0-9_]*(\s+[a-zA-Z_][a-zA-Z0-9_]*)?(\s+on\s+|$)/i) !== null;
}

/**
 * Extract table name from a line (simple extraction)
 */
function extractTableName(line: string): string {
  const parts = line.trim().split(/\s+/);
  // Find the first word that looks like a table name (not a JOIN keyword)
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!lower.match(/^(join|inner|left|right|full|outer|cross|on)$/)) {
      return part;
    }
  }
  return "";
}

/**
 * Check if a line looks like a JOIN condition but is missing the ON keyword
 */
function isJoinConditionWithoutOn(line: string): boolean {
  const trimmed = line.trim().toLowerCase();

  // Look for patterns that suggest a join condition:
  // - Contains equals sign
  // - Contains table/alias references with dots (e.g., "u.id = ur.user_id")
  // - Doesn't start with ON
  if (trimmed.includes("=") && !trimmed.startsWith("on ")) {
    // Check for table.column patterns
    const hasTableColumnPattern = /[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/.test(trimmed);

    // Check for comparison between two identifiers
    const hasComparisonPattern = /[a-zA-Z_][a-zA-Z0-9_.]*\s*=\s*[a-zA-Z_][a-zA-Z0-9_.]*/.test(trimmed);

    return hasTableColumnPattern && hasComparisonPattern;
  }

  return false;
}
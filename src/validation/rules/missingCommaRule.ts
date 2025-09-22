import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

function findNextNonEmptyLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return null;
}

export const missingCommaRule: ValidationRule = {
  name: "missing-comma",
  description: "Check for missing commas in column lists",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    try {
      const parser = getParser();
      const ast = parser.astify(sql);

      // If parsing succeeds, check the AST structure for potential issues
      if (ast && typeof ast === 'object' && 'type' in ast && ast.type === "select") {
        // The parser will automatically handle comma separation
        // If there's a syntax error due to missing comma, it will throw an error
        return { isValid: true };
      }
      return { isValid: true };
    } catch (error: any) {
      // If parsing fails, it might be due to missing comma or other syntax errors
      const errorMessage = error.message?.toLowerCase() || "";
      if (
        errorMessage.includes("comma") ||
        errorMessage.includes("unexpected") ||
        errorMessage.includes("syntax error") ||
        errorMessage.includes("expected")
      ) {
        // Fall back to string-based detection for missing commas
        const lines = originalQuery.split("\n");
        let inSelectClause = false;
        let previousLineNeedsComma = false;
        let previousLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const lowerLine = line.toLowerCase();

          // Check if we're starting a SELECT statement
          if (lowerLine.startsWith("select")) {
            inSelectClause = true;
            continue;
          }

          // Check if we've reached the FROM clause
          if (inSelectClause && lowerLine.startsWith("from")) {
            inSelectClause = false;
            break;
          }

          // Only check lines between SELECT and FROM
          if (inSelectClause) {
            // Check if previous line needed a comma but didn't have one
            if (
              previousLineNeedsComma &&
              !lines[previousLineIndex].trim().endsWith(",") &&
              !lowerLine.startsWith("case") &&
              !lowerLine.match(
                /^(and|or|where|group|order|having|limit|offset|on|as)/i
              )
            ) {
              return {
                isValid: false,
                errorMessage: "Missing comma between column expressions. Add a comma at the end of this line to separate columns in SELECT statement.",
                lineNumber: previousLineIndex,
              };
            }

            // This line needs a comma if it's not the last one before FROM
            // and it's not a CASE statement continuation
            previousLineNeedsComma =
              !lowerLine.includes("case") &&
              !lowerLine.match(/^(when|then|else|end)/i);
            previousLineIndex = i;

            // Check if next non-empty line is FROM
            const nextNonEmptyLine = findNextNonEmptyLine(lines, i + 1);
            if (
              nextNonEmptyLine &&
              nextNonEmptyLine.toLowerCase().startsWith("from")
            ) {
              previousLineNeedsComma = false;
            }
          }
        }
      }

      return { isValid: true };
    }
  },
};
import { ValidationRule, ValidationResult } from '../types';
import { areWordsSimilar } from '../../utils/stringUtils';

function findNextNonEmptyLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return null;
}

function looksLikeFROM(text: string): boolean {
  const firstWord = text.split(/\s+/)[0].toUpperCase();
  // Check exact match or similar spelling (handles FRO, FORM, FOMR, etc.)
  return firstWord === "FROM" || areWordsSimilar(firstWord, "FROM", 2);
}

/**
 * Check for missing commas in parenthesized lists (INSERT column lists, VALUES, etc.)
 * Returns error if a comma is missing, or null if valid
 */
function checkParenthesizedList(lines: string[], startIndex: number): ValidationResult | null {
  let depth = 0;
  let previousLineNeedsComma = false;
  let previousLineIndex = -1;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Track parenthesis depth
    for (const char of line) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth === 0 && char === ')') break; // Reached end of list
    }

    // If we're out of the parenthesized section, stop
    if (depth === 0 && line.includes(')')) {
      break;
    }

    // Skip the line with opening parenthesis
    if (line.includes('(') && !previousLineIndex) {
      previousLineIndex = i;
      continue;
    }

    // Skip YAML property lines (e.g., "password: value" or "queries:")
    // These are not part of SQL syntax and shouldn't be checked for commas
    if (line.includes(':') && !line.includes('::')) { // Allow PostgreSQL :: cast operator
      continue;
    }

    // Check if previous line needs comma
    if (previousLineNeedsComma && !lines[previousLineIndex].trim().endsWith(",")) {
      const previousLine = lines[previousLineIndex];
      const endOfLine = previousLine.trimEnd().length;

      return {
        isValid: false,
        errorMessage: "Missing comma between items in list. Add a comma at the end of this line.",
        lineNumber: previousLineIndex,
        suggestedFix: {
          range: {
            start: { line: previousLineIndex, character: endOfLine },
            end: { line: previousLineIndex, character: endOfLine }
          },
          newText: ","
        }
      };
    }

    // This line needs a comma if it's not the last item (before closing paren)
    const nextLine = findNextNonEmptyLine(lines, i + 1);
    const isLastItem = !nextLine || nextLine.includes(')');
    previousLineNeedsComma = !isLastItem && line.length > 0;
    previousLineIndex = i;
  }

  return null;
}

export const missingCommaRule: ValidationRule = {
  name: "missing-comma",
  description: "Check for missing commas in column lists, VALUES, and SET clauses",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    const lines = originalQuery.split("\n");

    // Check different SQL statement types
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const lowerLine = line.toLowerCase();

      // Check INSERT statements (column list and VALUES)
      if (lowerLine.startsWith("insert into")) {
        // Check for missing commas in column list: INSERT INTO table (col1, col2, col3)
        const columnListError = checkParenthesizedList(lines, i);
        if (columnListError) return columnListError;

        // Find VALUES clause and check it
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().toLowerCase().startsWith("values")) {
            const valuesError = checkParenthesizedList(lines, j);
            if (valuesError) return valuesError;
            break;
          }
        }
      }

      // Check UPDATE SET clauses
      if (lowerLine.startsWith("update")) {
        // Find SET clause
        for (let j = i + 1; j < lines.length; j++) {
          const setLine = lines[j].trim().toLowerCase();
          if (setLine.startsWith("set")) {
            // Check commas in SET clause (SET col1=val1, col2=val2)
            let inSetClause = true;
            let previousLineNeedsComma = false;
            let previousLineIndex = -1;

            for (let k = j + 1; k < lines.length; k++) {
              const currentLine = lines[k].trim();
              if (!currentLine) continue;
              const currentLower = currentLine.toLowerCase();

              // Stop at WHERE, FROM, or other clauses
              if (currentLower.startsWith("where") || currentLower.startsWith("from")) {
                inSetClause = false;
                break;
              }

              if (inSetClause && previousLineNeedsComma && !lines[previousLineIndex].trim().endsWith(",")) {
                const previousLine = lines[previousLineIndex];
                const endOfLine = previousLine.trimEnd().length;

                return {
                  isValid: false,
                  errorMessage: "Missing comma between SET assignments. Add a comma at the end of this line.",
                  lineNumber: previousLineIndex,
                  suggestedFix: {
                    range: {
                      start: { line: previousLineIndex, character: endOfLine },
                      end: { line: previousLineIndex, character: endOfLine }
                    },
                    newText: ","
                  }
                };
              }

              const nextLine = findNextNonEmptyLine(lines, k + 1);
              const isLastAssignment = !nextLine ||
                nextLine.toLowerCase().startsWith("where") ||
                nextLine.toLowerCase().startsWith("from");

              previousLineNeedsComma = !isLastAssignment && currentLine.includes("=");
              previousLineIndex = k;
            }
            break;
          }
        }
      }
    }

    // Check SELECT statements (original logic)
    let inSelectClause = false;
    let previousLineNeedsComma = false;
    let previousLineIndex = -1;
    let caseDepth = 0;

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
        // Track CASE statement depth
        if (lowerLine.includes("case")) {
          caseDepth++;
        }
        if (lowerLine.includes("end") && caseDepth > 0) {
          caseDepth--;
        }

        // Check if previous line needed a comma but didn't have one
        if (
          previousLineNeedsComma &&
          !lines[previousLineIndex].trim().endsWith(",") &&
          caseDepth === 0 && // Not inside a CASE expression
          !lowerLine.match(/^(when|then|else|end|and|or|where|group|order|having|limit|offset|on)/i)
        ) {
          const previousLine = lines[previousLineIndex];
          const endOfLine = previousLine.trimEnd().length;

          return {
            isValid: false,
            errorMessage: "Missing comma between column expressions. Add a comma at the end of this line to separate columns in SELECT statement.",
            lineNumber: previousLineIndex,
            suggestedFix: {
              range: {
                start: { line: previousLineIndex, character: endOfLine },
                end: { line: previousLineIndex, character: endOfLine }
              },
              newText: ","
            }
          };
        }

        // Check if next non-empty line is FROM or looks like FROM (this is the last column)
        // This handles typos like FRO, FORM, FOMR, etc.
        const nextNonEmptyLine = findNextNonEmptyLine(lines, i + 1);
        const isLastColumn = nextNonEmptyLine && looksLikeFROM(nextNonEmptyLine);

        // This line needs a comma if:
        // 1. It's not the last column before FROM
        // 2. We're not inside a CASE expression
        // 3. It's not a CASE statement keyword line
        previousLineNeedsComma =
          !isLastColumn &&
          caseDepth === 0 &&
          !lowerLine.match(/^(when|then|else|case)$/i) &&
          line.length > 0;

        previousLineIndex = i;
      }
    }

    return { isValid: true };
  },
};
import { ValidationRule, ValidationResult } from '../types';
import { getParser } from '../../utils/sqlUtils';
import { findLineWithPattern } from '../../utils/stringUtils';

export const trailingCommaRule: ValidationRule = {
  name: "trailing-comma",
  description: "Check for trailing commas after the last column in SELECT statements",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // Always use string-based analysis for trailing comma detection
    // This avoids duplicate error reporting and is more reliable for this specific case
    return checkTrailingCommaString(sql, originalQuery);
  },
};

/**
 * String-based detection of trailing commas in SELECT statements
 */
function checkTrailingCommaString(sql: string, originalQuery: string): ValidationResult {
  // First, do a quick check - if there are no trailing commas, exit early
  if (!originalQuery.includes(',')) {
    return { isValid: true };
  }

  const lines = originalQuery.split('\n');
  let inSelectClause = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();

    if (!line) continue;

    // Check if we're starting a SELECT statement
    if (lowerLine.startsWith('select')) {
      inSelectClause = true;

      // Check if SELECT is on the same line as FROM
      if (lowerLine.includes(' from ')) {
        const selectPart = line.substring(0, lowerLine.indexOf(' from '));
        if (selectPart.trim().endsWith(',')) {
          return {
            isValid: false,
            errorMessage: "Trailing comma found after last column in SELECT statement. Remove the comma before FROM clause.",
            lineNumber: i,
          };
        }
        inSelectClause = false;
        continue;
      }

      // Check if the SELECT line itself has trailing comma (single line SELECT)
      if (!lowerLine.includes(' from ') && line.trim().endsWith(',')) {
        // Look ahead to see if next non-empty line is FROM
        const nextNonEmptyLine = findNextNonEmptyLine(lines, i + 1);
        if (nextNonEmptyLine && nextNonEmptyLine.toLowerCase().trim().startsWith('from')) {
          return {
            isValid: false,
            errorMessage: "Trailing comma found after last column in SELECT statement. Remove the comma before FROM clause.",
            lineNumber: i,
          };
        }
      }
      continue;
    }

    // Check if we've reached the FROM clause
    if (inSelectClause && lowerLine.startsWith('from')) {
      // Check the previous non-empty line for trailing comma
      const prevLineInfo = findPreviousNonEmptyLine(lines, i - 1);
      if (prevLineInfo && prevLineInfo.line.trim().endsWith(',')) {
        return {
          isValid: false,
          errorMessage: "Trailing comma found after last column in SELECT statement. Remove the comma before FROM clause.",
          lineNumber: prevLineInfo.index,
        };
      }
      inSelectClause = false;
      continue;
    }

    // Check for other SQL keywords that would end the SELECT column list
    if (inSelectClause && lowerLine.match(/^(where|group\s+by|order\s+by|having|limit|offset|union|except|intersect)\b/i)) {
      // Check the previous non-empty line for trailing comma
      const prevLineInfo = findPreviousNonEmptyLine(lines, i - 1);
      if (prevLineInfo && prevLineInfo.line.trim().endsWith(',')) {
        return {
          isValid: false,
          errorMessage: "Trailing comma found after last column in SELECT statement. Remove the comma before the clause.",
          lineNumber: prevLineInfo.index,
        };
      }
      inSelectClause = false;
      continue;
    }

    // If we're in a SELECT clause and this line ends with comma,
    // check if the next meaningful line ends the SELECT
    if (inSelectClause && line.endsWith(',')) {
      const nextNonEmptyLine = findNextNonEmptyLine(lines, i + 1);
      if (nextNonEmptyLine) {
        const nextLower = nextNonEmptyLine.toLowerCase().trim();
        if (nextLower.startsWith('from') ||
            nextLower.match(/^(where|group\s+by|order\s+by|having|limit|offset|union|except|intersect)\b/i)) {
          return {
            isValid: false,
            errorMessage: "Trailing comma found after last column in SELECT statement. Remove the comma before the next clause.",
            lineNumber: i,
          };
        }
      }
    }
  }

  return { isValid: true };
}

/**
 * Find the next non-empty line after the given index
 */
function findNextNonEmptyLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('--') && !line.startsWith('#')) {
      return line;
    }
  }
  return null;
}

/**
 * Find the previous non-empty line before the given index
 */
function findPreviousNonEmptyLine(lines: string[], startIndex: number): { line: string; index: number } | null {
  for (let i = startIndex; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !line.startsWith('--') && !line.startsWith('#')) {
      return { line: lines[i], index: i };
    }
  }
  return null;
}
/** @format */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Parser } from 'node-sql-parser';
import * as yaml from 'js-yaml';

// Create SQL parser only once when needed, not on module load
let parser: Parser | null = null;
function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
  }
  return parser;
}

// Cache for storing validation results to avoid reprocessing unchanged content
const validationCache = new Map<
  string,
  Array<{ message: string; position?: number; lineNumber?: number }>
>();

// Try different SQL dialects for parsing
function validateSql(
  sql: string,
  originalQuery: string
): {
  isValid: boolean;
  errors: Array<{ message: string; position?: number; lineNumber?: number }>;
} {
  // Check cache first using a hash of the query
  const queryHash = hashString(originalQuery);
  if (validationCache.has(queryHash)) {
    const cachedErrors = validationCache.get(queryHash);
    return {
      isValid: cachedErrors?.length === 0,
      errors: cachedErrors || [],
    };
  }

  // Temporarily replace ?<param> tokens with placeholders for validation
  const paramRegex = /\?\<([a-zA-Z0-9_]+)\>/g;
  const sanitizedSql = sql.replace(paramRegex, '?');

  console.log(`[Baton SQL] Original SQL: ${sql}`);
  console.log(`[Baton SQL] Sanitized SQL for validation: ${sanitizedSql}`);

  const errors: Array<{
    message: string;
    position?: number;
    lineNumber?: number;
  }> = [];

  // Apply all validation rules
  for (const rule of sqlValidationRules) {
    try {
      console.log(`[Baton SQL] Applying validation rule: ${rule.name}`);
      const validationResult = rule.validate(sanitizedSql, originalQuery);

      if (!validationResult.isValid && validationResult.errorMessage) {
        console.log(
          `[Baton SQL] Validation failed for rule ${rule.name}: ${validationResult.errorMessage}`
        );
        errors.push({
          message: validationResult.errorMessage,
          position: validationResult.position,
          lineNumber: validationResult.lineNumber,
        });
      }
    } catch (error) {
      console.log(`[Baton SQL] Error in validation rule ${rule.name}:`, error);
    }
  }

  // Cache the validation result
  validationCache.set(queryHash, errors);

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Simple hash function for strings (for caching)
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return String(hash);
}

// Check for missing commas in column lists, especially for multiline SQL
function checkMissingCommas(sql: string): {
  hasMissingComma: boolean;
  lineNumber: number;
} {
  const lines = sql.split('\n');
  let inSelectClause = false;
  let fromLineFound = false;
  let previousLineEndsWithComma = true; // Assume valid at start
  let problemLineNumber = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();

    // Check if we're starting a SELECT statement
    if (lowerLine.startsWith('select')) {
      inSelectClause = true;
      continue;
    }

    // Check if we've reached the FROM clause
    if (inSelectClause && lowerLine.startsWith('from')) {
      inSelectClause = false;
      fromLineFound = true;
      continue;
    }

    // Skip empty lines
    if (!line) {
      continue;
    }

    // Only check lines between SELECT and FROM
    if (inSelectClause) {
      // If previous line didn't end with a comma and this line doesn't start with a special keyword
      // and doesn't appear to continue a previous expression (like a function with parentheses)
      if (
        !previousLineEndsWithComma &&
        !lowerLine.startsWith('from') &&
        !lowerLine.match(
          /^(and|or|where|group|order|having|limit|offset|on|as)/i
        ) &&
        !lowerLine.match(/^\)/)
      ) {
        problemLineNumber = i;
        return { hasMissingComma: true, lineNumber: i };
      }

      // Check if this line ends with a comma for the next line
      previousLineEndsWithComma = line.endsWith(',');
    }
  }

  return { hasMissingComma: false, lineNumber: -1 };
}

// Custom SQL validation rules
interface ValidationRule {
  name: string;
  description: string;
  validate: (
    sql: string,
    originalQuery: string
  ) => {
    isValid: boolean;
    errorMessage?: string;
    position?: number;
    lineNumber?: number;
  };
}

const sqlValidationRules: ValidationRule[] = [
  {
    name: 'missing-comma',
    description: 'Check for missing commas in column lists',
    validate: (sql: string, originalQuery: string) => {
      // Check for missing commas in SELECT statements
      if (sql.toLowerCase().startsWith('select')) {
        const fromIndex = sql.toLowerCase().indexOf(' from ');
        if (fromIndex !== -1) {
          const selectClause = sql.substring(6, fromIndex).trim();
          const columns = selectClause.split(',');

          // Look for columns that might have multiple identifiers without commas
          for (let i = 0; i < columns.length; i++) {
            const col = columns[i].trim();
            const words = col.split(/\s+/);
            // If there are multiple words and no AS keyword, might be missing comma
            // Skip if it's a CASE statement
            if (words.length > 3 && !col.toLowerCase().includes(' as ') && !col.toLowerCase().includes('case')) {
              return {
                isValid: false,
                errorMessage: 'Possible missing comma in column list',
                position: sql.indexOf(col),
              };
            }
          }

          // Check original query for lines that should have commas
          if (originalQuery.includes('\n')) {
            const lines = originalQuery.split('\n');
            let inSelectClause = false;
            let inCaseStatement = false;
            let previousLineNeedsComma = false;
            let previousLineIndex = -1;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const lowerLine = line.toLowerCase();
              if (lowerLine.startsWith('select')) {
                inSelectClause = true;
                continue;
              }

              if (lowerLine.startsWith('from')) {
                inSelectClause = false;
                continue;
              }

              // Track CASE statement boundaries
              if (lowerLine.includes('case')) {
                inCaseStatement = true;
              }
              if (lowerLine.includes('end')) {
                inCaseStatement = false;
              }

              if (inSelectClause && !inCaseStatement) {
                // Line needs comma if it's not the last one before FROM
                if (
                  previousLineNeedsComma &&
                  !lines[previousLineIndex].trim().endsWith(',')
                ) {
                  return {
                    isValid: false,
                    errorMessage: 'Missing comma at end of previous line',
                    lineNumber: previousLineIndex,
                  };
                }

                previousLineNeedsComma = true;
                previousLineIndex = i;

                // Last line before FROM doesn't need comma
                const nextNonEmptyLine = findNextNonEmptyLine(lines, i + 1);
                if (
                  nextNonEmptyLine &&
                  nextNonEmptyLine.toLowerCase().startsWith('from')
                ) {
                  previousLineNeedsComma = false;
                }
              }
            }
          }
        }
      }
      return { isValid: true };
    },
  },
  {
    name: 'missing-from',
    description: 'Check for missing FROM clause in SELECT statements',
    validate: (sql: string, originalQuery: string) => {
      if (
        sql.toLowerCase().startsWith('select') &&
        !sql.toLowerCase().includes(' from ')
      ) {
        // Find the SELECT line in the original query
        const lineNumber = findLineWithPattern(originalQuery, /^\s*select\b/i);

        return {
          isValid: false,
          errorMessage: 'Missing FROM clause in SELECT statement',
          lineNumber: lineNumber >= 0 ? lineNumber : undefined,
        };
      }
      return { isValid: true };
    },
  },
  {
    name: 'unclosed-parentheses',
    description: 'Check for unclosed parentheses',
    validate: (sql: string, originalQuery: string) => {
      let openParens = 0;
      let lastOpenParenPos = -1;

      for (let i = 0; i < sql.length; i++) {
        if (sql[i] === '(') {
          openParens++;
          lastOpenParenPos = i;
        }
        if (sql[i] === ')') {
          openParens--;

          if (openParens < 0) {
            // Find line number for this position
            if (originalQuery.includes('\n')) {
              const pos = findPositionInOriginalQuery(originalQuery, sql, i);
              const lines = originalQuery.substr(0, pos).split('\n');
              return {
                isValid: false,
                errorMessage: 'Unexpected closing parenthesis',
                lineNumber: lines.length - 1,
              };
            }

            return {
              isValid: false,
              errorMessage: 'Unexpected closing parenthesis',
              position: i,
            };
          }
        }
      }

      if (openParens > 0) {
        // Find line number for the last open parenthesis
        if (originalQuery.includes('\n') && lastOpenParenPos >= 0) {
          const pos = findPositionInOriginalQuery(
            originalQuery,
            sql,
            lastOpenParenPos
          );
          const lines = originalQuery.substr(0, pos).split('\n');
          return {
            isValid: false,
            errorMessage: `Missing ${openParens} closing parenthesis/parentheses`,
            lineNumber: lines.length - 1,
          };
        }

        return {
          isValid: false,
          errorMessage: `Missing ${openParens} closing parenthesis/parentheses`,
        };
      }

      return { isValid: true };
    },
  },
  {
    name: 'invalid-join',
    description: 'Check for invalid JOIN syntax',
    validate: (sql: string, originalQuery: string) => {
      // Skip if there's no JOIN
      if (!sql.toLowerCase().includes(' join ')) {
        return { isValid: true };
      }

      // In multiline queries, we need to check if there's an ON clause for each JOIN
      if (originalQuery.includes('\n')) {
        const lines = originalQuery.split('\n');
        let pendingJoins = []; // Track JOIN statements we've seen but not found an ON for

        for (let i = 0; i < lines.length; i++) {
          const trimmedLine = lines[i].trim().toLowerCase();

          // Skip empty lines
          if (!trimmedLine) {
            continue;
          }

          // Check for new JOIN statements
          if (
            trimmedLine.includes(' join ') ||
            trimmedLine.startsWith('join ')
          ) {
            // If this line doesn't also contain an ON clause, add it to pending
            if (!trimmedLine.includes(' on ')) {
              pendingJoins.push({ lineNumber: i, joinText: lines[i].trim() });
            }
          }

          // Check if this line has an ON and remove one pending JOIN
          if (
            (trimmedLine.includes(' on ') || trimmedLine.startsWith('on ')) &&
            pendingJoins.length > 0
          ) {
            pendingJoins.shift(); // Remove the earliest JOIN that was waiting for an ON
          }

          // If we hit a WHERE, GROUP BY, ORDER BY, or another JOIN clause, check if there are pending JOINs
          if (
            (trimmedLine.includes(' where ') ||
              trimmedLine.includes(' group by ') ||
              trimmedLine.includes(' having ') ||
              trimmedLine.includes(' order by ') ||
              trimmedLine.includes(' limit ') ||
              i === lines.length - 1) &&
            pendingJoins.length > 0
          ) {
            // Report the first JOIN that doesn't have an ON
            const firstPendingJoin = pendingJoins[0];
            return {
              isValid: false,
              errorMessage: 'JOIN without ON clause',
              lineNumber: firstPendingJoin.lineNumber,
            };
          }
        }

        // If we have any pending JOINs at the end, report the first one
        if (pendingJoins.length > 0) {
          const firstPendingJoin = pendingJoins[0];
          return {
            isValid: false,
            errorMessage: 'JOIN without ON clause',
            lineNumber: firstPendingJoin.lineNumber,
          };
        }
      } else {
        // For single-line queries, check if there's a JOIN without ON
        const hasJoin = / join /i.test(sql);
        const hasOn = / on /i.test(sql);

        if (hasJoin && !hasOn) {
          return {
            isValid: false,
            errorMessage: 'JOIN without ON clause',
            position: sql.toLowerCase().indexOf(' join '),
          };
        }
      }

      return { isValid: true };
    },
  },
  {
    name: 'ambiguous-columns',
    description: 'Check for potentially ambiguous column references',
    validate: (sql: string, originalQuery: string) => {
      // Check if there are multiple tables but columns without table alias
      const fromMatches = sql
        .toLowerCase()
        .match(/\bfrom\b\s+(\w+)(?:\s+as\s+(\w+))?/i);
      const joinMatches = sql
        .toLowerCase()
        .match(/\bjoin\b\s+(\w+)(?:\s+as\s+(\w+))?/gi);

      if (fromMatches && joinMatches) {
        // Multiple tables, look for column references without table alias
        const selectClause = sql
          .substring(0, sql.toLowerCase().indexOf(' from '))
          .trim();
        if (selectClause.toLowerCase().includes('select *')) {
          // Find the SELECT line in the original query
          if (originalQuery.includes('\n')) {
            const lines = originalQuery.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().toLowerCase().includes('select *')) {
                return {
                  isValid: false,
                  errorMessage:
                    'Using * with multiple tables can lead to ambiguous columns',
                  lineNumber: i,
                };
              }
            }
          }

          return {
            isValid: false,
            errorMessage:
              'Using * with multiple tables can lead to ambiguous columns',
            position: sql.toLowerCase().indexOf('select *'),
          };
        }
      }

      return { isValid: true };
    },
  },
  {
    name: 'invalid-group-by',
    description: 'Check for aggregate functions without GROUP BY',
    validate: (sql: string, originalQuery: string) => {
      const hasAggregates = /(count|sum|avg|min|max|group_concat)\s*\(/i.test(
        sql
      );
      const hasGroupBy = /\bgroup\s+by\b/i.test(sql);

      if (
        hasAggregates &&
        !hasGroupBy &&
        !/\bcount\s*\(\s*\*\s*\)/i.test(sql)
      ) {
        // Has aggregate functions but no GROUP BY, and not just COUNT(*)
        const columns = sql
          .substring(
            sql.toLowerCase().indexOf('select') + 6,
            sql.toLowerCase().indexOf(' from ')
          )
          .split(',');

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
          if (originalQuery.includes('\n')) {
            const lines = originalQuery.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().toLowerCase().startsWith('select')) {
                return {
                  isValid: false,
                  errorMessage:
                    'Mixing aggregate functions with non-aggregated columns requires GROUP BY',
                  lineNumber: i,
                };
              }
            }
          }

          return {
            isValid: false,
            errorMessage:
              'Mixing aggregate functions with non-aggregated columns requires GROUP BY',
            position: sql.toLowerCase().indexOf('select'),
          };
        }
      }

      return { isValid: true };
    },
  },
  {
    name: 'invalid-order-by',
    description: 'Check for invalid ORDER BY references',
    validate: (sql: string, originalQuery: string) => {
      const orderByMatch = sql.match(/\border\s+by\s+(\d+)\b/i);
      if (orderByMatch) {
        // Find the ORDER BY line in the original query
        if (originalQuery.includes('\n')) {
          const lines = originalQuery.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (
              lines[i].trim().toLowerCase().includes('order by') &&
              /\border\s+by\s+(\d+)\b/i.test(lines[i])
            ) {
              return {
                isValid: false,
                errorMessage:
                  'Using position numbers in ORDER BY is not supported in some SQL dialects',
                lineNumber: i,
              };
            }
          }
        }

        return {
          isValid: false,
          errorMessage:
            'Using position numbers in ORDER BY is not supported in some SQL dialects',
          position: sql.indexOf(orderByMatch[0]),
        };
      }

      return { isValid: true };
    },
  },
  {
    name: 'duplicate-aliases',
    description: 'Check for duplicate table aliases',
    validate: (sql: string, originalQuery: string) => {
      const aliasRegex = /\b(?:from|join)\s+\w+\s+(?:as\s+)?(\w+)/gi;
      const aliases = new Set();
      const aliasPositions = new Map();
      let match;

      while ((match = aliasRegex.exec(sql)) !== null) {
        const alias = match[1].toLowerCase();
        if (aliases.has(alias)) {
          // Find the duplicate alias line in the original query
          if (originalQuery.includes('\n')) {
            const pos = findPositionInOriginalQuery(
              originalQuery,
              sql,
              match.index
            );
            const lines = originalQuery.substr(0, pos).split('\n');
            return {
              isValid: false,
              errorMessage: `Duplicate table alias: ${alias}`,
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
    },
  },
  {
    name: 'keyword-spelling',
    description: 'Check for misspelled SQL keywords',
    validate: (sql: string, originalQuery: string) => {
      // List of common SQL keywords that must be spelled correctly
      const sqlKeywords = [
        'SELECT',
        'FROM',
        'WHERE',
        'AND',
        'OR',
        'ORDER BY',
        'GROUP BY',
        'HAVING',
        'JOIN',
        'LEFT JOIN',
        'RIGHT JOIN',
        'INNER JOIN',
        'FULL JOIN',
        'OUTER JOIN',
        'CROSS JOIN',
        'ON',
        'AS',
        'IN',
        'EXISTS',
        'NOT',
        'BETWEEN',
        'LIKE',
        'IS NULL',
        'IS NOT NULL',
        'LIMIT',
        'OFFSET',
        'INSERT INTO',
        'VALUES',
        'UPDATE',
        'SET',
        'DELETE FROM',
        'CREATE TABLE',
        'ALTER TABLE',
        'DROP TABLE',
        'INDEX',
        'UNION',
        'ALL',
        'DISTINCT',
        'CASE',
        'WHEN',
        'THEN',
        'ELSE',
        'END',
        'WITH',
      ];

      // Common typos and misspellings of SQL keywords
      const commonTypos = {
        SELCT: 'SELECT',
        SLECT: 'SELECT',
        SELET: 'SELECT',
        SELECTT: 'SELECT',
        SEKECT: 'SELECT',
        FORM: 'FROM',
        FOMR: 'FROM',
        FROMT: 'FROM',
        FRIM: 'FROM',
        WEHRE: 'WHERE',
        WHRE: 'WHERE',
        WHER: 'WHERE',
        WHEER: 'WHERE',
        WHEREE: 'WHERE',
        HWERE: 'WHERE',
        WKERE: 'WHERE',
        WHERRE: 'WHERE',
        GROOP: 'GROUP',
        GRUOP: 'GROUP',
        GORUP: 'GROUP',
        GROPU: 'GROUP',
        GROUPP: 'GROUP',
        ORDRE: 'ORDER',
        ORDR: 'ORDER',
        OREDR: 'ORDER',
        ORDERBY: 'ORDER BY',
        ODER: 'ORDER',
        OERDER: 'ORDER',
        JOIM: 'JOIN',
        JION: 'JOIN',
        JIOIN: 'JOIN',
        JOINN: 'JOIN',
        ONM: 'ON',
        ONN: 'ON',
        UPDTE: 'UPDATE',
        UPDAET: 'UPDATE',
        UPATE: 'UPDATE',
        UPDATTE: 'UPDATE',
        ISNER: 'INSERT',
        INSRET: 'INSERT',
        INSER: 'INSERT',
        INSETT: 'INSERT',
        INSETR: 'INSERT',
        DELTE: 'DELETE',
        DELETTE: 'DELETE',
        DEELETE: 'DELETE',
        DEKETE: 'DELETE',
        DELEET: 'DELETE',
        HAIVNG: 'HAVING',
        HAVNIG: 'HAVING',
        AHVING: 'HAVING',
        HABING: 'HAVING',
        GROUPBY: 'GROUP BY',
        INNERJOIN: 'INNER JOIN',
        LEFTJOIN: 'LEFT JOIN',
        RIGHTJOIN: 'RIGHT JOIN',
        FULLJOIN: 'FULL JOIN',
        OUTERJOIN: 'OUTER JOIN',
      };

      // Only do this validation for multiline queries
      if (!originalQuery.includes('\n')) {
        return { isValid: true };
      }

      const lines = originalQuery.split('\n');

      // Check each line for typoed keywords
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Convert line to uppercase for comparison
        const upperLine = line.toUpperCase();

        // Check for common typos first - this is explicit and reliable
        for (const [typo, correction] of Object.entries(commonTypos)) {
          // Use word boundary to avoid false positives
          const typoRegex = new RegExp(`\\b${typo}\\b`, 'i');
          if (typoRegex.test(upperLine)) {
            return {
              isValid: false,
              errorMessage: `Possible typo in SQL keyword: "${typo}" - Did you mean "${correction}"?`,
              lineNumber: i,
            };
          }
        }

        // Skip the more aggressive typo detection as it's causing false positives
        // Just check for exact matches of the first word against our keyword list
        const firstWord = upperLine.split(/\s+/)[0];

        // Skip if it's not at least 3 characters
        if (firstWord.length < 3) continue;

        // If the first word is already a valid SQL keyword, don't try to suggest corrections
        const isValidKeyword = sqlKeywords.some(
          (keyword) => keyword.split(/\s+/)[0] === firstWord
        );

        if (isValidKeyword) {
          continue;
        }

        // Only check for very close matches (1 character different)
        // and only for the most common SQL clause keywords to avoid false positives
        const primaryKeywords = [
          'SELECT',
          'FROM',
          'WHERE',
          'GROUP',
          'ORDER',
          'JOIN',
          'HAVING',
        ];

        const possibleKeywords = primaryKeywords.filter((keyword) => {
          return areWordsSimilar(firstWord, keyword, 1); // Only 1 character difference allowed
        });

        if (possibleKeywords.length > 0) {
          const mostSimilar = findMostSimilarWord(firstWord, possibleKeywords);

          return {
            isValid: false,
            errorMessage: `Possible typo in SQL keyword: "${firstWord}" - Did you mean "${mostSimilar}"?`,
            lineNumber: i,
          };
        }
      }

      return { isValid: true };
    },
  },
  {
    name: 'property-name-typos',
    description: 'Check for common property name typos',
    validate: (sql: string, originalQuery: string) => {
      // Common property name typos and their corrections
      const propertyTypos = {
        'static_entitlement': 'static_entitlements',
        'staticentitlements': 'static_entitlements',
        'static_entitlementz': 'static_entitlements',
        'static_entitlementss': 'static_entitlements',
        'staticentitlement': 'static_entitlements',
        'static_entitlement_': 'static_entitlements',
        '_static_entitlements': 'static_entitlements'
      };

      // Check each line for property name typos
      const lines = originalQuery.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Check for property name typos
        for (const [typo, correction] of Object.entries(propertyTypos)) {
          if (line.includes(typo + ':')) {
            return {
              isValid: false,
              errorMessage: `Did you mean '${correction}' instead of '${typo}'?`,
              lineNumber: i
            };
          }
        }
      }

      return { isValid: true };
    }
  },
];

// Helper function to check if two words are similar (possible typo)
function areWordsSimilar(
  word1: string,
  word2: string,
  maxDistance: number = 2
): boolean {
  // If length difference is too great, they're not similar
  if (Math.abs(word1.length - word2.length) > maxDistance) return false;

  // Calculate Levenshtein distance (simple implementation)
  const distance = levenshteinDistance(word1, word2);

  // Words are similar if the distance is small relative to their length
  return distance <= maxDistance;
}

// Simple Levenshtein distance implementation
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Find the most similar word from a list
function findMostSimilarWord(word: string, possibleWords: string[]): string {
  let minDistance = Infinity;
  let mostSimilar = '';

  for (const candidate of possibleWords) {
    const distance = levenshteinDistance(word, candidate);
    if (distance < minDistance) {
      minDistance = distance;
      mostSimilar = candidate;
    }
  }

  return mostSimilar;
}

// Helper function to find the next non-empty line
function findNextNonEmptyLine(
  lines: string[],
  startIndex: number
): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      return line;
    }
  }
  return null;
}

// Keep track of file digests to avoid reprocessing unchanged files
const fileDigests = new Map<string, string>();

function validateSQLInDocument(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection
) {
  // Check if the file has changed since last validation
  const text = document.getText();
  const fileDigest = hashString(text);

  if (fileDigests.get(document.fileName) === fileDigest) {
    console.log(
      `[Baton SQL] Skipping validation, file unchanged: ${document.fileName}`
    );
    return;
  }

  console.log(`[Baton SQL] Validating SQL in document: ${document.fileName}`);
  const diagnosticsList: vscode.Diagnostic[] = [];

  try {
    // Parse YAML content
    console.log(`[Baton SQL] Parsing YAML content...`);
    const yamlContent = yaml.load(text);
    console.log(`[Baton SQL] YAML parsed successfully`, yamlContent);

    // Function to recursively find SQL queries in the YAML structure
    function findSQLQueries(obj: any, path: string[] = []) {
      console.log(
        `[Baton SQL] Checking object at path: ${path.join('.')}`,
        typeof obj
      );

      if (typeof obj === 'string') {
        // Optimize check for SQL: First do a quick check for SQL keywords
        const trimmedObj = obj.trim();
        const lowerObj = trimmedObj.toLowerCase();

        // Quick keyword check before deeper analysis
        const hasSqlKeywords =
          lowerObj.includes('select') ||
          lowerObj.includes('from') ||
          lowerObj.includes('where') ||
          lowerObj.includes('join');

        // Check if this is potentially a Baton parameterized query
        const hasBatonParams = obj.includes('?<');

        if ((hasSqlKeywords && lowerObj.length > 15) || hasBatonParams) {
          console.log(
            `[Baton SQL] Found potential SQL at path: ${path.join('.')}`,
            trimmedObj.substring(0, 50) + '...'
          );

          try {
            // Normalize the SQL by removing extra whitespace and newlines
            const normalizedSQL = obj
              .split('\n')
              .map((line) => line.trim())
              .join(' ')
              .replace(/\s+/g, ' ');

            console.log(`[Baton SQL] Validating SQL:`, normalizedSQL);

            // Validate SQL using our custom rules
            const validationResult = validateSql(normalizedSQL, obj);

            if (!validationResult.isValid) {
              console.log(
                `[Baton SQL] SQL validation failed with ${validationResult.errors.length} errors`
              );

              // Create diagnostics for each error
              validationResult.errors.forEach((error) => {
                let range;

                if (error.lineNumber !== undefined) {
                  // If we have a line number, use our new line-based positioning
                  range = findPositionInMultilineQuery(
                    document,
                    obj,
                    error.lineNumber,
                    error.position
                  );
                } else if (error.position !== undefined) {
                  // If we have a position, use it
                  const errorPos = error.position;

                  // Try to find the position in the original query
                  const originalPosition = findPositionInOriginalQuery(
                    obj,
                    normalizedSQL,
                    errorPos
                  );

                  // Get line and character for this position
                  const pos = document.positionAt(originalPosition);
                  const lineText = document.lineAt(pos.line).text;

                  // Create range for the error - highlight the whole line for better visibility
                  range = new vscode.Range(
                    new vscode.Position(pos.line, 0),
                    new vscode.Position(pos.line, lineText.length)
                  );
                } else {
                  // If no position provided, highlight the whole query
                  const position = findStringPosition(text, obj);
                  if (position) {
                    range = new vscode.Range(
                      document.positionAt(position.start),
                      document.positionAt(position.end)
                    );
                  } else {
                    // Fallback if we can't find the position
                    range = new vscode.Range(0, 0, 0, 0);
                  }
                }

                const diagnostic = new vscode.Diagnostic(
                  range,
                  `Invalid SQL syntax: ${error.message}`,
                  vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'SQL Validator';
                diagnosticsList.push(diagnostic);

                console.log(
                  `[Baton SQL] Diagnostic added: ${error.message} at range ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`
                );
              });
            } else {
              console.log(`[Baton SQL] SQL validation passed`);
            }
          } catch (error: any) {
            console.log(`[Baton SQL] SQL Validation Error:`, error);

            // If validation fails with an exception, create a diagnostic
            const position = findStringPosition(text, obj);
            if (position) {
              console.log(
                `[Baton SQL] Error position found at ${position.start}-${position.end}`
              );

              const range = new vscode.Range(
                document.positionAt(position.start),
                document.positionAt(position.end)
              );

              const diagnostic = new vscode.Diagnostic(
                range,
                `SQL validation error: ${error.message}`,
                vscode.DiagnosticSeverity.Error
              );
              diagnostic.source = 'SQL Validator';
              diagnosticsList.push(diagnostic);

              console.log(`[Baton SQL] Diagnostic added: ${error.message}`);
            } else {
              console.log(`[Baton SQL] Could not find position for error`);
            }
          }
        }
      } else if (typeof obj === 'object' && obj !== null) {
        // Optimize: Directly check common SQL query field names
        const commonSqlFields = ['query', 'sql', 'statement'];

        if (obj && typeof obj === 'object') {
          for (const field of commonSqlFields) {
            if (field in obj && typeof obj[field] === 'string') {
              // Direct path to likely SQL query
              findSQLQueries(obj[field], [...path, field]);
            }
          }
        }

        // Check other properties
        for (const [key, value] of Object.entries(obj)) {
          // Skip if we already processed this via the direct path optimization
          if (!commonSqlFields.includes(key)) {
            findSQLQueries(value, [...path, key]);
          }
        }
      }
    }

    findSQLQueries(yamlContent);

    console.log(`[Baton SQL] Found ${diagnosticsList.length} diagnostics`);

    // Save the file digest to avoid reprocessing if unchanged
    fileDigests.set(document.fileName, fileDigest);
  } catch (error: any) {
    console.error(`[Baton SQL] Error parsing YAML:`, error);

    // Handle YAML parsing errors
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      `Error parsing YAML: ${error.message}`,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = 'YAML Parser';
    diagnosticsList.push(diagnostic);
  }

  console.log(
    `[Baton SQL] Setting ${diagnosticsList.length} diagnostics for ${document.fileName}`
  );
  diagnostics.set(document.uri, diagnosticsList);
}

function findStringPosition(
  text: string,
  searchString: string
): { start: number; end: number } | null {
  const start = text.indexOf(searchString);
  if (start === -1) return null;
  return {
    start,
    end: start + searchString.length,
  };
}

// Helper function to map position from normalized SQL to original query
function findPositionInOriginalQuery(
  originalQuery: string,
  normalizedSQL: string,
  positionInNormalized: number
): number {
  // This is a simplified mapping - in a real implementation, you'd need more complex logic
  // based on the actual normalization process

  // Simple implementation: Try to find the same substring around the error position
  const contextSize = 10;
  const start = Math.max(0, positionInNormalized - contextSize);
  const end = Math.min(
    normalizedSQL.length,
    positionInNormalized + contextSize
  );

  const context = normalizedSQL.substring(start, end);
  const contextIndex = originalQuery.indexOf(context);

  if (contextIndex >= 0) {
    // Adjust the position based on the context start position
    return contextIndex + (positionInNormalized - start);
  }

  // Fallback if we can't find the context
  return 0;
}

// Helper function to find position in original multiline query with line and column info
function findPositionInMultilineQuery(
  document: vscode.TextDocument,
  originalQuery: string,
  errorLine: number = -1,
  errorColumn: number = -1
): vscode.Range {
  const lines = originalQuery.split('\n');

  // If we have a specific line number
  if (errorLine >= 0 && errorLine < lines.length) {
    // Get the actual document line at this offset in the query
    let positionStart = 0;
    for (let i = 0; i < errorLine; i++) {
      positionStart += lines[i].length + 1; // +1 for newline
    }

    // Find the actual document position
    const documentPos = document.positionAt(
      document.getText().indexOf(originalQuery) + positionStart
    );
    const lineText = document.lineAt(documentPos.line).text;

    // Create a range for the entire line
    return new vscode.Range(
      new vscode.Position(documentPos.line, 0),
      new vscode.Position(documentPos.line, lineText.length)
    );
  }

  // Fallback to highlighting the entire query
  const start = document.getText().indexOf(originalQuery);
  if (start >= 0) {
    const startPos = document.positionAt(start);
    const endPos = document.positionAt(start + originalQuery.length);
    return new vscode.Range(startPos, endPos);
  }

  // Last resort fallback
  return new vscode.Range(0, 0, 0, 0);
}

// Helper function to find the line in original query that matches a pattern
function findLineWithPattern(
  originalQuery: string,
  pattern: RegExp | string
): number {
  const lines = originalQuery.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (
      typeof pattern === 'string'
        ? line.includes(pattern.toLowerCase())
        : pattern.test(line)
    ) {
      return i;
    }
  }
  return -1; // Not found
}

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('=== Baton SQL Extension Activation Started ===');

    // Create a diagnostic collection for SQL validation
    const sqlDiagnostics =
      vscode.languages.createDiagnosticCollection('sql-validation');

    // Optimize activation - only process visible documents initially
    const visibleEditors = vscode.window.visibleTextEditors;
    let hasProcessedFile = false;

    for (const editor of visibleEditors) {
      const document = editor.document;
      if (shouldProcessDocument(document)) {
        console.log(
          `[Baton SQL] Processing visible document: ${document.fileName}`
        );
        applyBatonSQLSchema(document.fileName);
        validateSQLInDocument(document, sqlDiagnostics);
        hasProcessedFile = true;
      }
    }

    // Show activation message only if we processed a relevant file
    if (hasProcessedFile) {
      vscode.window.showInformationMessage('Baton SQL Extension Activated');
    }

    // Function to check if a document should be processed - optimized
    function shouldProcessDocument(document: vscode.TextDocument): boolean {
      const fileName = document.fileName;
      const baseName = path.basename(fileName);

      // Quick check first - if not YAML or not baton file, skip further checks
      if (!fileName.endsWith('.yaml') && !fileName.endsWith('.yml')) {
        return false;
      }

      if (!baseName.startsWith('baton-sql-')) {
        return false;
      }

      // More detailed checks only if basic checks passed
      const isYaml =
        document.languageId === 'yaml' ||
        fileName.endsWith('.yaml') ||
        fileName.endsWith('.yml');
      const isBatonFile = baseName.startsWith('baton-sql-');

      console.log(`[Baton SQL] Checking file: ${fileName}`);
      console.log(`[Baton SQL] Language ID: ${document.languageId}`);
      console.log(`[Baton SQL] Is YAML: ${isYaml}`);
      console.log(`[Baton SQL] Is Baton File: ${isBatonFile}`);

      return isYaml && isBatonFile;
    }

    // Listen for new documents - lazy initialization
    console.log('[Baton SQL] Setting up document open listener...');
    const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
      console.log(`[Baton SQL] Document opened: ${document.fileName}`);
      if (shouldProcessDocument(document)) {
        console.log(
          `[Baton SQL] Processing newly opened document: ${document.fileName}`
        );
        applyBatonSQLSchema(document.fileName);
        validateSQLInDocument(document, sqlDiagnostics);
      }
    });

    // Watch for changes in the document - with debouncing
    console.log('[Baton SQL] Setting up document change listener...');
    let changeTimeout: NodeJS.Timeout | null = null;
    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (shouldProcessDocument(event.document)) {
        // Clear previous timeout
        if (changeTimeout) {
          clearTimeout(changeTimeout);
        }

        // Debounce validation to reduce processing during rapid edits
        changeTimeout = setTimeout(() => {
          console.log(
            `[Baton SQL] Processing changed document: ${event.document.fileName}`
          );
          validateSQLInDocument(event.document, sqlDiagnostics);
          changeTimeout = null;
        }, 500); // 500ms debounce delay
      }
    });

    const applySchemaCommand = vscode.commands.registerCommand(
      'batonSQL.applySchema',
      () => {
        console.log('[Baton SQL] Manual schema application requested');
        const document = vscode.window.activeTextEditor?.document;
        if (document && shouldProcessDocument(document)) {
          console.log(
            `[Baton SQL] Manually applying schema to: ${document.fileName}`
          );
          applyBatonSQLSchema(document.fileName);
          validateSQLInDocument(document, sqlDiagnostics);
        } else {
          console.log(
            '[Baton SQL] No valid document found for schema application'
          );
          vscode.window.showInformationMessage(
            'This file is not a valid baton SQL configuration file. Please use a file named baton-sql-*.yaml or baton-sql-*.yml'
          );
        }
      }
    );

    // Register all disposables
    context.subscriptions.push(
      applySchemaCommand,
      sqlDiagnostics,
      openListener,
      changeListener
    );
    console.log('=== Baton SQL Extension Activation Completed ===');
  } catch (error) {
    console.error('[Baton SQL] Activation Error:', error);
    vscode.window.showErrorMessage(
      'Baton SQL Extension failed to activate: ' + error
    );
  }
}

async function applyBatonSQLSchema(fileName: string) {
  try {
    const schemaPath = path.join(
      __dirname,
      '..',
      'schemas',
      'baton-schema.json'
    );
    console.log(`[Baton SQL] Schema path: ${schemaPath}`);

    // Check if schema file exists
    if (!fs.existsSync(schemaPath)) {
      console.error(`[Baton SQL] Schema file not found at ${schemaPath}`);
      vscode.window.showErrorMessage(`Schema file not found at ${schemaPath}`);
      return;
    }

    const schemaUri = vscode.Uri.file(schemaPath).toString();
    console.log(`[Baton SQL] Schema URI: ${schemaUri}`);

    const config = vscode.workspace.getConfiguration('yaml');
    const currentSchemas =
      config.get<{ [key: string]: string[] }>('schemas') || {};

    currentSchemas[schemaUri] = ['baton-sql-*.yaml', 'baton-sql-*.yml'];

    await config.update(
      'schemas',
      currentSchemas,
      vscode.ConfigurationTarget.Workspace
    );

    vscode.window.showInformationMessage(
      `Baton SQL Schema applied to ${fileName}`
    );
  } catch (error) {
    console.error(`[Baton SQL] Error applying schema: ${error}`);
    vscode.window.showErrorMessage(`Error applying schema: ${error}`);
  }
}

export function deactivate() {}

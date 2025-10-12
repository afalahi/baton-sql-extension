import { ValidationRule, ValidationResult } from '../types';

/**
 * Validates PostgreSQL-specific and unconventional SQL syntax patterns.
 * Provides informational messages about advanced SQL features.
 */
export const unconventionalSqlSyntaxRule: ValidationRule = {
  name: "unconventional-sql-syntax",
  description: "Validate PostgreSQL-specific and unconventional SQL syntax",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    const lines = originalQuery.split('\n');
    const lowerSql = sql.toLowerCase();

    // Check for ON CONFLICT without DO NOTHING or DO UPDATE
    if (lowerSql.includes('on conflict')) {
      const onConflictPattern = /on\s+conflict(?!\s+(do\s+nothing|do\s+update))/i;
      if (onConflictPattern.test(sql)) {
        // Find the line with ON CONFLICT
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes('on conflict')) {
            return {
              isValid: false,
              errorMessage: "ON CONFLICT clause requires either 'DO NOTHING' or 'DO UPDATE SET ...' after it.",
              lineNumber: i,
            };
          }
        }
      }
    }

    // Check for RETURNING clause without SELECT-like columns
    if (lowerSql.includes('returning')) {
      const returningPattern = /returning\s*$/i;
      if (returningPattern.test(sql.trim())) {
        // Find the line with incomplete RETURNING
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes('returning') && lines[i].trim().toLowerCase().endsWith('returning')) {
            return {
              isValid: false,
              errorMessage: "RETURNING clause requires column names after it (e.g., RETURNING id, name).",
              lineNumber: i,
            };
          }
        }
      }
    }

    // Check for COALESCE with less than 2 arguments
    const coalescePattern = /coalesce\s*\(\s*([^,)]+)\s*\)/gi;
    let coalesceMatch;
    while ((coalesceMatch = coalescePattern.exec(sql)) !== null) {
      // COALESCE should have at least 2 arguments
      // If we only find one argument (no comma), it's likely a mistake
      if (!coalesceMatch[1].includes(',')) {
        // Find line number
        const charIndex = coalesceMatch.index;
        let currentLength = 0;
        for (let i = 0; i < lines.length; i++) {
          currentLength += lines[i].length + 1; // +1 for newline
          if (currentLength > charIndex) {
            return {
              isValid: false,
              errorMessage: "COALESCE function requires at least 2 arguments to be useful. Use COALESCE(column, default_value).",
              lineNumber: i,
            };
          }
        }
      }
    }

    // Check for DATE type casting without proper format
    // e.g., DATE 'value' should be DATE '2024-01-01' format
    const datePattern = /date\s+'([^']+)'/gi;
    let dateMatch;
    while ((dateMatch = datePattern.exec(sql)) !== null) {
      const dateValue = dateMatch[1];
      // Check if it's a valid date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        const charIndex = dateMatch.index;
        let currentLength = 0;
        for (let i = 0; i < lines.length; i++) {
          currentLength += lines[i].length + 1;
          if (currentLength > charIndex) {
            return {
              isValid: false,
              errorMessage: `DATE literal '${dateValue}' should be in YYYY-MM-DD format (e.g., DATE '2024-01-01').`,
              lineNumber: i,
            };
          }
        }
      }
    }

    // Check for INTERVAL without proper unit
    const intervalPattern = /interval\s+'[^']+'\s*$/i;
    if (intervalPattern.test(sql.trim())) {
      for (let i = 0; i < lines.length; i++) {
        if (intervalPattern.test(lines[i].trim())) {
          return {
            isValid: false,
            errorMessage: "INTERVAL requires a time unit after the value (e.g., INTERVAL '1 day' or INTERVAL '1' DAY).",
            lineNumber: i,
          };
        }
      }
    }

    // Check for gen_salt without proper algorithm
    if (lowerSql.includes('gen_salt()')) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes('gen_salt()')) {
          return {
            isValid: false,
            errorMessage: "gen_salt() requires an algorithm parameter (e.g., gen_salt('bf') for Blowfish or gen_salt('md5')).",
            lineNumber: i,
          };
        }
      }
    }

    // Check for crypt() with wrong number of arguments
    const cryptPattern = /crypt\s*\(\s*([^)]*)\s*\)/gi;
    let cryptMatch;
    while ((cryptMatch = cryptPattern.exec(sql)) !== null) {
      const args = cryptMatch[1].split(',').map(s => s.trim()).filter(s => s);
      if (args.length !== 2) {
        const charIndex = cryptMatch.index;
        let currentLength = 0;
        for (let i = 0; i < lines.length; i++) {
          currentLength += lines[i].length + 1;
          if (currentLength > charIndex) {
            return {
              isValid: false,
              errorMessage: "crypt() requires exactly 2 arguments: crypt(password, gen_salt('algorithm')).",
              lineNumber: i,
            };
          }
        }
      }
    }

    return { isValid: true };
  },
};

import { ValidationRule, ValidationResult } from '../types';
import { areWordsSimilar, levenshteinDistance } from '../../utils/stringUtils';

// Find the most similar word from a list
function findMostSimilarWord(word: string, possibleWords: string[]): string {
  let minDistance = Infinity;
  let mostSimilar = "";

  for (const candidate of possibleWords) {
    const distance = levenshteinDistance(word, candidate);
    if (distance < minDistance) {
      minDistance = distance;
      mostSimilar = candidate;
    }
  }

  return mostSimilar;
}

export const keywordSpellingRule: ValidationRule = {
  name: "keyword-spelling",
  description: "Check for misspelled SQL keywords",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // List of common SQL keywords that must be spelled correctly
    const sqlKeywords = [
      "SELECT",
      "FROM",
      "WHERE",
      "AND",
      "OR",
      "ORDER BY",
      "GROUP BY",
      "HAVING",
      "JOIN",
      "LEFT JOIN",
      "RIGHT JOIN",
      "INNER JOIN",
      "FULL JOIN",
      "OUTER JOIN",
      "CROSS JOIN",
      "ON",
      "AS",
      "IN",
      "EXISTS",
      "NOT",
      "BETWEEN",
      "LIKE",
      "IS NULL",
      "IS NOT NULL",
      "LIMIT",
      "OFFSET",
      "INSERT INTO",
      "VALUES",
      "UPDATE",
      "SET",
      "DELETE FROM",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "INDEX",
      "UNION",
      "ALL",
      "DISTINCT",
      "CASE",
      "WHEN",
      "THEN",
      "ELSE",
      "END",
      "WITH",
    ];

    // Common typos and misspellings of SQL keywords
    const commonTypos: { [key: string]: string } = {
      SELCT: "SELECT",
      SLECT: "SELECT",
      SELET: "SELECT",
      SELECTT: "SELECT",
      SEKECT: "SELECT",
      FORM: "FROM",
      FOMR: "FROM",
      FROMT: "FROM",
      FRIM: "FROM",
      WEHRE: "WHERE",
      WHRE: "WHERE",
      WHER: "WHERE",
      WHEER: "WHERE",
      WHEREE: "WHERE",
      HWERE: "WHERE",
      WKERE: "WHERE",
      WHERRE: "WHERE",
      GROOP: "GROUP",
      GRUOP: "GROUP",
      GORUP: "GROUP",
      GROPU: "GROUP",
      GROUPP: "GROUP",
      ORDRE: "ORDER",
      ORDR: "ORDER",
      OREDR: "ORDER",
      ORDERBY: "ORDER BY",
      ODER: "ORDER",
      OERDER: "ORDER",
      JOIM: "JOIN",
      JION: "JOIN",
      JIOIN: "JOIN",
      JOINN: "JOIN",
      ONM: "ON",
      ONN: "ON",
      UPDTE: "UPDATE",
      UPDAET: "UPDATE",
      UPATE: "UPDATE",
      UPDATTE: "UPDATE",
      ISNER: "INSERT",
      INSRET: "INSERT",
      INSER: "INSERT",
      INSETT: "INSERT",
      INSETR: "INSERT",
      DELTE: "DELETE",
      DELETTE: "DELETE",
      DEELETE: "DELETE",
      DEKETE: "DELETE",
      DELEET: "DELETE",
      HAIVNG: "HAVING",
      HAVNIG: "HAVING",
      AHVING: "HAVING",
      HABING: "HAVING",
      GROUPBY: "GROUP BY",
      INNERJOIN: "INNER JOIN",
      LEFTJOIN: "LEFT JOIN",
      RIGHTJOIN: "RIGHT JOIN",
      FULLJOIN: "FULL JOIN",
      OUTERJOIN: "OUTER JOIN",
    };

    // Only do this validation for multiline queries
    if (!originalQuery.includes("\n")) {
      return { isValid: true };
    }

    const lines = originalQuery.split("\n");

    // Check each line for typoed keywords
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Convert line to uppercase for comparison
      const upperLine = line.toUpperCase();

      // Check for common typos first - this is explicit and reliable
      for (const [typo, correction] of Object.entries(commonTypos)) {
        // Use word boundary to avoid false positives
        const typoRegex = new RegExp(`\\b${typo}\\b`, "i");
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
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP",
        "ORDER",
        "JOIN",
        "HAVING",
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
};
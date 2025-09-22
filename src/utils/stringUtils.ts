/**
 * Utility functions for string manipulation and analysis
 */

/**
 * Simple hash function for strings
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

/**
 * Find a line in text that matches a pattern, with fuzzy matching support
 */
export function findLineWithPattern(text: string, pattern: string, options: {
  fuzzy?: boolean;
  ignoreCase?: boolean;
  ignoreWhitespace?: boolean;
} = {}): { lineNumber: number; line: string } | null {
  const lines = text.split('\n');
  const normalizedPattern = options.ignoreWhitespace
    ? pattern.replace(/\s+/g, ' ').trim()
    : pattern;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (options.ignoreCase) {
      line = line.toLowerCase();
    }

    if (options.ignoreWhitespace) {
      line = line.replace(/\s+/g, ' ').trim();
    }

    if (options.fuzzy) {
      if (line.includes(normalizedPattern) || normalizedPattern.includes(line.trim())) {
        return { lineNumber: i + 1, line: lines[i] };
      }
    } else {
      if (line.includes(normalizedPattern)) {
        return { lineNumber: i + 1, line: lines[i] };
      }
    }
  }

  return null;
}

/**
 * Calculate Levenshtein distance between two words
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator, // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two words are similar based on Levenshtein distance
 */
export function areWordsSimilar(word1: string, word2: string, threshold: number = 2): boolean {
  const distance = levenshteinDistance(word1.toLowerCase(), word2.toLowerCase());
  return distance <= threshold;
}
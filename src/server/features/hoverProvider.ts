/** @format */

import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getKeywordDocumentation } from '../documentation/sqlKeywords';
import { getBatonParameterDocumentation } from '../documentation/batonParameters';

/**
 * Get the word at a specific position in the document
 */
function getWordAtPosition(document: TextDocument, offset: number): string {
  const text = document.getText();
  let start = offset;
  let end = offset;

  // Find word boundaries
  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    start--;
  }
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
    end++;
  }

  return text.substring(start, end);
}

/**
 * Check if we're inside a Baton parameter like {{.external_id}}
 */
function getBatonParameterAtPosition(document: TextDocument, offset: number): string | null {
  const text = document.getText();
  let start = offset;

  // Look backwards for {{
  while (start > 0 && text.substring(start - 2, start) !== '{{') {
    start--;
    if (offset - start > 100) return null; // Safety limit
  }

  if (text.substring(start - 2, start) !== '{{') {
    return null;
  }

  // Look forward for }}
  let end = offset;
  while (end < text.length && text.substring(end, end + 2) !== '}}') {
    end++;
    if (end - start > 100) return null; // Safety limit
  }

  if (text.substring(end, end + 2) !== '}}') {
    return null;
  }

  return text.substring(start - 2, end + 2);
}

/**
 * Check for multi-word keywords (like "LEFT JOIN", "GROUP BY")
 */
function getMultiWordKeyword(document: TextDocument, offset: number, word: string): string {
  const text = document.getText();
  const upperWord = word.toUpperCase();

  // Check for two-word combinations
  const twoWordKeywords = [
    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'OUTER JOIN', 'CROSS JOIN',
    'ORDER BY', 'GROUP BY', 'INSERT INTO', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
    'IS NULL', 'IS NOT'
  ];

  for (const keyword of twoWordKeywords) {
    const [first, second] = keyword.split(' ');
    if (upperWord === first) {
      // Look ahead for the second word
      let nextWordStart = offset + word.length;
      while (nextWordStart < text.length && /\s/.test(text[nextWordStart])) {
        nextWordStart++;
      }
      let nextWordEnd = nextWordStart;
      while (nextWordEnd < text.length && /[a-zA-Z]/.test(text[nextWordEnd])) {
        nextWordEnd++;
      }
      const nextWord = text.substring(nextWordStart, nextWordEnd).toUpperCase();
      if (nextWord === second) {
        return keyword;
      }
    }
  }

  // Check for "IS NOT NULL"
  if (upperWord === 'IS') {
    const remainingText = text.substring(offset).toUpperCase();
    if (remainingText.startsWith('IS NOT NULL')) {
      return 'IS NOT NULL';
    }
  }

  return word;
}

/**
 * Provide hover information for SQL keywords and Baton parameters
 */
export function provideHover(document: TextDocument, position: { line: number; character: number }): Hover | null {
  const offset = document.offsetAt(position);

  // Check if we're hovering over a Baton parameter
  const batonParam = getBatonParameterAtPosition(document, offset);
  if (batonParam) {
    const doc = getBatonParameterDocumentation(batonParam);
    if (doc) {
      const markdown: MarkupContent = {
        kind: MarkupKind.Markdown,
        value: [
          `### ${doc.parameter}`,
          '',
          doc.description,
          '',
          doc.example ? `**Example:**\n\`\`\`sql\n${doc.example}\n\`\`\`` : ''
        ].filter(Boolean).join('\n')
      };
      return {
        contents: markdown
      };
    }
  }

  // Get the word at the current position
  const word = getWordAtPosition(document, offset);
  if (!word) {
    return null;
  }

  // Check for multi-word keywords
  const fullKeyword = getMultiWordKeyword(document, offset, word);

  // Try to find documentation for the keyword
  const keywordDoc = getKeywordDocumentation(fullKeyword);
  if (keywordDoc) {
    const markdown: MarkupContent = {
      kind: MarkupKind.Markdown,
      value: [
        `### ${keywordDoc.keyword}`,
        '',
        keywordDoc.description,
        '',
        keywordDoc.example ? `**Example:**\n\`\`\`sql\n${keywordDoc.example}\n\`\`\`` : ''
      ].filter(Boolean).join('\n')
    };
    return {
      contents: markdown
    };
  }

  // Try Baton schema properties (for YAML keys)
  const schemaDoc = getBatonParameterDocumentation(word);
  if (schemaDoc) {
    const markdown: MarkupContent = {
      kind: MarkupKind.Markdown,
      value: [
        `### ${schemaDoc.parameter}`,
        '',
        schemaDoc.description,
        '',
        schemaDoc.example ? `**Example:**\n\`\`\`yaml\n${schemaDoc.example}\n\`\`\`` : ''
      ].filter(Boolean).join('\n')
    };
    return {
      contents: markdown
    };
  }

  return null;
}

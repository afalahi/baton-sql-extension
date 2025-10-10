/** @format */

import { CompletionItem, CompletionItemKind, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SQL_KEYWORDS, SQL_FUNCTIONS, SQL_TYPES } from '../constants/sqlKeywords';
import { BATON_PARAMETERS, BATON_SCHEMA_PROPERTIES } from '../documentation/batonParameters';

/**
 * Check if the cursor is inside a SQL query string
 */
function isInsideSQLQuery(document: TextDocument, offset: number): boolean {
  const text = document.getText();
  const lines = text.split('\n');
  let currentOffset = 0;

  for (const line of lines) {
    if (currentOffset + line.length >= offset) {
      // Check if we're in a YAML value that looks like SQL
      const trimmedLine = line.trim();
      if (trimmedLine.includes('query:') || trimmedLine.includes('queries:')) {
        return true;
      }
      // Check if line starts with SQL keywords (likely inside a multi-line SQL string)
      if (/^\s+(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(line)) {
        return true;
      }
    }
    currentOffset += line.length + 1;
  }

  return false;
}

/**
 * Get the current line text up to the cursor position
 */
function getCurrentLinePrefix(document: TextDocument, position: { line: number; character: number }): string {
  const line = document.getText({
    start: { line: position.line, character: 0 },
    end: position
  });
  return line;
}

/**
 * Check if we should provide Baton parameter completions
 */
function shouldProvideBatonParameters(linePrefix: string): boolean {
  // Check if we're after {{ which indicates Baton parameter
  return linePrefix.includes('{{');
}

/**
 * Check if we should provide YAML schema property completions
 */
function shouldProvideSchemaProperties(linePrefix: string): boolean {
  // Simple heuristic: if line starts with spaces and no colon yet, might be a YAML key
  const trimmed = linePrefix.trim();
  return trimmed.length > 0 && !trimmed.includes(':') && !trimmed.startsWith('-');
}

/**
 * Provide completion items for SQL keywords, functions, and Baton parameters
 */
export function provideCompletionItems(params: TextDocumentPositionParams, document: TextDocument): CompletionItem[] {
  const position = params.position;
  const offset = document.offsetAt(position);
  const linePrefix = getCurrentLinePrefix(document, position);
  const completions: CompletionItem[] = [];

  // Check context
  const inSQLQuery = isInsideSQLQuery(document, offset);
  const needsBatonParams = shouldProvideBatonParameters(linePrefix);
  const needsSchemaProps = shouldProvideSchemaProperties(linePrefix);

  // Provide Baton parameter completions
  if (needsBatonParams) {
    for (const [param, doc] of Object.entries(BATON_PARAMETERS)) {
      completions.push({
        label: param,
        kind: CompletionItemKind.Variable,
        detail: 'Baton Parameter',
        documentation: doc.description,
        insertText: param
      });
    }
  }

  // Provide SQL keyword completions when inside SQL query
  if (inSQLQuery) {
    // SQL Keywords
    for (const keyword of SQL_KEYWORDS) {
      completions.push({
        label: keyword,
        kind: CompletionItemKind.Keyword,
        detail: 'SQL Keyword',
        insertText: keyword
      });
    }

    // SQL Functions
    for (const func of SQL_FUNCTIONS) {
      completions.push({
        label: func,
        kind: CompletionItemKind.Function,
        detail: 'SQL Function',
        insertText: `${func}($1)`,
        insertTextFormat: 2 // Snippet format
      });
    }

    // SQL Data Types
    for (const type of SQL_TYPES) {
      completions.push({
        label: type,
        kind: CompletionItemKind.TypeParameter,
        detail: 'SQL Data Type',
        insertText: type
      });
    }
  }

  // Provide Baton schema property completions for YAML structure
  if (needsSchemaProps && !inSQLQuery) {
    for (const [prop, doc] of Object.entries(BATON_SCHEMA_PROPERTIES)) {
      completions.push({
        label: prop,
        kind: CompletionItemKind.Property,
        detail: 'Baton Schema Property',
        documentation: doc.description,
        insertText: `${prop}: `
      });
    }
  }

  return completions;
}

/**
 * Resolve additional details for a completion item (optional enhancement)
 */
export function resolveCompletionItem(item: CompletionItem): CompletionItem {
  // Could add more detailed documentation here if needed
  return item;
}

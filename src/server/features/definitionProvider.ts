/** @format */

import { Definition, Location, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolIndex } from '../index/symbolIndex';

/**
 * Get the word at a specific position in the document
 */
function getWordAtPosition(document: TextDocument, position: Position): string {
  const offset = document.offsetAt(position);
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
 * Provide go-to-definition functionality
 */
export function provideDefinition(
  document: TextDocument,
  position: Position,
  symbolIndex: SymbolIndex
): Definition | null {
  // Get the word under the cursor
  const word = getWordAtPosition(document, position);
  if (!word) {
    return null;
  }

  // Look up the symbol in the index
  const symbols = symbolIndex.findSymbol(word);
  if (symbols.length === 0) {
    return null;
  }

  // Return all locations where this symbol is defined
  const locations: Location[] = symbols.map(symbol => ({
    uri: symbol.documentUri,
    range: symbol.range
  }));

  // If there's only one definition, return it directly
  if (locations.length === 1) {
    return locations[0];
  }

  // Multiple definitions - return array
  return locations;
}

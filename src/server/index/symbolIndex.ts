/** @format */

import { Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseYaml, findSQLQueries } from '../../utils/serverUtils';

export interface SymbolInfo {
  name: string;
  type: 'table' | 'alias' | 'resource_type' | 'entitlement';
  range: Range;
  documentUri: string;
}

export class SymbolIndex {
  private symbols: Map<string, SymbolInfo[]> = new Map();

  /**
   * Index a document and extract symbols
   */
  indexDocument(document: TextDocument): void {
    const uri = document.uri;
    const content = document.getText();

    // Clear existing symbols for this document
    this.clearDocument(uri);

    try {
      // Parse YAML
      const yamlObject = parseYaml(content);
      if (!yamlObject) return;

      // Extract resource types
      if (yamlObject.resource_types) {
        this.extractResourceTypes(document, yamlObject.resource_types);
      }

      // Extract table names from SQL queries
      const sqlQueries = findSQLQueries(content, yamlObject);
      for (const queryInfo of sqlQueries) {
        this.extractTablesFromQuery(document, queryInfo.query, queryInfo.startPosition);
      }
    } catch (error) {
      // Silently fail - indexing is best-effort
    }
  }

  /**
   * Extract resource type definitions from YAML
   */
  private extractResourceTypes(document: TextDocument, resourceTypes: any): void {
    const lines = document.getText().split('\n');

    for (const [name, _value] of Object.entries(resourceTypes)) {
      // Find the line where this resource type is defined
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith(`${name}:`)) {
          const startChar = line.indexOf(name);
          const symbol: SymbolInfo = {
            name,
            type: 'resource_type',
            range: {
              start: { line: i, character: startChar },
              end: { line: i, character: startChar + name.length }
            },
            documentUri: document.uri
          };
          this.addSymbol(name, symbol);
          break;
        }
      }
    }
  }

  /**
   * Extract table names from SQL query (simple regex-based extraction)
   */
  private extractTablesFromQuery(document: TextDocument, query: string, queryStartPos: number): void {
    // Simple regex to extract table names from FROM and JOIN clauses
    const tablePatterns = [
      /FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi
    ];

    const queryLines = query.split('\n');
    let currentOffset = queryStartPos;

    for (let lineIdx = 0; lineIdx < queryLines.length; lineIdx++) {
      const line = queryLines[lineIdx];

      for (const pattern of tablePatterns) {
        pattern.lastIndex = 0; // Reset regex
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const tableName = match[1];
          const startChar = match.index + match[0].indexOf(tableName);

          // Calculate position in document
          const position = document.positionAt(currentOffset + startChar);

          const symbol: SymbolInfo = {
            name: tableName,
            type: 'table',
            range: {
              start: position,
              end: { line: position.line, character: position.character + tableName.length }
            },
            documentUri: document.uri
          };
          this.addSymbol(tableName, symbol);
        }
      }

      currentOffset += line.length + 1; // +1 for newline
    }
  }

  /**
   * Add a symbol to the index
   */
  private addSymbol(name: string, symbol: SymbolInfo): void {
    const existing = this.symbols.get(name) || [];
    existing.push(symbol);
    this.symbols.set(name, existing);
  }

  /**
   * Find symbol by name
   */
  findSymbol(name: string): SymbolInfo[] {
    return this.symbols.get(name) || [];
  }

  /**
   * Clear symbols for a document
   */
  clearDocument(uri: string): void {
    for (const [name, symbols] of this.symbols.entries()) {
      const filtered = symbols.filter(s => s.documentUri !== uri);
      if (filtered.length > 0) {
        this.symbols.set(name, filtered);
      } else {
        this.symbols.delete(name);
      }
    }
  }

  /**
   * Clear all symbols
   */
  clear(): void {
    this.symbols.clear();
  }
}

import * as vscode from 'vscode';
import { ValidationResult, SQLQueryInfo } from '../validation/types';

/**
 * Check if a file matches the Baton SQL pattern
 */
export function isBatonSQLFile(uri: vscode.Uri): boolean {
  const fileName = uri.path.split('/').pop() || '';
  return /^baton-sql-.*\.(yaml|yml)$/i.test(fileName);
}

/**
 * Convert validation results to VS Code diagnostics
 */
export function createDiagnostics(
  document: vscode.TextDocument,
  validationResults: ValidationResult[],
  queryInfo?: SQLQueryInfo
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  for (const result of validationResults) {
    const diagnostic = createDiagnosticFromResult(document, result, queryInfo);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

/**
 * Create a single diagnostic from a validation result
 */
function createDiagnosticFromResult(
  document: vscode.TextDocument,
  result: ValidationResult,
  queryInfo?: SQLQueryInfo
): vscode.Diagnostic | null {
  let range: vscode.Range;

  if (result.lineNumber !== undefined) {
    // Use specific line number
    const lineNumber = Math.max(0, Math.min(result.lineNumber, document.lineCount - 1));
    const line = document.lineAt(lineNumber);
    range = new vscode.Range(
      lineNumber,
      0,
      lineNumber,
      line.text.length
    );
  } else if (result.position !== undefined && queryInfo) {
    // Use position information
    range = createRangeFromPosition(document, result.position, queryInfo);
  } else if (queryInfo) {
    // Use query info to create range
    range = createRangeFromQueryInfo(document, queryInfo);
  } else {
    // Fallback to first line
    range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
  }

  return new vscode.Diagnostic(
    range,
    result.errorMessage || 'SQL validation error',
    vscode.DiagnosticSeverity.Error
  );
}

/**
 * Create a range from position information
 */
function createRangeFromPosition(
  document: vscode.TextDocument,
  position: number,
  queryInfo: SQLQueryInfo
): vscode.Range {
  const startPos = document.positionAt(queryInfo.startPosition + position);
  const endPos = document.positionAt(queryInfo.startPosition + position + 10); // Highlight ~10 chars
  return new vscode.Range(startPos, endPos);
}

/**
 * Create a range from query info
 */
function createRangeFromQueryInfo(
  document: vscode.TextDocument,
  queryInfo: SQLQueryInfo
): vscode.Range {
  const startPos = document.positionAt(queryInfo.startPosition);
  const endPos = document.positionAt(queryInfo.endPosition);
  return new vscode.Range(startPos, endPos);
}

/**
 * Apply JSON schema to a document
 */
export async function applyBatonSchema(document: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration('yaml', document.uri);
  const schemas = config.get('schemas') as any;

  if (!schemas) {
    await config.update('schemas', {}, vscode.ConfigurationTarget.WorkspaceFolder);
  }

  const extensionPath = vscode.extensions.getExtension('batonSQL.extension')?.extensionPath;
  if (extensionPath) {
    const schemaPath = `${extensionPath}/schemas/baton-schema.json`;
    const existingSchemas = config.get('schemas', {}) as { [key: string]: string[] };

    existingSchemas[schemaPath] = [document.uri.toString()];
    await config.update('schemas', existingSchemas, vscode.ConfigurationTarget.WorkspaceFolder);
  }
}

/**
 * Debounce function for validation
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(null, args), wait);
  };
}

/**
 * Check if document content has changed (for caching)
 */
export function hasDocumentChanged(
  document: vscode.TextDocument,
  lastDigest: string,
  hashFunction: (str: string) => string
): boolean {
  const currentDigest = hashFunction(document.getText());
  return currentDigest !== lastDigest;
}
/**
 * File utility functions that work for both VS Code URIs and plain file paths
 * These are used by the language server which doesn't have access to vscode module
 */

/**
 * Check if a file path matches the Baton SQL pattern
 * Works with both VS Code URIs (file:///path/to/file) and plain paths
 */
export function isBatonSQLFilePath(pathOrUri: string): boolean {
  // Extract filename from URI or path
  const fileName = pathOrUri.split('/').pop() || '';
  return /^baton-sql-.*\.(yaml|yml)$/i.test(fileName);
}

/**
 * Hash a string to create a digest for change detection
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

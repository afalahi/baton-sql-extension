/** @format */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// Import our modular validation and utility functions
import { validateSql, clearValidationCache, ValidationResult } from './validation';
import {
  parseYaml,
  findSQLQueries,
  isBatonSQLFile,
  createDiagnostics,
  applyBatonSchema,
  debounce,
  hasDocumentChanged,
  hashString
} from './utils';

// File digest cache for change detection
const fileDigests = new Map<string, string>();

// Diagnostic collection for SQL validation errors
let diagnosticCollection: vscode.DiagnosticCollection;

/**
 * Validate SQL in a VS Code document and update diagnostics
 */
async function validateSQLInDocument(document: vscode.TextDocument): Promise<void> {
  // Check if file has changed to avoid unnecessary processing
  const currentDigest = hashString(document.getText());
  const lastDigest = fileDigests.get(document.uri.toString());

  if (lastDigest === currentDigest) {
    return; // No changes, skip validation
  }

  fileDigests.set(document.uri.toString(), currentDigest);

  try {
    // Clear previous diagnostics
    diagnosticCollection.delete(document.uri);

    // Parse YAML content
    const yamlContent = document.getText();
    const yamlObject = parseYaml(yamlContent);

    if (!yamlObject) {
      return; // Invalid YAML, let YAML extension handle it
    }

    // Find all SQL queries in the document
    const sqlQueries = findSQLQueries(yamlContent, yamlObject);

    if (sqlQueries.length === 0) {
      return; // No SQL queries found
    }

    // Validate each SQL query
    const allDiagnostics: vscode.Diagnostic[] = [];

    for (const queryInfo of sqlQueries) {
      const validationResults = validateSql(queryInfo.query, yamlContent);

      if (validationResults.length > 0) {
        const diagnostics = createDiagnostics(document, validationResults, queryInfo);
        allDiagnostics.push(...diagnostics);
      }
    }

    // Update diagnostics in VS Code
    if (allDiagnostics.length > 0) {
      diagnosticCollection.set(document.uri, allDiagnostics);
    }

  } catch (error) {
    console.error('[Baton SQL] Error validating document:', error);
  }
}

/**
 * Check if a document should be processed by this extension
 */
function shouldProcessDocument(document: vscode.TextDocument): boolean {
  return isBatonSQLFile(document.uri) && document.languageId === 'yaml';
}

/**
 * Process all currently open documents on activation
 */
function processOpenDocuments(): void {
  for (const document of vscode.workspace.textDocuments) {
    if (shouldProcessDocument(document)) {
      validateSQLInDocument(document);
      applyBatonSchema(document);
    }
  }
}

/**
 * Apply Baton SQL schema to current file (command handler)
 */
async function applySchemaCommand(): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  const document = activeEditor.document;
  if (!isBatonSQLFile(document.uri)) {
    vscode.window.showWarningMessage('This command only works with baton-sql-*.yaml files.');
    return;
  }

  try {
    await applyBatonSchema(document);
    await validateSQLInDocument(document);
    vscode.window.showInformationMessage('Baton SQL schema applied successfully.');
  } catch (error) {
    console.error('[Baton SQL] Error applying schema:', error);
    vscode.window.showErrorMessage('Failed to apply Baton SQL schema.');
  }
}

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext): void {

  // Create diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection('baton-sql');
  context.subscriptions.push(diagnosticCollection);

  // Create debounced validation function to avoid excessive processing
  const debouncedValidation = debounce(validateSQLInDocument, 500);

  // Register command for manual schema application
  const applySchemaCommandHandler = vscode.commands.registerCommand(
    'batonSQL.applySchema',
    applySchemaCommand
  );
  context.subscriptions.push(applySchemaCommandHandler);

  // Process currently open documents
  processOpenDocuments();

  // Set up event handlers

  // Document change handler
  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
    if (shouldProcessDocument(event.document)) {
      debouncedValidation(event.document);
    }
  });
  context.subscriptions.push(onDidChangeTextDocument);

  // Document open handler
  const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
    if (shouldProcessDocument(document)) {
      applyBatonSchema(document);
      validateSQLInDocument(document);
    }
  });
  context.subscriptions.push(onDidOpenTextDocument);

  // Document save handler
  const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument((document) => {
    if (shouldProcessDocument(document)) {
      validateSQLInDocument(document);
    }
  });
  context.subscriptions.push(onDidSaveTextDocument);

  // Document close handler (cleanup)
  const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
    if (isBatonSQLFile(document.uri)) {
      diagnosticCollection.delete(document.uri);
      fileDigests.delete(document.uri.toString());
    }
  });
  context.subscriptions.push(onDidCloseTextDocument);

}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  // Clear caches
  clearValidationCache();
  fileDigests.clear();

  // Dispose diagnostic collection
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
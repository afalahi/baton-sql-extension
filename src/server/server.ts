/** @format */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
  DiagnosticSeverity,
  Diagnostic
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Import validation logic
import { validateSql, clearValidationCache } from '../validation';
import { parseYaml, findSQLQueries, isBatonSQLFilePath, hashString } from '../utils/serverUtils';

// Import LSP feature providers
import { provideHover } from './features/hoverProvider';
import { provideCompletionItems, resolveCompletionItem } from './features/completionProvider';
import { provideCodeActions, storeDiagnosticFix, clearDiagnosticFixes } from './features/codeActionProvider';
import { provideDefinition } from './features/definitionProvider';
import { SymbolIndex } from './index/symbolIndex';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for file digests to detect changes
const fileDigests = new Map<string, string>();

// Symbol index for go-to-definition
const symbolIndex = new SymbolIndex();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

/**
 * Initialize the language server
 */
connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Hover support - show documentation on hover
      hoverProvider: true,
      // Completion support - auto-complete SQL keywords and Baton parameters
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', '{', ' ', '\n']
      },
      // Code Action support - quick fixes for diagnostics
      codeActionProvider: true,
      // Definition provider - go-to-definition support
      definitionProvider: true
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  connection.console.log('[Baton SQL Language Server] Initialized');
});

/**
 * Validate a text document and send diagnostics
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const uri = textDocument.uri;

  // Check if this is a Baton SQL file
  if (!isBatonSQLFilePath(uri)) {
    return;
  }

  // Check if file has changed to avoid unnecessary processing
  const content = textDocument.getText();
  const currentDigest = hashString(content);
  const lastDigest = fileDigests.get(uri);

  if (lastDigest === currentDigest) {
    return; // No changes, skip validation
  }

  fileDigests.set(uri, currentDigest);

  try {
    // Clear previous diagnostic fixes for this document
    clearDiagnosticFixes(uri);

    // Parse YAML content
    const yamlObject = parseYaml(content);

    if (!yamlObject) {
      return; // Invalid YAML, let YAML language server handle it
    }

    // Find all SQL queries in the document
    const sqlQueries = findSQLQueries(content, yamlObject);

    if (sqlQueries.length === 0) {
      // No SQL queries found, clear any existing diagnostics
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    // Validate each SQL query
    const allDiagnostics: Diagnostic[] = [];

    for (const queryInfo of sqlQueries) {
      const validationResults = validateSql(queryInfo.query, content);

      if (validationResults.length > 0) {
        for (const result of validationResults) {
          const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
              start: textDocument.positionAt(queryInfo.startPosition),
              end: textDocument.positionAt(queryInfo.endPosition)
            },
            message: result.errorMessage || 'SQL validation error',
            source: 'baton-sql'
          };

          // If we have a specific line number from the validation result, adjust the range
          if (result.lineNumber !== undefined) {
            const lines = content.split('\n');
            let offset = 0;
            for (let i = 0; i < result.lineNumber && i < lines.length; i++) {
              offset += lines[i].length + 1; // +1 for newline
            }
            diagnostic.range = {
              start: textDocument.positionAt(offset),
              end: textDocument.positionAt(offset + (lines[result.lineNumber]?.length || 0))
            };
          } else if (result.position !== undefined) {
            diagnostic.range = {
              start: textDocument.positionAt(queryInfo.startPosition + result.position),
              end: textDocument.positionAt(queryInfo.startPosition + result.position + 1)
            };
          }

          allDiagnostics.push(diagnostic);

          // Store suggested fix if available
          if (result.suggestedFix) {
            storeDiagnosticFix(uri, diagnostic, result.suggestedFix);
          }
        }
      }
    }

    // Deduplicate diagnostics by message and range
    // This prevents duplicate errors when the same query appears multiple times in the YAML
    const uniqueDiagnostics = allDiagnostics.filter((diagnostic, index, self) =>
      index === self.findIndex(d =>
        d.message === diagnostic.message &&
        d.range.start.line === diagnostic.range.start.line &&
        d.range.start.character === diagnostic.range.start.character
      )
    );

    // Send deduplicated diagnostics to the client
    connection.sendDiagnostics({ uri, diagnostics: uniqueDiagnostics });

    // Update symbol index for go-to-definition
    symbolIndex.indexDocument(textDocument);

  } catch (error: any) {
    connection.console.error(`[Baton SQL] Error validating document ${uri}: ${error.message}`);
  }
}

// Document change handler
documents.onDidChangeContent(async (change) => {
  await validateTextDocument(change.document);
});

// Document open handler
documents.onDidOpen(async (event) => {
  await validateTextDocument(event.document);
});

// Document close handler
documents.onDidClose((event) => {
  fileDigests.delete(event.document.uri);
  symbolIndex.clearDocument(event.document.uri);
  // Clear diagnostics for closed document
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Configuration change handler
connection.onDidChangeConfiguration(() => {
  // Clear validation cache when configuration changes
  clearValidationCache();
  fileDigests.clear();

  // Revalidate all open documents
  documents.all().forEach(validateTextDocument);
});

// Hover handler - provides documentation on hover
connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return provideHover(document, params.position);
});

// Completion handler - provides auto-complete suggestions
connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return provideCompletionItems(params, document);
});

// Completion resolve handler - provides additional details for selected completion item
connection.onCompletionResolve((item) => {
  return resolveCompletionItem(item);
});

// Code Action handler - provides quick fixes for diagnostics
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return provideCodeActions(params, document);
});

// Definition handler - provides go-to-definition functionality
connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  return provideDefinition(document, params.position, symbolIndex);
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Start listening for messages from the client
connection.listen();

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
import { validateDocument, documentCache, uriToHash, evictUri } from '../validation/pipeline';
import { isBatonSQLFilePath, hashString } from '../utils/serverUtils';

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

  if (!isBatonSQLFilePath(uri)) {
    return;
  }

  const content = textDocument.getText();
  const newHash = hashString(content);
  const previousHash = uriToHash.get(uri);

  // If this URI's content hasn't changed since last validation, nothing to do.
  if (previousHash === newHash) {
    return;
  }

  uriToHash.set(uri, newHash);

  // The URI's content changed: only drop the previous hash's cache slot if no
  // OTHER URI still references it. This protects multi-URI sessions where two
  // workspaces have identical content cached under one hash.
  if (previousHash !== undefined) {
    let stillReferenced = false;
    for (const h of uriToHash.values()) {
      if (h === previousHash) { stillReferenced = true; break; }
    }
    if (!stillReferenced) {
      documentCache.delete(previousHash);
    }
  }

  // Cache hit (same content under a different URI): reuse the diagnostics.
  const cached = documentCache.get(newHash);
  if (cached) {
    connection.sendDiagnostics({ uri, diagnostics: cached });
    return;
  }

  try {
    clearDiagnosticFixes(uri);

    const { document, results } = validateDocument(content, (ruleName, error) => {
      const msg = error instanceof Error ? (error.stack || error.message) : String(error);
      connection.console.error(`[Baton SQL] rule '${ruleName}' threw while validating ${uri}: ${msg}`);
    });

    // No queries found AND no document-scope failures? Send empty and cache.
    if (results.length === 0) {
      documentCache.set(newHash, []);
      connection.sendDiagnostics({ uri, diagnostics: [] });
      symbolIndex.indexDocument(textDocument);
      return;
    }

    // Convert PipelineResult[] → Diagnostic[].
    const allDiagnostics: Diagnostic[] = [];
    for (const pr of results) {
      const r = pr.result;
      const startOffset = pr.query?.startOffset ?? 0;
      const endOffset = pr.query?.endOffset ?? content.length;

      let range = {
        start: textDocument.positionAt(startOffset),
        end: textDocument.positionAt(endOffset),
      };

      // lineNumber: absolute line in the YAML document (today's semantic).
      if (r.lineNumber !== undefined) {
        const lines = content.split('\n');
        let offset = 0;
        for (let i = 0; i < r.lineNumber && i < lines.length; i++) {
          offset += lines[i].length + 1;
        }
        range = {
          start: textDocument.positionAt(offset),
          end: textDocument.positionAt(offset + (lines[r.lineNumber]?.length || 0)),
        };
      } else if (r.position !== undefined) {
        range = {
          start: textDocument.positionAt(startOffset + r.position),
          end: textDocument.positionAt(startOffset + r.position + 1),
        };
      }

      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range,
        message: r.errorMessage || 'SQL validation error',
        source: 'baton-sql',
      };
      allDiagnostics.push(diagnostic);

      if (r.suggestedFix) {
        storeDiagnosticFix(uri, diagnostic, r.suggestedFix);
      }
    }

    // Dedupe by (message, start.line, start.character) — verbatim from v1.4.0.
    const uniqueDiagnostics = allDiagnostics.filter((diagnostic, index, self) =>
      index === self.findIndex(d =>
        d.message === diagnostic.message &&
        d.range.start.line === diagnostic.range.start.line &&
        d.range.start.character === diagnostic.range.start.character
      )
    );

    documentCache.set(newHash, uniqueDiagnostics);
    connection.sendDiagnostics({ uri, diagnostics: uniqueDiagnostics });
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
  evictUri(event.document.uri);
  symbolIndex.clearDocument(event.document.uri);
  // Clear diagnostics for closed document
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Configuration change handler
connection.onDidChangeConfiguration(() => {
  // Clear validation cache when configuration changes
  clearValidationCache();
  documentCache.clear();
  uriToHash.clear();

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

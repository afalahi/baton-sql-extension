/** @format */

import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  TextEdit as LSPTextEdit,
  WorkspaceEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit } from '../../validation/types';

/**
 * Storage for diagnostics with their suggested fixes
 * Key: document URI + diagnostic message
 */
const diagnosticFixes = new Map<string, TextEdit>();

/**
 * Store a diagnostic with its suggested fix for later retrieval
 */
export function storeDiagnosticFix(uri: string, diagnostic: Diagnostic, fix: TextEdit): void {
  const key = `${uri}:${diagnostic.message}:${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
  diagnosticFixes.set(key, fix);
}

/**
 * Clear all stored fixes for a document
 */
export function clearDiagnosticFixes(uri: string): void {
  const keys = Array.from(diagnosticFixes.keys());
  for (const key of keys) {
    if (key.startsWith(uri)) {
      diagnosticFixes.delete(key);
    }
  }
}

/**
 * Convert our TextEdit to LSP TextEdit
 */
function convertToLSPTextEdit(edit: TextEdit): LSPTextEdit {
  return {
    range: edit.range,
    newText: edit.newText
  };
}

/**
 * Provide code actions (quick fixes) for diagnostics
 */
export function provideCodeActions(params: CodeActionParams, document: TextDocument): CodeAction[] {
  const codeActions: CodeAction[] = [];

  // Check each diagnostic in the current range
  for (const diagnostic of params.context.diagnostics) {
    // Check if we have a fix stored for this diagnostic
    const key = `${params.textDocument.uri}:${diagnostic.message}:${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
    const fix = diagnosticFixes.get(key);

    if (fix) {
      // Create a code action with the fix
      const codeAction: CodeAction = {
        title: getFixTitleFromDiagnostic(diagnostic.message),
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [params.textDocument.uri]: [convertToLSPTextEdit(fix)]
          }
        }
      };

      codeActions.push(codeAction);
    }
  }

  return codeActions;
}

/**
 * Generate a user-friendly title for the quick fix based on the diagnostic message
 */
function getFixTitleFromDiagnostic(message: string): string {
  // Extract suggestions from error messages
  if (message.includes('Did you mean')) {
    const match = message.match(/Did you mean "([^"]+)"/);
    if (match) {
      return `Change to "${match[1]}"`;
    }
  }

  if (message.includes('Missing comma')) {
    return "Add missing comma";
  }

  if (message.includes('unclosed parenthes') || message.includes('missing closing parenthes')) {
    return "Add closing parenthesis";
  }

  if (message.includes('missing ON clause')) {
    return "Add ON clause to JOIN";
  }

  if (message.includes('Missing FROM clause')) {
    return "Add FROM clause";
  }

  // Default fallback
  return "Apply suggested fix";
}

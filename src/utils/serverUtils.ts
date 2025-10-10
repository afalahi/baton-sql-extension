/** @format */

/**
 * Server-safe utility exports
 *
 * This file provides a barrel export for the language server that ONLY includes
 * utilities without any VS Code API dependencies. The server must use these
 * exports instead of the main utils/index.ts to avoid bundling the 'vscode' module.
 */

// String utilities (no vscode deps)
export { findLineWithPattern, areWordsSimilar, levenshteinDistance } from './stringUtils';

// SQL utilities (no vscode deps)
export * from './sqlUtils';

// YAML utilities (no vscode deps)
export * from './yamlUtils';

// File utilities (no vscode deps) - includes hashString
export * from './fileUtils';

// DO NOT export vscodeUtils - it contains VS Code API dependencies
// that would cause "Cannot find module 'vscode'" errors in the language server

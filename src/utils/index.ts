// Utility module exports
export * from './stringUtils';
export * from './sqlUtils';
export * from './yamlUtils';
export * from './vscodeUtils';
export * from './fileUtils';

// Re-export commonly used functions for convenience
export { findLineWithPattern, areWordsSimilar, levenshteinDistance } from './stringUtils';
export { getParser, normalizeSQL, parseSQL, hasFromClause, extractTableNames, extractAliases, hasAggregateFunction, hasGroupBy } from './sqlUtils';
export { parseYaml, findSQLQueries } from './yamlUtils';
export { isBatonSQLFile, createDiagnostics, applyBatonSchema, debounce, hasDocumentChanged } from './vscodeUtils';
export { isBatonSQLFilePath, hashString } from './fileUtils';
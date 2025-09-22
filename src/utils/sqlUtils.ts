/**
 * SQL parsing utilities
 */
import { Parser } from 'node-sql-parser';

// Shared parser instance to avoid recreation
let parserInstance: Parser | null = null;

/**
 * Get or create SQL parser instance
 */
export function getParser(): Parser {
  if (!parserInstance) {
    parserInstance = new Parser();
  }
  return parserInstance;
}

/**
 * Normalize SQL for parsing by removing Baton-specific parameters
 */
export function normalizeSQL(sql: string): string {
  return sql.replace(/\?\<[^>]+\>/g, '?');
}

/**
 * Safe SQL parsing with error handling
 */
export function parseSQL(sql: string): { ast: any; error: string | null } {
  try {
    const parser = getParser();
    const normalizedSQL = normalizeSQL(sql);
    const ast = parser.astify(normalizedSQL);
    return { ast, error: null };
  } catch (error) {
    return { ast: null, error: error instanceof Error ? error.message : 'Unknown parsing error' };
  }
}

/**
 * Check if SQL has a FROM clause
 */
export function hasFromClause(ast: any): boolean {
  if (!ast || typeof ast !== 'object') return false;

  if (Array.isArray(ast)) {
    return ast.some(hasFromClause);
  }

  if (ast.from && ast.from.length > 0) {
    return true;
  }

  for (const key in ast) {
    if (typeof ast[key] === 'object' && hasFromClause(ast[key])) {
      return true;
    }
  }

  return false;
}

/**
 * Extract table names from AST
 */
export function extractTableNames(ast: any): string[] {
  const tables: string[] = [];

  function traverse(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(traverse);
      return;
    }

    if (obj.table && typeof obj.table === 'string') {
      tables.push(obj.table);
    }

    Object.values(obj).forEach(traverse);
  }

  traverse(ast);
  return [...new Set(tables)]; // Remove duplicates
}

/**
 * Extract aliases from AST
 */
export function extractAliases(ast: any): string[] {
  const aliases: string[] = [];

  function traverse(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(traverse);
      return;
    }

    if (obj.as && typeof obj.as === 'string') {
      aliases.push(obj.as);
    }

    Object.values(obj).forEach(traverse);
  }

  traverse(ast);
  return aliases;
}

/**
 * Check if SQL contains aggregate functions
 */
export function hasAggregateFunction(ast: any): boolean {
  const aggregateFunctions = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT'];

  function traverse(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;

    if (Array.isArray(obj)) {
      return obj.some(traverse);
    }

    if (obj.type === 'aggr_func' ||
        (obj.type === 'function' && aggregateFunctions.includes(obj.name?.toUpperCase()))) {
      return true;
    }

    return Object.values(obj).some(traverse);
  }

  return traverse(ast);
}

/**
 * Check if SQL has GROUP BY clause
 */
export function hasGroupBy(ast: any): boolean {
  function traverse(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;

    if (Array.isArray(obj)) {
      return obj.some(traverse);
    }

    if (obj.groupby) return true;

    return Object.values(obj).some(traverse);
  }

  return traverse(ast);
}
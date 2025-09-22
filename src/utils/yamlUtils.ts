import * as yaml from 'js-yaml';
import { SQLQueryInfo } from '../validation/types';
import { findLineWithPattern } from './stringUtils';

/**
 * Safely parse YAML content with error handling
 */
export function parseYaml(yamlContent: string): any {
  try {
    return yaml.load(yamlContent);
  } catch (error) {
    // YAML parsing failed - let YAML extension handle it
    return null;
  }
}

/**
 * Find SQL queries in YAML document with position information
 */
export function findSQLQueries(yamlContent: string, yamlObject: any): SQLQueryInfo[] {
  const queries: SQLQueryInfo[] = [];

  function traverseObject(obj: any, path: string[] = []): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        traverseObject(item, [...path, index.toString()]);
      });
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key];

      // Check if this is a SQL query field
      if (typeof value === 'string' && isSQLField(key, value)) {
        const queryInfo = findSQLQueryPosition(yamlContent, value, currentPath);
        if (queryInfo) {
          queries.push(queryInfo);
        }
      } else if (typeof value === 'object') {
        traverseObject(value, currentPath);
      }
    }
  }

  traverseObject(yamlObject);
  return queries;
}

/**
 * Check if a field contains SQL based on field name and content
 */
function isSQLField(fieldName: string, content: string): boolean {
  const sqlFieldNames = ['query', 'sql', 'statement'];
  const contentMediaType = content.includes('SELECT') || content.includes('INSERT') ||
                          content.includes('UPDATE') || content.includes('DELETE');

  return sqlFieldNames.includes(fieldName.toLowerCase()) || contentMediaType;
}

/**
 * Find the position of a SQL query in the YAML document
 */
function findSQLQueryPosition(yamlContent: string, query: string, yamlPath: string[]): SQLQueryInfo | null {
  const lines = yamlContent.split('\n');

  // Try different methods to find the query position

  // Method 1: Direct string match
  let queryPosition = findQueryByDirectMatch(yamlContent, query);
  if (queryPosition) return queryPosition;

  // Method 2: Normalized whitespace match
  queryPosition = findQueryByNormalizedMatch(yamlContent, query);
  if (queryPosition) return queryPosition;

  // Method 3: Line-by-line fuzzy search
  queryPosition = findQueryByLineSearch(lines, query, yamlPath);
  if (queryPosition) return queryPosition;

  // Method 4: YAML path-aware search
  queryPosition = findQueryByYamlPath(lines, query, yamlPath);
  if (queryPosition) return queryPosition;

  return null;
}

function findQueryByDirectMatch(yamlContent: string, query: string): SQLQueryInfo | null {
  const index = yamlContent.indexOf(query);
  if (index !== -1) {
    return {
      query,
      yamlPath: [],
      startPosition: index,
      endPosition: index + query.length
    };
  }
  return null;
}

function findQueryByNormalizedMatch(yamlContent: string, query: string): SQLQueryInfo | null {
  const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim();
  const normalizedQuery = normalizeWhitespace(query);
  const normalizedContent = normalizeWhitespace(yamlContent);

  const index = normalizedContent.indexOf(normalizedQuery);
  if (index !== -1) {
    return {
      query,
      yamlPath: [],
      startPosition: index,
      endPosition: index + query.length
    };
  }
  return null;
}

function findQueryByLineSearch(lines: string[], query: string, yamlPath: string[]): SQLQueryInfo | null {
  const queryLines = query.split('\n').filter(line => line.trim());
  if (queryLines.length === 0) return null;

  const firstQueryLine = queryLines[0].trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes(firstQueryLine)) {
      return {
        query,
        yamlPath,
        startPosition: lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0),
        endPosition: lines.slice(0, i + queryLines.length).join('\n').length
      };
    }
  }
  return null;
}

function findQueryByYamlPath(lines: string[], query: string, yamlPath: string[]): SQLQueryInfo | null {
  // Try to find the query by following the YAML path
  let currentIndentLevel = 0;
  let inTargetSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // Check if we're in the right section based on YAML path
    if (yamlPath.length > 0 && trimmedLine.includes(yamlPath[yamlPath.length - 1] + ':')) {
      inTargetSection = true;
      currentIndentLevel = line.length - line.trimStart().length;
      continue;
    }

    if (inTargetSection && trimmedLine.includes(query.substring(0, Math.min(50, query.length)))) {
      return {
        query,
        yamlPath,
        startPosition: lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0),
        endPosition: lines.slice(0, i + 1).join('\n').length
      };
    }

    // Exit target section if we've moved to a different indent level
    if (inTargetSection && trimmedLine &&
        (line.length - line.trimStart().length) <= currentIndentLevel &&
        !line.startsWith(' '.repeat(currentIndentLevel + 2))) {
      inTargetSection = false;
    }
  }

  return null;
}
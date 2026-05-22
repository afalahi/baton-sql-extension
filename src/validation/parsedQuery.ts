import { getParser, normalizeSQL } from '../utils/sqlUtils';

export interface ParsedQuery {
  /** Raw SQL with ?<param> tokens intact. */
  rawSql: string;
  /** SQL after `?<param>` → `?` normalization. */
  normalizedSql: string;
  /** AST from node-sql-parser, or null if parsing failed. */
  ast: any | null;
  /** Parser error message, or null. */
  astError: string | null;
  /** node-sql-parser dialect used for the parse (undefined = default/mysql). */
  dialect: string | undefined;
  /** YAML path to this query, e.g. ['resource_types', 'user', 'list', 'query']. */
  yamlPath: (string | number)[];
  /** Absolute byte offset in BatonDocument.yamlContent. */
  startOffset: number;
  /** Absolute byte offset of end. */
  endOffset: number;
  /** vars visible to this query, resolved from container scope. */
  varsScope: Map<string, string>;
  /** Set of ?<param> names appearing in rawSql. */
  usedParams: Set<string>;
}

export interface ParseQueryInput {
  rawSql: string;
  yamlPath: (string | number)[];
  startOffset: number;
  endOffset: number;
  varsScope: Map<string, string>;
  /** node-sql-parser dialect ('postgresql', 'mysql', 'transactsql', etc.). Undefined uses the default. */
  dialect?: string;
}

const PARAM_RE = /\?\<([^>]+)\>/g;

export function parseQuery(input: ParseQueryInput): ParsedQuery {
  const normalizedSql = normalizeSQL(input.rawSql);

  let ast: any | null = null;
  let astError: string | null = null;
  try {
    // node-sql-parser accepts opt=undefined as "use default dialect" — no need to branch.
    const options = input.dialect ? { database: input.dialect } : undefined;
    ast = getParser().astify(normalizedSql, options);
  } catch (err: any) {
    astError = err?.message ?? String(err);
  }

  const usedParams = new Set<string>();
  for (const match of input.rawSql.matchAll(PARAM_RE)) {
    usedParams.add(match[1]);
  }

  return {
    rawSql: input.rawSql,
    normalizedSql,
    ast,
    astError,
    dialect: input.dialect,
    yamlPath: input.yamlPath,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    varsScope: input.varsScope,
    usedParams,
  };
}

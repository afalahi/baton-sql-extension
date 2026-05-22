import { ParsedQuery } from './parsedQuery';
import { BatonDocument } from './document';

/**
 * Context passed to rules as an optional third argument.
 * Existing rules ignore it; new rules opt in for richer info.
 *
 * - For `scope: 'query'` rules (the default), `query` is set.
 * - For `scope: 'document'` rules, `query` is undefined.
 */
export interface RuleContext {
  query?: ParsedQuery;
  document: BatonDocument;
}

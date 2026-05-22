import { parseYaml } from '../utils/yamlUtils';
import { ParsedQuery, parseQuery } from './parsedQuery';

/**
 * Resolve the `vars` map visible to a query at the given yamlPath.
 *
 * See the spec table at docs/superpowers/specs/2026-05-22-sql-validation-foundation-design.md
 * for the full mapping. Each query yamlPath corresponds to exactly one vars source.
 */
export function resolveVarsScope(
  yamlObject: any,
  yamlPath: (string | number)[]
): Map<string, string> {
  const scope = new Map<string, string>();
  if (!yamlObject || typeof yamlObject !== 'object') return scope;

  // Helper: read object at a path, returning undefined if any segment missing.
  const at = (root: any, segs: (string | number)[]): any => {
    let cur = root;
    for (const s of segs) {
      if (cur == null) return undefined;
      // eslint-disable-next-line security/detect-object-injection -- path segments come from the typed walker, not user input
      cur = cur[s];
    }
    return cur;
  };

  const mergeVars = (vars: any): void => {
    if (!vars || typeof vars !== 'object') return;
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'string') scope.set(k, v);
    }
  };

  // Determine the vars source path based on yamlPath shape.
  // The patterns mirror the spec's resolution table.

  // actions.<a>.query  OR  actions.<a>.queries[<j>]
  if (yamlPath[0] === 'actions' && yamlPath.length >= 2) {
    const actionRoot = at(yamlObject, [yamlPath[0], yamlPath[1]]);
    mergeVars(actionRoot?.vars);
    // arguments keys are also in scope, with their type as the "value"
    const args = actionRoot?.arguments;
    if (args && typeof args === 'object') {
      for (const [argName, argConfig] of Object.entries(args)) {
        const type = (argConfig as any)?.type;
        if (typeof type === 'string') scope.set(argName, type);
      }
    }
    return scope;
  }

  if (yamlPath[0] !== 'resource_types' || yamlPath.length < 3) {
    return scope; // unknown shape, return empty
  }

  const rtRoot = at(yamlObject, [yamlPath[0], yamlPath[1]]);
  if (!rtRoot) return scope;

  const section = yamlPath[2];

  if (section === 'list') {
    mergeVars(rtRoot.list?.vars);
    return scope;
  }

  if (section === 'entitlements') {
    // Two sub-cases: entitlements.query (vars source: entitlements.vars)
    //                entitlements.map[<i>].provisioning.{grant,revoke}.queries[<j>] (vars: map[i].provisioning.vars)
    if (yamlPath[3] === 'map' && typeof yamlPath[4] === 'number') {
      const mapEntry = at(rtRoot, ['entitlements', 'map', yamlPath[4]]);
      mergeVars(mapEntry?.provisioning?.vars);
    } else {
      mergeVars(rtRoot.entitlements?.vars);
    }
    return scope;
  }

  if (section === 'grants' && typeof yamlPath[3] === 'number') {
    const grantEntry = at(rtRoot, ['grants', yamlPath[3]]);
    mergeVars(grantEntry?.vars);
    return scope;
  }

  if (section === 'static_entitlements' && typeof yamlPath[3] === 'number') {
    // static_entitlements[<i>].provisioning.{grant,revoke}.queries[<j>]
    const seEntry = at(rtRoot, ['static_entitlements', yamlPath[3]]);
    mergeVars(seEntry?.provisioning?.vars);
    return scope;
  }

  if (section === 'account_provisioning') {
    const sub = yamlPath[3];
    if (sub === 'create' || sub === 'validate') {
      // eslint-disable-next-line security/detect-object-injection -- sub is constrained to 'create' | 'validate' by the if-check above
      mergeVars(rtRoot.account_provisioning?.[sub]?.vars);
    }
    return scope;
  }

  if (section === 'credential_rotation') {
    if (yamlPath[3] === 'update') {
      mergeVars(rtRoot.credential_rotation?.update?.vars);
    }
    return scope;
  }

  return scope;
}

export interface ConnectConfig {
  dsn?: string;
  scheme?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  params?: Record<string, string>;
  databases?: { static?: string[]; discovery_query?: string };
}

export interface ResourceTypeDef {
  id: string;
  name?: string;
  description?: string;
  list?: {
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  };
  entitlements?: {
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  };
  /** Always initialized to [] by buildBatonDocument — never null. */
  grants: Array<{
    vars: Map<string, string>;
    query: ParsedQuery | null;
    map?: any;
    pagination?: any;
    scope?: string;
  }>;
  /** Always initialized to [] by buildBatonDocument — never null. */
  staticEntitlements: Array<{
    id: string;
    provisioning?: { vars: Map<string, string>; grant?: any; revoke?: any };
  }>;
  accountProvisioning?: any;
  credentialRotation?: any;
}

export interface ActionDef {
  id: string;
  name?: string;
  arguments?: Record<string, any>;
  vars?: Map<string, string>;
  query?: ParsedQuery | null;
  queries?: ParsedQuery[];
}

export interface BatonDocument {
  yaml: any | null;
  yamlContent: string;
  connect?: ConnectConfig;
  resourceTypes: Map<string, ResourceTypeDef>;
  actions: Map<string, ActionDef>;
  queries: ParsedQuery[];
  definedEntitlementIds: {
    literal: Set<string>;
    expression: Set<string>;
  };
  knownResourceTypeIds: Set<string>;
}

function emptyDocument(yamlContent: string, yaml: any | null): BatonDocument {
  return {
    yaml,
    yamlContent,
    resourceTypes: new Map(),
    actions: new Map(),
    queries: [],
    definedEntitlementIds: { literal: new Set(), expression: new Set() },
    knownResourceTypeIds: new Set(),
  };
}

export function buildBatonDocument(yamlContent: string): BatonDocument {
  const yamlObj = parseYaml(yamlContent);
  if (!yamlObj || typeof yamlObj !== 'object') {
    return emptyDocument(yamlContent, null);
  }
  const doc = emptyDocument(yamlContent, yamlObj);

  // connect
  if (yamlObj.connect && typeof yamlObj.connect === 'object') {
    const c = yamlObj.connect;
    doc.connect = {
      dsn: c.dsn,
      scheme: c.scheme,
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
      params: c.params,
      databases: c.databases,
    };
  }

  // resource_types walk.
  // The OUTER iteration follows YAML key order (Object.entries on the
  // resource_types map). Within each resource type, sub-sections are walked
  // in a FIXED order (list → entitlements → grants → static_entitlements →
  // account_provisioning → credential_rotation), which can differ from today's
  // findSQLQueries traversal if a YAML file lists sub-sections out of
  // conventional order. For typical configs this is identical; for unusual
  // orderings the dedup logic (which keeps first-equal) absorbs the difference.
  if (yamlObj.resource_types && typeof yamlObj.resource_types === 'object') {
    for (const [rtId, rtVal] of Object.entries<any>(yamlObj.resource_types)) {
      if (!rtVal || typeof rtVal !== 'object') continue;
      doc.knownResourceTypeIds.add(rtId);
      const rt: ResourceTypeDef = {
        id: rtId,
        name: rtVal.name,
        description: rtVal.description,
        grants: [],
        staticEntitlements: [],
      };
      doc.resourceTypes.set(rtId, rt);

      // list
      if (rtVal.list && typeof rtVal.list === 'object') {
        const listPath = ['resource_types', rtId, 'list'];
        const varsScope = resolveVarsScope(yamlObj, [...listPath, 'query']);
        const query = buildQueryIfPresent(
          yamlContent, rtVal.list.query, [...listPath, 'query'], varsScope, doc.queries
        );
        rt.list = {
          vars: varsScope,
          query,
          map: rtVal.list.map,
          pagination: rtVal.list.pagination,
          scope: rtVal.list.scope,
        };
      }

      // entitlements
      if (rtVal.entitlements && typeof rtVal.entitlements === 'object') {
        const entPath = ['resource_types', rtId, 'entitlements'];
        const varsScope = resolveVarsScope(yamlObj, [...entPath, 'query']);
        const query = buildQueryIfPresent(
          yamlContent, rtVal.entitlements.query, [...entPath, 'query'], varsScope, doc.queries
        );
        rt.entitlements = {
          vars: varsScope,
          query,
          map: rtVal.entitlements.map,
          pagination: rtVal.entitlements.pagination,
          scope: rtVal.entitlements.scope,
        };

        // entitlements.map[i].id (expression) → definedEntitlementIds.expression
        // and walk per-mapping provisioning queries.
        if (Array.isArray(rtVal.entitlements.map)) {
          for (let i = 0; i < rtVal.entitlements.map.length; i++) {
            const m = rtVal.entitlements.map[i];
            if (!m || typeof m !== 'object') continue;
            if (typeof m.id === 'string') {
              doc.definedEntitlementIds.expression.add(m.id);
            }
            if (m.provisioning && typeof m.provisioning === 'object') {
              const provPath = ['resource_types', rtId, 'entitlements', 'map', i, 'provisioning'];
              const varsScope = resolveVarsScope(yamlObj, [...provPath, 'grant', 'queries', 0]);
              if (Array.isArray(m.provisioning.grant?.queries)) {
                for (let j = 0; j < m.provisioning.grant.queries.length; j++) {
                  buildQueryIfPresent(
                    yamlContent,
                    m.provisioning.grant.queries[j],
                    [...provPath, 'grant', 'queries', j],
                    varsScope,
                    doc.queries,
                  );
                }
              }
              if (Array.isArray(m.provisioning.revoke?.queries)) {
                for (let j = 0; j < m.provisioning.revoke.queries.length; j++) {
                  buildQueryIfPresent(
                    yamlContent,
                    m.provisioning.revoke.queries[j],
                    [...provPath, 'revoke', 'queries', j],
                    varsScope,
                    doc.queries,
                  );
                }
              }
            }
          }
        }
      }

      // grants
      if (Array.isArray(rtVal.grants)) {
        for (let i = 0; i < rtVal.grants.length; i++) {
          const g = rtVal.grants[i];
          if (!g || typeof g !== 'object') continue;
          const gPath = ['resource_types', rtId, 'grants', i];
          const varsScope = resolveVarsScope(yamlObj, [...gPath, 'query']);
          const query = buildQueryIfPresent(
            yamlContent, g.query, [...gPath, 'query'], varsScope, doc.queries
          );
          rt.grants.push({
            vars: varsScope,
            query,
            map: g.map,
            pagination: g.pagination,
            scope: g.scope,
          });
        }
      }

      // static_entitlements
      if (Array.isArray(rtVal.static_entitlements)) {
        for (let i = 0; i < rtVal.static_entitlements.length; i++) {
          const se = rtVal.static_entitlements[i];
          if (!se || typeof se !== 'object') continue;
          if (typeof se.id === 'string') {
            doc.definedEntitlementIds.literal.add(se.id);
          }
          const seDef: ResourceTypeDef['staticEntitlements'][number] = {
            id: typeof se.id === 'string' ? se.id : '',
          };
          if (se.provisioning && typeof se.provisioning === 'object') {
            const provPath = ['resource_types', rtId, 'static_entitlements', i, 'provisioning'];
            const varsScope = resolveVarsScope(yamlObj, [...provPath, 'grant', 'queries', 0]);
            seDef.provisioning = { vars: varsScope, grant: se.provisioning.grant, revoke: se.provisioning.revoke };

            // grant queries
            if (se.provisioning.grant?.queries && Array.isArray(se.provisioning.grant.queries)) {
              for (let j = 0; j < se.provisioning.grant.queries.length; j++) {
                buildQueryIfPresent(
                  yamlContent,
                  se.provisioning.grant.queries[j],
                  [...provPath, 'grant', 'queries', j],
                  varsScope,
                  doc.queries,
                );
              }
            }
            // revoke queries
            if (se.provisioning.revoke?.queries && Array.isArray(se.provisioning.revoke.queries)) {
              for (let j = 0; j < se.provisioning.revoke.queries.length; j++) {
                buildQueryIfPresent(
                  yamlContent,
                  se.provisioning.revoke.queries[j],
                  [...provPath, 'revoke', 'queries', j],
                  varsScope,
                  doc.queries,
                );
              }
            }
          }
          rt.staticEntitlements.push(seDef);
        }
      }

      // account_provisioning
      if (rtVal.account_provisioning && typeof rtVal.account_provisioning === 'object') {
        const apPath = ['resource_types', rtId, 'account_provisioning'];
        const ap = rtVal.account_provisioning;

        // validate.query
        if (ap.validate?.query) {
          const validatePath = [...apPath, 'validate', 'query'];
          const varsScope = resolveVarsScope(yamlObj, validatePath);
          buildQueryIfPresent(yamlContent, ap.validate.query, validatePath, varsScope, doc.queries);
        }

        // create.queries
        if (Array.isArray(ap.create?.queries)) {
          for (let j = 0; j < ap.create.queries.length; j++) {
            const queriesPath = [...apPath, 'create', 'queries', j];
            const varsScope = resolveVarsScope(yamlObj, queriesPath);
            buildQueryIfPresent(
              yamlContent, ap.create.queries[j], queriesPath, varsScope, doc.queries
            );
          }
        }
      }

      // credential_rotation
      if (rtVal.credential_rotation && typeof rtVal.credential_rotation === 'object') {
        const crPath = ['resource_types', rtId, 'credential_rotation'];
        const cr = rtVal.credential_rotation;
        if (Array.isArray(cr.update?.queries)) {
          for (let j = 0; j < cr.update.queries.length; j++) {
            const queriesPath = [...crPath, 'update', 'queries', j];
            const varsScope = resolveVarsScope(yamlObj, queriesPath);
            buildQueryIfPresent(
              yamlContent, cr.update.queries[j], queriesPath, varsScope, doc.queries
            );
          }
        }
      }

      // account_provisioning + credential_rotation: structural retention.
      rt.accountProvisioning = rtVal.account_provisioning;
      rt.credentialRotation = rtVal.credential_rotation;
    }
  }

  // actions walked in Task 7.
  return doc;
}

/**
 * Build a ParsedQuery for `rawSql`, push into `into`, and return it.
 * Returns null if rawSql isn't a non-empty string.
 *
 * Offset finding mirrors today's findSQLQueries multi-fallback chain
 * (yamlUtils.ts:90-176) so behavior is preserved on edge configs where
 * YAML block-fold changes whitespace or several queries share text.
 */
function buildQueryIfPresent(
  yamlContent: string,
  rawSql: any,
  yamlPath: (string | number)[],
  varsScope: Map<string, string>,
  into: ParsedQuery[]
): ParsedQuery | null {
  if (typeof rawSql !== 'string' || rawSql.length === 0) return null;
  const { startOffset, endOffset } = locateQueryInYaml(yamlContent, rawSql, yamlPath);
  const query = parseQuery({
    rawSql,
    yamlPath,
    startOffset,
    endOffset,
    varsScope,
  });
  into.push(query);
  return query;
}

/**
 * Find the absolute byte offsets of `rawSql` within `yamlContent`. Tries four
 * strategies in order, matching the fallback chain in `findSQLQueries`:
 *
 *   1. Direct string match (covers the common case).
 *   2. Normalized-whitespace match (YAML block-fold `>` collapses newlines).
 *   3. First-line match (multi-line block scalars where lines reflow).
 *   4. yamlPath-aware section search (anchors on the last string segment of
 *      the yamlPath to disambiguate identical SQL appearing in two places).
 *
 * Returns `{0, 0}` if all four strategies fail.
 */
function locateQueryInYaml(
  yamlContent: string,
  rawSql: string,
  yamlPath: (string | number)[]
): { startOffset: number; endOffset: number } {
  // 1. Direct match.
  const direct = yamlContent.indexOf(rawSql);
  if (direct !== -1) {
    return { startOffset: direct, endOffset: direct + rawSql.length };
  }

  // 2. Normalized-whitespace match.
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedRaw = norm(rawSql);
  const normalizedYaml = norm(yamlContent);
  const normIdx = normalizedYaml.indexOf(normalizedRaw);
  if (normIdx !== -1) {
    return { startOffset: normIdx, endOffset: normIdx + rawSql.length };
  }

  // 3. First-line search.
  const queryLines = rawSql.split('\n').filter(l => l.trim().length > 0);
  if (queryLines.length > 0) {
    const firstLine = queryLines[0].trim();
    const lines = yamlContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLine)) {
        const offset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        return { startOffset: offset, endOffset: offset + rawSql.length };
      }
    }
  }

  // 4. yamlPath-anchored section search.
  const stringSegs = yamlPath.filter((s): s is string => typeof s === 'string');
  if (stringSegs.length > 0) {
    const lastKey = stringSegs[stringSegs.length - 1];
    const lines = yamlContent.split('\n');
    let inSection = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!inSection && trimmed.includes(lastKey + ':')) {
        inSection = true;
        continue;
      }
      if (inSection && trimmed.includes(rawSql.substring(0, Math.min(50, rawSql.length)))) {
        const offset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        return { startOffset: offset, endOffset: offset + rawSql.length };
      }
    }
  }

  // All four strategies failed; fall back to zero offsets. The diagnostic
  // range will cover the full document, which is the same behavior today's
  // server.ts uses when findSQLQueries returns no position info.
  return { startOffset: 0, endOffset: 0 };
}

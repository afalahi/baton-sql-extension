import { parseYaml } from '../utils/yamlUtils';
import { ParsedQuery } from './parsedQuery';

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

  // connect: shallow copy of recognized fields
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

  // resource_types + actions walks come in Tasks 5–7.
  return doc;
}

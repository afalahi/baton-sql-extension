/**
 * Documentation for Baton-specific parameters and schema properties
 */

export interface ParameterDocumentation {
  parameter: string;
  description: string;
  example?: string;
}

export const BATON_PARAMETERS: Record<string, ParameterDocumentation> = {
  "{{.external_id}}": {
    parameter: "{{.external_id}}",
    description: "The external ID of the resource being provisioned or queried. This is typically the primary identifier from your system.",
    example: "WHERE user_id = '{{.external_id}}'"
  },
  "{{.baton_user_email}}": {
    parameter: "{{.baton_user_email}}",
    description: "The email address of the user in Baton's system. Used for user identification and correlation.",
    example: "WHERE email = '{{.baton_user_email}}'"
  },
  "{{.baton_user_id}}": {
    parameter: "{{.baton_user_id}}",
    description: "The Baton-assigned unique identifier for the user.",
    example: "WHERE baton_id = '{{.baton_user_id}}'"
  },
  "{{.entitlement_id}}": {
    parameter: "{{.entitlement_id}}",
    description: "The ID of the entitlement being granted or revoked.",
    example: "WHERE permission_id = '{{.entitlement_id}}'"
  },
  "{{.resource_id}}": {
    parameter: "{{.resource_id}}",
    description: "The ID of the resource that is being accessed or managed.",
    example: "WHERE resource_id = '{{.resource_id}}'"
  },
};

export const BATON_SCHEMA_PROPERTIES: Record<string, ParameterDocumentation> = {
  "app_name": {
    parameter: "app_name",
    description: "The name of your application or connector. This identifies your Baton SQL connector.",
    example: "app_name: \"Finance DB Connector\""
  },
  "app_description": {
    parameter: "app_description",
    description: "Optional description of your application or connector.",
    example: "app_description: \"Manages access to the finance database\""
  },
  "connect": {
    parameter: "connect",
    description: "Database connection configuration including DSN, username, and password. Credentials can be embedded in DSN or provided separately.",
    example: "# Option 1: Credentials embedded in DSN\nconnect:\n  dsn: \"mysql://user:pass@host:3306/db\"\n\n# Option 2: Credentials provided separately\nconnect:\n  dsn: \"mysql://host:3306/db\"\n  user: \"dbuser\"\n  password: \"dbpass\""
  },
  "resource_types": {
    parameter: "resource_types",
    description: "Defines the types of resources (users, groups, roles, etc.) that this connector manages.",
    example: "resource_types:\n  user:\n    name: \"User\""
  },
  "entitlements": {
    parameter: "entitlements",
    description: "Defines the permissions or access rights that can be granted to resources.",
    example: "entitlements:\n  query: \"SELECT id, name FROM permissions\""
  },
  "grants": {
    parameter: "grants",
    description: "Defines how entitlements are assigned to resources (who has what permissions).",
    example: "grants:\n  query: \"SELECT user_id, permission_id FROM user_permissions\""
  },
  "list": {
    parameter: "list",
    description: "Configuration for listing resources of this type. Includes the SQL query and field mappings.",
    example: "list:\n  query: \"SELECT * FROM users\""
  },
  "map": {
    parameter: "map",
    description: "Maps query result columns to Baton's expected field names (id, display_name, description, etc.).",
    example: "map:\n  id: \"user_id\"\n  display_name: \"full_name\""
  },
  "query": {
    parameter: "query",
    description: "SQL query string to execute. Can use Baton parameters like {{.external_id}}.",
    example: "query: |\n  SELECT * FROM users\n  WHERE id = '{{.external_id}}'"
  },
  "pagination": {
    parameter: "pagination",
    description: "Configuration for paginating large result sets. Supports 'offset' or 'cursor' strategies.",
    example: "pagination:\n  strategy: \"offset\"\n  primary_key: \"id\""
  },
  "static_entitlements": {
    parameter: "static_entitlements",
    description: "Statically defined entitlements that don't come from database queries.",
    example: "static_entitlements:\n  - id: \"admin\"\n    display_name: \"Administrator\""
  },
  "account_provisioning": {
    parameter: "account_provisioning",
    description: "Configuration for creating new user accounts, including credential management.",
    example: "account_provisioning:\n  schema:\n    - name: \"username\"\n      type: \"string\""
  },
  "credentials": {
    parameter: "credentials",
    description: "Defines how passwords are managed when creating accounts (random_password, no_password, encrypted_password).",
    example: "credentials:\n  random_password:\n    max_length: 32\n    min_length: 16"
  }
};

export function getBatonParameterDocumentation(param: string): ParameterDocumentation | undefined {
  return BATON_PARAMETERS[param] || BATON_SCHEMA_PROPERTIES[param];
}

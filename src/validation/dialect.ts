/**
 * Maps the user-facing `connect.scheme` value to a node-sql-parser `database`
 * option string. Returns undefined for schemes node-sql-parser doesn't support
 * (oracle, hdb, etc.) so the caller falls back to the default parser dialect.
 *
 * Case-insensitive on input.
 */
export function schemeToDialect(scheme?: string): string | undefined {
  if (!scheme) return undefined;
  const s = scheme.toLowerCase().trim();
  switch (s) {
    case 'pg':
    case 'postgres':
    case 'postgresql':
      return 'postgresql';
    case 'mysql':
    case 'mysql2':
    case 'mariadb':
      return 'mysql';
    case 'sqlserver':
    case 'mssql':
    case 'tsql':
    case 'transactsql':
      return 'transactsql';
    case 'sqlite':
      return 'sqlite';
    case 'snowflake':
      return 'snowflake';
    case 'bigquery':
      return 'bigquery';
    case 'redshift':
      return 'redshift';
    case 'db2':
      return 'db2';
    // Schemes the connector supports but node-sql-parser doesn't (5.3.9):
    case 'oracle':
    case 'hdb':
    default:
      return undefined;
  }
}

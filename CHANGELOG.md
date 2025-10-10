# Change Log

All notable changes to the "Baton SQL Extension" will be documented in this file.

## [1.0.0] - 2025-10-10

### Added
- 🔍 Real-time SQL validation with 14 comprehensive rules
- 💡 Intelligent auto-completion for SQL keywords, functions, and Baton parameters
- 📖 Inline documentation via hover support
- ⚡ One-click quick fixes for common SQL errors
- 🎯 Go-to-definition for tables and resource types
- 🛡️ JSON Schema validation for baton-sql-*.yaml files
- 🏗️ Built with Language Server Protocol (LSP) for professional-grade features

### Validation Rules
- Missing comma detection (SELECT, INSERT, UPDATE statements)
- Keyword spelling correction (SELCT → SELECT, FRO → FROM, etc.)
- Unclosed parentheses detection
- Invalid JOIN syntax validation
- Ambiguous column reference detection
- GROUP BY validation with aggregate functions
- ORDER BY reference validation
- Duplicate alias detection
- Baton parameter syntax validation (?<parameter_name>)
- Credential mutual exclusion validation
- Property name typo detection
- Trailing comma detection
- FROM clause requirement validation
- Diagnostic deduplication to prevent repeated errors

### Features
- Automatic schema application for `baton-sql-*.yaml` files
- Context-aware completion suggestions
- Rich markdown formatting in hover documentation
- Quick fix lightbulb (💡) actions with Cmd+. / Ctrl+.
- F12 or Cmd+Click navigation to definitions
- Support for account provisioning, credential rotation, and more
- Integration with Red Hat YAML extension for schema validation

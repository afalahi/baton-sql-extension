<!-- @format -->

# Baton SQL Extension

A professional-grade VS Code extension providing comprehensive SQL validation, IntelliSense, and schema enforcement for Baton SQL configuration files using the Language Server Protocol (LSP).

## Features

### Real-time SQL Validation

- **14 validation rules** covering SELECT, INSERT, UPDATE statements
- Detects missing commas, typos, unclosed parentheses, invalid JOINs, and more
- Works across all SQL queries in your YAML (list, grants, provisioning, etc.)

### Intelligent Auto-completion

- SQL keywords (SELECT, FROM, WHERE, JOIN, etc.)
- SQL functions (COUNT, SUM, AVG, CONCAT, etc.)
- Baton-specific parameters (?<parameter_name>)
- Context-aware suggestions

### Inline Documentation (Hover)

- Hover over SQL keywords for documentation
- Hover over Baton parameters for syntax help
- Rich markdown formatting

### One-Click Quick Fixes

- Fix misspelled keywords (SELCT → SELECT)
- Add missing commas automatically
- Add closing parentheses
- Add missing FROM clauses
- Quick fix available via lightbulb 💡 or `Cmd+.` / `Ctrl+.`

### Go-to-Definition

- Jump to table definitions (F12 or Cmd+Click)
- Navigate to resource type definitions
- Understand query structure instantly

### JSON Schema Validation

- Automatic schema application for `baton-sql-*.yaml` files
- Validates YAML structure, required fields, property types
- Supports account provisioning, credential rotation, and more
- Helpful tooltips on hover

## Installation

### Option 1: Install from VSIX (Recommended)

1. Download the latest `.vsix` file from releases
2. Open VS Code
3. Go to Extensions panel (⇧⌘X / Ctrl+Shift+X)
4. Click "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

### Option 2: Build from Source

```console
# Clone the repository
git clone https://github.com/yourusername/baton-sql-extension.git
cd baton-sql-extension

# Install dependencies
npm install

# Build and package
npm run build
npm run package

# Install the generated .vsix file
```

## Requirements

- **VS Code**: 1.80.0 or higher
- **Red Hat YAML Extension**: Required for schema validation (installed automatically)

## Usage

The extension activates automatically when you open files matching:

- `baton-sql-*.yaml`
- `baton-sql-*.yml`

All features work automatically—no configuration needed!

### Example: SQL Validation

```yaml
resource_types:
  user:
    list:
      query: |
        SELECT
          id,
          name
          email  ← Error: Missing comma
        FRO users  ← Error: Typo in FROM
```

You'll see:

- Red squiggles under errors
- Lightbulb 💡 with quick fixes
- Detailed error messages

### Example: Auto-completion

Type `SE` and see suggestions for:

- `SELECT`
- `SET`

Type `?<` to trigger Baton parameter completion.

### Example: Go-to-Definition

```yaml
SELECT * FROM users JOIN orders ON users.id = orders.user_id
WHERE orders.status = 'active'
       ^^^^^^ Cmd+Click here to jump to JOIN definition
```

## Technical Architecture

Built with the **Language Server Protocol** for maximum compatibility:

```
baton-sql-extension/
├── src/
│   ├── client/           # LSP client (VS Code integration)
│   ├── server/           # LSP server (validation logic)
│   │   ├── features/     # Hover, completion, code actions, go-to-def
│   │   └── index/        # Symbol indexing
│   ├── validation/       # 14 SQL validation rules
│   └── utils/            # Shared utilities
├── schemas/
│   └── baton-schema.json # JSON schema definition
└── out/                  # Compiled output
```

### Key Benefits of LSP

- **Native VS Code support** - Install directly from marketplace
- **Other LSP editors** - Server can be configured for Neovim, Emacs, Sublime Text, etc. (manual setup required)
- Runs in separate process for better performance
- Professional-grade features (hover, completion, quick fixes, navigation)

## Development

### Run in Development Mode

```console
npm run build
code .
```

Then press `F5` to open a new Extension Development Host window.

### Build for Production

```console
npm run build      # Compile TypeScript and bundle
npm run package    # Create .vsix file
```

### Project Scripts

- `npm run build` - Compile TypeScript + webpack bundle
- `npm run package` - Package as VSIX
- `npm run watch` - Watch mode for development

## Validation Rules

The extension includes 14 SQL validation rules:

1. **Missing Comma Rule** - Detects missing commas in SELECT, INSERT, UPDATE
2. **Keyword Spelling Rule** - Catches typos in SQL keywords
3. **Missing FROM Rule** - Ensures SELECT has FROM clause
4. **Unclosed Parentheses Rule** - Detects unbalanced parentheses
5. **Invalid JOIN Rule** - Validates JOIN syntax and ON clauses (CROSS JOIN exempt)
6. **Ambiguous Columns Rule** - Detects `SELECT *` across multiple tables
7. **Invalid GROUP BY Rule** - Flags aggregates mixed with non-aggregates and no GROUP BY
8. **Invalid ORDER BY Rule** - Flags positional `ORDER BY 1`
9. **Duplicate Aliases Rule** - Detects duplicate table aliases
10. **Property Name Typos Rule** - Catches common YAML typos (e.g., `static_entitlement` → `static_entitlements`)
11. **Baton Parameter Validation Rule** - Validates `?<param>` syntax
12. **Trailing Comma Rule** - Detects invalid trailing commas before `FROM` / `WHERE`
13. **Vars / Query Mismatch Rule** - Flags `vars` entries unused by the query and `?<param>` references missing from `vars`
14. **Unconventional SQL Syntax Rule** - PostgreSQL-specific checks (ON CONFLICT, RETURNING, gen_salt, crypt, COALESCE, DATE literals)

## Schema Support

### Supported Properties

- `app_name`, `app_description`, `connect`
- `resource_types` with full validation
- `static_entitlements` with provisioning support
- `entitlements` and `grants`
- `account_provisioning` with schema, credentials, validate, create
- `credential_rotation` for password updates

### Credential Types

- `no_password` - SSO-only accounts
- `random_password` - Generate random passwords
- `encrypted_password` - Pre-encrypted passwords

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/YourFeature`)
3. Commit your changes (`git commit -m 'Add YourFeature'`)
4. Push to the branch (`git push origin feature/YourFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter issues or have feature requests:

1. Check existing issues on GitHub
2. Create a new issue with detailed information
3. Include your VS Code version and extension version

---

**Made with ❤️ for the Baton community**

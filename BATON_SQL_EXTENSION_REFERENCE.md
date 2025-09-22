# Baton SQL Extension - Complete Reference Guide

**Created:** September 2025
**Purpose:** Comprehensive reference document for the Baton SQL VS Code Extension codebase

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technical Architecture](#technical-architecture)
3. [Core Features](#core-features)
4. [File Structure](#file-structure)
5. [SQL Validation System](#sql-validation-system)
6. [Schema Definition](#schema-definition)
7. [Performance Optimizations](#performance-optimizations)
8. [Development Guide](#development-guide)
9. [Configuration](#configuration)
10. [Troubleshooting](#troubleshooting)

---

## Project Overview

### What is This Extension?
The **Baton SQL Extension** is a VS Code extension designed for developers working with **Baton** - an identity and access management (IAM) system. The extension provides comprehensive SQL validation and schema assistance for Baton configuration files.

### Key Purpose
- **Validate SQL queries** in Baton YAML configuration files
- **Apply JSON schema** to enforce proper configuration structure
- **Provide real-time feedback** on SQL syntax errors and potential issues
- **Prevent common mistakes** through custom validation rules

### Target Files
The extension automatically activates for YAML files matching the pattern:
- `baton-sql-*.yaml`
- `baton-sql-*.yml`

### Main Technologies
- **TypeScript** - Main extension logic
- **JSON Schema** - Configuration validation
- **node-sql-parser** - SQL AST parsing and validation
- **js-yaml** - YAML parsing
- **Webpack** - Build system

---

## Technical Architecture

### Extension Structure
```
baton-sql-extension/
├── src/
│   └── extension.ts          # Main extension logic (1,570 lines)
├── schemas/
│   └── baton-schema.json     # JSON schema definition (426 lines)
├── package.json              # VS Code extension manifest
├── webpack.config.js         # Build configuration
├── tsconfig.json            # TypeScript configuration
├── README.md                # User documentation
├── out/                     # Compiled output
├── assets/                  # Extension icon
└── node_modules/           # Dependencies
```

### Key Dependencies
```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",           // YAML parsing
    "node-sql-parser": "^5.3.9"   // SQL parsing and validation
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.13.8",
    "@types/vscode": "^1.80.0",   // VS Code API types
    "ts-loader": "^9.5.2",
    "typescript": "^4.0.0",
    "webpack": "^5.99.8",
    "webpack-cli": "^6.0.1"
  }
}
```

### Activation Events
The extension activates on:
- `onStartupFinished` - When VS Code starts
- `onLanguage:yaml` - When opening YAML files

---

## Core Features

### 1. Automatic Schema Application
- Detects files matching `baton-sql-*` pattern
- Automatically applies Baton JSON schema
- Provides IntelliSense and validation

### 2. Real-time SQL Validation
- Parses YAML to find SQL queries
- Validates SQL syntax using AST parsing
- Shows errors as VS Code diagnostics
- Supports Baton's parameterized queries (`?<param>`)

### 3. Custom Validation Rules
10 specialized validation rules for common SQL issues:
1. Missing comma detection
2. Missing FROM clause
3. Unclosed parentheses
4. Invalid JOIN syntax
5. Ambiguous columns
6. Invalid GROUP BY usage
7. Invalid ORDER BY syntax
8. Duplicate table aliases
9. SQL keyword spelling errors
10. Baton property name typos

### 4. Performance Optimization
- Caching system for validation results
- Debounced validation (500ms delay)
- Lazy initialization
- File change detection

### 5. Manual Commands
- `Apply Baton SQL Schema to Current File` - Manual schema application

---

## File Structure

### `/src/extension.ts` (1,570 lines)
**Purpose:** Main extension logic and SQL validation engine

**Key Components:**
- `activate()` - Extension activation (line 1399)
- `validateSQLInDocument()` - Main validation function (line 1089)
- `validateSql()` - Core SQL validation with custom rules (line 40)
- `sqlValidationRules[]` - Array of 10 validation rules (line 191)
- Performance optimization functions
- YAML parsing and SQL extraction

### `/schemas/baton-schema.json` (426 lines)
**Purpose:** JSON Schema definition for Baton configuration files

**Key Sections:**
- `app_name` - Application identifier
- `connect` - Database connection config
- `resource_types` - Resource definitions with SQL queries
- `static_entitlements` - Static permission definitions
- `account_provisioning` - User account creation config
- `grants` - Access grants configuration

### `/package.json`
**Purpose:** VS Code extension manifest

**Key Settings:**
- Extension metadata and description
- Activation events configuration
- Command contributions
- YAML schema associations
- Build scripts

### `/webpack.config.js`
**Purpose:** Build configuration

**Settings:**
- Target: Node.js environment
- Entry: `src/extension.ts`
- Output: `out/extension.js`
- TypeScript compilation via ts-loader

---

## SQL Validation System

### Validation Flow
1. **File Detection** - Check if file matches `baton-sql-*` pattern
2. **YAML Parsing** - Parse YAML content with js-yaml
3. **SQL Discovery** - Recursively find SQL queries in YAML structure
4. **SQL Normalization** - Prepare SQL for parsing (remove Baton params)
5. **Rule Application** - Apply all 10 custom validation rules
6. **Diagnostic Creation** - Generate VS Code error markers
7. **Caching** - Store results to avoid reprocessing

### Custom Validation Rules Detail

#### 1. Missing Comma Detection (`missing-comma`)
**Location:** Line 192-283
**Purpose:** Detects missing commas between SELECT columns
**Method:** AST parsing with fallback to string analysis

#### 2. Missing FROM Clause (`missing-from`)
**Location:** Line 284-326
**Purpose:** Ensures SELECT statements have FROM clauses
**Method:** Checks AST structure for from property

#### 3. Unclosed Parentheses (`unclosed-parentheses`)
**Location:** Line 327-348
**Purpose:** Detects unbalanced parentheses
**Method:** Relies on parser error detection

#### 4. Invalid JOIN Syntax (`invalid-join`)
**Location:** Line 349-437
**Purpose:** Validates JOIN statements have ON clauses
**Method:** Recursive AST traversal

#### 5. Ambiguous Columns (`ambiguous-columns`)
**Location:** Line 438-544
**Purpose:** Warns about SELECT * with multiple tables
**Method:** Counts tables and checks for * columns

#### 6. Invalid GROUP BY (`invalid-group-by`)
**Location:** Line 545-648
**Purpose:** Validates aggregate function usage
**Method:** Checks for aggregates without GROUP BY

#### 7. Invalid ORDER BY (`invalid-order-by`)
**Location:** Line 649-683
**Purpose:** Detects unsupported ORDER BY syntax
**Method:** Regex pattern matching

#### 8. Duplicate Aliases (`duplicate-aliases`)
**Location:** Line 684-780
**Purpose:** Finds duplicate table aliases
**Method:** Set-based duplicate detection

#### 9. Keyword Spelling (`keyword-spelling`)
**Location:** Line 781-968
**Purpose:** Detects common SQL keyword typos
**Method:** Levenshtein distance algorithm

#### 10. Property Name Typos (`property-name-typos`)
**Location:** Line 969-1005
**Purpose:** Catches Baton-specific property typos
**Method:** Dictionary-based matching

### Caching System
**Location:** Line 18-22, 47-55, 98-99
**Purpose:** Avoid reprocessing unchanged SQL
**Implementation:**
- `validationCache` - Maps query hash to validation results
- `fileDigests` - Maps filename to content hash
- `hashString()` - Simple hash function for cache keys

---

## Schema Definition

### Baton Configuration Structure
The JSON schema defines the complete structure for Baton connector configurations:

#### Top-level Properties
- **`app_name`** (required) - String identifier for the application
- **`connect`** (required) - Database connection configuration
- **`resource_types`** (required) - Resource type definitions
- **`static_entitlements`** (optional) - Static permission definitions
- **`account_provisioning`** (optional) - User account creation config
- **`grants`** (optional) - Access grant mappings

#### Database Connection (`connect`)
```yaml
connect:
  dsn: "postgres://user:pass@host:5432/db"  # Required, validated with regex
```

#### Resource Types (`resource_types`)
Each resource type contains:
- **`name`** - Display name
- **`description`** - Resource description
- **`list`** - Query configuration for listing resources
  - **`query`** - SQL query string (validated)
  - **`map`** - Field mappings (id, display_name required)
  - **`pagination`** - Optional pagination config
- **`static_entitlements`** - Optional static permissions
- **`grants`** - Optional grant mappings

#### Static Entitlements
Array of permission objects with:
- **`id`**, **`display_name`**, **`description`** - Required strings
- **`purpose`** - Must be "assignment" or "permission"
- **`grantable_to`** - Array of resource type IDs
- **`provisioning`** - Optional SQL queries for grant/revoke

#### Account Provisioning
- **`schema`** - Form field definitions
- **`credentials`** - Credential configuration
- **`validate`** - Validation query
- **`create`** - Account creation queries

### Schema Error Messages
The schema includes custom error messages:
- `"Did you mean 'static_entitlements'?"` for `static_entitlement` typo
- Built-in validation for DSN format
- Required field enforcement

---

## Performance Optimizations

### 1. Caching System
**Implementation:** Line 18-22, 1086-1103
**Benefits:** Avoids revalidating unchanged content
**Components:**
- Validation result cache (by query hash)
- File digest cache (by filename)
- Simple string hashing function

### 2. Debounced Validation
**Implementation:** Line 1471-1489
**Benefits:** Reduces processing during rapid edits
**Configuration:** 500ms delay after last change

### 3. Lazy Initialization
**Implementation:** Line 1407-1421
**Benefits:** Only processes relevant visible files on activation
**Strategy:** Check file pattern before full processing

### 4. Optimized File Detection
**Implementation:** Line 1429-1455
**Benefits:** Fast rejection of non-Baton files
**Method:** Quick filename checks before detailed analysis

### 5. SQL Discovery Optimization
**Implementation:** Line 1250-1268
**Benefits:** Direct path to common SQL field names
**Strategy:** Check `query`, `sql`, `statement` fields first

### 6. Change Detection
**Implementation:** Line 1093-1102
**Benefits:** Skip processing if file unchanged
**Method:** Content hash comparison

---

## Development Guide

### Building the Extension
```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build and watch for development
npm run watch

# Package for distribution
npm run package
```

### Build Configuration
- **TypeScript:** Compiles to ES6/CommonJS
- **Webpack:** Bundles to single `out/extension.js`
- **Target:** Node.js environment for VS Code

### Testing the Extension
1. Open project in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a `baton-sql-*.yaml` file
4. Verify schema application and SQL validation

### Extension Packaging
```bash
# Install vsce globally
npm install -g vsce

# Package the extension
vsce package
```

### Adding New Validation Rules
1. Add rule to `sqlValidationRules` array (line 191)
2. Implement `ValidationRule` interface:
   ```typescript
   interface ValidationRule {
     name: string;
     description: string;
     validate: (sql: string, originalQuery: string) => {
       isValid: boolean;
       errorMessage?: string;
       position?: number;
       lineNumber?: number;
     };
   }
   ```
3. Use AST parsing with string-based fallback
4. Return specific line numbers when possible

### Extending Schema
1. Modify `schemas/baton-schema.json`
2. Add new properties with validation rules
3. Include helpful error messages
4. Test with sample YAML files

---

## Configuration

### VS Code Extension Manifest
**File:** `package.json`

#### Key Configuration Sections:

**Activation Events:**
```json
"activationEvents": [
  "onStartupFinished",
  "onLanguage:yaml"
]
```

**Commands:**
```json
"commands": [
  {
    "command": "batonSQL.applySchema",
    "title": "Apply Baton SQL Schema to Current File"
  }
]
```

**YAML Schema Association:**
```json
"yaml": {
  "schemas": [
    {
      "fileMatch": [
        "**/baton-sql-*.yaml",
        "**/baton-sql-*.yml"
      ],
      "url": "./schemas/baton-schema.json"
    }
  ]
}
```

### TypeScript Configuration
**File:** `tsconfig.json`
- Target: ES6
- Module: CommonJS
- Strict mode enabled
- Source maps for debugging

---

## Troubleshooting

### Common Issues

#### 1. Schema Not Applied
**Symptoms:** No IntelliSense or validation in YAML files
**Causes:**
- File doesn't match `baton-sql-*` pattern
- YAML extension not installed
- Schema file missing

**Solutions:**
- Verify filename matches pattern
- Run "Apply Baton SQL Schema" command manually
- Check schema file exists at `schemas/baton-schema.json`

#### 2. SQL Validation Not Working
**Symptoms:** No SQL error highlighting
**Causes:**
- File not recognized as Baton config
- YAML parsing errors
- SQL not found in expected locations

**Solutions:**
- Check console output (View → Output → Extension Host)
- Verify YAML syntax is valid
- Ensure SQL is in `query` fields

#### 3. False Positive Validations
**Symptoms:** Valid SQL showing as errors
**Causes:**
- Baton parameterized queries (`?<param>`)
- Complex SQL syntax not handled
- Parser limitations

**Solutions:**
- Check if SQL uses Baton parameters correctly
- Review validation rule implementation
- Consider adding exceptions for specific patterns

#### 4. Performance Issues
**Symptoms:** VS Code becomes slow with extension
**Causes:**
- Large YAML files
- Frequent validation triggers
- Cache not working

**Solutions:**
- Check file sizes (validation optimized for typical configs)
- Verify debouncing is working (500ms delay)
- Clear cache if corrupted

### Debug Information
Enable debug output by checking VS Code Developer Tools:
1. Help → Toggle Developer Tools
2. Console tab
3. Look for `[Baton SQL]` prefixed messages

### Error Message Reference

#### SQL Validation Errors:
- `"Missing comma between column expressions"` - Missing commas in SELECT
- `"Missing FROM clause in SELECT statement"` - SELECT without FROM
- `"JOIN statement missing ON clause"` - JOIN without ON
- `"Using * with multiple tables can lead to ambiguous columns"` - SELECT * with JOINs
- `"Mixing aggregate functions with non-aggregated columns requires GROUP BY"` - Invalid aggregation
- `"Using position numbers in ORDER BY is not supported"` - ORDER BY with numbers
- `"Duplicate table alias"` - Same alias used twice
- `"Possible typo in SQL keyword"` - Misspelled SQL keywords
- `"Did you mean 'static_entitlements'?"` - Common Baton property typo

#### Schema Validation Errors:
- JSON Schema validation messages from VS Code YAML extension
- Custom error messages defined in schema

---

## Summary

The Baton SQL Extension is a comprehensive VS Code extension that provides:

1. **Automatic schema application** for Baton configuration files
2. **Advanced SQL validation** with 10 custom rules
3. **Real-time error detection** and reporting
4. **Performance optimizations** for smooth editing experience
5. **Extensible architecture** for adding new validation rules

The extension is specifically designed for Baton IAM system configurations, making it easier for developers to write correct SQL queries and properly structured YAML configurations.

**Key Files to Remember:**
- `src/extension.ts` - Main logic (1,570 lines)
- `schemas/baton-schema.json` - Schema definition (426 lines)
- `package.json` - Extension configuration

**Total Codebase:** ~2,000 lines of custom code plus configuration files
export interface TextEdit {
  /** The range to replace */
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  /** The new text to insert */
  newText: string;
}

export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  position?: number;
  lineNumber?: number;
  /** Suggested fix for the validation error (for code actions/quick fixes) */
  suggestedFix?: TextEdit;
  /** The text that should be replaced (helps identify the exact location) */
  replaceText?: string;
}

export interface ValidationRule {
  name: string;
  description: string;
  validate: (sql: string, originalQuery: string) => ValidationResult;
}

export interface SQLQueryInfo {
  query: string;
  yamlPath: string[];
  startPosition: number;
  endPosition: number;
}
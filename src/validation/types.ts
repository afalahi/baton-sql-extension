export interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  position?: number;
  lineNumber?: number;
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
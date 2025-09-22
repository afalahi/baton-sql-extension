import { ValidationRule, ValidationResult } from '../types';
import { findLineWithPattern, areWordsSimilar } from '../../utils/stringUtils';

export const batonParameterValidationRule: ValidationRule = {
  name: "baton-parameter-validation",
  description: "Validate Baton parameterized query syntax",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // Find all Baton parameters in the format ?<param_name>
    const batonParamRegex = /\?\<([^>]+)\>/g;
    const matches = [...sql.matchAll(batonParamRegex)];

    if (matches.length === 0) {
      return { isValid: true }; // No Baton parameters to validate
    }

    // SQL keywords that shouldn't be used as parameter names
    const sqlKeywords = new Set([
      'select', 'from', 'where', 'and', 'or', 'order', 'by', 'group', 'having',
      'join', 'inner', 'left', 'right', 'outer', 'on', 'as', 'in', 'exists',
      'not', 'between', 'like', 'null', 'is', 'limit', 'offset', 'insert',
      'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter',
      'drop', 'index', 'union', 'all', 'distinct', 'case', 'when', 'then',
      'else', 'end', 'with'
    ]);

    for (const match of matches) {
      const paramName = match[1].trim();
      const matchIndex = match.index || 0;

      // Check for empty parameter name
      if (!paramName) {
        return {
          isValid: false,
          errorMessage: "Empty Baton parameter name. Use format: ?<parameter_name>",
          position: matchIndex
        };
      }

      // Check for valid parameter name format (alphanumeric and underscores only)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Invalid Baton parameter name '${paramName}'. Use only letters, numbers, and underscores. Must start with letter or underscore.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check if parameter name conflicts with SQL keywords
      if (sqlKeywords.has(paramName.toLowerCase())) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Baton parameter name '${paramName}' conflicts with SQL keyword. Consider using '${paramName}_value' or '${paramName}_param'.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check for common naming convention issues
      if (paramName.length < 2) {
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Baton parameter name '${paramName}' is too short. Use descriptive names like 'user_id' or 'resource_name'.`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }

      // Check for potential typos in common parameter patterns
      const commonParams = ['user_id', 'resource_id', 'role_id', 'permission_id', 'group_id'];
      const similarParams = commonParams.filter(param =>
        areWordsSimilar(paramName.toLowerCase(), param, 1)
      );

      if (similarParams.length > 0 && !commonParams.includes(paramName.toLowerCase())) {
        const suggestion = similarParams[0];
        const lineResult = findLineWithPattern(
          originalQuery,
          `?<${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`
        );
        return {
          isValid: false,
          errorMessage: `Possible typo in Baton parameter '${paramName}'. Did you mean '${suggestion}'?`,
          lineNumber: lineResult ? lineResult.lineNumber : undefined,
          position: matchIndex
        };
      }
    }

    return { isValid: true };
  },
};
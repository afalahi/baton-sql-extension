// Export all validation rules
export { missingCommaRule } from './missingCommaRule';
export { missingFromRule } from './missingFromRule';
export { unclosedParenthesesRule } from './unclosedParenthesesRule';
export { invalidJoinRule } from './invalidJoinRule';
export { ambiguousColumnsRule } from './ambiguousColumnsRule';
export { invalidGroupByRule } from './invalidGroupByRule';
export { invalidOrderByRule } from './invalidOrderByRule';
export { duplicateAliasesRule } from './duplicateAliasesRule';
export { keywordSpellingRule } from './keywordSpellingRule';
export { propertyNameTyposRule } from './propertyNameTyposRule';
export { batonParameterValidationRule } from './batonParameterValidationRule';
export { trailingCommaRule } from './trailingCommaRule';
export { varsQueryMismatchRule } from './varsQueryMismatchRule';
export { unconventionalSqlSyntaxRule } from './unconventionalSqlSyntaxRule';
export { scopeEnumRule } from './scopeEnumRule';
export { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
export { databasesConfigRule } from './databasesConfigRule';
export { actionQueryShapeRule } from './actionQueryShapeRule';
export { actionArgumentDefaultRule } from './actionArgumentDefaultRule';

import { ValidationRule } from '../types';
import { missingCommaRule } from './missingCommaRule';
import { missingFromRule } from './missingFromRule';
import { unclosedParenthesesRule } from './unclosedParenthesesRule';
import { invalidJoinRule } from './invalidJoinRule';
import { ambiguousColumnsRule } from './ambiguousColumnsRule';
import { invalidGroupByRule } from './invalidGroupByRule';
import { invalidOrderByRule } from './invalidOrderByRule';
import { duplicateAliasesRule } from './duplicateAliasesRule';
import { keywordSpellingRule } from './keywordSpellingRule';
import { propertyNameTyposRule } from './propertyNameTyposRule';
import { batonParameterValidationRule } from './batonParameterValidationRule';
import { trailingCommaRule } from './trailingCommaRule';
import { varsQueryMismatchRule } from './varsQueryMismatchRule';
import { unconventionalSqlSyntaxRule } from './unconventionalSqlSyntaxRule';
import { scopeEnumRule } from './scopeEnumRule';
import { randomPasswordConstraintsRule } from './randomPasswordConstraintsRule';
import { databasesConfigRule } from './databasesConfigRule';
import { actionQueryShapeRule } from './actionQueryShapeRule';
import { actionArgumentDefaultRule } from './actionArgumentDefaultRule';

// Array of all validation rules for easy consumption.
// Note: the connector's AccountCredentials struct allows multiple credential
// strategies simultaneously (preferred: true picks the default), so we do NOT
// flag configs with multiple credentials — see baton-sql/pkg/bsql/config.go.
export const allValidationRules: ValidationRule[] = [
  missingCommaRule,
  missingFromRule,
  unclosedParenthesesRule,
  invalidJoinRule,
  ambiguousColumnsRule,
  invalidGroupByRule,
  invalidOrderByRule,
  duplicateAliasesRule,
  keywordSpellingRule,
  propertyNameTyposRule,
  batonParameterValidationRule,
  trailingCommaRule,
  varsQueryMismatchRule,
  unconventionalSqlSyntaxRule,
  scopeEnumRule,
  randomPasswordConstraintsRule,
  databasesConfigRule,
  actionQueryShapeRule,
  actionArgumentDefaultRule,
];
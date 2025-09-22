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
export { credentialMutualExclusionRule } from './credentialMutualExclusionRule';

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
import { credentialMutualExclusionRule } from './credentialMutualExclusionRule';

// Array of all validation rules for easy consumption
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
  credentialMutualExclusionRule,
];
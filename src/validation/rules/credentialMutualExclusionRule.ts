import { ValidationRule, ValidationResult } from '../types';

export const credentialMutualExclusionRule: ValidationRule = {
  name: "credential-mutual-exclusion",
  description: "Check for conflicting credential strategies",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // This rule validates YAML structure, not SQL directly
    // Look for credential configuration conflicts
    const lines = originalQuery.split('\n');

    let hasRandomPassword = false;
    let hasNoPassword = false;
    let randomPasswordLine = -1;
    let noPasswordLine = -1;
    let insideCredentials = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim().toLowerCase();

      if (line.includes('credentials:')) {
        insideCredentials = true;
        continue;
      }

      if (insideCredentials) {
        // Check if we've exited the credentials section (unindented line that's not empty)
        if (line.length > 0 && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
          insideCredentials = false;
          continue;
        }

        if (line.includes('random_password:')) {
          hasRandomPassword = true;
          randomPasswordLine = i;
        }

        if (line.includes('no_password:')) {
          hasNoPassword = true;
          noPasswordLine = i;
        }
      }
    }

    // If both credential types are found, report the error
    if (hasRandomPassword && hasNoPassword) {
      return {
        isValid: false,
        errorMessage: "Only one credential strategy is allowed. Choose either 'random_password' or 'no_password', not both.",
        lineNumber: Math.min(randomPasswordLine, noPasswordLine) // Report error on the first occurrence
      };
    }

    return { isValid: true };
  },
};
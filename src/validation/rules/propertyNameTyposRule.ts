import { ValidationRule, ValidationResult } from '../types';

export const propertyNameTyposRule: ValidationRule = {
  name: "property-name-typos",
  description: "Check for common property name typos",
  validate: (sql: string, originalQuery: string): ValidationResult => {
    // Common property name typos and their corrections
    const propertyTypos: { [key: string]: string } = {
      static_entitlement: "static_entitlements",
      staticentitlements: "static_entitlements",
      static_entitlementz: "static_entitlements",
      static_entitlementss: "static_entitlements",
      staticentitlement: "static_entitlements",
      static_entitlement_: "static_entitlements",
      _static_entitlements: "static_entitlements",
    };

    // Check each line for property name typos
    const lines = originalQuery.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check for property name typos
      for (const [typo, correction] of Object.entries(propertyTypos)) {
        if (line.includes(typo + ":")) {
          return {
            isValid: false,
            errorMessage: `Did you mean '${correction}' instead of '${typo}'?`,
            lineNumber: i,
          };
        }
      }
    }

    return { isValid: true };
  },
};
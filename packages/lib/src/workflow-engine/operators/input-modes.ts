// packages/lib/src/workflow-engine/operators/input-modes.ts

import type { Operator } from '../../conditions/operator-definitions'
import { BaseType } from '../core/types'

/**
 * Input rendering modes for condition values
 * Determines how value inputs should be displayed based on field type + operator combination
 */
export enum InputMode {
  /** Single value input (text, number, date, etc.) */
  SINGLE = 'single',

  /** Multiple value inputs (for "is one of" operators) */
  MULTIPLE = 'multiple',

  /** Relation picker input (for relation fields with is/is not) */
  RELATION = 'relation',

  /** Plain text input (for contains, starts with on relation fields) */
  TEXT = 'text',

  /** No input needed (for empty, exists operators) */
  NONE = 'none',
}

/**
 * Input configuration returned by resolver
 * Contains all information needed to render the appropriate input component
 */
export interface InputConfig {
  /** The rendering mode to use */
  mode: InputMode

  /** The variable type for VarEditor (if applicable) */
  varType?: BaseType

  /** Whether to show variable picker option */
  allowVarEditor?: boolean

  /** Whether to allow multiple values (for MULTIPLE mode) */
  allowMultiple?: boolean

  /** Placeholder text for input */
  placeholder?: string
}

/**
 * Determines the appropriate input mode based on field type and operator
 * This is the SINGLE SOURCE OF TRUTH for input behavior
 *
 * @param fieldType - The BaseType of the field
 * @param operator - The operator key (e.g., 'is', 'contains', 'in')
 * @returns InputConfig with mode, varType, and other rendering hints
 */
export function resolveInputConfig(fieldType: BaseType, operator: Operator): InputConfig {
  // ===== OPERATORS THAT DON'T NEED VALUES =====
  if (['empty', 'not empty', 'exists', 'not exists'].includes(operator)) {
    return { mode: InputMode.NONE }
  }

  // ===== OPERATORS THAT OVERRIDE FIELD TYPE =====
  // These operators need specific input types regardless of field type

  // Operators that need NUMBER input (days count, byte size)
  if (['within_days', 'older_than_days', 'uploaded_within_days'].includes(operator)) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.NUMBER,
      allowVarEditor: true,
      placeholder: 'Enter number of days',
    }
  }

  // Operators that need STRING input (regex patterns)
  if (operator === 'matches_pattern') {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.STRING,
      allowVarEditor: true,
      placeholder: 'Enter regex pattern',
    }
  }

  // Array length operators that need NUMBER input
  if (['length =', 'length >', 'length <', 'length >=', 'length <='].includes(operator)) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.NUMBER,
      allowVarEditor: true,
      placeholder: 'Enter length',
    }
  }

  // ===== "IS ONE OF" / "IS NOT ONE OF" OPERATORS (MULTIPLE VALUES) =====
  if (['in', 'not in'].includes(operator)) {
    return {
      mode: InputMode.MULTIPLE,
      varType: fieldType,
      allowVarEditor: true,
      placeholder: 'Add values',
    }
  }

  // ===== RELATION FIELD HANDLING =====
  if (fieldType === BaseType.RELATION) {
    // For "is" and "is not", use relation picker
    if (['is', 'is not'].includes(operator)) {
      return {
        mode: InputMode.RELATION,
        varType: BaseType.RELATION,
        allowVarEditor: true,
        placeholder: 'Select or enter value',
      }
    }

    // For string-like operators on relations (contains, starts with, etc.)
    // Use text input (searching by ID or name)
    if (['contains', 'not contains', 'starts with', 'ends with'].includes(operator)) {
      return {
        mode: InputMode.TEXT,
        varType: BaseType.STRING,
        allowVarEditor: true,
        placeholder: 'Enter text to search',
      }
    }

    // Fallback for unsupported operators on relations
    return {
      mode: InputMode.TEXT,
      varType: BaseType.STRING,
      allowVarEditor: false,
      placeholder: 'Enter value',
    }
  }

  // ===== ACTOR FIELD HANDLING =====
  if (fieldType === BaseType.ACTOR) {
    if (['is', 'is not'].includes(operator)) {
      return {
        mode: InputMode.SINGLE,
        varType: BaseType.ACTOR,
        allowVarEditor: true,
        placeholder: 'Select user',
      }
    }
    if (['contains', 'not contains', 'starts with', 'ends with'].includes(operator)) {
      return {
        mode: InputMode.TEXT,
        varType: BaseType.STRING,
        allowVarEditor: true,
        placeholder: 'Enter text to search',
      }
    }
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.ACTOR,
      allowVarEditor: true,
      placeholder: 'Select user',
    }
  }

  // ===== STRING FIELD HANDLING =====
  if ([BaseType.STRING, BaseType.EMAIL, BaseType.URL, BaseType.PHONE].includes(fieldType)) {
    return {
      mode: InputMode.SINGLE,
      varType: fieldType,
      allowVarEditor: true,
      placeholder: 'Enter value',
    }
  }

  // ===== NUMBER FIELD HANDLING =====
  if (fieldType === BaseType.NUMBER) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.NUMBER,
      allowVarEditor: true,
      placeholder: 'Enter number',
    }
  }

  // ===== DATE/DATETIME FIELD HANDLING =====
  if ([BaseType.DATE, BaseType.DATETIME, BaseType.TIME].includes(fieldType)) {
    return {
      mode: InputMode.SINGLE,
      varType: fieldType,
      allowVarEditor: true,
      placeholder: 'Select date',
    }
  }

  // ===== BOOLEAN FIELD HANDLING =====
  if (fieldType === BaseType.BOOLEAN) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.BOOLEAN,
      allowVarEditor: true,
      placeholder: 'Select true/false',
    }
  }

  // ===== ENUM FIELD HANDLING =====
  if (fieldType === BaseType.ENUM) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.ENUM,
      allowVarEditor: true,
      placeholder: 'Select value',
    }
  }

  // ===== ARRAY FIELD HANDLING =====
  if (fieldType === BaseType.ARRAY) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.ARRAY,
      allowVarEditor: true,
      placeholder: 'Enter list',
    }
  }

  // ===== OBJECT FIELD HANDLING =====
  if (fieldType === BaseType.OBJECT) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.OBJECT,
      allowVarEditor: true,
      placeholder: 'Enter object',
    }
  }

  // ===== CURRENCY FIELD HANDLING =====
  if (fieldType === BaseType.CURRENCY) {
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.CURRENCY,
      allowVarEditor: true,
      placeholder: 'Enter amount',
    }
  }

  // ===== ADDRESS FIELD HANDLING =====
  if (fieldType === BaseType.ADDRESS) {
    // For "contains" operator, allow text search
    if (['contains', 'not contains'].includes(operator)) {
      return {
        mode: InputMode.TEXT,
        varType: BaseType.STRING,
        allowVarEditor: true,
        placeholder: 'Search address',
      }
    }
    // Default structured address input
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.ADDRESS,
      allowVarEditor: true,
      placeholder: 'Enter address',
    }
  }

  // ===== TAGS FIELD HANDLING (same as MULTI_SELECT) =====
  if (fieldType === BaseType.TAGS) {
    // Note: "in" / "not in" already handled above with MULTIPLE mode
    // For "contains" / "not contains", single tag
    if (['contains', 'not contains'].includes(operator)) {
      return {
        mode: InputMode.SINGLE,
        varType: BaseType.TAGS,
        allowVarEditor: true,
        placeholder: 'Select tag',
      }
    }
    // Default (for "is", "is not" if ever supported)
    return {
      mode: InputMode.SINGLE,
      varType: BaseType.TAGS,
      allowVarEditor: true,
      placeholder: 'Select tag',
    }
  }

  // ===== SECRET FIELD HANDLING =====
  // SECURITY: Never show value inputs for SECRET fields
  if (fieldType === BaseType.SECRET) {
    return {
      mode: InputMode.NONE,
      allowVarEditor: false,
      placeholder: 'Secret fields cannot be filtered',
    }
  }

  // ===== DEFAULT FALLBACK =====
  return {
    mode: InputMode.SINGLE,
    varType: BaseType.ANY,
    allowVarEditor: true,
    placeholder: 'Enter value',
  }
}

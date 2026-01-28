// packages/lib/src/conditions/field-input-modes.ts

import { FieldType } from '@auxx/database/enums'
import type { Operator } from './operator-definitions'

/**
 * Input rendering modes for resource condition values
 * Determines how value inputs should be displayed based on FieldType + operator combination
 */
export enum FieldInputMode {
  /** Single value input using FieldInputAdapter */
  SINGLE = 'single',

  /** Multiple value inputs (for "is one of" operators) */
  MULTIPLE = 'multiple',

  /** Relation picker input (for RELATIONSHIP fields) */
  RELATION = 'relation',

  /** Actor picker input (for ACTOR fields) */
  ACTOR = 'actor',

  /** Select input (for SELECT/MULTI_SELECT/TAGS fields) */
  SELECT = 'select',

  /** Plain text input */
  TEXT = 'text',

  /** No input needed (for empty, exists operators) */
  NONE = 'none',
}

/**
 * Input configuration returned by resolver
 * Contains all information needed to render the appropriate input component
 */
export interface FieldInputConfig {
  /** The rendering mode to use */
  mode: FieldInputMode

  /** The FieldType for the input */
  fieldType?: string

  /** Whether to allow multiple values (for MULTIPLE mode) */
  allowMultiple?: boolean

  /** Placeholder text for input */
  placeholder?: string
}

/**
 * Determines the appropriate input mode based on FieldType and operator
 * This is the SINGLE SOURCE OF TRUTH for resource-mode input behavior
 *
 * @param fieldType - The FieldType of the field (from database)
 * @param operator - The operator key (e.g., 'is', 'contains', 'in')
 * @returns FieldInputConfig with mode, fieldType, and other rendering hints
 */
export function resolveFieldInputConfig(fieldType: string, operator: Operator): FieldInputConfig {
  // ===== OPERATORS THAT DON'T NEED VALUES =====
  if (
    [
      'empty',
      'not empty',
      'exists',
      'not exists',
      'today',
      'yesterday',
      'this_week',
      'this_month',
      'is_valid',
      'is_invalid',
      'uploaded_today',
      'contains_numbers',
      'contains_date',
      'has_version',
      'is_office_document',
      'is_image_format',
      'is_text_format',
      'is_compressed',
      'is_executable',
    ].includes(operator)
  ) {
    return { mode: FieldInputMode.NONE }
  }

  // ===== OPERATORS THAT OVERRIDE FIELD TYPE =====

  // Operators that need NUMBER input (days count, byte size)
  if (['within_days', 'older_than_days', 'uploaded_within_days', 'within_size_limit', 'exceeds_limit'].includes(operator)) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.NUMBER,
      placeholder: 'Enter number',
    }
  }

  // Operators that need STRING input (regex patterns)
  if (operator === 'matches_pattern') {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.TEXT,
      placeholder: 'Enter regex pattern',
    }
  }

  // Array length operators that need NUMBER input
  if (['length =', 'length >', 'length <', 'length >=', 'length <='].includes(operator)) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.NUMBER,
      placeholder: 'Enter length',
    }
  }

  // ===== "IS ONE OF" / "IS NOT ONE OF" OPERATORS (MULTIPLE VALUES) =====
  if (['in', 'not in'].includes(operator)) {
    return {
      mode: FieldInputMode.MULTIPLE,
      fieldType,
      allowMultiple: true,
      placeholder: 'Add values',
    }
  }

  // ===== RELATIONSHIP FIELD HANDLING =====
  if (fieldType === FieldType.RELATIONSHIP) {
    // For "is" and "is not", use relation picker
    if (['is', 'is not'].includes(operator)) {
      return {
        mode: FieldInputMode.RELATION,
        fieldType: FieldType.RELATIONSHIP,
        placeholder: 'Select record',
      }
    }

    // For string-like operators on relations (contains, starts with, etc.)
    // Use text input (searching by ID or name)
    if (['contains', 'not contains', 'starts with', 'ends with'].includes(operator)) {
      return {
        mode: FieldInputMode.TEXT,
        fieldType: FieldType.TEXT,
        placeholder: 'Enter text to search',
      }
    }

    // Fallback for unsupported operators on relations
    return {
      mode: FieldInputMode.TEXT,
      fieldType: FieldType.TEXT,
      placeholder: 'Enter value',
    }
  }

  // ===== ACTOR FIELD HANDLING =====
  if (fieldType === FieldType.ACTOR) {
    if (['is', 'is not'].includes(operator)) {
      return {
        mode: FieldInputMode.ACTOR,
        fieldType: FieldType.ACTOR,
        placeholder: 'Select user or group',
      }
    }

    // For string-like operators, use text input
    if (['contains', 'not contains', 'starts with', 'ends with'].includes(operator)) {
      return {
        mode: FieldInputMode.TEXT,
        fieldType: FieldType.TEXT,
        placeholder: 'Enter name to search',
      }
    }

    return {
      mode: FieldInputMode.ACTOR,
      fieldType: FieldType.ACTOR,
      placeholder: 'Select user or group',
    }
  }

  // ===== SELECT FIELD HANDLING =====
  if ([FieldType.SINGLE_SELECT, FieldType.MULTI_SELECT, FieldType.TAGS].includes(fieldType as any)) {
    return {
      mode: FieldInputMode.SELECT,
      fieldType,
      placeholder: 'Select value',
    }
  }

  // ===== TEXT FIELD HANDLING =====
  if ([FieldType.TEXT, FieldType.RICH_TEXT, FieldType.NAME].includes(fieldType as any)) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType,
      placeholder: 'Enter text',
    }
  }

  // ===== EMAIL FIELD HANDLING =====
  if (fieldType === FieldType.EMAIL) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.EMAIL,
      placeholder: 'Enter email',
    }
  }

  // ===== URL FIELD HANDLING =====
  if (fieldType === FieldType.URL) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.URL,
      placeholder: 'Enter URL',
    }
  }

  // ===== PHONE FIELD HANDLING =====
  if (fieldType === FieldType.PHONE_INTL) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.PHONE_INTL,
      placeholder: 'Enter phone number',
    }
  }

  // ===== NUMBER FIELD HANDLING =====
  if (fieldType === FieldType.NUMBER) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.NUMBER,
      placeholder: 'Enter number',
    }
  }

  // ===== CURRENCY FIELD HANDLING =====
  if (fieldType === FieldType.CURRENCY) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.CURRENCY,
      placeholder: 'Enter amount',
    }
  }

  // ===== DATE/DATETIME/TIME FIELD HANDLING =====
  if ([FieldType.DATE, FieldType.DATETIME, FieldType.TIME].includes(fieldType as any)) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType,
      placeholder: 'Select date',
    }
  }

  // ===== CHECKBOX FIELD HANDLING =====
  if (fieldType === FieldType.CHECKBOX) {
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.CHECKBOX,
      placeholder: 'Select true/false',
    }
  }

  // ===== ADDRESS FIELD HANDLING =====
  if ([FieldType.ADDRESS, FieldType.ADDRESS_STRUCT].includes(fieldType as any)) {
    // For "contains" operator, allow text search
    if (['contains', 'not contains'].includes(operator)) {
      return {
        mode: FieldInputMode.TEXT,
        fieldType: FieldType.TEXT,
        placeholder: 'Search address',
      }
    }
    // Default structured address input
    return {
      mode: FieldInputMode.SINGLE,
      fieldType,
      placeholder: 'Enter address',
    }
  }

  // ===== FILE FIELD HANDLING =====
  if (fieldType === FieldType.FILE) {
    // Most file operators don't need value input
    // Those that do (matches_pattern, within_size_limit, etc.) are handled above
    return {
      mode: FieldInputMode.SINGLE,
      fieldType: FieldType.FILE,
      placeholder: 'Select file',
    }
  }

  // ===== CALC FIELD HANDLING =====
  // CALC fields are computed - they shouldn't be filterable directly
  if (fieldType === FieldType.CALC) {
    return {
      mode: FieldInputMode.NONE,
      placeholder: 'Calculated fields cannot be filtered',
    }
  }

  // ===== DEFAULT FALLBACK =====
  return {
    mode: FieldInputMode.SINGLE,
    fieldType: FieldType.TEXT,
    placeholder: 'Enter value',
  }
}

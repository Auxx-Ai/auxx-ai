// packages/lib/src/workflow-engine/operators/definitions.ts

import { BaseType } from '../core/types'

/**
 * Operator definition with complete metadata
 */
export interface OperatorDefinition {
  /** Unique operator key (e.g., 'is', 'contains', 'is_valid') */
  key: string

  /** Display label for UI */
  label: string

  /** Whether this operator requires a comparison value */
  requiresValue: boolean

  /** Which BaseTypes support this operator */
  supportedTypes: BaseType[]

  /** Value input type: single value, multiple values, or none */
  valueType?: 'single' | 'multiple' | 'none'

  /** Optional description for tooltips */
  description?: string

  /** Optional category for grouping in UI */
  category?:
    | 'equality'
    | 'comparison'
    | 'string'
    | 'set'
    | 'existence'
    | 'file'
    | 'date'
    | 'array'
    | 'object'
}

/**
 * All available operators with complete metadata
 * This is the SINGLE SOURCE OF TRUTH
 */
export const OPERATOR_DEFINITIONS = {
  // ===== EQUALITY OPERATORS =====
  is: {
    key: 'is',
    label: 'Is',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.BOOLEAN,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.REFERENCE,
      BaseType.RELATION,
    ],
    valueType: 'single',
    category: 'equality',
  },
  'is not': {
    key: 'is not',
    label: 'Is not',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.BOOLEAN,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.REFERENCE,
      BaseType.RELATION,
    ],
    valueType: 'single',
    category: 'equality',
  },

  // ===== COMPARISON OPERATORS =====
  '>': {
    key: '>',
    label: 'Greater than',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER],
    valueType: 'single',
    category: 'comparison',
  },
  '<': {
    key: '<',
    label: 'Less than',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER],
    valueType: 'single',
    category: 'comparison',
  },
  '>=': {
    key: '>=',
    label: 'Greater than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER],
    valueType: 'single',
    category: 'comparison',
  },
  '<=': {
    key: '<=',
    label: 'Less than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER],
    valueType: 'single',
    category: 'comparison',
  },

  // ===== STRING OPERATORS =====
  contains: {
    key: 'contains',
    label: 'Contains',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ARRAY,
      BaseType.RELATION,
      BaseType.ANY,
    ],
    valueType: 'single',
    category: 'string',
  },
  'not contains': {
    key: 'not contains',
    label: 'Does not contain',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ARRAY,
      BaseType.RELATION,
      BaseType.ANY,
    ],
    valueType: 'single',
    category: 'string',
  },
  'starts with': {
    key: 'starts with',
    label: 'Starts with',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.RELATION,
      BaseType.ANY,
    ],
    valueType: 'single',
    category: 'string',
  },
  'ends with': {
    key: 'ends with',
    label: 'Ends with',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.RELATION,
      BaseType.ANY,
    ],
    valueType: 'single',
    category: 'string',
  },

  // ===== SET OPERATORS =====
  in: {
    key: 'in',
    label: 'Is one of',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ANY,
    ],
    valueType: 'multiple',
    category: 'set',
  },
  'not in': {
    key: 'not in',
    label: 'Is not one of',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ANY,
    ],
    valueType: 'multiple',
    category: 'set',
  },

  // ===== DATE OPERATORS =====
  before: {
    key: 'before',
    label: 'Before',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME, BaseType.TIME],
    valueType: 'single',
    category: 'date',
  },
  after: {
    key: 'after',
    label: 'After',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME, BaseType.TIME],
    valueType: 'single',
    category: 'date',
  },
  on: {
    key: 'on',
    label: 'On',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'single',
    category: 'date',
  },
  'not on': {
    key: 'not on',
    label: 'Not on',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'single',
    category: 'date',
  },
  within_days: {
    key: 'within_days',
    label: 'Within days',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'single',
    category: 'date',
    description: 'Check if date is within N days from now',
  },
  older_than_days: {
    key: 'older_than_days',
    label: 'Older than days',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'single',
    category: 'date',
    description: 'Check if date is older than N days',
  },
  today: {
    key: 'today',
    label: 'Today',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  yesterday: {
    key: 'yesterday',
    label: 'Yesterday',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  this_week: {
    key: 'this_week',
    label: 'This week',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  this_month: {
    key: 'this_month',
    label: 'This month',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    valueType: 'none',
    category: 'date',
  },

  // ===== EXISTENCE OPERATORS =====
  empty: {
    key: 'empty',
    label: 'Is empty',
    requiresValue: false,
    supportedTypes: [
      BaseType.STRING,
      BaseType.ARRAY,
      BaseType.OBJECT,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ANY,
    ],
    valueType: 'none',
    category: 'existence',
  },
  'not empty': {
    key: 'not empty',
    label: 'Is not empty',
    requiresValue: false,
    supportedTypes: [
      BaseType.STRING,
      BaseType.ARRAY,
      BaseType.OBJECT,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ANY,
    ],
    valueType: 'none',
    category: 'existence',
  },
  exists: {
    key: 'exists',
    label: 'Exists',
    requiresValue: false,
    supportedTypes: Object.values(BaseType), // All types
    valueType: 'none',
    category: 'existence',
  },
  'not exists': {
    key: 'not exists',
    label: 'Does not exist',
    requiresValue: false,
    supportedTypes: Object.values(BaseType), // All types
    valueType: 'none',
    category: 'existence',
  },

  // ===== FILE VALIDATION OPERATORS =====
  is_valid: {
    key: 'is_valid',
    label: 'Is valid',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is valid (has required properties)',
  },
  is_invalid: {
    key: 'is_invalid',
    label: 'Is invalid',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is invalid',
  },
  uploaded_today: {
    key: 'uploaded_today',
    label: 'Uploaded today',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file was uploaded today',
  },
  uploaded_within_days: {
    key: 'uploaded_within_days',
    label: 'Uploaded within days',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file was uploaded within N days',
  },

  // ===== FILE PATTERN OPERATORS =====
  matches_pattern: {
    key: 'matches_pattern',
    label: 'Matches pattern',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if filename matches regex pattern',
  },
  contains_numbers: {
    key: 'contains_numbers',
    label: 'Contains numbers',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename contains numbers',
  },
  contains_date: {
    key: 'contains_date',
    label: 'Contains date',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename contains a date',
  },
  has_version: {
    key: 'has_version',
    label: 'Has version',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename has version number',
  },

  // ===== FILE EXTENSION CATEGORY OPERATORS =====
  is_office_document: {
    key: 'is_office_document',
    label: 'Is office document',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is an office document (docx, xlsx, pptx, etc.)',
  },
  is_image_format: {
    key: 'is_image_format',
    label: 'Is image format',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is an image (jpg, png, gif, etc.)',
  },
  is_text_format: {
    key: 'is_text_format',
    label: 'Is text format',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is a text format (txt, md, csv, etc.)',
  },
  is_compressed: {
    key: 'is_compressed',
    label: 'Is compressed',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is compressed (zip, rar, tar, etc.)',
  },
  is_executable: {
    key: 'is_executable',
    label: 'Is executable',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is executable (exe, sh, bat, etc.)',
  },

  // ===== FILE SIZE OPERATORS =====
  within_size_limit: {
    key: 'within_size_limit',
    label: 'Within size limit',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file size is within limit (bytes)',
  },
  exceeds_limit: {
    key: 'exceeds_limit',
    label: 'Exceeds limit',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file size exceeds limit (bytes)',
  },

  // ===== ARRAY OPERATORS =====
  'length =': {
    key: 'length =',
    label: 'Length equals',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length >': {
    key: 'length >',
    label: 'Length greater than',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length <': {
    key: 'length <',
    label: 'Length less than',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length >=': {
    key: 'length >=',
    label: 'Length greater than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length <=': {
    key: 'length <=',
    label: 'Length less than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },

  // ===== OBJECT/JSON OPERATORS =====
  'has key': {
    key: 'has key',
    label: 'Has key',
    requiresValue: true,
    supportedTypes: [BaseType.OBJECT, BaseType.JSON],
    valueType: 'single',
    category: 'object',
  },
  'key equals': {
    key: 'key equals',
    label: 'Key equals',
    requiresValue: true,
    supportedTypes: [BaseType.OBJECT, BaseType.JSON],
    valueType: 'single',
    category: 'object',
    description: 'Format: key:value',
  },
} as const satisfies Record<string, OperatorDefinition>

/**
 * All valid operator keys as array
 */
export const ALL_OPERATOR_KEYS = Object.keys(OPERATOR_DEFINITIONS) as Array<
  keyof typeof OPERATOR_DEFINITIONS
>

/**
 * Type for all valid operator keys
 */
export type Operator = keyof typeof OPERATOR_DEFINITIONS

/**
 * Helper: Check if operator requires a value
 */
export function operatorRequiresValue(operator: Operator): boolean {
  if (operator in OPERATOR_DEFINITIONS) {
    return OPERATOR_DEFINITIONS[operator].requiresValue
  }
  return true // Default to requiring value for unknown operators
}

/**
 * Helper: Get operator definition
 */
export function getOperatorDefinition(operator: Operator): OperatorDefinition | undefined {
  if (operator in OPERATOR_DEFINITIONS) {
    return OPERATOR_DEFINITIONS[operator]
  }
  return undefined
}

/**
 * Helper: Get all operators for a specific type
 *
 * If fieldType is BaseType.ANY, returns all operators (since ANY can work with any operator)
 * Otherwise, returns only operators that explicitly support that type
 */
export function getOperatorsForFieldType(fieldType: BaseType): OperatorDefinition[] {
  // If querying for ANY type, return all operators
  if (fieldType === BaseType.ANY) {
    return Object.values(OPERATOR_DEFINITIONS)
  }

  // Otherwise, return only operators that support this specific type
  return Object.values(OPERATOR_DEFINITIONS).filter((op) =>
    (op.supportedTypes as readonly BaseType[]).includes(fieldType)
  )
}

/**
 * Helper: Get operators by category
 */
export function getOperatorsByCategory(
  category: OperatorDefinition['category']
): OperatorDefinition[] {
  return Object.values(OPERATOR_DEFINITIONS).filter((op) => op.category === category)
}

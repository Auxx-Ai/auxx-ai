// packages/lib/src/conditions/operator-definitions.ts

import { FieldType } from '@auxx/database/enums'
// `FieldType` above is the runtime value map (used as `FieldType.TEXT` etc.
// throughout this file); the type-level union is imported separately under
// its own name so `mapFieldTypeToBaseType` below can be typed against it
// without renaming the ~170 existing `FieldType.<MEMBER>` value references.
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import { BaseType } from '../workflow-engine/core/types'

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

  /** Which BaseTypes support this operator (used for workflow variables) */
  supportedTypes: BaseType[]

  /**
   * Optional: Explicit FieldType support for resource conditions.
   * If defined, takes precedence over supportedTypes when checking FieldType compatibility.
   * This allows more precise control over which operators appear for specific field types.
   */
  supportedFieldTypes?: string[]

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
    label: 'is',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.CURRENCY,
      BaseType.BOOLEAN,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.REFERENCE,
      BaseType.RELATION,
      BaseType.ACTOR,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.NAME,
      FieldType.NUMBER,
      FieldType.CURRENCY,
      FieldType.CHECKBOX,
      FieldType.SINGLE_SELECT,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
    ],
    valueType: 'single',
    category: 'equality',
  },
  'is not': {
    key: 'is not',
    label: 'is not',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.CURRENCY,
      BaseType.BOOLEAN,
      BaseType.ENUM,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.REFERENCE,
      BaseType.RELATION,
      BaseType.ACTOR,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.NAME,
      FieldType.NUMBER,
      FieldType.CURRENCY,
      FieldType.CHECKBOX,
      FieldType.SINGLE_SELECT,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
    ],
    valueType: 'single',
    category: 'equality',
  },

  // ===== COMPARISON OPERATORS =====
  '>': {
    key: '>',
    label: 'greater than',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER, BaseType.CURRENCY],
    supportedFieldTypes: [FieldType.NUMBER, FieldType.CURRENCY],
    valueType: 'single',
    category: 'comparison',
  },
  '<': {
    key: '<',
    label: 'less than',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER, BaseType.CURRENCY],
    supportedFieldTypes: [FieldType.NUMBER, FieldType.CURRENCY],
    valueType: 'single',
    category: 'comparison',
  },
  '>=': {
    key: '>=',
    label: 'greater than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER, BaseType.CURRENCY],
    supportedFieldTypes: [FieldType.NUMBER, FieldType.CURRENCY],
    valueType: 'single',
    category: 'comparison',
  },
  '<=': {
    key: '<=',
    label: 'less than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.NUMBER, BaseType.CURRENCY],
    supportedFieldTypes: [FieldType.NUMBER, FieldType.CURRENCY],
    valueType: 'single',
    category: 'comparison',
  },

  // ===== STRING OPERATORS =====
  contains: {
    key: 'contains',
    label: 'contains',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ARRAY,
      BaseType.TAGS,
      BaseType.ADDRESS,
      BaseType.RELATION,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.ADDRESS,
      FieldType.ADDRESS_STRUCT,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
    ],
    valueType: 'single',
    category: 'string',
    description:
      'For ADDRESS: searches across all address fields. For TAGS/MULTI_SELECT: checks if value exists. For ACTOR: searches by display name',
  },
  'not contains': {
    key: 'not contains',
    label: 'does not contain',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ARRAY,
      BaseType.TAGS,
      BaseType.ADDRESS,
      BaseType.RELATION,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.ADDRESS,
      FieldType.ADDRESS_STRUCT,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
    ],
    valueType: 'single',
    category: 'string',
    description:
      'For ADDRESS: searches across all address fields. For TAGS/MULTI_SELECT: checks if value does not exist. For ACTOR: searches by display name',
  },
  'starts with': {
    key: 'starts with',
    label: 'starts with',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.RELATION,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
    ],
    valueType: 'single',
    category: 'string',
  },
  'ends with': {
    key: 'ends with',
    label: 'ends with',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.RELATION,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
    ],
    valueType: 'single',
    category: 'string',
  },

  // ===== SET OPERATORS =====
  in: {
    key: 'in',
    label: 'is one of',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.CURRENCY,
      BaseType.ENUM,
      BaseType.TAGS,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.NAME,
      FieldType.NUMBER,
      FieldType.SINGLE_SELECT,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.ACTOR,
      FieldType.RELATIONSHIP,
    ],
    valueType: 'multiple',
    category: 'set',
    description: 'For TAGS/MULTI_SELECT: checks if ANY selected value is in the list',
  },
  'not in': {
    key: 'not in',
    label: 'is not one of',
    requiresValue: true,
    supportedTypes: [
      BaseType.STRING,
      BaseType.NUMBER,
      BaseType.CURRENCY,
      BaseType.ENUM,
      BaseType.TAGS,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.NAME,
      FieldType.NUMBER,
      FieldType.SINGLE_SELECT,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.ACTOR,
      FieldType.RELATIONSHIP,
    ],
    valueType: 'multiple',
    category: 'set',
    description: 'For TAGS/MULTI_SELECT: checks if NO selected value is in the list',
  },

  // ===== DATE OPERATORS =====
  before: {
    key: 'before',
    label: 'before',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME, BaseType.TIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME, FieldType.TIME],
    valueType: 'single',
    category: 'date',
  },
  after: {
    key: 'after',
    label: 'after',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME, BaseType.TIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME, FieldType.TIME],
    valueType: 'single',
    category: 'date',
  },
  within_days: {
    key: 'within_days',
    label: 'within days',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'single',
    category: 'date',
    description: 'Check if date is within N days from now',
  },
  older_than_days: {
    key: 'older_than_days',
    label: 'older than days',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'single',
    category: 'date',
    description: 'Check if date is older than N days',
  },
  today: {
    key: 'today',
    label: 'today',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  yesterday: {
    key: 'yesterday',
    label: 'yesterday',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  this_week: {
    key: 'this_week',
    label: 'this week',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  this_month: {
    key: 'this_month',
    label: 'this month',
    requiresValue: false,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'none',
    category: 'date',
  },
  on_date: {
    key: 'on_date',
    label: 'is',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'single',
    category: 'date',
  },
  not_on_date: {
    key: 'not_on_date',
    label: 'is not',
    requiresValue: true,
    supportedTypes: [BaseType.DATE, BaseType.DATETIME],
    supportedFieldTypes: [FieldType.DATE, FieldType.DATETIME],
    valueType: 'single',
    category: 'date',
  },

  // ===== EXISTENCE OPERATORS =====
  empty: {
    key: 'empty',
    label: 'is empty',
    requiresValue: false,
    supportedTypes: [
      BaseType.STRING,
      BaseType.ARRAY,
      BaseType.OBJECT,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.CURRENCY,
      BaseType.ADDRESS,
      BaseType.TAGS,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.SINGLE_SELECT,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.ADDRESS,
      FieldType.ADDRESS_STRUCT,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
      FieldType.FILE,
      FieldType.CURRENCY,
    ],
    valueType: 'none',
    category: 'existence',
    description:
      'For TAGS/MULTI_SELECT: checks if no values selected. For ADDRESS: checks if address is empty. For ACTOR: checks if no user/group assigned',
  },
  'not empty': {
    key: 'not empty',
    label: 'is not empty',
    requiresValue: false,
    supportedTypes: [
      BaseType.STRING,
      BaseType.ARRAY,
      BaseType.OBJECT,
      BaseType.EMAIL,
      BaseType.URL,
      BaseType.PHONE,
      BaseType.CURRENCY,
      BaseType.ADDRESS,
      BaseType.TAGS,
      BaseType.ACTOR,
      BaseType.ANY,
    ],
    supportedFieldTypes: [
      FieldType.TEXT,
      FieldType.RICH_TEXT,
      FieldType.NAME,
      FieldType.SINGLE_SELECT,
      FieldType.MULTI_SELECT,
      FieldType.TAGS,
      FieldType.EMAIL,
      FieldType.URL,
      FieldType.PHONE_INTL,
      FieldType.ADDRESS,
      FieldType.ADDRESS_STRUCT,
      FieldType.RELATIONSHIP,
      FieldType.ACTOR,
      FieldType.FILE,
      FieldType.CURRENCY,
    ],
    valueType: 'none',
    category: 'existence',
    description:
      'For TAGS/MULTI_SELECT: checks if at least one value selected. For ADDRESS: checks if address is not empty. For ACTOR: checks if user/group is assigned',
  },
  // exists: {
  //   key: 'exists',
  //   label: 'Exists',
  //   requiresValue: false,
  //   supportedTypes: Object.values(BaseType),
  //   // No supportedFieldTypes - use BaseType fallback for all field types
  //   valueType: 'none',
  //   category: 'existence',
  // },
  // 'not exists': {
  //   key: 'not exists',
  //   label: 'Does not exist',
  //   requiresValue: false,
  //   supportedTypes: Object.values(BaseType),
  //   // No supportedFieldTypes - use BaseType fallback for all field types
  //   valueType: 'none',
  //   category: 'existence',
  // },

  // ===== FILE VALIDATION OPERATORS =====
  is_valid: {
    key: 'is_valid',
    label: 'is valid',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is valid (has required properties)',
  },
  is_invalid: {
    key: 'is_invalid',
    label: 'is invalid',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is invalid',
  },
  uploaded_today: {
    key: 'uploaded_today',
    label: 'uploaded today',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file was uploaded today',
  },
  uploaded_within_days: {
    key: 'uploaded_within_days',
    label: 'uploaded within days',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file was uploaded within N days',
  },

  // ===== FILE PATTERN OPERATORS =====
  matches_pattern: {
    key: 'matches_pattern',
    label: 'matches pattern',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if filename matches regex pattern',
  },
  contains_numbers: {
    key: 'contains_numbers',
    label: 'contains numbers',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename contains numbers',
  },
  contains_date: {
    key: 'contains_date',
    label: 'contains date',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename contains a date',
  },
  has_version: {
    key: 'has_version',
    label: 'has version',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if filename has version number',
  },

  // ===== FILE EXTENSION CATEGORY OPERATORS =====
  is_office_document: {
    key: 'is_office_document',
    label: 'is office document',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is an office document (docx, xlsx, pptx, etc.)',
  },
  is_image_format: {
    key: 'is_image_format',
    label: 'is image format',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is an image (jpg, png, gif, etc.)',
  },
  is_text_format: {
    key: 'is_text_format',
    label: 'is text format',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is a text format (txt, md, csv, etc.)',
  },
  is_compressed: {
    key: 'is_compressed',
    label: 'is compressed',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is compressed (zip, rar, tar, etc.)',
  },
  is_executable: {
    key: 'is_executable',
    label: 'is executable',
    requiresValue: false,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'none',
    category: 'file',
    description: 'Check if file is executable (exe, sh, bat, etc.)',
  },

  // ===== FILE SIZE OPERATORS =====
  within_size_limit: {
    key: 'within_size_limit',
    label: 'within size limit',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file size is within limit (bytes)',
  },
  exceeds_limit: {
    key: 'exceeds_limit',
    label: 'exceeds limit',
    requiresValue: true,
    supportedTypes: [BaseType.FILE],
    supportedFieldTypes: [FieldType.FILE],
    valueType: 'single',
    category: 'file',
    description: 'Check if file size exceeds limit (bytes)',
  },

  // ===== ARRAY OPERATORS =====
  'length =': {
    key: 'length =',
    label: 'length equals',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    // No supportedFieldTypes - array length ops don't apply to FieldTypes
    valueType: 'single',
    category: 'array',
  },
  'length >': {
    key: 'length >',
    label: 'length greater than',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length <': {
    key: 'length <',
    label: 'length less than',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length >=': {
    key: 'length >=',
    label: 'length greater than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },
  'length <=': {
    key: 'length <=',
    label: 'length less than or equal',
    requiresValue: true,
    supportedTypes: [BaseType.ARRAY],
    valueType: 'single',
    category: 'array',
  },

  // ===== OBJECT/JSON OPERATORS =====
  'has key': {
    key: 'has key',
    label: 'has key',
    requiresValue: true,
    supportedTypes: [BaseType.OBJECT, BaseType.JSON],
    supportedFieldTypes: [FieldType.JSON],
    valueType: 'single',
    category: 'object',
  },
  'key equals': {
    key: 'key equals',
    label: 'key equals',
    requiresValue: true,
    supportedTypes: [BaseType.OBJECT, BaseType.JSON],
    supportedFieldTypes: [FieldType.JSON],
    valueType: 'single',
    category: 'object',
    description: 'Format: key:value',
  },
  // ===== SCOPE OPERATORS =====
  this_mailbox: {
    key: 'this_mailbox',
    label: 'This mailbox',
    requiresValue: false,
    supportedTypes: [],
    supportedFieldTypes: ['SCOPE'],
    valueType: 'none',
    category: 'equality',
    description: 'Search within current mailbox/view context',
  },
  everywhere: {
    key: 'everywhere',
    label: 'Everywhere',
    requiresValue: false,
    supportedTypes: [],
    supportedFieldTypes: ['SCOPE'],
    valueType: 'none',
    category: 'equality',
    description: 'Search across all mailboxes',
  },
} as const satisfies Record<string, OperatorDefinition>

/**
 * SECURITY NOTE: BaseType.SECRET
 *
 * SECRET fields (passwords, API keys, tokens) do NOT support any operators
 * for security reasons. Secret values should never be:
 * - Displayed in UI
 * - Used in filter conditions
 * - Compared in queries
 * - Accessible via workflow variables
 *
 * Only existence checks (exists/not exists) could be considered in the future
 * if explicitly required by a security-reviewed use case.
 */

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
 * Helper: Get all operators for a specific BaseType (for workflow variables)
 *
 * If baseType is BaseType.ANY, returns all operators (since ANY can work with any operator)
 * Otherwise, returns only operators that explicitly support that type
 */
export function getOperatorsForBaseType(baseType: BaseType): OperatorDefinition[] {
  // If querying for ANY type, return all operators
  if (baseType === BaseType.ANY) {
    return Object.values(OPERATOR_DEFINITIONS)
  }

  // Otherwise, return only operators that support this specific type
  return Object.values(OPERATOR_DEFINITIONS).filter((op) =>
    (op.supportedTypes as readonly BaseType[]).includes(baseType)
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

/**
 * Maps FieldType to BaseType for fallback operator lookup
 * Used when supportedFieldTypes is not defined on an operator
 *
 * The switch is exhaustive over every `FieldType` member (see `_exhaustive`
 * below): adding a new member to the enum without a case here fails to
 * compile, instead of silently falling through to the ANY default. NOT
 * unified with `workflow-engine/utils/field-type-mapper.ts`'s own
 * `mapFieldTypeToBaseType` on purpose — their `ADDRESS`/`CALC`/default
 * outputs genuinely diverge:
 *  - `ADDRESS` maps to `BaseType.ADDRESS` here (vs. STRING there) because
 *    resource-condition operators key off the structured address operator
 *    set, not the free-text one.
 *  - `CALC` maps to `BaseType.ANY` here (calculated fields aren't typically
 *    filterable, so every operator stays a candidate) rather than STRING.
 *  - The default/unknown case returns `BaseType.ANY` here, not STRING —
 *    `getOperatorsForBaseType(ANY)` returns every operator, so this is a
 *    fail-OPEN default (an unrecognized field type still gets a full
 *    operator list). Changing this to STRING would silently narrow which
 *    operators resource conditions offer for any field type this function
 *    doesn't recognize.
 */
export function mapFieldTypeToBaseType(fieldType: FieldTypeValue | string): BaseType {
  // Cast only to enable switch-exhaustiveness checking against every real
  // `FieldType` member below — the parameter still accepts arbitrary strings,
  // and a genuinely-invalid one still flows to `default` at runtime exactly
  // as before.
  const type = fieldType as FieldTypeValue
  switch (type) {
    case FieldType.TEXT:
    case FieldType.NAME:
    case FieldType.RICH_TEXT:
      return BaseType.STRING
    case FieldType.EMAIL:
      return BaseType.EMAIL
    case FieldType.URL:
      return BaseType.URL
    case FieldType.PHONE_INTL:
      return BaseType.PHONE
    case FieldType.NUMBER:
      return BaseType.NUMBER
    case FieldType.CURRENCY:
      return BaseType.CURRENCY
    case FieldType.CHECKBOX:
      return BaseType.BOOLEAN
    case FieldType.SINGLE_SELECT:
      return BaseType.ENUM
    case FieldType.MULTI_SELECT:
      return BaseType.ARRAY
    case FieldType.TAGS:
      return BaseType.TAGS
    case FieldType.DATE:
      return BaseType.DATE
    case FieldType.DATETIME:
      return BaseType.DATETIME
    case FieldType.TIME:
      return BaseType.TIME
    case FieldType.FILE:
      return BaseType.FILE
    case FieldType.RELATIONSHIP:
      return BaseType.RELATION
    case FieldType.ACTOR:
      return BaseType.ACTOR
    case FieldType.ADDRESS:
      return BaseType.ADDRESS
    case FieldType.ADDRESS_STRUCT:
      return BaseType.ADDRESS
    case FieldType.JSON:
      return BaseType.JSON
    case FieldType.CALC:
      // Calculated fields - not typically filterable
      return BaseType.ANY
    default: {
      // Exhaustiveness guard: once every `FieldType` member has its own case
      // above, `type` narrows to `never` here. A new enum member added
      // without a matching case fails this assignment at compile time. Still
      // reachable at runtime for a raw string that isn't a real FieldType —
      // same fail-open ANY fallback as before.
      const _exhaustive: never = type
      void _exhaustive
      return BaseType.ANY
    }
  }
}

/**
 * Get operators that support a specific FieldType (for resource conditions)
 * Uses supportedFieldTypes if defined, otherwise falls back to BaseType mapping
 */
export function getOperatorsForFieldType(fieldType: string): OperatorDefinition[] {
  // Widened: the `as const` literal type is a union whose members don't all
  // carry the optional `supportedFieldTypes` key.
  const definitions: OperatorDefinition[] = Object.values(OPERATOR_DEFINITIONS)
  return definitions.filter((op) => {
    // If supportedFieldTypes is defined and non-empty, use it directly
    if (op.supportedFieldTypes && op.supportedFieldTypes.length > 0) {
      return op.supportedFieldTypes.includes(fieldType)
    }

    // Fall back to BaseType mapping
    const baseType = mapFieldTypeToBaseType(fieldType)
    return (op.supportedTypes as readonly BaseType[]).includes(baseType)
  })
}

/**
 * Check if operator supports a specific FieldType
 */
export function isOperatorValidForFieldType(operator: Operator, fieldType: string): boolean {
  const def = getOperatorDefinition(operator)
  if (!def) return false

  // If supportedFieldTypes is defined and non-empty, use it directly
  if (def.supportedFieldTypes && def.supportedFieldTypes.length > 0) {
    return def.supportedFieldTypes.includes(fieldType)
  }

  // Fall back to BaseType mapping
  const baseType = mapFieldTypeToBaseType(fieldType)
  return (def.supportedTypes as readonly BaseType[]).includes(baseType)
}

// packages/types/custom-field/index.ts

import { z } from 'zod'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'

// =============================================================================
// RE-EXPORT MODEL TYPES FROM DATABASE
// =============================================================================

export { ModelTypes, ModelTypeMeta, ModelTypeValues, type ModelType } from '@auxx/database/enums'

// =============================================================================
// SELECT OPTION COLORS
// =============================================================================

/**
 * Available colors for select options
 * Matches ICON_COLORS from icon-picker for consistency
 */
export const SELECT_OPTION_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const

export type SelectOptionColor = (typeof SELECT_OPTION_COLORS)[number]

/** Default color for select options (used when no color is specified) */
export const DEFAULT_SELECT_OPTION_COLOR: SelectOptionColor = 'gray'

// =============================================================================
// TARGET TIME IN STATUS (Kanban column time tracking)
// =============================================================================

/** Zod schema for kanban column target time configuration */
export const targetTimeInStatusSchema = z.object({
  value: z.number().min(1),
  unit: z.enum(['days', 'months', 'years']),
})

/** Target time configuration for kanban columns */
export type TargetTimeInStatus = z.infer<typeof targetTimeInStatusSchema>

// =============================================================================
// SELECT OPTION
// =============================================================================

/** Zod schema for select/multi-select field options */
export const selectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  color: z.enum(SELECT_OPTION_COLORS).optional(),
  /** Target time for items to remain in this status (kanban) */
  targetTimeInStatus: targetTimeInStatusSchema.optional(),
  /** Trigger celebration animation when cards move to this column (kanban) */
  celebration: z.boolean().optional(),
})

/** Complete SelectOption type */
export type SelectOption = z.infer<typeof selectOptionSchema>

// =============================================================================
// CURRENCY OPTIONS
// =============================================================================

/** Decimal places options */
export const decimalPlacesValues = ['two-places', 'no-decimal'] as const
export type DecimalPlaces = (typeof decimalPlacesValues)[number]

/** Display type options */
export const currencyDisplayTypeValues = ['symbol', 'name', 'code'] as const
export type CurrencyDisplayType = (typeof currencyDisplayTypeValues)[number]

/** Grouping options */
export const currencyGroupsValues = ['default', 'no-groups'] as const
export type CurrencyGroups = (typeof currencyGroupsValues)[number]

/** Zod schema for currency field options */
export const currencyOptionsSchema = z.object({
  currencyCode: z.string().length(3).default('USD'),
  decimalPlaces: z.enum(decimalPlacesValues).default('two-places'),
  displayType: z.enum(currencyDisplayTypeValues).default('symbol'),
  groups: z.enum(currencyGroupsValues).default('default'),
})

/** Currency options type */
export type CurrencyOptions = z.infer<typeof currencyOptionsSchema>

// =============================================================================
// FILE OPTIONS
// =============================================================================

/** Zod schema for file field options */
export const fileOptionsSchema = z.object({
  allowMultiple: z.boolean().default(false),
  maxFiles: z.number().int().min(1).max(10).optional(),
  allowedFileTypes: z.array(z.string()).optional(),
  allowedFileExtensions: z.array(z.string()).optional(),
})

/** File options type */
export type FileOptions = z.infer<typeof fileOptionsSchema>

// =============================================================================
// FIELD OPTIONS UNION (for tRPC and service layer)
// =============================================================================

/** Zod schema for all possible field options */
export const fieldOptionsUnionSchema = z.union([
  z.array(selectOptionSchema),
  z.object({ file: fileOptionsSchema }),
  z.object({ currency: currencyOptionsSchema }),
])

// =============================================================================
// RELATIONSHIP TYPES
// =============================================================================

/** Supported relationship cardinality types */
export type RelationshipType = 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'

/**
 * Relationship configuration stored in options.relationship
 */
export interface RelationshipConfig {
  relatedEntityDefinitionId: string | null
  relatedModelType: string | null
  inverseFieldId: string | null
  relationshipType: RelationshipType
  displayFieldId: string | null
  isInverse: boolean
}

/**
 * Relationship-specific options for CreateCustomFieldInput
 * When type is RELATIONSHIP, these additional fields are required
 */
export interface RelationshipOptions {
  /** Unified resource ID format (e.g., 'contact', 'entity_product') - preferred */
  relatedResourceId?: string
  /** System resource ModelType (e.g., 'contact', 'ticket') - legacy, use relatedResourceId */
  relatedModelType?: string | null
  /** Custom entity definition UUID - legacy, use relatedResourceId */
  relatedEntityDefinitionId?: string | null
  relationshipType: RelationshipType
  displayFieldId?: string | null
  inverseName: string
  inverseDescription?: string
  inverseIcon?: string
  inverseDisplayFieldId?: string | null
}

// =============================================================================
// UNIQUENESS
// =============================================================================

/**
 * Field types that can be marked as unique identifiers.
 * Only scalar types with clear equality semantics are supported.
 */
export const UNIQUEABLE_FIELD_TYPES = new Set<string>([
  FieldTypeEnum.TEXT,
  FieldTypeEnum.NUMBER,
  FieldTypeEnum.EMAIL,
  FieldTypeEnum.PHONE_INTL,
  FieldTypeEnum.URL,
  // RELATIONSHIP is handled separately - only has_one allowed
])

/**
 * Check if a field type supports uniqueness.
 * @param type - The field type
 * @param relationshipType - For RELATIONSHIP fields, the cardinality
 * @returns True if the field type can be marked as unique
 */
export function canFieldBeUnique(
  type: string,
  relationshipType?: RelationshipType
): boolean {
  if (type === FieldTypeEnum.RELATIONSHIP) {
    return relationshipType === 'has_one'
  }
  return UNIQUEABLE_FIELD_TYPES.has(type)
}

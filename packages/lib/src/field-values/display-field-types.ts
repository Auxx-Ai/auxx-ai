// packages/lib/src/field-values/display-field-types.ts

/**
 * Display field types for EntityInstance denormalization.
 * Used when updating cached display values on EntityInstance.
 */
export type DisplayFieldType = 'primary' | 'secondary' | 'avatar'

/**
 * Configuration for each display field type.
 * Maps EntityDefinition columns to EntityInstance columns.
 */
export interface DisplayFieldConfig {
  /** Column on EntityDefinition that stores the CustomField ID */
  definitionColumn: 'primaryDisplayFieldId' | 'secondaryDisplayFieldId' | 'avatarFieldId'
  /** Column on EntityInstance that stores the cached value */
  instanceColumn: 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'
  /** Human-readable name for logging */
  label: string
}

/**
 * Configuration mapping for all display field types.
 */
export const DISPLAY_FIELD_CONFIG: Record<DisplayFieldType, DisplayFieldConfig> = {
  primary: {
    definitionColumn: 'primaryDisplayFieldId',
    instanceColumn: 'displayName',
    label: 'Primary Display',
  },
  secondary: {
    definitionColumn: 'secondaryDisplayFieldId',
    instanceColumn: 'secondaryDisplayValue',
    label: 'Secondary Display',
  },
  avatar: {
    definitionColumn: 'avatarFieldId',
    instanceColumn: 'avatarUrl',
    label: 'Avatar',
  },
}

/**
 * Map from definition column name to display field type.
 * Used for detecting which display fields changed in an update.
 */
export const DEFINITION_COLUMN_TO_TYPE: Record<string, DisplayFieldType> = {
  primaryDisplayFieldId: 'primary',
  secondaryDisplayFieldId: 'secondary',
  avatarFieldId: 'avatar',
}

/**
 * Input for recalculating a single display field.
 */
export interface RecalculateDisplayFieldInput {
  entityDefinitionId: string
  organizationId: string
  displayFieldType: DisplayFieldType
}

/**
 * Input for recalculating multiple display fields.
 */
export interface RecalculateDisplayFieldsInput {
  entityDefinitionId: string
  organizationId: string
  displayFieldTypes: DisplayFieldType[]
}

/**
 * Result from display field recalculation.
 */
export interface RecalculateDisplayFieldResult {
  displayFieldType: DisplayFieldType
  processed: number
  updated: number
}

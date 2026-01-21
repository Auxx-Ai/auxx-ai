import { z } from 'zod'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { CustomFieldEntity as CustomField } from '@auxx/database/models'
import {
  ModelTypes,
  type ModelType,
  ModelTypeMeta,
  selectOptionSchema,
  type SelectOption,
  currencyOptionsSchema,
  fileOptionsSchema,
  relationshipConfigSchema,
} from '@auxx/types/custom-field'

// Re-export types needed by other lib modules
export { ModelTypes, type ModelType }

/**
 * Grouped FieldType values for UI pickers
 * Used for custom field creation dialogs
 */
export const FIELD_TYPE_GROUPS: Record<string, FieldType[]> = {
  Basic: [FieldTypeEnum.TEXT, FieldTypeEnum.NUMBER, FieldTypeEnum.CHECKBOX],
  'Text Formats': [FieldTypeEnum.EMAIL, FieldTypeEnum.URL, FieldTypeEnum.PHONE_INTL],
  'Date & Time': [FieldTypeEnum.DATE, FieldTypeEnum.DATETIME, FieldTypeEnum.TIME],
  Selection: [FieldTypeEnum.SINGLE_SELECT, FieldTypeEnum.MULTI_SELECT, FieldTypeEnum.TAGS],
  Complex: [
    FieldTypeEnum.ADDRESS_STRUCT,
    FieldTypeEnum.CURRENCY,
    FieldTypeEnum.FILE,
    FieldTypeEnum.RICH_TEXT,
    FieldTypeEnum.RELATIONSHIP,
  ],
  Advanced: [FieldTypeEnum.CALC],
}

/**
 * FieldTypeOption interface
 * Describes the metadata associated with each custom field type option
 */
export interface FieldTypeOption {
  label: string
  /** Icon ID for EntityIcon component (from ICON_DATA in icons.tsx) */
  iconId: string
  description: string
  minWidth?: number // Optional minimum width for input popover (in pixels)
  maxWidth?: number // Optional maximum width for input popover (in pixels)
}
export const customFieldFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(FieldTypeEnum),
  fieldType: z.enum(FieldTypeEnum),
  description: z.string().optional(),
  required: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  defaultValue: z.string().optional(),
  icon: z.string().optional(),
  isCustom: z.boolean().default(true),
})
export type CustomFieldFormValues = z.infer<typeof customFieldFormSchema> & {
  id?: string
  options?: SelectOption[]
  addressComponents?: string[]
}
export type CustomFieldRecord = CustomField

/**
 * AddressStruct interface
 * Structured address data matching ADDRESS_COMPONENTS in address-component-editor.tsx
 */
export interface AddressStruct {
  street1: string
  street2?: string
  city: string
  state: string
  zipCode: string
  country: string
}

/**
 * DataModelOption interface for describing each data model option
 */
export interface DataModelOption {
  icon: string
  label: string
  labelPlural: string
  type: ModelType
  isSystem: boolean
}

/**
 * DataModelOptions: Record of available data models and their metadata
 * Derived from ModelTypeMeta for consistency
 */
export const DataModelOptions: Record<ModelType, DataModelOption> = Object.fromEntries(
  Object.entries(ModelTypeMeta).map(([key, meta]) => [
    key as ModelType,
    {
      icon: meta.icon,
      label: meta.label,
      labelPlural: meta.plural,
      type: key as ModelType,
      isSystem: key !== 'entity',
    },
  ])
) as Record<ModelType, DataModelOption>
/**
 * fieldTypeOptions constant
 * Record of available custom field types with their iconography and description
 */
export const fieldTypeOptions: Record<FieldType, FieldTypeOption> = {
  [FieldTypeEnum.TEXT]: {
    label: 'Text',
    iconId: 'text',
    description: 'Simple text input for short text entries',
  },
  [FieldTypeEnum.NAME]: {
    label: 'Name',
    iconId: 'user',
    description: 'First and last name fields',
  },
  [FieldTypeEnum.NUMBER]: {
    label: 'Number',
    iconId: 'hash',
    description: 'Numeric values only',
    minWidth: 120,
    maxWidth: 120,
  },
  [FieldTypeEnum.CURRENCY]: {
    label: 'Currency',
    iconId: 'dollar-sign',
    description: 'Monetary values with currency formatting',
    minWidth: 180,
  },
  [FieldTypeEnum.PHONE_INTL]: {
    label: 'Phone Number',
    iconId: 'phone',
    description: 'Phone number format with country code',
  },
  [FieldTypeEnum.EMAIL]: {
    label: 'Email',
    iconId: 'mail',
    description: 'Email address with validation',
  },
  [FieldTypeEnum.URL]: {
    label: 'URL',
    iconId: 'link',
    description: 'Web address with validation',
  },
  [FieldTypeEnum.DATE]: {
    label: 'Date',
    iconId: 'calendar',
    description: 'Date picker for selecting dates',
    minWidth: 240,
    maxWidth: 240,
  },
  [FieldTypeEnum.DATETIME]: {
    label: 'Date & Time',
    iconId: 'calendar-clock',
    description: 'Date and time picker',
    minWidth: 240,
    maxWidth: 240,
  },
  [FieldTypeEnum.TIME]: {
    label: 'Time',
    iconId: 'clock',
    description: 'Time picker for selecting times',
    minWidth: 240,
    maxWidth: 240,
  },
  [FieldTypeEnum.CHECKBOX]: {
    label: 'Checkbox',
    iconId: 'toggle-left',
    description: 'Simple yes/no or true/false option',
    minWidth: 70,
    maxWidth: 70,
  },
  [FieldTypeEnum.TAGS]: {
    label: 'Tags',
    iconId: 'tags',
    description: 'Multiple keyword tags for categorization',
  },
  [FieldTypeEnum.ADDRESS]: {
    label: 'Address (Simple)',
    iconId: 'map-pin',
    description: 'Simple text address field',
  },
  [FieldTypeEnum.ADDRESS_STRUCT]: {
    label: 'Address',
    iconId: 'map-pin',
    description: 'Separate fields for address components',
    minWidth: 350,
    maxWidth: 350,
  },
  [FieldTypeEnum.SINGLE_SELECT]: {
    label: 'Select',
    iconId: 'list',
    description: 'Choose one option from a list',
  },
  [FieldTypeEnum.MULTI_SELECT]: {
    label: 'Multi-Select',
    iconId: 'list-checks',
    description: 'Choose multiple options from a list',
  },
  [FieldTypeEnum.RICH_TEXT]: {
    label: 'Rich Text Editor',
    iconId: 'file-text',
    description: 'Formatted text with styling options',
  },
  [FieldTypeEnum.FILE]: {
    label: 'File Upload',
    iconId: 'upload',
    description: 'Attach files or documents',
  },
  [FieldTypeEnum.RELATIONSHIP]: {
    label: 'Relationship',
    iconId: 'link-2',
    description: 'Link to another entity (contact, company, or custom entity)',
    minWidth: 200,
  },
  [FieldTypeEnum.CALC]: {
    label: 'Calculated',
    iconId: 'calculator',
    description: 'Formula field that computes value from other fields',
    minWidth: 200,
  },
}
/**
 * Record of default empty values for each FieldType
 */
export const fieldTypeDefaults: Record<FieldType, unknown> = {
  [FieldTypeEnum.TEXT]: '',
  [FieldTypeEnum.NAME]: { first: '', last: '' },
  [FieldTypeEnum.NUMBER]: 0,
  [FieldTypeEnum.CURRENCY]: null,
  [FieldTypeEnum.PHONE_INTL]: '',
  [FieldTypeEnum.EMAIL]: '',
  [FieldTypeEnum.URL]: '',
  [FieldTypeEnum.DATE]: null,
  [FieldTypeEnum.DATETIME]: null,
  [FieldTypeEnum.TIME]: null,
  [FieldTypeEnum.CHECKBOX]: false,
  [FieldTypeEnum.TAGS]: [],
  [FieldTypeEnum.ADDRESS]: '',
  [FieldTypeEnum.ADDRESS_STRUCT]: {
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
  } as AddressStruct,
  [FieldTypeEnum.SINGLE_SELECT]: '',
  [FieldTypeEnum.MULTI_SELECT]: [],
  [FieldTypeEnum.RICH_TEXT]: '',
  [FieldTypeEnum.FILE]: null,
  [FieldTypeEnum.RELATIONSHIP]: null,
  [FieldTypeEnum.CALC]: null, // Computed, no default
}
/**
 * Common options for all field types
 */
export const baseFieldOptionsSchema = z.object({
  icon: z.string().optional(),
  isCustom: z.boolean().default(true),
})
/**
 * Type-specific display options
 */
export const textFieldOptionsSchema = baseFieldOptionsSchema.extend({
  displayedMaxRows: z.number().int().min(1).max(10).optional(),
})
export const numberFieldOptionsSchema = baseFieldOptionsSchema.extend({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
})
export const moneyFieldOptionsSchema = baseFieldOptionsSchema.extend({
  currencyCode: z.string().length(3).optional(),
})
export const phoneFieldOptionsSchema = baseFieldOptionsSchema.extend({
  country: z.string().optional(),
  format: z.string().optional(),
  phoneFormat: z.enum(['raw', 'national', 'international']).optional(),
})
export const checkboxFieldOptionsSchema = baseFieldOptionsSchema.extend({
  label: z.string().optional(),
})
export const selectFieldOptionsSchema = baseFieldOptionsSchema.extend({
  options: z.array(selectOptionSchema).optional(),
})
export const addressFieldOptionsSchema = baseFieldOptionsSchema.extend({
  addressComponents: z.array(z.string()).optional(),
})
export const dateFieldOptionsSchema = baseFieldOptionsSchema.extend({
  format: z.string().optional(),
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
})
export const relationshipFieldOptionsSchema = baseFieldOptionsSchema.extend({
  relationship: relationshipConfigSchema.optional(),
})

/** Currency display options schema */
export const currencyFieldOptionsSchema = baseFieldOptionsSchema.extend({
  currency: currencyOptionsSchema.optional(),
})

/** Currency field options type (includes base options + currency) */
export type CurrencyFieldOptions = z.infer<typeof currencyFieldOptionsSchema>

/** File field options schema */
export const fileFieldOptionsSchema = baseFieldOptionsSchema.extend({
  file: fileOptionsSchema.optional(),
})

/** File field options type (includes base options + file) */
export type FileFieldOptions = z.infer<typeof fileFieldOptionsSchema>

/** CALC (calculated) field options schema */
export const calcFieldOptionsSchema = baseFieldOptionsSchema.extend({
  calc: z
    .object({
      expression: z.string().min(1),
      sourceFields: z.record(z.string(), z.string()), // Record<placeholderName, fieldId>
      resultFieldType: z.string(),
      disabled: z.boolean().optional(),
      disabledReason: z.string().optional(),
    })
    .optional(),
})

/** CALC field options type */
export type CalcFieldOptions = z.infer<typeof calcFieldOptionsSchema>

/**
 * Map of field type to options schema
 */
export const fieldTypeOptionsSchemaMap: Record<FieldType, z.ZodTypeAny> = {
  [FieldTypeEnum.TEXT]: textFieldOptionsSchema,
  [FieldTypeEnum.NAME]: baseFieldOptionsSchema,
  [FieldTypeEnum.NUMBER]: numberFieldOptionsSchema,
  [FieldTypeEnum.CURRENCY]: currencyFieldOptionsSchema,
  [FieldTypeEnum.PHONE_INTL]: phoneFieldOptionsSchema,
  [FieldTypeEnum.EMAIL]: baseFieldOptionsSchema,
  [FieldTypeEnum.URL]: baseFieldOptionsSchema,
  [FieldTypeEnum.DATE]: dateFieldOptionsSchema,
  [FieldTypeEnum.DATETIME]: dateFieldOptionsSchema,
  [FieldTypeEnum.TIME]: dateFieldOptionsSchema,
  [FieldTypeEnum.CHECKBOX]: checkboxFieldOptionsSchema,
  [FieldTypeEnum.TAGS]: selectFieldOptionsSchema,
  [FieldTypeEnum.ADDRESS]: baseFieldOptionsSchema,
  [FieldTypeEnum.ADDRESS_STRUCT]: addressFieldOptionsSchema,
  [FieldTypeEnum.SINGLE_SELECT]: selectFieldOptionsSchema,
  [FieldTypeEnum.MULTI_SELECT]: selectFieldOptionsSchema,
  [FieldTypeEnum.RICH_TEXT]: baseFieldOptionsSchema,
  [FieldTypeEnum.FILE]: fileFieldOptionsSchema,
  [FieldTypeEnum.RELATIONSHIP]: relationshipFieldOptionsSchema,
  [FieldTypeEnum.CALC]: calcFieldOptionsSchema,
}
/**
 * Get the correct Zod schema for a field type
 */
export function getFieldOptionsSchema(type: FieldType) {
  return fieldTypeOptionsSchemaMap[type] || baseFieldOptionsSchema
}

/** Default minimum width for field input popovers */
const DEFAULT_FIELD_MIN_WIDTH = 200

/**
 * Get the minimum width for a field type's input popover
 */
export function getFieldTypeMinWidth(fieldType: FieldType): number {
  return fieldTypeOptions[fieldType]?.minWidth ?? DEFAULT_FIELD_MIN_WIDTH
}

/**
 * Get the maximum width for a field type's input popover
 * Returns undefined if no max width is set (allows popover to grow)
 */
export function getFieldTypeMaxWidth(fieldType: FieldType): number | undefined {
  return fieldTypeOptions[fieldType]?.maxWidth
}

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity as CustomField, FieldType } from '@auxx/database/types'
import {
  aiOptionsSchema,
  fileOptionsSchema,
  type ModelType,
  ModelTypeMeta,
  ModelTypes,
  relationshipConfigSchema,
  type SelectOption,
  selectOptionSchema,
} from '@auxx/types/custom-field'
import { z } from 'zod'

// Re-export types needed by other lib modules
export { ModelTypes, type ModelType }

/** Field types eligible for use as the primary display field */
export const PRIMARY_DISPLAY_ELIGIBLE_TYPES: FieldType[] = [
  FieldTypeEnum.TEXT,
  FieldTypeEnum.EMAIL,
  FieldTypeEnum.NAME,
  FieldTypeEnum.PHONE_INTL,
  FieldTypeEnum.URL,
  FieldTypeEnum.NUMBER,
]

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
  Advanced: [FieldTypeEnum.CALC, FieldTypeEnum.ACTOR],
}

/**
 * Source→target field-type compatibility for value mapping.
 *
 * Keyed by the **target** {@link FieldType} → the set of **source** field types
 * whose values can be written into it (a target always accepts its own type —
 * that's implicit in {@link isFieldTypeCompatible}, not repeated here). Blocks
 * the impossible coercions: a boolean can't populate a DATE, an array (TAGS/
 * MULTI_SELECT) can't populate a scalar TEXT, etc. Targets with an empty list
 * (RELATIONSHIP, ACTOR, CALC) are never a write sink for another type's value.
 *
 * Used by connector mappings and any flow that binds a typed source value to a
 * field. A raw JSON source type is first reduced to its representative field
 * type (string→TEXT, number→NUMBER, boolean→CHECKBOX, array→TAGS, object→JSON)
 * before checking against this map.
 */
export const FIELD_TYPE_COMPATIBILITY_MAP: Record<FieldType, FieldType[]> = {
  // Text-like sinks accept most stringifiable scalars.
  [FieldTypeEnum.TEXT]: [
    FieldTypeEnum.NAME,
    FieldTypeEnum.RICH_TEXT,
    FieldTypeEnum.EMAIL,
    FieldTypeEnum.URL,
    FieldTypeEnum.PHONE_INTL,
    FieldTypeEnum.NUMBER,
    FieldTypeEnum.CURRENCY,
    FieldTypeEnum.CHECKBOX,
    FieldTypeEnum.SINGLE_SELECT,
    FieldTypeEnum.DATE,
    FieldTypeEnum.DATETIME,
    FieldTypeEnum.TIME,
  ],
  [FieldTypeEnum.RICH_TEXT]: [FieldTypeEnum.TEXT, FieldTypeEnum.NAME],
  [FieldTypeEnum.NAME]: [FieldTypeEnum.TEXT],
  [FieldTypeEnum.EMAIL]: [FieldTypeEnum.TEXT],
  [FieldTypeEnum.URL]: [FieldTypeEnum.TEXT],
  [FieldTypeEnum.PHONE_INTL]: [FieldTypeEnum.TEXT],
  // Numeric sinks.
  [FieldTypeEnum.NUMBER]: [FieldTypeEnum.CURRENCY, FieldTypeEnum.TEXT],
  [FieldTypeEnum.CURRENCY]: [FieldTypeEnum.NUMBER, FieldTypeEnum.TEXT],
  // Boolean.
  [FieldTypeEnum.CHECKBOX]: [FieldTypeEnum.TEXT],
  // Selects.
  [FieldTypeEnum.SINGLE_SELECT]: [FieldTypeEnum.TEXT, FieldTypeEnum.NUMBER, FieldTypeEnum.CHECKBOX],
  [FieldTypeEnum.MULTI_SELECT]: [FieldTypeEnum.TAGS],
  [FieldTypeEnum.TAGS]: [FieldTypeEnum.MULTI_SELECT, FieldTypeEnum.TEXT],
  // Date/time (numbers accepted as epoch timestamps).
  [FieldTypeEnum.DATE]: [FieldTypeEnum.DATETIME, FieldTypeEnum.TEXT, FieldTypeEnum.NUMBER],
  [FieldTypeEnum.DATETIME]: [FieldTypeEnum.DATE, FieldTypeEnum.TEXT, FieldTypeEnum.NUMBER],
  [FieldTypeEnum.TIME]: [FieldTypeEnum.TEXT],
  // Complex.
  [FieldTypeEnum.ADDRESS]: [FieldTypeEnum.ADDRESS_STRUCT, FieldTypeEnum.TEXT],
  [FieldTypeEnum.ADDRESS_STRUCT]: [FieldTypeEnum.JSON],
  [FieldTypeEnum.FILE]: [FieldTypeEnum.TEXT],
  // JSON is an opaque sink — accepts any other type.
  [FieldTypeEnum.JSON]: [
    FieldTypeEnum.TEXT,
    FieldTypeEnum.NAME,
    FieldTypeEnum.RICH_TEXT,
    FieldTypeEnum.EMAIL,
    FieldTypeEnum.URL,
    FieldTypeEnum.PHONE_INTL,
    FieldTypeEnum.NUMBER,
    FieldTypeEnum.CURRENCY,
    FieldTypeEnum.CHECKBOX,
    FieldTypeEnum.SINGLE_SELECT,
    FieldTypeEnum.MULTI_SELECT,
    FieldTypeEnum.TAGS,
    FieldTypeEnum.DATE,
    FieldTypeEnum.DATETIME,
    FieldTypeEnum.TIME,
    FieldTypeEnum.ADDRESS,
    FieldTypeEnum.ADDRESS_STRUCT,
    FieldTypeEnum.FILE,
    FieldTypeEnum.RELATIONSHIP,
    FieldTypeEnum.ACTOR,
    FieldTypeEnum.CALC,
  ],
  // Never a sink for a different type's value.
  [FieldTypeEnum.RELATIONSHIP]: [],
  [FieldTypeEnum.ACTOR]: [],
  [FieldTypeEnum.CALC]: [],
}

/**
 * Can a `source` field type's value be written into a `target` field type? A
 * target always accepts its own type; otherwise it must be listed in
 * {@link FIELD_TYPE_COMPATIBILITY_MAP}.
 */
export function isFieldTypeCompatible(target: FieldType, source: FieldType): boolean {
  if (target === source) return true
  return FIELD_TYPE_COMPATIBILITY_MAP[target]?.includes(source) ?? false
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
  /**
   * Whether this field type can have AI generation enabled via `options.ai`.
   * When true, the edit dialog shows the AI generation toggle and the value
   * pipeline accepts stage-1 AI requests. When false or absent, the field
   * is never AI-generatable.
   */
  canAiGenerate?: boolean
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
    canAiGenerate: true,
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
    canAiGenerate: true,
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
    canAiGenerate: true,
  },
  [FieldTypeEnum.URL]: {
    label: 'URL',
    iconId: 'link',
    description: 'Web address with validation',
    canAiGenerate: true,
  },
  [FieldTypeEnum.DATE]: {
    label: 'Date',
    iconId: 'calendar',
    description: 'Date picker for selecting dates',
    minWidth: 240,
    maxWidth: 240,
    canAiGenerate: true,
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
    canAiGenerate: true,
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
    canAiGenerate: true,
  },
  [FieldTypeEnum.MULTI_SELECT]: {
    label: 'Multi-Select',
    iconId: 'list-checks',
    description: 'Choose multiple options from a list',
    canAiGenerate: true,
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
  [FieldTypeEnum.ACTOR]: {
    label: 'Actor',
    iconId: 'circle-user',
    description: 'Assign users or groups to a record',
    minWidth: 200,
  },
  [FieldTypeEnum.JSON]: {
    label: 'JSON',
    iconId: 'braces',
    description: 'Arbitrary JSON data storage',
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
  [FieldTypeEnum.ACTOR]: null, // Users or groups, depends on multiple setting
  [FieldTypeEnum.JSON]: {}, // Empty object default
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
  /** Render the editor as a multiline autosize textarea instead of a single-line input. */
  multiline: z.boolean().optional(),
  /** Preferred visible row count for the multiline editor. */
  rows: z.number().int().min(1).max(20).optional(),
  /** Mask the value (single-line) and show a reveal toggle. For secrets/passwords. */
  secret: z.boolean().optional(),
  ai: aiOptionsSchema.optional(),
})
export const numberFieldOptionsSchema = baseFieldOptionsSchema.extend({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  ai: aiOptionsSchema.optional(),
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
  ai: aiOptionsSchema.optional(),
})
/**
 * Shared by SINGLE_SELECT, MULTI_SELECT, and TAGS. The `ai` block is schema-
 * permissive here; the runtime `canAiGenerate` gate blocks AI on TAGS.
 */
export const selectFieldOptionsSchema = baseFieldOptionsSchema.extend({
  options: z.array(selectOptionSchema).optional(),
  ai: aiOptionsSchema.optional(),
})
export const addressFieldOptionsSchema = baseFieldOptionsSchema.extend({
  addressComponents: z.array(z.string()).optional(),
})
/**
 * Shared by DATE, DATETIME, and TIME. The `ai` block is schema-permissive
 * here; the runtime `canAiGenerate` gate blocks AI on DATETIME/TIME.
 */
export const dateFieldOptionsSchema = baseFieldOptionsSchema.extend({
  format: z.string().optional(),
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  ai: aiOptionsSchema.optional(),
})
/** EMAIL-specific options — dedicated schema so AI stays off other base-schema types. */
export const emailFieldOptionsSchema = baseFieldOptionsSchema.extend({
  ai: aiOptionsSchema.optional(),
})
/** URL-specific options — dedicated schema so AI stays off other base-schema types. */
export const urlFieldOptionsSchema = baseFieldOptionsSchema.extend({
  ai: aiOptionsSchema.optional(),
})
export const relationshipFieldOptionsSchema = baseFieldOptionsSchema.extend({
  relationship: relationshipConfigSchema.optional(),
})

/** Currency display options schema (flat — `decimals`/`useGrouping` shared with NUMBER) */
export const currencyFieldOptionsSchema = baseFieldOptionsSchema.extend({
  currencyCode: z.string().length(3).optional(),
  decimals: z.number().int().min(0).max(10).optional(),
  useGrouping: z.boolean().optional(),
  currencyDisplay: z.enum(['symbol', 'code', 'name', 'compact']).optional(),
})

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

/** ACTOR field options schema */
export const actorFieldOptionsSchema = baseFieldOptionsSchema.extend({
  actor: z
    .object({
      /**
       * Who this ACTOR field can reference.
       * - `user`  / `group` / `agent` — single bucket.
       * - `both` — users + groups (humans only; legacy default).
       * - `all`  — users + groups + agents.
       */
      target: z.enum(['user', 'group', 'agent', 'both', 'all']),
      multiple: z.boolean(),
      roles: z.array(z.enum(['OWNER', 'ADMIN', 'USER'])).optional(),
      groupIds: z.array(z.string()).optional(),
    })
    .optional(),
})

/** ACTOR field options type */
export type ActorFieldOptions = z.infer<typeof actorFieldOptionsSchema>

/**
 * Map of field type to options schema
 */
export const fieldTypeOptionsSchemaMap: Record<FieldType, z.ZodTypeAny> = {
  [FieldTypeEnum.TEXT]: textFieldOptionsSchema,
  [FieldTypeEnum.NAME]: baseFieldOptionsSchema,
  [FieldTypeEnum.NUMBER]: numberFieldOptionsSchema,
  [FieldTypeEnum.CURRENCY]: currencyFieldOptionsSchema,
  [FieldTypeEnum.PHONE_INTL]: phoneFieldOptionsSchema,
  [FieldTypeEnum.EMAIL]: emailFieldOptionsSchema,
  [FieldTypeEnum.URL]: urlFieldOptionsSchema,
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
  [FieldTypeEnum.ACTOR]: actorFieldOptionsSchema,
  [FieldTypeEnum.JSON]: baseFieldOptionsSchema,
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

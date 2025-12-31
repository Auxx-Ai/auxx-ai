import {
  type LucideIcon,
  Text,
  Hash,
  Phone,
  Mail,
  Link,
  Link2,
  Calendar,
  CalendarClock,
  Clock,
  Check,
  Tags,
  MapPin,
  List,
  ListChecks,
  FileText,
  Upload,
  DollarSign,
} from 'lucide-react'
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
}

/**
 * FieldTypeOption interface
 * Describes the metadata associated with each custom field type option
 */
interface FieldTypeOption {
  value: FieldType
  label: string
  icon: LucideIcon
  /** Icon ID for EntityIcon component (from icon-picker/icon-data.ts) */
  iconId: string
  description: string
  minWidth?: number // Optional minimum width for input popover (in pixels)
  maxWidth?: number // Optional maximum width for input popover (in pixels)
}
export const customFieldFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(FieldTypeEnum),
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
 * Lists each available custom field type with its iconography and description
 */
export const fieldTypeOptions: FieldTypeOption[] = [
  {
    value: FieldTypeEnum.TEXT,
    label: 'Text',
    icon: Text,
    iconId: 'text',
    description: 'Simple text input for short text entries',
  },
  {
    value: FieldTypeEnum.NUMBER,
    label: 'Number',
    icon: Hash,
    iconId: 'hash',
    description: 'Numeric values only',
    minWidth: 120,
    maxWidth: 120,
  },
  {
    value: FieldTypeEnum.CURRENCY,
    label: 'Currency',
    icon: DollarSign,
    iconId: 'dollar-sign',
    description: 'Monetary values with currency formatting',
    minWidth: 180,
  },
  {
    value: FieldTypeEnum.PHONE_INTL,
    label: 'Phone Number',
    icon: Phone,
    iconId: 'phone',
    description: 'Phone number format with country code',
  },
  {
    value: FieldTypeEnum.EMAIL,
    label: 'Email',
    icon: Mail,
    iconId: 'mail',
    description: 'Email address with validation',
  },
  {
    value: FieldTypeEnum.URL,
    label: 'URL',
    icon: Link,
    iconId: 'link',
    description: 'Web address with validation',
  },
  {
    value: FieldTypeEnum.DATE,
    label: 'Date',
    icon: Calendar,
    iconId: 'calendar',
    description: 'Date picker for selecting dates',
    minWidth: 240,
    maxWidth: 240,
  },
  {
    value: FieldTypeEnum.DATETIME,
    label: 'Date & Time',
    icon: CalendarClock,
    iconId: 'calendar-clock',
    description: 'Date and time picker',
    minWidth: 240,
    maxWidth: 240,
  },
  {
    value: FieldTypeEnum.TIME,
    label: 'Time',
    icon: Clock,
    iconId: 'clock',
    description: 'Time picker for selecting times',
    minWidth: 240,
    maxWidth: 240,
  },
  {
    value: FieldTypeEnum.CHECKBOX,
    label: 'Checkbox',
    icon: Check,
    iconId: 'toggle-left',
    description: 'Simple yes/no or true/false option',
    minWidth: 70,
    maxWidth: 70,
  },
  {
    value: FieldTypeEnum.TAGS,
    label: 'Tags',
    icon: Tags,
    iconId: 'tags',
    description: 'Multiple keyword tags for categorization',
  },
  {
    value: FieldTypeEnum.ADDRESS_STRUCT,
    label: 'Address',
    icon: MapPin,
    iconId: 'map-pin',
    description: 'Separate fields for address components',
    minWidth: 350,
    maxWidth: 350,
  },
  {
    value: FieldTypeEnum.SINGLE_SELECT,
    label: 'Select',
    icon: List,
    iconId: 'list',
    description: 'Choose one option from a list',
  },
  {
    value: FieldTypeEnum.MULTI_SELECT,
    label: 'Multi-Select',
    icon: ListChecks,
    iconId: 'list-checks',
    description: 'Choose multiple options from a list',
  },
  {
    value: FieldTypeEnum.RICH_TEXT,
    label: 'Rich Text Editor',
    icon: FileText,
    iconId: 'file-text',
    description: 'Formatted text with styling options',
  },
  {
    value: FieldTypeEnum.FILE,
    label: 'File Upload',
    icon: Upload,
    iconId: 'upload',
    description: 'Attach files or documents',
  },
  {
    value: FieldTypeEnum.RELATIONSHIP,
    label: 'Relationship',
    icon: Link2,
    iconId: 'link-2',
    description: 'Link to another entity (contact, company, or custom entity)',
    minWidth: 320,
  },
]
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
  relationship: z
    .object({
      relatedEntityDefinitionId: z.string().nullable(),
      relatedModelType: z.string().nullable(),
      inverseFieldId: z.string().nullable(),
      relationshipType: z.enum(['belongs_to', 'has_one', 'has_many']),
      displayFieldId: z.string().nullable(),
      isInverse: z.boolean(),
    })
    .optional(),
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
  const option = fieldTypeOptions.find((opt) => opt.value === fieldType)
  return option?.minWidth ?? DEFAULT_FIELD_MIN_WIDTH
}

/**
 * Get the maximum width for a field type's input popover
 * Returns undefined if no max width is set (allows popover to grow)
 */
export function getFieldTypeMaxWidth(fieldType: FieldType): number | undefined {
  const option = fieldTypeOptions.find((opt) => opt.value === fieldType)
  return option?.maxWidth
}

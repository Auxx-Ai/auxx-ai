// apps/web/src/components/workflow/nodes/inputs/form-input/types.ts

import type { FileTypeCategory } from '@auxx/lib/files/client'
import type { BaseNodeData } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'
import type { BaseType } from '~/components/workflow/types/unified-types'

/**
 * Select option for ENUM type
 */
export interface EnumOption {
  label: string
  value: string
}

/**
 * File options for FILE type
 */
export interface FileTypeOptions {
  allowMultiple: boolean
  maxFiles?: number
  maxFileSize?: number // in MB
  /** @deprecated Use allowedFileTypes and allowedFileExtensions instead */
  allowedTypes?: string[]
  /** Allowed file type categories: image, document, video, audio, custom */
  allowedFileTypes?: FileTypeCategory[]
  /** Custom file extensions when allowedFileTypes includes 'custom' */
  allowedFileExtensions?: string[]
}

/**
 * Currency options for CURRENCY type (flat — matches CurrencyFieldOptions)
 */
export interface CurrencyTypeOptions {
  currencyCode: string
  decimals: number
  currencyDisplay: 'symbol' | 'code' | 'name' | 'compact'
  useGrouping: boolean
}

/**
 * Address options for ADDRESS type
 */
export interface AddressTypeOptions {
  components: string[] // ['street1', 'street2', 'city', 'state', 'zipCode', 'country']
}

/**
 * Boolean options for BOOLEAN type
 */
export interface BooleanTypeOptions {
  variant?: 'switch' | 'button-group'
  /** Label shown next to the switch */
  label?: string
}

/**
 * String options for STRING type
 */
export interface StringTypeOptions {
  /** Use textarea for multiline input */
  multiline?: boolean
  /** Minimum character length */
  minLength?: number
  /** Maximum character length */
  maxLength?: number
}

/**
 * Type-specific options union
 */
export interface TypeOptions {
  enum?: EnumOption[]
  file?: FileTypeOptions
  currency?: CurrencyTypeOptions
  address?: AddressTypeOptions
  boolean?: BooleanTypeOptions
  string?: StringTypeOptions
}

/**
 * Form input node data interface
 * Uses BaseType for type selection (aligned with future FieldType→BaseType migration)
 */
export interface FormInputNodeData extends BaseNodeData {
  type: NodeType.FORM_INPUT
  title: string
  desc?: string

  // Core field properties
  label: string
  inputType: BaseType // The input type (defaults to STRING for backward compat)
  placeholder?: string
  required?: boolean
  defaultValue?: string | number | boolean | null
  hint?: string // Helper text shown to end users when filling the input field

  // Type-specific options
  typeOptions?: TypeOptions

  // Ordering (fractional indexing for drag-and-drop sorting in manual trigger panel)
  position?: string
}

// apps/web/src/lib/extensions/forms/types.ts

/**
 * Local type definitions for form reconstruction.
 * These mirror the types from SDK but are defined locally to avoid
 * import path issues with @auxx/sdk package exports.
 */

/**
 * Form validation mode.
 */
export type FormValidationMode =
  | 'onChange' // Validate on every change
  | 'onBlur' // Validate when field loses focus
  | 'onSubmit' // Validate only on submit
  | 'onTouched' // Validate after first blur
  | 'all' // Validate on all events

/**
 * String field metadata.
 */
export interface FormStringMetadata {
  optional?: boolean
  multiline?: boolean
  minLength?: number
  maxLength?: number
  placeholder?: string
  email?: boolean
  url?: boolean
  defaultValue?: string
  /** Custom error messages */
  errorMessages?: {
    required?: string
    minLength?: string
    maxLength?: string
    email?: string
    url?: string
  }
}

/**
 * Number field metadata.
 */
export interface FormNumberMetadata {
  optional?: boolean
  min?: number
  max?: number
  integer?: boolean
  positive?: boolean
  placeholder?: string
  defaultValue?: number
  errorMessages?: {
    required?: string
    min?: string
    max?: string
    integer?: string
    positive?: string
  }
}

/**
 * Boolean field metadata.
 */
export interface FormBooleanMetadata {
  defaultValue?: boolean
}

/**
 * Select option.
 */
export interface SelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

/**
 * Select field metadata.
 */
export interface FormSelectMetadata<T extends string = string> {
  options: SelectOption<T>[]
  optional?: boolean
  placeholder?: string
  defaultValue?: T
  errorMessages?: {
    required?: string
  }
}

/**
 * Discriminated union for serialized field types.
 * Ensures type safety when reconstructing schemas on web app side.
 */
export type SerializedFormValue =
  | { type: 'string'; metadata: FormStringMetadata }
  | { type: 'number'; metadata: FormNumberMetadata }
  | { type: 'boolean'; metadata: FormBooleanMetadata }
  | { type: 'select'; metadata: FormSelectMetadata }

/**
 * Serialized schema format.
 */
export interface SerializedSchema {
  fields: Record<string, SerializedFormValue>
}

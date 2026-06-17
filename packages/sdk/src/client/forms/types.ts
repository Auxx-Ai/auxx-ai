// packages/sdk/src/client/forms/types.ts

/**
 * Discriminated union for serialized field types.
 * Ensures type safety when reconstructing schemas on web app side.
 */
export type SerializedFormValue =
  | { type: 'string'; metadata: FormStringMetadata }
  | { type: 'number'; metadata: FormNumberMetadata }
  | { type: 'boolean'; metadata: FormBooleanMetadata }
  | { type: 'select'; metadata: FormSelectMetadata }
  | { type: 'picker'; metadata: FormPickerMetadata }

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
 * Async option resolver for {@link FormPickerMetadata}. Called with the live
 * search string (`''` on open); runs in the app sandbox (may call `.server`
 * functions) and returns the matching options.
 */
export type PickerLoadOptions = (query: string) => Promise<SelectOption[]>

/**
 * Picker field metadata.
 *
 * `loadOptions` is a runtime-only function (kept in `_metadata` so the form tag
 * can invoke it across the bridge); it is NOT serialized — `toJSON()` emits
 * `hasLoadOptions` instead. `options` is the static / client-filtered path.
 */
export interface FormPickerMetadata {
  /** Runtime-only resolver; stripped from the serialized form (see `hasLoadOptions`). */
  loadOptions?: PickerLoadOptions
  /** Serialized flag: the field resolves options via `loadOptions` over the bridge. */
  hasLoadOptions?: boolean
  /** Static options (client-filtered). Mutually exclusive with `loadOptions`. */
  options?: SelectOption[]
  /** Multi-select (string[]) vs single (string). Default false. */
  multi?: boolean
  optional?: boolean
  placeholder?: string
  errorMessages?: {
    required?: string
  }
}

/**
 * Form schema type.
 */
export type FormSchema = Record<string, FormValue<any>>

/**
 * Infer form values from schema.
 */
export type InferFormValues<S extends FormSchema> = {
  [K in keyof S]: S[K] extends FormValue<infer T>
    ? S[K]['_metadata']['optional'] extends true
      ? T | undefined
      : T
    : never
}

// Forward declaration for FormValue
import type { FormValue } from './base.js'

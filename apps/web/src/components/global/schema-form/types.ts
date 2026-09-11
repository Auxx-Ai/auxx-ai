// apps/web/src/components/global/schema-form/types.ts

export interface SelectOption {
  value: string
  label: string
}

export interface FieldNodeMetadata {
  label?: string
  description?: string
  placeholder?: string
  multi?: boolean
  defaultValue?: unknown
  options?: SelectOption[]
}

export interface FieldNode {
  type: string
  isOptional?: boolean
  _metadata?: FieldNodeMetadata
  /** JSON-Schema node-level label/description (zod→JSON-Schema config nodes). */
  title?: string
  description?: string
  /**
   * JSON-Schema string `format` (`date-time`, `date`, `email`, …), as emitted by
   * zod→JSON-Schema for `z.iso.datetime()` and friends. Carries the only signal
   * that distinguishes a date from any other string, so a config field can be
   * rendered with a real picker instead of a free-text box.
   */
  format?: string
}

export interface FieldEntry {
  key: string
  node: FieldNode
  meta: FieldNodeMetadata
  required: boolean
}

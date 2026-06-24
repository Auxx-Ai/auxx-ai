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
}

export interface FieldEntry {
  key: string
  node: FieldNode
  meta: FieldNodeMetadata
  required: boolean
}

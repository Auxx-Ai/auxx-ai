// apps/web/src/components/workflow/ui/structured-output-generator/types.ts

/**
 * @deprecated Use BaseType from unified-types.ts instead
 * Will be removed after full migration
 */
export enum Type {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
  array = 'array',
}

export enum ArrayType {
  string = 'array[string]',
  number = 'array[number]',
  boolean = 'array[boolean]',
  object = 'array[object]',
}

export type SchemaEnumType = string[] | number[]

export interface StructuredField {
  id: string
  name: string
  required?: boolean
}

/**
 * New schema
 */
export interface StructuredSchema {
  id: string
  name: string
  description?: string
  required?: string[] // Required field names
}

/**
 * @deprecated Use StructuredField instead
 * Kept for backward compatibility during migration
 */
export interface Field {
  type: Type // Keep for backward compatibility
  description?: string
  enum?: SchemaEnumType
  properties?: Record<string, Field>
  items?: Field
  required?: string[]
  additionalProperties?: boolean
}

/**
 * @deprecated Use StructuredSchema instead
 * Kept for backward compatibility during migration
 */
export interface SchemaRoot extends Field {
  type: Type.object
  properties: Record<string, Field>
  required: string[]
  additionalProperties: boolean
}

/**
 * Updated EditData to use
 */
export type EditData = {
  name: string
  required: boolean
  onSave: (field: StructuredField) => void
  onCancel: () => void
}

/**
 * @deprecated Use EditData instead
 */
export type LegacyEditData = {
  name: string
  type: Type | ArrayType
  required: boolean
  description?: string
  enum?: SchemaEnumType
}

export type AdvancedOptionsType = { enum: string }

export type SchemaView = 'visual' | 'json'

export const JSON_SCHEMA_MAX_DEPTH = 10

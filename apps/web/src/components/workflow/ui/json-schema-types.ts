// apps/web/src/components/workflow/ui/json-schema-types.ts

/**
 * JSON-Schema node-config types used by workflow nodes (AI / webhook /
 * information-extractor). Node configs persist plain JSON Schema in jsonb;
 * these are the structural TS annotations over that shape. The shared schema
 * editor (`~/components/schema-editor`) authors and emits this same plain JSON
 * Schema — these types are the consume-side view of it.
 */

export enum Type {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
  array = 'array',
}

export type SchemaEnumType = string[] | number[]

/** A single JSON Schema node. */
export interface Field {
  type: Type
  description?: string
  enum?: SchemaEnumType
  properties?: Record<string, Field>
  items?: Field
  required?: string[]
  additionalProperties?: boolean
}

/** A root JSON Schema (always an object). */
export interface SchemaRoot extends Field {
  type: Type.object
  properties: Record<string, Field>
  required: string[]
  additionalProperties: boolean
}

/** Max object/array nesting depth accepted by the schema editor. */
export const JSON_SCHEMA_MAX_DEPTH = 10

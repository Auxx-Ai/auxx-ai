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
  /** `false` to forbid extra keys, or a schema every extra key must satisfy. */
  additionalProperties?: boolean | Field
  /** JSON Schema string format hint — 'email', 'date', 'uri', … */
  format?: string
  /** JSON Schema numeric bounds */
  minimum?: number
  maximum?: number
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

/**
 * Narrow the plain JSON object the schema editor emits to a {@link SchemaRoot}.
 *
 * `SchemaEditorDialog.onSave` is typed as a bare `Record<string, unknown>` — it
 * round-trips whatever JSON the user authored — while node configs store the
 * stricter root shape. Node panels seed the editor with an object root, so the
 * members below are present at run time; this fills them in rather than
 * asserting they are.
 *
 * A non-object root (which `inferJsonSchema` can produce from an array or
 * scalar sample) has no `properties`, and so still yields no output variables
 * downstream — that gap is unchanged here.
 */
export function asSchemaRoot(schema: Record<string, unknown>): SchemaRoot {
  return {
    ...schema,
    type: Type.object,
    properties: (schema.properties as Record<string, Field> | undefined) ?? {},
    required: (schema.required as string[] | undefined) ?? [],
    additionalProperties: (schema.additionalProperties as boolean | undefined) ?? false,
  }
}

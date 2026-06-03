// apps/web/src/components/agents/ui/detail/restrictions/tool-args.ts

import type { ToolArgSchema } from '~/lib/agents/restrictions/arg-to-field-type'

/** One top-level argument of a tool, extracted from its `inputsJsonSchema`. */
export interface ToolArgInfo {
  name: string
  /** The arg's JSON-Schema fragment (the shape the type mapper reads). */
  schema: ToolArgSchema
  /** Whether the arg is in the schema's top-level `required` array. */
  required: boolean
  /** Short human label for the arg's type (e.g. `text`, `number`, `list`). */
  typeLabel: string
}

interface JsonSchemaObject {
  type?: string | string[]
  properties?: Record<string, ToolArgSchema>
  required?: string[]
}

/** Map a JSON-Schema `type` to a short display label. */
function typeLabel(schema: ToolArgSchema): string {
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== 'null') : schema.type
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'choice'
  switch (t) {
    case 'string':
      return 'text'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'true / false'
    case 'object':
      return 'object'
    case 'array':
      return 'list'
    default:
      return t ?? 'any'
  }
}

/**
 * Extract the top-level `properties` of a tool's `inputsJsonSchema` as a flat
 * arg list. Returns args in schema order, each annotated with whether it's
 * required and a short type label. Non-object schemas yield an empty list.
 * Object/array args are included (the dialog disables binding them). See
 * plans/chat/v6 phase-4.
 */
export function topLevelArgs(inputsJsonSchema: Record<string, unknown>): ToolArgInfo[] {
  const schema = inputsJsonSchema as JsonSchemaObject
  const properties = schema.properties
  if (!properties || typeof properties !== 'object') return []
  const requiredSet = new Set(schema.required ?? [])
  return Object.entries(properties).map(([name, argSchema]) => ({
    name,
    schema: argSchema,
    required: requiredSet.has(name),
    typeLabel: typeLabel(argSchema),
  }))
}

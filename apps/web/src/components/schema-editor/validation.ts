// apps/web/src/components/schema-editor/validation.ts

/**
 * The honest validation pipeline for the schema editor — structural checks the
 * field/JSON tabs run on tab-switch and save. This is intentionally NOT a full
 * draft-7 validator: server-side ajv (`mcp.updateToolSchema`) stays the final
 * authority for MCP, and workflow saves rely on these structural checks plus
 * the provider layer's tolerance. Anything exotic still round-trips through the
 * editor as a `raw` (`JSON`) leaf — validation never blocks a tab switch on a
 * representable-but-unusual construct, only on a malformed document.
 */

/** Max nesting depth the editor accepts (objects/arrays deep). */
export const JSON_SCHEMA_MAX_DEPTH = 10

export interface SchemaValidationResult {
  ok: boolean
  /** Human-readable message when `ok` is false; shown inline on the JSON tab. */
  error?: string
}

/** Parse JSON text, surfacing a friendly message on syntax errors. */
export function parseSchemaText(text: string):
  | { ok: true; schema: Record<string, unknown> }
  | {
      ok: false
      error: string
    } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Schema must be a JSON object' }
  }
  return { ok: true, schema: parsed as Record<string, unknown> }
}

/** Run the full structural pipeline over a parsed schema object. */
export function validateSchema(schema: Record<string, unknown>): SchemaValidationResult {
  const pre = preValidateSchema(schema)
  if (!pre.ok) return pre

  if (checkJsonSchemaDepth(schema) > JSON_SCHEMA_MAX_DEPTH) {
    return {
      ok: false,
      error: `Schema nesting exceeds the maximum depth of ${JSON_SCHEMA_MAX_DEPTH}`,
    }
  }
  return { ok: true }
}

/** The root must be an object schema — that is the editor's contract. */
export function preValidateSchema(schema: Record<string, unknown>): SchemaValidationResult {
  if (typeof schema !== 'object' || schema === null) {
    return { ok: false, error: 'Schema must be an object' }
  }
  if (schema.type !== 'object') {
    return { ok: false, error: 'Root schema type must be "object"' }
  }
  return { ok: true }
}

/** Maximum object/array nesting depth of a JSON Schema. */
export function checkJsonSchemaDepth(schema: unknown, depth = 0): number {
  if (depth > 100 || !schema || typeof schema !== 'object') return depth
  const node = schema as Record<string, unknown>
  let max = depth

  if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
    for (const child of Object.values(node.properties as Record<string, unknown>)) {
      max = Math.max(max, checkJsonSchemaDepth(child, depth + 1))
    }
  }
  if (node.type === 'array' && node.items) {
    max = Math.max(max, checkJsonSchemaDepth(node.items, depth + 1))
  }
  return max
}

/**
 * Validate a field (property) name against its siblings. Returns an error
 * string, or null when valid. JSON Schema keys can be arbitrary strings, but we
 * require identifier-shaped names so generated variable paths stay clean.
 */
export function validateFieldName(name: string, siblingNames: string[] = []): string | null {
  if (!name || name.trim() === '') return 'Field name is required'
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return 'Use letters, numbers, and underscores; must start with a letter or underscore'
  }
  if (siblingNames.includes(name)) return 'Field name already exists'
  return null
}

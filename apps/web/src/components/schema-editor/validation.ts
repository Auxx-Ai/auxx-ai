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
    // A JSON Schema *document* is always an object — a raw array/primitive here is
    // almost always a pasted sample value, so point at Import (which infers one).
    return {
      ok: false,
      error: 'This looks like a sample value, not a schema. Use “Import” to infer one.',
    }
  }
  return { ok: true, schema: parsed as Record<string, unknown> }
}

/**
 * Run the full structural pipeline over a parsed schema object. `root` controls
 * whether a non-object root is rejected (`'object'`, the workflow contract) or
 * allowed (`'any'`, MCP).
 */
export function validateSchema(
  schema: Record<string, unknown>,
  root: 'object' | 'any' = 'object'
): SchemaValidationResult {
  const pre = preValidateSchema(schema, root)
  if (!pre.ok) return pre

  if (checkJsonSchemaDepth(schema) > JSON_SCHEMA_MAX_DEPTH) {
    return {
      ok: false,
      error: `Schema nesting exceeds the maximum depth of ${JSON_SCHEMA_MAX_DEPTH}`,
    }
  }
  return { ok: true }
}

/**
 * Structural root check. Under `root: 'object'` (the default / workflow contract)
 * the root must be an object schema; under `root: 'any'` (MCP) any root passes —
 * array/scalar result schemas are first-class there.
 */
export function preValidateSchema(
  schema: Record<string, unknown>,
  root: 'object' | 'any' = 'object'
): SchemaValidationResult {
  if (typeof schema !== 'object' || schema === null) {
    return { ok: false, error: 'Schema must be an object' }
  }
  if (root === 'object' && schema.type !== 'object') {
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
 * string, or null when valid. JSON Schema keys can be arbitrary strings; the
 * identifier-shaped rule keeps generated workflow variable paths clean, so it's
 * skipped under `freeformNames` (data sources / general JSON schemas).
 */
export function validateFieldName(
  name: string,
  siblingNames: string[] = [],
  freeformNames = false
): string | null {
  if (!name || name.trim() === '') return 'Field name is required'
  if (!freeformNames && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return 'Use letters, numbers, and underscores; must start with a letter or underscore'
  }
  if (siblingNames.includes(name)) return 'Field name already exists'
  return null
}

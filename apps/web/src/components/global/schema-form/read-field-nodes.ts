// apps/web/src/components/global/schema-form/read-field-nodes.ts

import type { FieldEntry, FieldNode } from './types'

/**
 * Read a declared field schema into a flat list of renderable field entries.
 * Accepts two shapes:
 *  - the `_metadata`-annotated flat node map the app input catalog emits
 *    (`{ fieldKey: { type, _metadata } }`), and
 *  - a JSON-Schema object envelope (`{ type: 'object', properties: {…} }`) as
 *    produced by zod→json-schema for a connector's declared `config` — here the
 *    field nodes live under `properties`, so we unwrap it first.
 * The envelope is unambiguous: in the flat shape a top-level `type` is an object
 * node, never the string `'object'`. Non-object / untyped nodes are skipped. A
 * field is required unless `isOptional === true`.
 */
export function readFieldNodes(schema: Record<string, unknown> | null | undefined): FieldEntry[] {
  if (!schema) return []
  const nodes =
    schema.type === 'object' && schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : schema
  const entries: FieldEntry[] = []
  for (const [key, raw] of Object.entries(nodes)) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as FieldNode
    if (typeof node.type !== 'string') continue
    const meta = node._metadata ?? {}
    entries.push({ key, node, meta, required: node.isOptional !== true })
  }
  return entries
}

/** True when a value is unset / empty (used for required-field validation). */
export function isMissing(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Seed an initial value map from the field schema's declared defaults. */
export function seedDefaults(fields: FieldEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, meta } of fields) {
    if (meta.defaultValue !== undefined) {
      out[key] = meta.defaultValue
    }
  }
  return out
}

// apps/web/src/components/global/schema-form/read-field-nodes.ts

import type { FieldEntry, FieldNode } from './types'

/**
 * Read a declared field schema (the `_metadata`-annotated node shape the app
 * catalog emits) into a flat list of renderable field entries. Non-object /
 * untyped nodes are skipped. A field is required unless `isOptional === true`.
 */
export function readFieldNodes(schema: Record<string, unknown> | null | undefined): FieldEntry[] {
  if (!schema) return []
  const entries: FieldEntry[] = []
  for (const [key, raw] of Object.entries(schema)) {
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

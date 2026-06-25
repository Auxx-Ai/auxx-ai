// packages/lib/src/data-connectors/suggest-mappings.ts
// Tier 2 mapping suggester (create-sync-flow-plan §3.2) — propose field bindings
// for a bare custom-REST stream that has no template/app declarations to draw from.
// Pure + server-safe: given the stream's source schema (Layer A) and the target
// entity def's fields, it heuristically matches source leaves onto writable target
// fields by normalized name + type compatibility and emits ready-to-edit
// `FieldMapping` entries — the SAME one-click binding shape the mapping editor
// produces (`expression: '{path}'`, `sourceFields: { path: path }`). v2 (LLM-assisted
// proposal for the un-matched tail) rides behind the same procedure signature.

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import { toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { isFieldTypeCompatible } from '../custom-fields/types'
import { collectSchemaLeaves, lastSegment } from '../json-schema'
import type { ResourceField } from '../resources'
import type { FieldMapping } from './types'

/** Canonical name form so `first_name` ↔ `firstName` ↔ `First Name` all collide. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The representative {@link FieldType} a source leaf's values carry. */
function jsonToFieldType(jsonType: string): FieldTypeValue {
  switch (jsonType) {
    case 'number':
    case 'integer':
      return FieldType.NUMBER
    case 'boolean':
      return FieldType.CHECKBOX
    default:
      return FieldType.TEXT
  }
}

/**
 * Can an ongoing sync reliably write this target field? Mirrors the UI's
 * `isWritableTarget` rule — the sink drops non-creatable/non-updatable/computed
 * values, so those fields can never be kept in sync and aren't worth suggesting.
 */
function isWritable(field: ResourceField): boolean {
  const c = field.capabilities
  return c.creatable && c.updatable && !c.computed && !c.hidden
}

/**
 * Propose field bindings from a source schema onto an entity def's fields.
 * Heuristic v1: a source leaf binds to the first writable target whose normalized
 * `key` or `label` equals the leaf's normalized last segment AND whose type is
 * compatible (when the target carries a concrete `fieldType`; system fields with no
 * declared type are accepted by name alone). One target per proposal (1 source → 1
 * field). Returns the entry-array shape the editor stores directly.
 */
export function suggestFieldMappings(
  entityDefinitionId: string,
  sourceSchema: Record<string, unknown>,
  targetFields: ResourceField[]
): FieldMapping[] {
  const leaves = collectSchemaLeaves(sourceSchema)
  const writable = targetFields.filter(isWritable)
  const used = new Set<string>()
  const out: FieldMapping[] = []

  for (const leaf of leaves) {
    const leafName = normalizeName(lastSegment(leaf.path))
    if (!leafName) continue
    const match = writable.find((f) => {
      if (used.has(f.id)) return false
      if (![normalizeName(f.key), normalizeName(f.label)].includes(leafName)) return false
      if (f.fieldType && !isFieldTypeCompatible(f.fieldType, jsonToFieldType(leaf.jsonType))) {
        return false
      }
      return true
    })
    if (!match) continue
    used.add(match.id)
    out.push({
      id: generateId(),
      targetFieldRef: toResourceFieldId(entityDefinitionId, match.id),
      expression: `{${leaf.path}}`,
      sourceFields: { [leaf.path]: leaf.path },
    })
  }
  return out
}

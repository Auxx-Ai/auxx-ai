// apps/web/src/components/data-connectors/lib/source-path-fields.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { mapFieldTypeToBaseType } from '@auxx/lib/conditions/client'
import type { FieldDefinition } from '~/components/conditions'
import { lastSegment, type SourcePath } from '../hooks/use-source-paths'

/**
 * Infer a sensible field type from a source node. A detected string `format` (from
 * the test-fetch values) wins over the segment-name heuristic, which only falls back
 * when the format is absent.
 *
 * Two callers, one answer on purpose: the mapping tree's quick-create seeds a new
 * target field with it, and the record filter types its condition rows with it. If
 * they diverged, a leaf that quick-creates as a DATE would filter as free text.
 */
export function inferFieldType(path: string, sourceType: string, format?: string): FieldTypeType {
  switch (format) {
    case 'email':
      return FieldType.EMAIL
    case 'uri':
      return FieldType.URL
    case 'date-time':
      return FieldType.DATETIME
    case 'date':
      return FieldType.DATE
    case 'time':
      return FieldType.TIME
  }
  if (sourceType === 'array') return FieldType.TAGS
  if (sourceType === 'number' || sourceType === 'integer') return FieldType.NUMBER
  if (sourceType === 'boolean') return FieldType.CHECKBOX
  const seg = lastSegment(path).toLowerCase()
  if (seg.includes('email')) return FieldType.EMAIL
  if (seg.includes('url') || seg.includes('website')) return FieldType.URL
  if (seg.endsWith('_at') || seg.includes('date')) return FieldType.DATE
  return FieldType.TEXT
}

/**
 * One source leaf as a condition-builder field. The `id` is the SOURCE PATH itself
 * (`orders_count`, `customer.email`, `line_items[].sku`) — not a `ResourceFieldId`.
 * That is the whole adaptation the record filter needs: it runs on the raw payload
 * before mapping, so it addresses the payload's own vocabulary.
 *
 * A node's DECLARED `fieldType` (from a catalog struct overlay) wins over the
 * inference, so an `ADDRESS_STRUCT` leaf gets address operators rather than text ones.
 */
export function toSourceFieldDefinition(node: SourcePath): FieldDefinition {
  const fieldType = node.fieldType ?? inferFieldType(node.path, node.type, node.format)
  return {
    id: node.path,
    label: node.path,
    type: mapFieldTypeToBaseType(fieldType),
    fieldType,
    fieldKey: node.path,
  }
}

/**
 * The condition builder's field vocabulary for a stream: every VALUE leaf of the
 * stored source schema, plus any path a saved condition still references that the
 * schema no longer describes.
 *
 * The second half matters — a schema re-inference can drop a path a live filter is
 * built on. Without the carry-over the row's field chip would silently read
 * "Select field" and the merchant would have no way to tell which condition broke.
 * Branches (objects / arrays of objects) are excluded: they carry no comparable value.
 *
 * 🔴 **Fan-out (`[]`) paths are excluded too, and that is not cosmetic.**
 * `flattenSourceSchema` is shared with the MAPPING tree, where `line_items[].sku`
 * legitimately means "every element" and `extractSubtrees` expands it. A filter has no
 * such expansion: it resolves paths with `getByPath`, whose indexed segment requires
 * digits, so a bare `[]` matches nothing and the condition reads `undefined`. The
 * operators still compile, so this produces no diagnostics and the engine's fail-open
 * rule does NOT catch it — offering one of these paths would let a merchant build a
 * filter that looks right, reports a clean run, and silently drops every record.
 * `assertRecordFilterCompiles` rejects them at the write boundary; this is the half
 * that stops one being built in the first place.
 *
 * For an array-ROOT stream (a generic-rest collection endpoint, where every leaf reads
 * `[].something`) this correctly leaves the vocabulary empty — see the caller, which
 * says so rather than rendering an empty picker.
 */
export function buildSourceFieldDefinitions(
  paths: SourcePath[],
  referencedPaths: string[] = []
): FieldDefinition[] {
  const fields = paths
    .filter((p) => !p.isBranch && !p.path.includes('[]'))
    .map(toSourceFieldDefinition)
  const known = new Set(fields.map((f) => f.id))
  for (const path of referencedPaths) {
    if (!path || known.has(path)) continue
    known.add(path)
    fields.push(toSourceFieldDefinition({ path, type: 'string', depth: 0, isBranch: false }))
  }
  return fields
}

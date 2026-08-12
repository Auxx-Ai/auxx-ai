// packages/lib/src/workflow-engine/nodes/action-nodes/relation-utils.ts

/**
 * Normalize a raw relation field value into a flat array of ID strings.
 *
 * Handles formats from:
 * - Frontend relation-input picker: RecordId[] array
 * - Variable resolution: ResourceReference objects, entity objects
 * - Direct input: plain IDs, RecordId strings
 *
 * Object handling mirrors `extractIdFromValue` (`nodes/base-node.ts`) key for
 * key and in the same precedence. The two are the only places a workflow value
 * is reduced to an id, and a value that means one record for `resourceId` must
 * not mean a different one for a relation field.
 */
export function parseRelationInput(value: unknown): string[] {
  if (value == null || value === '') return []

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseRelationInput(item))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.id) return [String(obj.id)]
    // ResourceReference — what every find-node output and every `nodeId.<resource>`
    // variable is. Without this branch "find a record, then set it on a relation
    // field" resolves to nothing at all.
    if (obj.__resourceRef === true && obj.resourceId) return [String(obj.resourceId)]
    if (obj.referenceId) return [String(obj.referenceId)]
  }

  return []
}

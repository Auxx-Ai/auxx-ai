// packages/lib/src/workflow-engine/nodes/action-nodes/relation-utils.ts

/**
 * Normalize a raw relation field value into a flat array of ID strings.
 *
 * Handles formats from:
 * - Frontend relation-input picker: RecordId[] array
 * - Variable resolution: ResourceReference objects, entity objects
 * - Direct input: plain IDs, RecordId strings
 */
export function parseRelationInput(value: unknown): string[] {
  if (value == null || value === '') return []

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseRelationInput(item))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    return [trimmed]
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.referenceId) return [String(obj.referenceId)]
    if (obj.id) return [String(obj.id)]
  }

  return []
}

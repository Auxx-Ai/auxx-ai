// packages/lib/src/ai/kopilot/capabilities/entities/tools/field-label-helpers.ts

import { getFieldOutputKey } from '../../../../../resources/registry/field-types'
import type { Resource } from '../../../../../resources/registry/types'

/**
 * Resolve LLM-supplied field ids (systemAttribute / key / raw FieldId) to their
 * human labels using the cached resource. Falls back to the original id when a
 * match can't be found so the action summary still includes something readable.
 */
export function resolveFieldLabels(
  resource: Resource | null | undefined,
  fieldIds: string[]
): string[] {
  if (!resource) return fieldIds
  return fieldIds.map((id) => {
    const field = resource.fields.find(
      (f) => getFieldOutputKey(f) === id || f.key === id || f.id === id
    )
    return field?.label ?? id
  })
}

/**
 * Validate that each LLM-supplied field key matches the canonical id returned by
 * `list_entity_fields` (`systemAttribute ?? key`). Unknown keys are rejected — the
 * handler's key resolution is strict, so passing an unrecognised id silently drops
 * the write.
 *
 * @param keys - Field ids the LLM included in the tool call
 * @param resource - Cached resource for the entity
 * @returns `unknownKeys` (to reject) + `validIds` (to include in the error hint)
 */
export function validateFieldKeys(
  keys: string[],
  resource: Resource | null | undefined
): { unknownKeys: string[]; validIds: string[] } {
  if (!resource) return { unknownKeys: [], validIds: [] }
  const validIds = resource.fields.map(getFieldOutputKey)
  const validSet = new Set(validIds)
  const unknownKeys = keys.filter((k) => !validSet.has(k))
  return { unknownKeys, validIds }
}

/**
 * Build a user-visible error message when `validateFieldKeys` finds unknown keys.
 * Lists available ids so the LLM can self-correct in one turn.
 */
export function formatUnknownFieldsError(
  unknownKeys: string[],
  validIds: string[],
  entityLabel: string
): string {
  return `Unknown field${unknownKeys.length === 1 ? '' : 's'} on "${entityLabel}": ${unknownKeys.join(', ')}. Use the exact \`id\` returned by list_entity_fields. Available: ${validIds.join(', ')}`
}

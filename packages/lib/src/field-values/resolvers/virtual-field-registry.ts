// packages/lib/src/field-values/resolvers/virtual-field-registry.ts

import type { TypedFieldValue } from '@auxx/types'
import type { FieldValueContext } from '../field-value-helpers'
import { resolveThreadVirtualFields } from './thread-virtual-fields'

/**
 * Fields with dbColumn: undefined that have custom cross-table resolvers.
 * Keyed by field KEY (not UUID).
 */
const VIRTUAL_FIELD_KEYS: Record<string, Set<string>> = {
  thread: new Set(['from', 'to', 'body', 'hasAttachments', 'hasDraft', 'sent']),
}

/** Check using field KEY (not UUID). */
export function isVirtualField(entityDefId: string, fieldKey: string): boolean {
  return VIRTUAL_FIELD_KEYS[entityDefId]?.has(fieldKey) ?? false
}

/** Dispatch to the correct resource-specific virtual field resolver. */
export async function resolveVirtualFields(
  ctx: FieldValueContext,
  entityDefId: string,
  entityIds: string[],
  fieldKeys: string[],
  fieldIdMap: Map<string, string>
): Promise<Map<string, Map<string, TypedFieldValue>>> {
  if (entityIds.length === 0 || fieldKeys.length === 0) return new Map()

  switch (entityDefId) {
    case 'thread':
      return resolveThreadVirtualFields(ctx, entityIds, fieldKeys, fieldIdMap)
    default:
      return new Map()
  }
}

// packages/lib/src/field-values/resolvers/virtual-field-registry.ts

import type { TypedFieldValue } from '@auxx/types'
import type { FieldOptions } from '../../custom-fields/field-options'
import type { FieldValueContext } from '../field-value-helpers'
import { resolveThreadVirtualFields } from './thread-virtual-fields'
import { resolveVisitVirtualFields } from './visit-virtual-fields'

/** A virtual value plus per-record options needed to display it correctly. */
export interface VirtualFieldValue {
  value: TypedFieldValue
  fieldOptions?: FieldOptions
}

/** Virtual values grouped by record id and field key. */
export type VirtualFieldMap = Map<string, Map<string, VirtualFieldValue>>

/**
 * Fields with dbColumn: undefined that have custom cross-table resolvers.
 * Keyed by field KEY (not UUID).
 */
const VIRTUAL_FIELD_KEYS: Record<string, Set<string>> = {
  thread: new Set(['from', 'to', 'body', 'hasAttachments', 'hasDraft', 'sent']),
  visit: new Set(['date', 'startTime', 'endTime']),
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
): Promise<VirtualFieldMap> {
  if (entityIds.length === 0 || fieldKeys.length === 0) return new Map()

  switch (entityDefId) {
    case 'thread':
      return toVirtualFieldMap(
        await resolveThreadVirtualFields(ctx, entityIds, fieldKeys, fieldIdMap)
      )
    case 'visit':
      return resolveVisitVirtualFields(ctx, entityIds, fieldKeys, fieldIdMap)
    default:
      return new Map()
  }
}

/** Wrap legacy virtual values that do not require per-record display options. */
function toVirtualFieldMap(values: Map<string, Map<string, TypedFieldValue>>): VirtualFieldMap {
  const result: VirtualFieldMap = new Map()
  for (const [entityId, fieldMap] of values) {
    result.set(entityId, new Map([...fieldMap].map(([key, value]) => [key, { value }])))
  }
  return result
}

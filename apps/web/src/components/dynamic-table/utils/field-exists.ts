// apps/web/src/components/dynamic-table/utils/field-exists.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { getResourceStoreState } from '~/components/resources'
import { decodeColumnId } from './column-id'

/**
 * Check if all fields referenced by a column ID exist in the resource store.
 * Returns false if:
 * - Direct field doesn't exist in fieldMap
 * - Any path segment doesn't exist
 * - Field is in optimisticDeletedFields (deletion pending)
 */
export function doesColumnFieldExist(columnId: string): boolean {
  const { fieldMap, optimisticDeletedFields } = getResourceStoreState()

  const checkField = (rfId: ResourceFieldId): boolean => {
    const exists = rfId in fieldMap
    const deleted = optimisticDeletedFields.has(rfId)
    return exists && !deleted
  }

  const decoded = decodeColumnId(columnId)

  if (decoded.type === 'direct') {
    return checkField(decoded.resourceFieldId as ResourceFieldId)
  }

  // Path - all segments must exist
  return decoded.fieldPath.every((rfId) => checkField(rfId as ResourceFieldId))
}

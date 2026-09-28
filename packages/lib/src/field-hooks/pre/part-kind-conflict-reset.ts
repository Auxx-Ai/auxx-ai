// packages/lib/src/field-hooks/pre/part-kind-conflict-reset.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import type { FieldPreHookHandler } from '../types'

/**
 * A new kind drops the "keep it" confirmation (plans/mrp/17 D3). One-field writes only: a
 * multi-field update clears it through `PART_HOOKS`, and a create has nothing to clear.
 */
export const resetKindConflictConfirmation: FieldPreHookHandler = async (event) => {
  if (event.allValues.size !== 1) return event.newValue
  // Lazy: the builds module pulls the CRUD stack, which loads this registry.
  const { clearKindConflictConfirmations } = await import(
    '../../inventory/builds/kind-conflict-mutations'
  )
  const { entityInstanceId } = parseRecordId(event.recordId)
  await clearKindConflictConfirmations(database, event.organizationId, [entityInstanceId])
  return event.newValue
}

// packages/lib/src/field-hooks/pre/accounting-work-item-delete.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { deleteWorkItemsForSources } from '../../accounting/work-items/write'
import type { EntityPreDeleteHandler } from '../types'

/**
 * A deleted record takes its parked accounting work with it, or the row dangles on
 * the Blocked tab (91 §8.9). Keyed by the record's entity type, which is the
 * work item's `sourceKind`. A delete another hook refuses loses its rows, and the
 * sweep finds the record again as never-tried.
 */
export const sweepAccountingWorkItemsOnDelete: EntityPreDeleteHandler = async (event) => {
  if (!event.entityType) return
  const { entityInstanceId } = parseRecordId(event.recordId)
  // A failed sweep is logged by the writer and never refuses the delete.
  await deleteWorkItemsForSources(database, event.organizationId, {
    sourceKind: event.entityType,
    sourceIds: [entityInstanceId],
  })
}

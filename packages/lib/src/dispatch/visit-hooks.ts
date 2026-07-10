// packages/lib/src/dispatch/visit-hooks.ts

import { parseRecordId } from '@auxx/types/resource'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { ensureVisitForWorkOrder } from './visit-mutations'

/**
 * Auto-create the unscheduled visit row when a work order is created (any path:
 * generic record.create, createFromTicket, Kopilot tools, workflows). Keyed off the
 * first write of work_order_number — hook-generated exactly once per create (§F.4a),
 * since that field is creatable:false/updatable:false everywhere else.
 */
export const ensureVisitOnWorkOrderCreate: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'work_order_number') return
  if (event.oldValue !== null) return // not the create write
  const { entityInstanceId } = parseRecordId(event.recordId)
  await ensureVisitForWorkOrder(event.organizationId, entityInstanceId)
}

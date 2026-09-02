// packages/lib/src/field-hooks/publish.ts

import type { RecordId } from '@auxx/types/resource'
import { publisher } from '../events'
import type { FieldTriggerJobEvent } from '../events/types'
import type { TriggeredField } from './collect-triggers'
import { handleFieldTriggerJob } from './field-hook-job'

/**
 * Native field triggers run OFF the request, through the events queue
 * (`field:trigger` → `handleFieldTriggerJob` in the worker). Inline, a vendor
 * price edit waited for a whole-org part cost recalculation before the save
 * returned, and inside a transaction-scoped write the recalc could not see
 * the rows it was recomputing from
 * (plans/field-values/update-path-and-events.md section 3E). The handlers
 * recompute from current state, so a later edit is never repriced from an
 * earlier one's input.
 */
const FIELD_TRIGGERS_ASYNC = true

/**
 * Publish field trigger events for a single record update.
 * One event per triggered systemAttribute.
 */
export async function publishFieldTriggerEvents(
  ctx: { organizationId: string; userId: string },
  triggeredFields: TriggeredField[],
  recordId: RecordId
): Promise<void> {
  const events = triggeredFields.map(
    ({ systemAttribute }) =>
      ({
        type: 'field:trigger',
        data: {
          systemAttribute,
          recordIds: [recordId],
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      }) as FieldTriggerJobEvent
  )

  if (FIELD_TRIGGERS_ASYNC) {
    await Promise.all(events.map((event) => publisher.publishLater(event)))
  } else {
    for (const event of events) {
      await handleFieldTriggerJob({ data: event })
    }
  }
}

/**
 * Publish batched field trigger events for bulk operations.
 * One event per triggered systemAttribute with all affected recordIds.
 */
export async function publishBatchFieldTriggerEvents(
  ctx: { organizationId: string; userId: string },
  triggeredFields: TriggeredField[],
  recordIds: RecordId[]
): Promise<void> {
  const events = triggeredFields.map(
    ({ systemAttribute }) =>
      ({
        type: 'field:trigger',
        data: {
          systemAttribute,
          recordIds,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      }) as FieldTriggerJobEvent
  )

  if (FIELD_TRIGGERS_ASYNC) {
    await Promise.all(events.map((event) => publisher.publishLater(event)))
  } else {
    for (const event of events) {
      await handleFieldTriggerJob({ data: event })
    }
  }
}

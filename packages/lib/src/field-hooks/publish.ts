// packages/lib/src/field-hooks/publish.ts

import type { RecordId } from '@auxx/types/resource'
import { publisher } from '../events'
import type { FieldTriggerJobEvent } from '../events/types'
import type { TriggeredField } from './collect-triggers'
import { handleFieldTriggerJob } from './field-hook-job'

/** Set to `true` to dispatch field triggers async via BullMQ instead of inline. */
const FIELD_TRIGGERS_ASYNC = false

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

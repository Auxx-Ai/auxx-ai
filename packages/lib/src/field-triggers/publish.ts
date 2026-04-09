// packages/lib/src/field-triggers/publish.ts

import type { RecordId } from '@auxx/types/resource'
import { publisher } from '../events'
import type { FieldTriggerJobEvent } from '../events/types'
import type { TriggeredField } from './collect-triggers'

/**
 * Publish field trigger events for a single record update.
 * One event per triggered systemAttribute.
 */
export async function publishFieldTriggerEvents(
  ctx: { organizationId: string; userId: string },
  triggeredFields: TriggeredField[],
  recordId: RecordId
): Promise<void> {
  await Promise.all(
    triggeredFields.map(({ systemAttribute }) =>
      publisher.publishLater({
        type: 'field:trigger',
        data: {
          systemAttribute,
          recordIds: [recordId],
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      } as FieldTriggerJobEvent)
    )
  )
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
  await Promise.all(
    triggeredFields.map(({ systemAttribute }) =>
      publisher.publishLater({
        type: 'field:trigger',
        data: {
          systemAttribute,
          recordIds,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
      } as FieldTriggerJobEvent)
    )
  )
}

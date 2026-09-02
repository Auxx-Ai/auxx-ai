// packages/lib/src/events/handlers/create-event-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { THREAD_EVENT_TYPES } from '../../thread-events/client'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('create-event-job')

/** The full thread lifecycle vocabulary `publishThreadEventToRealtime` owns. */
const THREAD_EVENT_TYPE_SET = new Set<string>(THREAD_EVENT_TYPES)

/**
 * Legacy job name. `publishEventJob` now calls {@link persistEvent} inline;
 * this stays registered so jobs queued before a deploy still resolve.
 */
export const createEventJob = async ({ data: event }: { data: AuxxEvent }) => {
  await persistEvent(event)
}

/**
 * Write the `Event` row for one bus event. Throws when the insert fails so the
 * caller decides whether that is fatal (`publishEventJob` logs and continues).
 */
export async function persistEvent(event: AuxxEvent): Promise<void> {
  // Thread lifecycle events are persisted as `ThreadEvent` rows by
  // `publishThreadEventToRealtime` (the single writer; the realtime payload
  // carries the row id + createdAt for client-side dedupe). No `Event` row is
  // written for them at all (plans/threads/thread-events.md §12.1).
  if (THREAD_EVENT_TYPE_SET.has(event.type)) return
  // The native field-trigger dispatch is plumbing between the write and the
  // worker, not a record of anything a person did.
  if (event.type === 'field:trigger') return

  const organizationId = event.data.organizationId
  // `Event.organizationId` is NOT NULL, but a few event payloads
  // (`integration:connection_failed`) legitimately carry no org id; they fire
  // from early failure paths before a session is resolved. Persisting is
  // impossible for those; the audit-log handler still records them with a null
  // org id, so the event is not lost.
  if (!organizationId) {
    logger.warn('Event has no organizationId; skipping Event row', { type: event.type })
    return
  }
  const [result] = await database
    .insert(schema.Event)
    .values({
      organizationId,
      type: event.type,
      data: event.data,
      updatedAt: new Date(),
    })
    .returning()

  if (!result) {
    throw new Error('Failed to create event')
  }
}

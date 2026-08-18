// packages/lib/src/events/handlers/create-event-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { THREAD_EVENT_TYPES } from '../../thread-events/client'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('create-event-job')

/** The full thread lifecycle vocabulary `publishThreadEventToRealtime` owns. */
const THREAD_EVENT_TYPE_SET = new Set<string>(THREAD_EVENT_TYPES)

export const createEventJob = async ({ data: event }: { data: AuxxEvent }) => {
  // Thread lifecycle events are persisted as `ThreadEvent` rows by
  // `publishThreadEventToRealtime` (the single writer — the realtime payload
  // carries the row id + createdAt for client-side dedupe). No `Event` row is
  // written for them at all (plans/threads/thread-events.md §12.1).
  if (THREAD_EVENT_TYPE_SET.has(event.type)) return
  await createEvent(event)
}

async function createEvent(event: AuxxEvent) {
  const organizationId = event.data.organizationId
  // `Event.organizationId` is NOT NULL, but a few event payloads
  // (`integration:connection_failed`) legitimately carry no org id — they fire
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

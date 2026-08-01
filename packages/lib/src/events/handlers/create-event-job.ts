// packages/lib/src/events/handlers/create-event-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import type { AuxxEvent } from '../types'
import { THREAD_REALTIME_EVENT_TYPES } from './publish-thread-event-to-realtime'

const logger = createScopedLogger('create-event-job')

export const createEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  // Thread lifecycle events are persisted by `publishThreadEventToRealtime`
  // so the realtime payload can carry the row id + createdAt for client-side
  // dedupe. Skip here to avoid double-insert.
  if (THREAD_REALTIME_EVENT_TYPES.has(event.type)) return
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

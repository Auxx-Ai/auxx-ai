// packages/lib/src/events/handlers/create-event-job.ts

import { database, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import type { AuxxEvent } from '../types'
import { THREAD_REALTIME_EVENT_TYPES } from './publish-thread-event-to-realtime'

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

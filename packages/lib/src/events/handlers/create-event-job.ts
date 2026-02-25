// packages/lib/src/events/handlers/create-event-job.ts

import { database, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import type { AuxxEvent } from '../types'

export const createEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
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

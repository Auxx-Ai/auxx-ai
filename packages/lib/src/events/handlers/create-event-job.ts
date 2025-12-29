import { Job } from 'bullmq'
import { EventModel } from '@auxx/database/models'
import { type AuxxEvent } from '../types'

export const createEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  await createEvent(event)
}

async function createEvent(event: AuxxEvent) {
  const organizationId = event.data.organizationId
  const model = new EventModel(organizationId)
  const res = await model.create({ type: event.type as any, data: event.data as any } as any)
  const result = res.ok ? res.value : null

  if (!result) {
    throw new Error('Failed to create event')
  }
}

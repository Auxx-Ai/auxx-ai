// packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { getRealtimeService, rooms } from '../../realtime'
import type {
  AuxxEvent,
  ThreadArchivedEvent,
  ThreadAssigneeChangedEvent,
  ThreadReopenedEvent,
  ThreadReturnedToAiEvent,
  ThreadTakenOverEvent,
  ThreadVisitorIdentifiedEvent,
} from '../types'

const logger = createScopedLogger('publish-thread-event-to-realtime')

type RealtimeThreadEvent =
  | ThreadArchivedEvent
  | ThreadReopenedEvent
  | ThreadTakenOverEvent
  | ThreadReturnedToAiEvent
  | ThreadAssigneeChangedEvent
  | ThreadVisitorIdentifiedEvent

/**
 * Thread lifecycle event types this handler owns end-to-end (persistence +
 * realtime fan-out). The generic `createEventJob` skips these types so this
 * handler is the single writer — that way the Pusher payload can carry the
 * row's `id` and `createdAt` for stable client-side dedupe.
 */
export const THREAD_REALTIME_EVENT_TYPES = new Set<AuxxEvent['type']>([
  'thread:archived',
  'thread:reopened',
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:assignee:changed',
  'thread:visitor:identified',
])

/**
 * Persist the thread lifecycle event AND push it onto the per-thread realtime
 * room so widget and admin clients can render centered system lines without
 * polling. Owns the `Event` row insert for these types — the generic
 * `createEventJob` skips them so the inserted `id` and `createdAt` can be
 * included in the Pusher payload (downstream clients dedupe on `id`).
 */
export const publishThreadEventToRealtime = async (job: Job<AuxxEvent>) => {
  const event = job.data
  if (!THREAD_REALTIME_EVENT_TYPES.has(event.type)) return

  const typed = event as RealtimeThreadEvent
  const threadId = typed.data.threadId
  if (!threadId) {
    logger.warn('Thread event missing threadId; skipping realtime push', { type: event.type })
    return
  }

  // Persist first — the realtime payload carries the row id so clients can
  // dedupe against the rows they load via the history endpoint.
  let row: { id: string; createdAt: Date } | undefined
  try {
    const [inserted] = await database
      .insert(schema.Event)
      .values({
        organizationId: typed.data.organizationId,
        type: event.type,
        data: typed.data,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Event.id, createdAt: schema.Event.createdAt })
    row = inserted
  } catch (error) {
    logger.error('Failed to persist thread event row', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await getRealtimeService().publish(rooms.chatThread(threadId), event.type, {
      ...typed.data,
      id: row?.id,
      createdAt: row?.createdAt?.toISOString() ?? new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to publish thread event to realtime', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

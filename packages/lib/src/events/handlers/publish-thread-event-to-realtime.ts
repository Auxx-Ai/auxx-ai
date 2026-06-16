// packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
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

  const payload = {
    ...typed.data,
    id: row?.id,
    createdAt: row?.createdAt?.toISOString() ?? new Date().toISOString(),
  }

  // Per-thread room: the admin conversation panel and the widget's per-thread
  // subscription both listen here. This is the primary delivery path.
  try {
    await getRealtimeService().publish(rooms.chatThread(threadId), event.type, payload)
  } catch (error) {
    logger.error('Failed to publish thread event to realtime', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Redundant fan-out to the visitor's per-thread-agnostic channel. The widget
  // only subscribes to the per-thread room while that conversation is open, so
  // without this a takeover that happens while the visitor sits on Home (or
  // whose per-thread subscription hiccuped) never surfaces live. The visitor
  // channel is always connected for the widget session; the client dedupes
  // against the per-thread delivery by event `id`. Chat threads only — email
  // threads carry no `visitorParticipantId` and resolve to `null` here.
  const visitorParticipantId = await resolveVisitorParticipantId(threadId)
  if (visitorParticipantId) {
    try {
      await getRealtimeService().publish(rooms.visitor(visitorParticipantId), event.type, payload)
    } catch (error) {
      logger.error('Failed to publish thread event to visitor channel', {
        type: event.type,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Resolve the chat visitor's Participant id from the thread's metadata, or
 * `null` for non-chat threads (which have no visitor channel to fan out to).
 */
async function resolveVisitorParticipantId(threadId: string): Promise<string | null> {
  try {
    const [row] = await database
      .select({ metadata: schema.Thread.metadata })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, threadId))
      .limit(1)
    const metadata = row?.metadata as { visitorParticipantId?: string } | null | undefined
    return metadata?.visitorParticipantId ?? null
  } catch {
    return null
  }
}

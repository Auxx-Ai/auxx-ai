// packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts

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

const SUPPORTED_TYPES = new Set<AuxxEvent['type']>([
  'thread:archived',
  'thread:reopened',
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:assignee:changed',
  'thread:visitor:identified',
])

/**
 * Push thread lifecycle events onto the per-thread realtime room so widget
 * and admin clients can render centered system lines without polling. Runs
 * as a sibling of `createEventJob` — audit-log persistence is unaffected.
 */
export const publishThreadEventToRealtime = async (job: Job<AuxxEvent>) => {
  const event = job.data
  if (!SUPPORTED_TYPES.has(event.type)) return

  const typed = event as RealtimeThreadEvent
  const threadId = typed.data.threadId
  if (!threadId) {
    logger.warn('Thread event missing threadId; skipping realtime push', { type: event.type })
    return
  }

  try {
    await getRealtimeService().publish(rooms.chatThread(threadId), event.type, typed.data)
  } catch (error) {
    logger.error('Failed to publish thread event to realtime', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

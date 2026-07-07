// @auxx/lib/realtime/mail-event-shaping.ts

import type { Lens } from '../permissions/visibility/lens'
import { satisfiesLens } from '../permissions/visibility/lens'
import { redactMessagePatch, redactThreadPatch } from '../permissions/visibility/redact'
import type { MailSyncEvent } from './events'

/**
 * Shape one mail event for a lens variant (mail-permissions §6.2) — the single
 * projection both the per-lens inbox-channel publishers and the per-user
 * grantee fanout run every payload through. Pure and key-based:
 *
 * - `thread:updated` patches go through the {@link redactThreadPatch}
 *   ALLOWLIST, so an unclassified new field can't smuggle content to a lower
 *   channel. An empty redacted patch drops the event.
 * - `message:*` events don't exist below `subject` (messages are invisible at
 *   `metadata`); `message:updated` patches lose content fields below `full`.
 * - `thread:created` / `thread:deleted` / `inbox:syncCompleted` /
 *   `participant:updated` carry metadata-tier data only and pass through.
 *
 * Returns `null` when the event has nothing to say at this lens.
 */
export function shapeMailEventForLens(e: MailSyncEvent, lens: Lens): MailSyncEvent | null {
  if (lens === 'none') return null
  switch (e.event) {
    case 'thread:created':
    case 'thread:deleted':
    case 'participant:updated':
    case 'inbox:syncCompleted':
      return e
    case 'thread:updated': {
      if (lens === 'full') return e
      const patch = redactThreadPatch(e.data.patch, lens)
      if (!Object.keys(patch).some((k) => k !== 'id')) return null
      return { event: 'thread:updated', data: { threadId: e.data.threadId, patch } }
    }
    case 'message:created':
    case 'message:deleted':
      return satisfiesLens(lens, 'subject') ? e : null
    case 'message:updated': {
      if (!satisfiesLens(lens, 'subject')) return null
      if (lens === 'full') return e
      const patch = redactMessagePatch(e.data.patch as Record<string, unknown>, lens)
      if (!Object.keys(patch).some((k) => k !== 'id' && k !== 'threadId')) return null
      return {
        event: 'message:updated',
        data: { messageId: e.data.messageId, threadId: e.data.threadId, patch },
      }
    }
    case 'mail:batch': {
      const events = e.data.events
        .map((inner) => shapeMailEventForLens(inner, lens))
        .filter((inner): inner is MailSyncEvent => inner !== null)
      if (events.length === 0) return null
      return { event: 'mail:batch', data: { events } }
    }
  }
}

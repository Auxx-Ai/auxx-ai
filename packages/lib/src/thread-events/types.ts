// packages/lib/src/thread-events/types.ts

import type { schema } from '@auxx/database'
import type { ThreadEventData, ThreadEventType } from './client'

/** A selected `ThreadEvent` row. */
export type ThreadEventRow = typeof schema.ThreadEvent.$inferSelect

/**
 * Decoded keyset-pagination cursor: the `(createdAt, id)` of the LAST row of
 * the previous page (page order is `createdAt DESC, id DESC`). Travels over
 * the wire as the opaque string produced by `encodeThreadEventCursor`.
 */
export interface ThreadEventCursor {
  createdAt: Date
  id: string
}

/** Input for `listThreadEvents`. No access checks here — the router asserts the lens. */
export interface ListThreadEventsInput {
  organizationId: string
  threadId: string
  /** Page size, default 50. */
  limit?: number
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null
}

/** One page of thread events, newest first. */
export interface ListThreadEventsResult {
  events: ThreadEventRow[]
  /** Opaque cursor for the next (older) page, or null when exhausted. */
  nextCursor: string | null
}

/** Input for `recordThreadEvent`, typed per event type so `data` matches `type`. */
export interface RecordThreadEventInput<T extends ThreadEventType = ThreadEventType> {
  organizationId: string
  threadId: string
  type: T
  /** Branded ActorId string ('user:…' / 'agent:…'); omit/null for system/automation. */
  actorId?: string | null
  data?: ThreadEventData[T]
  /**
   * Normally omitted (the schema default mints a cuid). The Phase 3 data
   * migration reuses legacy `Event.id`s so client dedupe-by-id keeps working
   * across the cut-over.
   */
  id?: string
  /** Normally omitted (defaults to now); the backfill preserves original timestamps. */
  createdAt?: Date
}

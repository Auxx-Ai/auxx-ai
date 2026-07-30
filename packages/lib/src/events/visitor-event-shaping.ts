// packages/lib/src/events/visitor-event-shaping.ts

import type { AuxxEvent } from './types'

/**
 * The ONLY fields of a thread lifecycle event that may reach a chat visitor
 * (plan 45 §1.5).
 *
 * The visitor sink is a **public** Pusher channel — `rooms.visitor(...)` is
 * connected by the widget before any session exists, so Pusher never asks the
 * server to sign it (`realtime/rooms.ts`). Spreading the internal `typed.data`
 * onto it sent `userId` / `fromUserId` / `toUserId` / `previousState` — internal
 * principal ids and AI-handoff state — to an unauthenticated client.
 *
 * An ALLOWLIST rather than a denylist, for the same reason
 * `THREAD_METADATA_FIELDS` is one: a field added to an event payload later is
 * withheld from visitors until someone classifies it, instead of leaking by
 * default.
 *
 * Nothing is lost. The widget renders these as centered system lines keyed on
 * `type` alone and reads no payload field at all
 * (`packages/chat/src/views/conversation/system-line.tsx`); `threadId` is kept
 * because the widget scopes events to the open conversation, and `id` /
 * `createdAt` because it dedupes the realtime delivery against the history
 * fetch by `id` and orders by `createdAt`.
 */
export const VISITOR_THREAD_EVENT_FIELDS = ['threadId', 'id', 'createdAt'] as const

/**
 * Project a thread lifecycle event payload down to what a chat visitor may see.
 *
 * Applied at BOTH visitor-facing sinks or it is cosmetic: the realtime publish
 * to `rooms.visitor(...)` and the history rows the widget fetches over HTTP
 * (`loadThreadEvents` in `apps/api/src/routes/chat/lib.ts`), which read the same
 * unshaped `Event.data` row back out of the database.
 *
 * The persisted `Event.data` row deliberately stays complete — it is the admin
 * audit record, and `apps/web`'s own history endpoint serves the member sink
 * from it.
 */
export function shapeThreadEventForVisitor(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of VISITOR_THREAD_EVENT_FIELDS) {
    if (data[field] !== undefined) out[field] = data[field]
  }
  return out
}

/** Thread lifecycle event types with a visitor-facing sink. */
export type VisitorFacingThreadEventType = Extract<
  AuxxEvent['type'],
  | 'thread:archived'
  | 'thread:reopened'
  | 'thread:taken_over'
  | 'thread:returned_to_ai'
  | 'thread:assignee:changed'
  | 'thread:visitor:identified'
>

// packages/chat/src/transport/thread-events.ts
//
// Thread lifecycle event types the widget renders as centered system lines.
//
// Duplicated locally (rather than imported from `@auxx/lib/events`) because
// the widget bundle cannot pull `@auxx/lib` — its event types transitively
// import server-only deps (`@auxx/database/types`, `@auxx/types/...`).
//
// Keep this union in sync with `apps/api/src/routes/chat/lib.ts`'s
// `WIDGET_THREAD_EVENT_TYPES` constant.

export const THREAD_EVENT_TYPES = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
] as const

export type ThreadEventType = (typeof THREAD_EVENT_TYPES)[number]

export interface ThreadEvent {
  id: string
  type: ThreadEventType
  /** ISO string from the server, or Date when freshly published over Pusher. */
  createdAt: string
  data: ThreadEventData
}

/**
 * What a visitor-facing thread event carries — ONE shape for all six types,
 * because the server projects every one of them through
 * `shapeThreadEventForVisitor`'s allowlist before it reaches this bundle
 * (plan 45 §1.5). Both sinks are shaped: the public realtime channel and the
 * history rows in `initialize` / `threads`.
 *
 * The internal payloads in `packages/lib/src/events/types.ts` are richer —
 * `userId`, `previousState`, `fromUserId` / `toUserId`, `visitorEmail` — and
 * those fields are deliberately NOT mirrored here. They never arrive, and
 * `system-line.tsx` keys its copy off `type` alone, so nothing reads them.
 *
 * Adding a field to this interface is therefore not enough to receive it: it has
 * to be classified into `VISITOR_THREAD_EVENT_FIELDS` server-side first.
 */
export interface ThreadEventData {
  threadId: string
}

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

/** Per-event payload shapes — mirrored from `packages/lib/src/events/types.ts`. */
export type ThreadEventData =
  | ThreadTakenOverData
  | ThreadReturnedToAiData
  | ThreadArchivedData
  | ThreadReopenedData
  | ThreadAssigneeChangedData
  | ThreadVisitorIdentifiedData

export interface ThreadTakenOverData {
  threadId: string
  organizationId: string
  userId: string
  previousState: 'ai' | 'human'
}

export interface ThreadReturnedToAiData {
  threadId: string
  organizationId: string
  userId: string
}

export interface ThreadArchivedData {
  threadId: string
  organizationId: string
  userId: string
}

export interface ThreadReopenedData {
  threadId: string
  organizationId: string
  userId: string
}

export interface ThreadAssigneeChangedData {
  threadId: string
  organizationId: string
  fromUserId: string | null
  toUserId: string | null
}

export interface ThreadVisitorIdentifiedData {
  threadId: string
  organizationId: string
  visitorEmail: string
  participantId: string
}

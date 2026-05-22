// @auxx/lib/realtime/room-keys.ts

/**
 * Client-safe room key helpers and prefix mapping.
 *
 * Lives separately from `rooms.ts` so the client adapter can import it without
 * pulling in the server-only ACL logic (which touches the DB, inbox service,
 * etc.).
 *
 * Both files share the same `RoomKind` definitions for every room family —
 * the server registry adds `authorize(...)` fns on top.
 */

export type RoomKind = 'plain' | 'presence'

/** Typed helpers to build room keys. Mirrored on `rooms` for server callers. */
export const rooms = {
  /** Org-wide events (records, agents, mail batches outside an inbox). */
  orgEvents: (organizationId: string): string => `org-${organizationId}-events`,
  /** Org presence room (member online/idle). */
  orgPresence: (organizationId: string): string => `org-${organizationId}`,
  /** Per-inbox channel. `inboxSlug` is the raw inbox UUID, or `'none'` for triage. */
  orgInbox: (organizationId: string, inboxSlug: string): string =>
    `org-${organizationId}-inbox-${inboxSlug}`,
  /** Private per-user channel (notifications, personal events). */
  user: (userId: string): string => `user-${userId}`,
  /** Per-chat-thread admin channel. */
  chatThread: (threadId: string): string => `thread-${threadId}`,
  /** Visitor's chat session (widget-side). */
  chatSession: (sessionId: string): string => `chat-${sessionId}`,
  /** Visitor's cross-thread channel (widget-side). */
  visitor: (participantId: string): string => `visitor-${participantId}`,
}

/**
 * Resolve a room key to its kind. Same ordering as the server registry — must
 * stay in sync. Returns null for unknown keys.
 */
export function roomKindFor(roomKey: string): RoomKind | null {
  if (/^org-.+-inbox-.+$/.test(roomKey)) return 'plain'
  if (/^org-.+-events$/.test(roomKey)) return 'plain'
  if (roomKey.startsWith('org-')) return 'presence'
  if (roomKey.startsWith('user-')) return 'plain'
  if (roomKey.startsWith('thread-')) return 'plain'
  if (roomKey.startsWith('chat-')) return 'plain'
  if (roomKey.startsWith('visitor-')) return 'plain'
  return null
}

/** Map a room key to its Pusher channel name (`private-` / `presence-`). */
export function toPusherChannel(roomKey: string): string | null {
  const kind = roomKindFor(roomKey)
  if (!kind) return null
  return kind === 'presence' ? `presence-${roomKey}` : `private-${roomKey}`
}

/** Strip the Pusher prefix to recover the room key. */
export function fromPusherChannel(channelName: string): string | null {
  if (channelName.startsWith('private-')) return channelName.slice('private-'.length)
  if (channelName.startsWith('presence-')) return channelName.slice('presence-'.length)
  return null
}

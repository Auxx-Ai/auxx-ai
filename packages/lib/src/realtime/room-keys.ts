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

/**
 * - `plain` — server-published, client subscribes via `private-` Pusher channel
 *   with auth signing. Most admin-side rooms.
 * - `presence` — Pusher `presence-` channel; carries member roster + state.
 * - `public` — server-published, client subscribes to the raw channel name
 *   with no auth. Used for the visitor chat session (`chat-{id}`) which is
 *   bootstrapped from the widget without a session cookie.
 */
export type RoomKind = 'plain' | 'presence' | 'public'

/**
 * The lens variants an inbox channel is published at (mail-permissions §6.1).
 * `none` has no channel — a `none` viewer simply isn't subscribed. The
 * residual null-inbox (`'none'` slug) channel only exists at `full` and is
 * admin-only.
 */
export type ChannelLens = 'metadata' | 'subject' | 'full'

/** All inbox channel lens variants, ascending. */
export const CHANNEL_LENSES: readonly ChannelLens[] = ['metadata', 'subject', 'full']

const INBOX_ROOM_RE = /^org-(.+)-inbox-(.+)-(metadata|subject|full)$/

/** Parsed shape of a per-lens inbox room key. */
export interface InboxRoomKey {
  organizationId: string
  /** Raw inbox UUID, or `'none'` for residual null-inbox threads. */
  inboxSlug: string
  lens: ChannelLens
}

/** Parse `org-{org}-inbox-{slug}-{lens}` into its parts, or null. */
export function parseInboxRoomKey(roomKey: string): InboxRoomKey | null {
  const match = INBOX_ROOM_RE.exec(roomKey)
  if (!match) return null
  return { organizationId: match[1], inboxSlug: match[2], lens: match[3] as ChannelLens }
}

/** Typed helpers to build room keys. Mirrored on `rooms` for server callers. */
export const rooms = {
  /** Org-wide events (records, agents, mail batches outside an inbox). */
  orgEvents: (organizationId: string): string => `org-${organizationId}-events`,
  /** Org presence room (member online/idle). */
  orgPresence: (organizationId: string): string => `org-${organizationId}`,
  /**
   * Per-inbox per-lens channel (mail-permissions §6.1). `inboxSlug` is the raw
   * inbox UUID, or `'none'` for residual null-inbox threads (admin-only,
   * published at `full` only). Viewers subscribe to exactly their own lens
   * variant; the server publishes a redacted payload per variant.
   */
  orgInbox: (organizationId: string, inboxSlug: string, lens: ChannelLens): string =>
    `org-${organizationId}-inbox-${inboxSlug}-${lens}`,
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
  // Widget visitor session — raw public Pusher channel, no auth signing. The
  // widget connects with `connectPusher` (non-private), so the server must
  // publish to the same raw channel name.
  if (roomKey.startsWith('chat-')) return 'public'
  if (roomKey.startsWith('visitor-')) return 'plain'
  return null
}

/** Map a room key to its Pusher channel name. */
export function toPusherChannel(roomKey: string): string | null {
  const kind = roomKindFor(roomKey)
  if (!kind) return null
  if (kind === 'presence') return `presence-${roomKey}`
  if (kind === 'public') return roomKey
  return `private-${roomKey}`
}

/** Strip the Pusher prefix to recover the room key. */
export function fromPusherChannel(channelName: string): string | null {
  if (channelName.startsWith('private-')) return channelName.slice('private-'.length)
  if (channelName.startsWith('presence-')) return channelName.slice('presence-'.length)
  // Public channel — channel name and room key are the same.
  if (roomKindFor(channelName) === 'public') return channelName
  return null
}

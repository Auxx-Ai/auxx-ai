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

import type { Lens } from '../permissions/visibility/lens'

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
 * residual null-inbox (`'none'` slug) channel only exists at `read` and is
 * admin-only.
 *
 * **Derived from {@link Lens}, not a parallel wire vocabulary** (decided in plan
 * v3/03 P3b). Renaming `subject`→`identity` and `full`→`read` changes live
 * channel NAMES, which is a deploy-time blip — clients reconnect onto the new
 * names within one page load and Pusher does not replay. That was judged cheaper
 * than the alternative: the subscribe ACL (`rooms.ts`) compares the viewer's
 * `Lens` against the channel's variant with `satisfiesRung`, and the publish
 * side shapes payloads with the same value, so a second vocabulary needs a
 * translation at exactly the seam where a mismatch delivers NOTHING and logs
 * nothing. Typing it as a narrowing of `Lens` makes that mismatch a compile
 * error instead.
 */
export type ChannelLens = Exclude<Lens, 'none'>

/** All inbox channel lens variants, ascending. */
export const CHANNEL_LENSES: readonly ChannelLens[] = ['metadata', 'identity', 'read']

const INBOX_ROOM_RE = /^org-(.+)-inbox-(.+)-(metadata|identity|read)$/

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
  const [, organizationId, inboxSlug, lens] = match
  if (!organizationId || !inboxSlug || !lens) return null
  return { organizationId, inboxSlug, lens: lens as ChannelLens }
}

/**
 * `-records-` is the carve-out marker for per-def record rooms — it keeps the
 * greedy `org-` presence matcher from swallowing them, exactly as `-inbox-`
 * and the `-events` suffix do. The org part is non-greedy so the FIRST
 * `-records-` splits the key (an org id never contains the marker; a def id
 * theoretically could).
 */
const RECORD_ROOM_RE = /^org-(.+?)-records-(.+)$/

/** Parsed shape of a per-def record room key. */
export interface RecordRoomKey {
  organizationId: string
  /** Canonical `entityDefinitionId` (CUID) or a table-backed resource slug. */
  entityDefinitionId: string
}

/** Parse `org-{org}-records-{entityDefinitionId}` into its parts, or null. */
export function parseRecordRoomKey(roomKey: string): RecordRoomKey | null {
  const match = RECORD_ROOM_RE.exec(roomKey)
  if (!match) return null
  const [, organizationId, entityDefinitionId] = match
  if (!organizationId || !entityDefinitionId) return null
  return { organizationId, entityDefinitionId }
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
   * published at `read` only). Viewers subscribe to exactly their own lens
   * variant; the server publishes a redacted payload per variant.
   */
  orgInbox: (organizationId: string, inboxSlug: string, lens: ChannelLens): string =>
    `org-${organizationId}-inbox-${inboxSlug}-${lens}`,
  /**
   * Per-entity-definition record channel (plan v3/03 §8.1). Every
   * record-family event (`record:created|updated|archived|deleted`,
   * `fieldValues:updated`, `records:invalidated`) rides the channel of the def
   * it belongs to; the ACL is `canViewEntity(defId)`. Replaces the org-wide
   * presence broadcast, which shipped raw stored field values for every def in
   * the org to every member.
   */
  orgRecords: (organizationId: string, entityDefinitionId: string): string =>
    `org-${organizationId}-records-${entityDefinitionId}`,
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
  if (/^org-.+-records-.+$/.test(roomKey)) return 'plain'
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

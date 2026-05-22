// @auxx/lib/realtime/rooms.ts

/**
 * Server-side room registry — one entry per room family declares its ACL.
 *
 * The Pusher auth route and the server publish path both dispatch through
 * `findRoom(...)`. Adding a new room family = one helper on `rooms`, one
 * `roomKindFor(...)` branch in `room-keys.ts`, and one entry here.
 *
 * Client-safe helpers (key builders, kind lookup, prefix mapping) live in
 * `./room-keys.ts` so the browser bundle never pulls in DB code.
 */

import { database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { InboxService } from '../inboxes'
import { findMemberByUser } from '../members'
import { fromPusherChannel, type RoomKind, toPusherChannel } from './room-keys'

export type { RoomKind } from './room-keys'
export { fromPusherChannel, roomKindFor, rooms, toPusherChannel } from './room-keys'

/**
 * Authorization context handed to every `authorize(...)` call.
 *
 * - `session` is non-null for authenticated users in the admin app.
 * - `visitor` is populated by widget-facing auth surfaces after a passport check.
 *   When both are null, only rooms that explicitly allow anonymous access pass.
 */
export interface AuthorizeCtx {
  session: { userId: string; organizationId: string } | null
  visitor?: { participantId: string; threadId?: string }
}

/** Registry row for one room family. */
export interface RoomDef {
  kind: RoomKind
  /** Returns true if `roomKey` belongs to this family. */
  match: (roomKey: string) => boolean
  /** Per-key ACL. Return false to deny. */
  authorize: (roomKey: string, ctx: AuthorizeCtx) => Promise<boolean> | boolean
}

const DEV = process.env.NODE_ENV === 'development'

/** True iff the session is a member of the given org (with dev-mode bypass). */
async function isOrgMember(orgId: string, ctx: AuthorizeCtx): Promise<boolean> {
  if (!ctx.session) return false
  try {
    const membership = await findMemberByUser(orgId, ctx.session.userId)
    if (membership) return true
    return DEV
  } catch {
    return DEV
  }
}

/**
 * Registry order matters — `match` is greedy, so the more-specific patterns
 * (`-inbox-`, `-events`) must come before the generic `org-` presence room.
 */
const REGISTRY: RoomDef[] = [
  // Per-inbox channel: `org-{orgId}-inbox-{inboxSlug}`
  {
    kind: 'plain',
    match: (k) => /^org-.+-inbox-.+$/.test(k),
    authorize: async (key, ctx) => {
      const parts = key.split('-inbox-')
      if (parts.length !== 2) return false
      const orgId = parts[0].replace(/^org-/, '')
      const inboxSlug = parts[1]
      if (!(await isOrgMember(orgId, ctx))) return false
      // `none` (triage / unassigned) is open to all org members.
      if (inboxSlug === 'none') return true
      try {
        const inboxService = new InboxService(database, orgId, ctx.session!.userId)
        const allowed = await inboxService.hasUserAccess(
          toRecordId('inbox', inboxSlug),
          ctx.session!.userId
        )
        return allowed || DEV
      } catch {
        return DEV
      }
    },
  },
  // Org events: `org-{orgId}-events`
  {
    kind: 'plain',
    match: (k) => /^org-.+-events$/.test(k),
    authorize: async (key, ctx) => {
      const orgId = key.replace(/^org-/, '').replace(/-events$/, '')
      return isOrgMember(orgId, ctx)
    },
  },
  // Org presence: `org-{orgId}` (must run after `-inbox-` and `-events` entries).
  {
    kind: 'presence',
    match: (k) => k.startsWith('org-') && !k.includes('-inbox-') && !k.endsWith('-events'),
    authorize: async (key, ctx) => {
      const orgId = key.replace(/^org-/, '')
      return isOrgMember(orgId, ctx)
    },
  },
  // Private user channel: `user-{userId}`
  {
    kind: 'plain',
    match: (k) => k.startsWith('user-'),
    authorize: (key, ctx) => {
      const userId = key.slice('user-'.length)
      return !!ctx.session && ctx.session.userId === userId
    },
  },
  // Chat thread (admin view): `thread-{threadId}`
  {
    kind: 'plain',
    match: (k) => k.startsWith('thread-'),
    authorize: (_key, ctx) => !!ctx.session,
  },
  // Visitor chat session (widget-side): `chat-{sessionId}`.
  //
  // The widget signs `chat-*` bindings via `/api/chat/pusher/auth` (apps/api),
  // which validates the visitor passport and populates `ctx.visitor`. This
  // surface (apps/web `/api/pusher/auth`) never populates `ctx.visitor`, so in
  // practice the predicate below collapses to "authenticated admin only" here.
  //
  // Kept in the registry on purpose: when the widget's transport eventually
  // migrates onto this codepath, the ACL row is already in place. Don't drop
  // it just because the apps/web path can't satisfy it today.
  {
    kind: 'plain',
    match: (k) => k.startsWith('chat-'),
    authorize: (_key, ctx) => !!ctx.session || !!ctx.visitor,
  },
  // Visitor cross-thread (widget-side): `visitor-{participantId}`
  {
    kind: 'plain',
    match: (k) => k.startsWith('visitor-'),
    authorize: (key, ctx) => {
      const participantId = key.slice('visitor-'.length)
      return !!ctx.visitor && ctx.visitor.participantId === participantId
    },
  },
]

/** Find the registry entry that owns `roomKey`, or `null` if unknown. */
export function findRoom(roomKey: string): RoomDef | null {
  for (const def of REGISTRY) {
    if (def.match(roomKey)) return def
  }
  return null
}

/** Convenience — resolves a Pusher channel name directly. */
export function findRoomByChannel(channelName: string): RoomDef | null {
  const key = fromPusherChannel(channelName)
  if (!key) return null
  const def = findRoom(key)
  if (!def) return null
  // Reject if the channel prefix doesn't match the registered kind.
  if (toPusherChannel(key) !== channelName) return null
  return def
}

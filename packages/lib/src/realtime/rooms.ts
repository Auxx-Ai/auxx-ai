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

import { database, Thread } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
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
 * Thread → owning org id. The mapping is immutable (a thread never changes
 * org), so results are memoized for the process lifetime.
 */
const threadOrgCache = new Map<string, string>()
async function getThreadOrgId(threadId: string): Promise<string | null> {
  const cached = threadOrgCache.get(threadId)
  if (cached) return cached
  const row = await database.query.Thread.findFirst({
    where: eq(Thread.id, threadId),
    columns: { organizationId: true },
  })
  if (!row) return null
  threadOrgCache.set(threadId, row.organizationId)
  return row.organizationId
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
      // `none` (residual null-inbox threads) is admin-only — the read path
      // treats those threads as admin+assignee only (mail-permissions
      // decision #2), so broadcasting their subjects org-wide would leak.
      // Phase 3 renames the channel; this flip aligns Phase 2.
      if (inboxSlug === 'none') {
        try {
          const { getOrgCache } = await import('../cache')
          const roleMap = await getOrgCache().get(orgId, 'memberRoleMap')
          const role = roleMap[ctx.session!.userId]
          return role === 'OWNER' || role === 'ADMIN'
        } catch {
          return DEV
        }
      }
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
  //
  // Requires membership of the thread's owning org — without this any
  // authenticated user of any org could subscribe to any thread channel.
  // Phase 3 of the mail-permissions plan tightens this to
  // `effectiveLens >= metadata`; org membership is the floor.
  {
    kind: 'plain',
    match: (k) => k.startsWith('thread-'),
    authorize: async (key, ctx) => {
      if (!ctx.session) return false
      const threadId = key.slice('thread-'.length)
      const orgId = await getThreadOrgId(threadId)
      if (!orgId) return DEV
      return isOrgMember(orgId, ctx)
    },
  },
  // Visitor chat session (widget-side): `chat-{sessionId}`.
  //
  // Public Pusher channel — the widget connects with `connectPusher` (no auth
  // signing) at bootstrap, before any session is established. Authorization is
  // moot: the channel name is unguessable (random session id) and only carries
  // the visitor's own transcript echo. Authorize hook is unreachable for
  // public channels (Pusher never asks the server to sign them) but we leave
  // the entry in the registry so `findRoom` can resolve the key.
  {
    kind: 'public',
    match: (k) => k.startsWith('chat-'),
    authorize: () => true,
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

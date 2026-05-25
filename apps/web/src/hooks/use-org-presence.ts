// apps/web/src/hooks/use-org-presence.ts
'use client'

import { type PresenceState, resolvePresence } from '@auxx/lib/presence'
import type { PresenceMember } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from '~/realtime/adapter'

/**
 * Hydrates a `userId → PresenceState` map for every member currently in the
 * org presence room. Members not in the map are absent — treat that as
 * `'offline'` at the call site (the returned `getState` helper does this).
 *
 * Subscribes via the shared `realtimeAdapter`, so multiple call sites
 * refcount onto the same Pusher channel. Stays mounted across the consumer's
 * lifetime — unmount tears the subscription down only when refcount hits zero.
 *
 * `meta.idle` arrives via two paths:
 *  - initial subscribe: Pusher delivers `user_info` from the auth route,
 *    which doesn't carry `idle` — first sample is "online" until the user's
 *    heartbeat flips them.
 *  - subsequent `member-update` events: merged into the existing meta so
 *    name/avatar info from the initial join isn't clobbered.
 */
export function useOrgPresence(): {
  /** Live map. Use `getState(userId)` for the safe lookup. */
  map: Record<string, PresenceState>
  /** Convenience: returns `'offline'` for unknown users. */
  getState: (userId: string | null | undefined) => PresenceState
} {
  const { organizationId } = useUser()
  const [members, setMembers] = useState<Map<string, PresenceMember>>(() => new Map())

  useEffect(() => {
    if (!organizationId) {
      setMembers((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    const roomKey = rooms.orgPresence(organizationId)
    const sub = realtimeAdapter.subscribePresence(
      roomKey,
      // `self` is informational — Pusher derives the real self from the auth
      // response. Empty meta keeps payload small.
      { id: 'self', meta: {} },
      {
        onMembers: (list) => {
          setMembers(new Map(list.map((m) => [m.id, m])))
        },
        onJoin: (m) => {
          setMembers((prev) => {
            const next = new Map(prev)
            next.set(m.id, m)
            return next
          })
        },
        onLeave: (id) => {
          setMembers((prev) => {
            if (!prev.has(id)) return prev
            const next = new Map(prev)
            next.delete(id)
            return next
          })
        },
        onMemberUpdate: (m) => {
          setMembers((prev) => {
            const existing = prev.get(m.id)
            const next = new Map(prev)
            next.set(m.id, {
              id: m.id,
              meta: { ...(existing?.meta ?? {}), ...(m.meta ?? {}) },
            })
            return next
          })
        },
      }
    )
    return () => {
      sub.unsubscribe()
    }
  }, [organizationId])

  const map = useMemo(() => {
    const out: Record<string, PresenceState> = {}
    for (const [id, m] of members) {
      out[id] = resolvePresence({ subscribed: true, idle: m.meta?.idle === true })
    }
    return out
  }, [members])

  const getState = useMemo(() => {
    return (userId: string | null | undefined): PresenceState => {
      if (!userId) return 'offline'
      return map[userId] ?? 'offline'
    }
  }, [map])

  return { map, getState }
}

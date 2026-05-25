// apps/web/src/hooks/use-org-presence.ts
'use client'

import { type PresenceState, resolvePresence } from '@auxx/lib/presence'
import type { PresenceMember } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from '~/realtime/adapter'

/**
 * Module-level presence store, keyed by orgId. Lives outside React so that
 * every consumer reads the same map — `useSyncExternalStore` makes each
 * component a subscriber and avoids the per-component `useState` problem
 * where one mount receives `onMembers` and another never does.
 */
interface PresenceStore {
  members: Map<string, PresenceMember>
  listeners: Set<() => void>
  refCount: number
  unsub?: () => void
}

const presenceStores = new Map<string, PresenceStore>()
const EMPTY_MEMBERS: ReadonlyMap<string, PresenceMember> = new Map()
const noopUnsub = () => {}

function getOrCreateStore(orgId: string): PresenceStore {
  let store = presenceStores.get(orgId)
  if (!store) {
    store = { members: new Map(), listeners: new Set(), refCount: 0 }
    presenceStores.set(orgId, store)
  }
  return store
}

function notify(store: PresenceStore) {
  for (const l of store.listeners) l()
}

function ensureSubscribed(orgId: string, store: PresenceStore) {
  if (store.unsub) return
  const roomKey = rooms.orgPresence(orgId)
  const sub = realtimeAdapter.subscribePresence(
    roomKey,
    { id: 'self', meta: {} },
    {
      onMembers: (list) => {
        store.members = new Map(list.map((m) => [m.id, m]))
        notify(store)
      },
      onJoin: (m) => {
        store.members = new Map(store.members).set(m.id, m)
        notify(store)
      },
      onLeave: (id) => {
        if (!store.members.has(id)) return
        const next = new Map(store.members)
        next.delete(id)
        store.members = next
        notify(store)
      },
      onMemberUpdate: (m) => {
        const existing = store.members.get(m.id)
        const next = new Map(store.members)
        next.set(m.id, { id: m.id, meta: { ...(existing?.meta ?? {}), ...(m.meta ?? {}) } })
        store.members = next
        notify(store)
      },
    }
  )
  store.unsub = () => sub.unsubscribe()
}

/**
 * Ensures the org presence channel is subscribed for as long as the calling
 * component is mounted. Ref-counted: multiple callers across the tree share
 * one Pusher channel and one store. Shared by `useOrgPresence` (readers) and
 * `usePresenceHeartbeat` (writes idle flag) so they don't open two parallel
 * subscriptions to the same room.
 */
export function usePresenceSubscription(orgId: string | null | undefined): void {
  useEffect(() => {
    if (!orgId) return
    const store = getOrCreateStore(orgId)
    store.refCount += 1
    ensureSubscribed(orgId, store)
    return () => {
      store.refCount -= 1
      if (store.refCount <= 0) {
        store.unsub?.()
        store.unsub = undefined
        store.members = new Map()
      }
    }
  }, [orgId])
}

/**
 * Returns `getState(userId)` for the org presence room. Members not in the
 * roster resolve to `'offline'`.
 *
 * `meta.idle` arrives via two paths:
 *  - initial subscribe: Pusher delivers `user_info` from the auth route,
 *    which doesn't carry `idle` — first sample is "online" until the user's
 *    heartbeat flips them.
 *  - subsequent `member-update` events: merged into the existing meta so
 *    name/avatar info from the initial join isn't clobbered.
 */
export function useOrgPresence(): {
  getState: (userId: string | null | undefined) => PresenceState
} {
  const { organizationId } = useUser()
  usePresenceSubscription(organizationId)

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!organizationId) return noopUnsub
      const store = getOrCreateStore(organizationId)
      store.listeners.add(callback)
      return () => {
        store.listeners.delete(callback)
      }
    },
    [organizationId]
  )

  const getSnapshot = useCallback(() => {
    if (!organizationId) return EMPTY_MEMBERS
    return getOrCreateStore(organizationId).members
  }, [organizationId])

  const members = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MEMBERS)

  const getState = useCallback(
    (userId: string | null | undefined): PresenceState => {
      if (!userId) return 'offline'
      const m = members.get(userId)
      if (!m) return 'offline'
      return resolvePresence({ subscribed: true, idle: m.meta?.idle === true })
    },
    [members]
  )

  return { getState }
}

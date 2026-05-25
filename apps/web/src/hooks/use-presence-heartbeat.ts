// apps/web/src/hooks/use-presence-heartbeat.ts
'use client'

import { PRESENCE_IDLE_MS } from '@auxx/lib/presence'
import { rooms } from '@auxx/lib/realtime/client'
import { useEffect } from 'react'
import { usePresenceSubscription } from '~/hooks/use-org-presence'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from '~/realtime/adapter'

/**
 * Mount-once tracker that flips the current user's `meta.idle` flag on the
 * org presence room when the tab is hidden or interaction stalls past
 * `PRESENCE_IDLE_MS`.
 *
 * Subscription itself is delegated to `usePresenceSubscription` — shared with
 * `useOrgPresence` consumers via ref-counting, so the channel stays alive
 * regardless of which surface (sidebar nav, embed view) is mounted.
 *
 * Only emits on edge transitions — mouse-jiggling while already-active is a
 * no-op. On tab close / network drop, Pusher's connection drops and the
 * `pusher:member_removed` event handles "offline"; no explicit "going
 * offline" message is needed.
 */
export function usePresenceHeartbeat(): void {
  const { organizationId } = useUser()
  usePresenceSubscription(organizationId)

  useEffect(() => {
    if (!organizationId || typeof window === 'undefined') return
    const roomKey = rooms.orgPresence(organizationId)

    let isIdle: boolean | null = null
    let lastInteraction = Date.now()

    const flip = (next: boolean) => {
      if (next === isIdle) return
      isIdle = next
      void realtimeAdapter.updateSelf(roomKey, { idle: next })
    }

    const recompute = () => {
      flip(document.hidden || Date.now() - lastInteraction > PRESENCE_IDLE_MS)
    }

    const onActivity = () => {
      lastInteraction = Date.now()
      if (isIdle !== false) recompute()
    }

    const onVisibility = () => {
      if (!document.hidden) lastInteraction = Date.now()
      recompute()
    }

    // Initial sample so other clients see "online" right after subscribe.
    recompute()

    // Poll every 5s for the online → away transition. mousemove/keydown handle
    // the reverse direction (away → online) immediately.
    const timer = setInterval(recompute, 5_000)

    // `passive: true` keeps these listeners off the scrolling critical path.
    document.addEventListener('mousemove', onActivity, { passive: true })
    document.addEventListener('keydown', onActivity, { passive: true })
    document.addEventListener('click', onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(timer)
      document.removeEventListener('mousemove', onActivity)
      document.removeEventListener('keydown', onActivity)
      document.removeEventListener('click', onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [organizationId])
}

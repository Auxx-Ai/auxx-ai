// apps/web/src/hooks/use-presence-heartbeat.ts
'use client'

import { PRESENCE_IDLE_MS } from '@auxx/lib/presence'
import { rooms } from '@auxx/lib/realtime/client'
import { useEffect } from 'react'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from '~/realtime/adapter'

/**
 * Mount-once tracker that flips the current user's `meta.idle` flag on the
 * org presence room when the tab is hidden or interaction stalls past
 * `PRESENCE_IDLE_MS`.
 *
 * Only emits on edge transitions — mouse-jiggling while already-active is a
 * no-op. On tab close / network drop, Pusher's connection drops and the
 * `pusher:member_removed` event handles "offline" via the presence channel;
 * no explicit "going offline" message is needed.
 */
export function usePresenceHeartbeat(): void {
  const { organizationId } = useUser()

  useEffect(() => {
    if (!organizationId || typeof window === 'undefined') return
    const roomKey = rooms.orgPresence(organizationId)

    // Subscribing puts this user in the presence channel's member list — every
    // other admin watching the room will see them via `pusher:member_added`.
    // Without this, `updateSelf` would still publish member-update events but
    // the user would never have joined, so observers wouldn't track them.
    // Refcounted with `useOrgPresence` consumers, so this is cheap.
    const sub = realtimeAdapter.subscribePresence(roomKey, { id: 'self', meta: {} }, {})

    let isIdle: boolean | null = null
    let lastInteraction = Date.now()
    let timer: ReturnType<typeof setInterval> | null = null

    const flip = (next: boolean) => {
      if (next === isIdle) return
      isIdle = next
      // Fire-and-forget — the adapter's `updateSelf` already swallows errors.
      void realtimeAdapter.updateSelf(roomKey, { idle: next })
    }

    const recompute = () => {
      const idle = document.hidden || Date.now() - lastInteraction > PRESENCE_IDLE_MS
      flip(idle)
    }

    const onActivity = () => {
      lastInteraction = Date.now()
      // Cheap path — if we're already not-idle, this is a no-op.
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
    timer = setInterval(recompute, 5_000)

    // `passive: true` keeps these listeners off the scrolling critical path.
    document.addEventListener('mousemove', onActivity, { passive: true })
    document.addEventListener('keydown', onActivity, { passive: true })
    document.addEventListener('click', onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('mousemove', onActivity)
      document.removeEventListener('keydown', onActivity)
      document.removeEventListener('click', onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      sub.unsubscribe()
    }
  }, [organizationId])
}

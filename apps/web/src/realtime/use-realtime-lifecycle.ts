// ~/realtime/use-realtime-lifecycle.ts

'use client'

import { useEffect, useRef } from 'react'
import { useUser } from '~/hooks/use-user'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { realtimeAdapter } from './adapter'

/**
 * Drives the realtime adapter lifecycle based on auth state.
 * Mount once in the app layout. Renders nothing.
 *
 * On org change, tears down every room tied to the old org so the new org's
 * subscriptions don't bleed through the refcount store. Mirrors the legacy
 * `subscribeToOrg`-side cleanup that the old adapter did inline.
 */
export function useRealtimeLifecycle() {
  const { user, organizationId } = useUser()
  const { pusher: config } = useEnv()
  const previousOrgRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !organizationId) {
      realtimeAdapter.disconnect()
      previousOrgRef.current = null
      return
    }

    realtimeAdapter.connect({
      key: config.key,
      cluster: config.cluster,
      authEndpoint: '/api/pusher/auth',
      wsHost: config.wsHost,
      wsPort: config.wsPort,
      forceTLS: config.forceTLS,
    })

    // Org switch: tear down every room scoped to the previous org.
    //
    // Includes:
    //   - `org-{oldOrgId}` (org presence)
    //   - `org-{oldOrgId}-*` (org events, per-inbox channels)
    //   - `thread-*` (chat threads are org-scoped — a thread belongs to one
    //     org, so the previous org's thread subscriptions must be dropped)
    //
    // Intentionally excluded: `user-{userId}` — the same user crosses orgs,
    // so their private user channel stays bound across org switches.
    //
    // Hook-level subscriptions (useOrgChannel, useInboxChannels, thread hooks)
    // will re-subscribe on the next render with the new org id.
    if (previousOrgRef.current && previousOrgRef.current !== organizationId) {
      const stale = previousOrgRef.current
      const stalePrefix = `org-${stale}`
      realtimeAdapter.unsubscribeMatching(
        (key) =>
          key === stalePrefix || key.startsWith(`${stalePrefix}-`) || key.startsWith('thread-')
      )
    }
    previousOrgRef.current = organizationId

    return () => {
      realtimeAdapter.disconnect()
      previousOrgRef.current = null
    }
  }, [user, organizationId, config.key, config.cluster])
}

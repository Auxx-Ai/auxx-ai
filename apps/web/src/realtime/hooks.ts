// ~/realtime/hooks.ts

'use client'

import type { ChannelSubscription } from '@auxx/lib/realtime/client'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from './adapter'

/** Subscribe to the org channel. Re-renders only when channel reference changes. */
export function useOrgChannel(): ChannelSubscription | null {
  return useSyncExternalStore(
    realtimeAdapter.subscribeToOrgChannel,
    realtimeAdapter.getOrgChannelSnapshot,
    realtimeAdapter.getServerOrgChannelSnapshot
  )
}

/** Subscribe to connection state. Re-renders only on connect/disconnect. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    realtimeAdapter.subscribeToConnection,
    realtimeAdapter.getConnectionSnapshot,
    realtimeAdapter.getServerConnectionSnapshot
  )
}

/** Non-reactive read of current socket ID (for headers, not rendering). */
export function getRealtimeSocketId(): string | undefined {
  return realtimeAdapter.getSocketId()
}

/**
 * Subscribe to a single inbox channel by slug. Pass `'none'` for the
 * unassigned-triage channel. The hook reference-counts subscriptions so
 * multiple components can call it safely.
 *
 * Returns the channel once subscription is established, or null while pending.
 */
export function useInboxChannel(inboxSlug: string | null | undefined): ChannelSubscription | null {
  const { organizationId } = useUser()

  useEffect(() => {
    if (!organizationId || !inboxSlug) return
    realtimeAdapter.subscribeToInbox(organizationId, inboxSlug)
    return () => {
      realtimeAdapter.unsubscribeFromInbox(organizationId, inboxSlug)
    }
  }, [organizationId, inboxSlug])

  const getSnapshot = useCallback(
    () => (inboxSlug ? realtimeAdapter.getInboxChannelSnapshot(inboxSlug) : null),
    [inboxSlug]
  )
  const getServerSnapshot = useCallback(
    () => (inboxSlug ? realtimeAdapter.getServerInboxChannelSnapshot(inboxSlug) : null),
    [inboxSlug]
  )
  return useSyncExternalStore(
    realtimeAdapter.subscribeToInboxChannels,
    getSnapshot,
    getServerSnapshot
  )
}

/**
 * Subscribe to many inbox channels at once. Manages add/remove based on the
 * given slugs and notifies React on any change. Returns the adapter's full
 * inbox-channel map snapshot (stable until membership changes).
 *
 * Always include `'none'` in the slug set if you want unassigned-triage events.
 */
export function useInboxChannels(
  slugs: readonly string[]
): ReadonlyMap<string, ChannelSubscription> {
  const { organizationId } = useUser()

  // Stable comma-joined key so the effect only re-runs when the slug set changes.
  const slugKey = [...slugs].sort().join(',')

  useEffect(() => {
    if (!organizationId) return
    const list = slugKey ? slugKey.split(',') : []
    for (const slug of list) {
      realtimeAdapter.subscribeToInbox(organizationId, slug)
    }
    return () => {
      for (const slug of list) {
        realtimeAdapter.unsubscribeFromInbox(organizationId, slug)
      }
    }
  }, [organizationId, slugKey])

  return useSyncExternalStore(
    realtimeAdapter.subscribeToInboxChannels,
    realtimeAdapter.getInboxChannelMapSnapshot,
    realtimeAdapter.getServerInboxChannelMapSnapshot
  )
}

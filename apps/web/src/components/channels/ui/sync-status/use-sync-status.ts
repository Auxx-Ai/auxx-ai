// apps/web/src/components/channels/ui/sync-status/use-sync-status.ts

'use client'

import { useEffect } from 'react'
import {
  useAuthErrorChannels,
  useChannelsLoading,
  useSyncingChannels,
} from '../../hooks/use-channels'
import { useSyncDockStore } from '../../store/sync-dock-store'

/** Channels the sync status surfaces; `visible` is false when nothing is syncing or needs login. */
export function useSyncStatus() {
  const syncing = useSyncingChannels()
  const authErrors = useAuthErrorChannels()
  return { syncing, authErrors, visible: syncing.length + authErrors.length > 0 }
}

/**
 * Keeps the dock state honest: resets once there is nothing to show, and pops the card
 * back out when a channel that wasn't failing at dock time starts needing login.
 * Mount exactly once.
 */
export function useSyncDockRules() {
  const { visible, authErrors } = useSyncStatus()
  const isLoading = useChannelsLoading()

  useEffect(() => {
    // Before the first load the lists are empty, which would reset a persisted dock.
    if (isLoading) return
    const { phase, dockedAuthIds, reset, undock } = useSyncDockStore.getState()
    if (!visible) {
      if (phase !== 'floating') reset()
      return
    }
    if (phase === 'docked' && authErrors.some((c) => !dockedAuthIds.includes(c.id))) undock()
  }, [isLoading, visible, authErrors])
}

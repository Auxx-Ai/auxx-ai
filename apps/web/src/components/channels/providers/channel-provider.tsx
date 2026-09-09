// apps/web/src/components/channels/providers/channel-provider.tsx

'use client'

import { useEffect } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { getChannelStoreState, useChannelStore } from '../store/channel-store'
import { SyncStatusToastManager } from '../ui/sync-status-toast'

export function ChannelProvider({ children }: { children: React.ReactNode }) {
  const hasSyncing = useChannelStore((state) => state.syncingChannels.length > 0)
  const { can } = useAccess()

  // Two legitimate reasons to hold the org's channel list, and a member with
  // NEITHER should not be fetching it: mail (the composer's From picker reads
  // this store) and channel administration in settings. This provider mounts
  // app-wide, so an ungated query handed the list to every member on every page
  // — which is why an outside bookkeeper could open Compose and see the org's
  // channels as send-from options.
  const canLoadChannels = can('inboxes.view') || can('channels.view')

  const channelsQuery = api.channel.list.useQuery(undefined, {
    enabled: canLoadChannels,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: hasSyncing ? 5000 : false,
  })

  useEffect(() => {
    if (channelsQuery.data) {
      getChannelStoreState().setChannels(channelsQuery.data.channels)
    }
  }, [channelsQuery.data])

  useEffect(() => {
    getChannelStoreState().setLoading(channelsQuery.isLoading)
  }, [channelsQuery.isLoading])

  return (
    <>
      <SyncStatusToastManager />
      {children}
    </>
  )
}

export function clearChannelCaches() {
  getChannelStoreState().reset()
}

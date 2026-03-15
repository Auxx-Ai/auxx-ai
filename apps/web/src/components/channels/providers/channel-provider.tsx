// apps/web/src/components/channels/providers/channel-provider.tsx

'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { getChannelStoreState, useChannelStore } from '../store/channel-store'
import { SyncStatusToastManager } from '../ui/sync-status-toast'

export function ChannelProvider({ children }: { children: React.ReactNode }) {
  const hasSyncing = useChannelStore((state) => state.syncingChannels.length > 0)

  const channelsQuery = api.channel.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: hasSyncing ? 5000 : false,
  })

  useEffect(() => {
    if (channelsQuery.data) {
      getChannelStoreState().setChannels(channelsQuery.data.integrations)
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

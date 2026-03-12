// apps/web/src/components/channels/hooks/use-channels.ts

import { type Channel, useChannelStore } from '../store/channel-store'

/** Get a single channel by ID */
export function useChannel(channelId: string | undefined): Channel | undefined {
  return useChannelStore((state) => (channelId ? state.channelMap.get(channelId) : undefined))
}

/** Get all channels */
export function useChannels(): Channel[] {
  return useChannelStore((state) => state.channels)
}

/** Get channels that are currently syncing (pre-computed, stable reference) */
export function useSyncingChannels(): Channel[] {
  return useChannelStore((state) => state.syncingChannels)
}

/** Check if channels are loading */
export function useChannelsLoading(): boolean {
  return useChannelStore((state) => state.isLoading)
}

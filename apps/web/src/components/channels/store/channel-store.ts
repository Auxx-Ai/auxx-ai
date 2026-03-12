// apps/web/src/components/channels/store/channel-store.ts

import { create } from 'zustand'
import type { RouterOutputs } from '~/server/api/root'

export type Channel = RouterOutputs['channel']['list']['integrations'][number]

const EMPTY_CHANNELS: Channel[] = []

interface ChannelStoreState {
  channels: Channel[]
  channelMap: Map<string, Channel>
  syncingChannels: Channel[]
  isLoading: boolean

  setChannels: (channels: Channel[]) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useChannelStore = create<ChannelStoreState>((set) => ({
  channels: EMPTY_CHANNELS,
  channelMap: new Map(),
  syncingChannels: EMPTY_CHANNELS,
  isLoading: true,

  setChannels: (channels) => {
    const syncing = channels.filter((c) => c.syncStatus === 'SYNCING')
    set({
      channels,
      channelMap: new Map(channels.map((c) => [c.id, c])),
      syncingChannels: syncing.length > 0 ? syncing : EMPTY_CHANNELS,
    })
  },
  setLoading: (isLoading) => set({ isLoading }),
  reset: () =>
    set({
      channels: EMPTY_CHANNELS,
      channelMap: new Map(),
      syncingChannels: EMPTY_CHANNELS,
      isLoading: true,
    }),
}))

export function getChannelStoreState() {
  return useChannelStore.getState()
}

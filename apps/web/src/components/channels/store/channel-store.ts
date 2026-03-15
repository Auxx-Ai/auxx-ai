// apps/web/src/components/channels/store/channel-store.ts

import { create } from 'zustand'
import { getIntegrationStatus } from '~/components/global/integration-status-utils'
import type { RouterOutputs } from '~/server/api/root'

export type Channel = RouterOutputs['channel']['list']['integrations'][number]

const EMPTY_CHANNELS: Channel[] = []

interface ChannelStoreState {
  channels: Channel[]
  channelMap: Map<string, Channel>
  syncingChannels: Channel[]
  authErrorChannels: Channel[]
  isLoading: boolean

  setChannels: (channels: Channel[]) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useChannelStore = create<ChannelStoreState>((set) => ({
  channels: EMPTY_CHANNELS,
  channelMap: new Map(),
  syncingChannels: EMPTY_CHANNELS,
  authErrorChannels: EMPTY_CHANNELS,
  isLoading: true,

  setChannels: (channels) => {
    const syncing: Channel[] = []
    const authError: Channel[] = []
    for (const c of channels) {
      const status = getIntegrationStatus(c)
      if (status === 'syncing') syncing.push(c)
      else if (status === 'auth_error') authError.push(c)
    }
    set({
      channels,
      channelMap: new Map(channels.map((c) => [c.id, c])),
      syncingChannels: syncing.length > 0 ? syncing : EMPTY_CHANNELS,
      authErrorChannels: authError.length > 0 ? authError : EMPTY_CHANNELS,
    })
  },
  setLoading: (isLoading) => set({ isLoading }),
  reset: () =>
    set({
      channels: EMPTY_CHANNELS,
      channelMap: new Map(),
      syncingChannels: EMPTY_CHANNELS,
      authErrorChannels: EMPTY_CHANNELS,
      isLoading: true,
    }),
}))

export function getChannelStoreState() {
  return useChannelStore.getState()
}

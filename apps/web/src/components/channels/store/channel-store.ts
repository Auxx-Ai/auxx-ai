// apps/web/src/components/channels/store/channel-store.ts

import { type ChannelSelectionScope, canStartOutbound } from '@auxx/lib/channels/client'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { getIntegrationStatus } from '~/components/global/integration-status-utils'
import type { RouterOutputs } from '~/server/api/root'

export type Channel = RouterOutputs['channel']['list']['channels'][number]

const EMPTY_CHANNELS: Channel[] = []

/**
 * Providers held back from every send surface regardless of what the capability
 * map says.
 *
 * `imap` declares `newOutbound: true` (channels/capabilities.ts) and
 * `canSend: true` (provider-capabilities.ts), but has been excluded from the
 * send lists since `getEmailClients()` — IMAP is a receive protocol and sending
 * needs SMTP. Neither capability flag has been verified against a live IMAP
 * channel, so this stays a carve-out rather than a flip of the maps. One named
 * constant instead of a hand-kept allowlist: when someone confirms IMAP send
 * works, this is the single line to delete.
 */
const LEGACY_SEND_EXCLUDED = new Set(['imap'])

function isSendable(provider: string, scope: ChannelSelectionScope): boolean {
  return !LEGACY_SEND_EXCLUDED.has(provider) && canStartOutbound(provider, scope)
}

const MESSAGING_PROVIDERS = new Set([
  'facebook',
  'instagram',
  'openphone',
  'sms',
  'whatsapp',
  'chat',
])

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

/** Channels whose provider can send email (excludes IMAP — see `LEGACY_SEND_EXCLUDED`). */
export const useEmailChannels = () =>
  useChannelStore(useShallow((s) => s.channels.filter((c) => isSendable(c.provider, 'email'))))

/**
 * Channels a human can start a NEW conversation on — email **and** phone.
 *
 * This is what the composer's From picker reads. Capability-derived rather
 * than a hand-kept list: the old hardcoded `EMAIL_PROVIDERS` set is why a
 * connected Quo/SMS channel could never be selected, which in turn made every
 * `recipientModel === 'phone'` branch in the composer unreachable.
 */
export const useSendableChannels = (scope: ChannelSelectionScope = 'addressable') =>
  useChannelStore(useShallow((s) => s.channels.filter((c) => isSendable(c.provider, scope))))

/** Channels whose provider is messaging (chat, social DMs, SMS). */
export const useMessagingChannels = () =>
  useChannelStore(useShallow((s) => s.channels.filter((c) => MESSAGING_PROVIDERS.has(c.provider))))

/** Single-channel lookup by id. */
export const useChannelById = (id: string | undefined) =>
  useChannelStore((s) => (id ? s.channelMap.get(id) : undefined))

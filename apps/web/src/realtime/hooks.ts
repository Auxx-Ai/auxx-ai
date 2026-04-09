// ~/realtime/hooks.ts

'use client'

import type { ChannelSubscription } from '@auxx/lib/realtime/client'
import { useSyncExternalStore } from 'react'
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

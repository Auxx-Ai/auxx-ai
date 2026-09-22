// apps/web/src/components/channels/ui/sync-status/sync-status-shared.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Loader2, Mail } from 'lucide-react'
import { formatSyncStage } from '~/components/global/integration-status-utils'
import { useChannelReconnect } from '../../hooks/use-channel-reconnect'
import type { Channel } from '../../store/channel-store'

// Timings and easing mirror the chat widget's launcher↔panel morph (packages/chat/src/styles.css).
export const DOCK_DURATION = 280
export const DOCK_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
export const DOCK_FADE_OUT = 120

interface Counts {
  syncCount: number
  authCount: number
}

export function SyncStatusIcon({ syncCount }: Counts) {
  if (syncCount > 0) return <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
  return <AlertTriangle className='h-4 w-4 text-amber-500' />
}

export function SyncStatusHeaderText({ syncCount, authCount }: Counts) {
  const syncLabel = syncCount === 1 ? '1 channel' : `${syncCount} channels`
  const authLabel = authCount === 1 ? '1 needs login' : `${authCount} need login`

  if (syncCount > 0 && authCount > 0) {
    return (
      <>
        Syncing {syncLabel} &middot; {authLabel}
      </>
    )
  }
  if (syncCount > 0) return <>Syncing {syncLabel}</>
  return <>{authCount === 1 ? '1 channel needs login' : `${authCount} channels need login`}</>
}

/** Label + badge for the docked sidebar row; auth errors outrank syncing. */
export function getCompactStatus({ syncCount, authCount }: Counts) {
  return authCount > 0
    ? { label: 'Channel login needed', count: authCount }
    : { label: 'Syncing channels', count: syncCount }
}

/** Individual channel sync item in the expanded view */
export function SyncChannelItem({ channel }: { channel: Channel }) {
  const displayName = channel.email || channel.name || 'Unknown channel'
  const stage = channel.syncStage
  const statusText = stage ? formatSyncStage(stage, channel.pendingImportCount) : 'Syncing...'

  return (
    <div className='flex items-center gap-2 px-3 py-2 border-b last:border-b-0'>
      <Mail className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
      <div className='flex-1 min-w-0'>
        <div className='text-xs font-medium truncate'>{displayName}</div>
        <div className='text-xs text-muted-foreground'>{statusText}</div>
      </div>
    </div>
  )
}

/** Individual channel auth-error item in the expanded view */
export function ReauthChannelItem({ channel }: { channel: Channel }) {
  const { reconnect, pending, Dialogs } = useChannelReconnect()

  return (
    <div className='flex items-center gap-2 px-3 py-2 border-b last:border-b-0'>
      <AlertTriangle className='h-3.5 w-3.5 text-amber-500 shrink-0' />
      <div className='flex-1 min-w-0'>
        <div className='text-xs font-medium truncate'>
          {channel.email || channel.name || 'Unknown channel'}
        </div>
        <div className='text-xs text-amber-600'>Login expired</div>
      </div>
      <Button
        variant='outline'
        size='xs'
        onClick={() => reconnect(channel.id)}
        loading={pending}
        loadingText='...'>
        Reconnect
      </Button>
      {Dialogs}
    </div>
  )
}

// apps/web/src/components/channels/ui/sync-status-toast.tsx

'use client'

import { ChevronDown, ChevronUp, Loader2, Mail, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast as sonnerToast } from 'sonner'
import { formatSyncStage } from '~/components/global/integration-status-utils'
import { useSyncingChannels } from '../hooks/use-channels'
import type { Channel } from '../store/channel-store'

const SYNC_TOAST_ID = 'channel-sync-progress'

/**
 * Renderless component that manages the sync status toast lifecycle.
 * Reads syncing channels from store and shows/updates/dismisses the Sonner toast.
 */
export function SyncStatusToastManager() {
  const syncingChannels = useSyncingChannels()
  const prevCountRef = useRef(0)

  useEffect(() => {
    if (syncingChannels.length > 0) {
      sonnerToast.custom(
        (id) => (
          <SyncStatusToastContent
            channels={syncingChannels}
            onDismiss={() => sonnerToast.dismiss(id)}
          />
        ),
        {
          id: SYNC_TOAST_ID,
          duration: Infinity,
          position: 'bottom-right',
        }
      )
    } else if (prevCountRef.current > 0) {
      // All syncs completed — dismiss
      sonnerToast.dismiss(SYNC_TOAST_ID)
    }

    prevCountRef.current = syncingChannels.length
  }, [syncingChannels])

  return null
}

/**
 * The visual toast content rendered inside Sonner's toast.custom().
 */
function SyncStatusToastContent({
  channels,
  onDismiss,
}: {
  channels: Channel[]
  onDismiss: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const count = channels.length
  const label = count === 1 ? '1 channel' : `${count} channels`

  return (
    <div className='w-80 rounded-lg border bg-background shadow-lg'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2.5'>
        <div className='flex items-center gap-2'>
          <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
          <span className='text-sm font-medium'>Syncing {label}</span>
        </div>
        <div className='flex items-center gap-0.5'>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='p-1 rounded hover:bg-muted'
            aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? (
              <ChevronDown className='h-3.5 w-3.5 text-muted-foreground' />
            ) : (
              <ChevronUp className='h-3.5 w-3.5 text-muted-foreground' />
            )}
          </button>
          <button onClick={onDismiss} className='p-1 rounded hover:bg-muted' aria-label='Dismiss'>
            <X className='h-3.5 w-3.5 text-muted-foreground' />
          </button>
        </div>
      </div>

      {/* Expanded channel list */}
      {isExpanded && channels.length > 0 && (
        <div className='border-t max-h-48 overflow-y-auto'>
          {channels.map((channel) => (
            <SyncChannelItem key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Individual channel sync item in the expanded view */
function SyncChannelItem({ channel }: { channel: Channel }) {
  const displayName = channel.email || channel.name || 'Unknown channel'
  const stage = channel.syncStage
  const pending = channel.pendingImportCount

  let statusText = 'Syncing...'
  if (stage) {
    statusText = formatSyncStage(stage)
    if (stage === 'MESSAGES_IMPORT' && pending > 0) {
      statusText += ` (${pending.toLocaleString()} remaining)`
    }
  }

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

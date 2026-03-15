// apps/web/src/components/channels/ui/sync-status-toast.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Mail, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast as sonnerToast } from 'sonner'
import { formatSyncStage } from '~/components/global/integration-status-utils'
import { api } from '~/trpc/react'
import { useAuthErrorChannels, useSyncingChannels } from '../hooks/use-channels'
import type { Channel } from '../store/channel-store'

const SYNC_TOAST_ID = 'channel-sync-progress'

/**
 * Renderless component that manages the sync status toast lifecycle.
 * Reads syncing channels and auth-error channels from store and shows/updates/dismisses the Sonner toast.
 */
export function SyncStatusToastManager() {
  const syncingChannels = useSyncingChannels()
  const authErrorChannels = useAuthErrorChannels()
  const totalCount = syncingChannels.length + authErrorChannels.length
  const prevCountRef = useRef(0)

  useEffect(() => {
    if (totalCount > 0) {
      sonnerToast.custom(
        (id) => (
          <SyncStatusToastContent
            syncingChannels={syncingChannels}
            authErrorChannels={authErrorChannels}
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
      sonnerToast.dismiss(SYNC_TOAST_ID)
    }

    prevCountRef.current = totalCount
  }, [syncingChannels, authErrorChannels, totalCount])

  return null
}

/**
 * The visual toast content rendered inside Sonner's toast.custom().
 */
function SyncStatusToastContent({
  syncingChannels,
  authErrorChannels,
  onDismiss,
}: {
  syncingChannels: Channel[]
  authErrorChannels: Channel[]
  onDismiss: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const syncCount = syncingChannels.length
  const authCount = authErrorChannels.length

  return (
    <div className='w-80 rounded-lg border bg-background shadow-lg'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2.5'>
        <div className='flex items-center gap-2'>
          <ToastHeaderIcon syncCount={syncCount} authCount={authCount} />
          <span className='text-sm font-medium'>
            <ToastHeaderText syncCount={syncCount} authCount={authCount} />
          </span>
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
      {isExpanded && (syncingChannels.length > 0 || authErrorChannels.length > 0) && (
        <div className='border-t max-h-48 overflow-y-auto'>
          {syncingChannels.map((channel) => (
            <SyncChannelItem key={channel.id} channel={channel} />
          ))}
          {syncingChannels.length > 0 && authErrorChannels.length > 0 && (
            <div className='border-b' />
          )}
          {authErrorChannels.map((channel) => (
            <ReauthChannelItem key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToastHeaderIcon({ syncCount, authCount }: { syncCount: number; authCount: number }) {
  if (syncCount > 0) {
    return <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
  }
  return <AlertTriangle className='h-4 w-4 text-amber-500' />
}

function ToastHeaderText({ syncCount, authCount }: { syncCount: number; authCount: number }) {
  const syncLabel = syncCount === 1 ? '1 channel' : `${syncCount} channels`
  const authLabel = authCount === 1 ? '1 needs login' : `${authCount} need login`

  if (syncCount > 0 && authCount > 0) {
    return (
      <>
        Syncing {syncLabel} &middot; {authLabel}
      </>
    )
  }
  if (syncCount > 0) {
    return <>Syncing {syncLabel}</>
  }
  return <>{authCount === 1 ? '1 channel' : `${authCount} channels`} needs login</>
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

/** Individual channel auth-error item in the expanded view */
function ReauthChannelItem({ channel }: { channel: Channel }) {
  const reauthMutation = api.integrationReauth.initiateReauth.useMutation({
    onSuccess: (data) => {
      if (data.authUrl) window.location.href = data.authUrl
    },
    onError: (error) => {
      toastError({ title: 'Failed to re-authenticate', description: error.message })
    },
  })

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
        onClick={() => reauthMutation.mutate({ integrationId: channel.id })}
        loading={reauthMutation.isPending}
        loadingText='...'>
        Reconnect
      </Button>
    </div>
  )
}

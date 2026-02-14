// MessageSyncStatus.tsx

import { SYNC_STATUS } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { syncStatusConfig } from './mail-status-config'

interface MessageSyncStatusProps {
  integrationId: string
}
const options = [
  { label: 'Sync Last 7 Days', value: 7 },
  { label: 'Sync Last 30 Days', value: 30 },
  { label: 'Sync Last 90 Days', value: 90 },
]
const MessageSyncStatus: React.FC<MessageSyncStatusProps> = ({ integrationId }) => {
  const [activeSyncJobId, setActiveSyncJobId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState('0')
  const utils = api.useUtils()
  // Effect to load potential active sync job ID from localStorage on mount
  useEffect(() => {
    const storedSyncJobId = localStorage.getItem(`activeMessageSyncJob:${integrationId}`)
    if (storedSyncJobId) {
      console.debug(`Found sync job ID in localStorage: ${storedSyncJobId}`)
      setActiveSyncJobId(storedSyncJobId)
    }
  }, [integrationId])

  // Query to check if the stored job is still active
  const initialSyncCheck = api.integration.getSyncStatus.useQuery(
    { syncJobId: activeSyncJobId || '' },
    {
      enabled: !!activeSyncJobId,
      retry: false,
      staleTime: Infinity,
      onSuccess: (data) => {
        if (
          data &&
          (data.status === SYNC_STATUS.PENDING || data.status === SYNC_STATUS.IN_PROGRESS)
        ) {
          setActiveSyncJobId(initialSyncCheck.data?.id)
        } else {
          console.debug(`Stored sync job ${activeSyncJobId} is not active or not found.`)
          setActiveSyncJobId(null)
        }
      },
      onError: () => {
        console.debug(`Initial sync job check failed for ID ${activeSyncJobId}`)
        setActiveSyncJobId(null)
      },
      trpc: { context: { skipBatch: true } },
    }
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSyncJobId is intentionally excluded to avoid infinite loop when setting it to null
  useEffect(() => {
    if (activeSyncJobId && initialSyncCheck && initialSyncCheck.data) {
      const status = initialSyncCheck.data.status
      if (status === SYNC_STATUS.COMPLETED || status === SYNC_STATUS.FAILED) {
        localStorage.removeItem(`activeMessageSyncJob:${integrationId}`)
        setActiveSyncJobId(null)
      }
    }
  }, [initialSyncCheck, integrationId])
  // Mutation to start the sync
  const startSync = api.integration.syncMessages.useMutation({
    onSuccess: (data) => {
      setActiveSyncJobId(data.syncJobId)
      if (data.alreadyInProgress) {
        toastSuccess({ title: 'Sync already active', description: data.message })
      } else {
        toastSuccess({ title: 'Sync started', description: data.message })
      }
      // Force a refresh of the sync status query
      utils.integration.getSyncStatus.invalidate({ syncJobId: data.syncJobId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to start sync', description: error.message })
    },
  })

  // Mutation to cancel the sync
  const cancelSync = api.integration.cancelSync.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'Sync cancelled', description: data.message })
      setActiveSyncJobId(null)
      localStorage.removeItem(`activeMessageSyncJob:${integrationId}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to cancel sync', description: error.message })
    },
  })

  // Confirmation dialog hook
  const [confirm, ConfirmDialog] = useConfirm()

  // Handle cancel sync with confirmation
  const handleCancelSync = async () => {
    const confirmed = await confirm({
      title: 'Cancel Message Sync?',
      description: 'This will stop the current sync operation. You can start a new sync anytime.',
      confirmText: 'Cancel Sync',
      cancelText: 'Keep Running',
      destructive: true,
    })

    if (confirmed && activeSyncJobId) {
      cancelSync.mutate({ syncJobId: activeSyncJobId })
    }
  }
  // This is the main polling query
  const syncStatus = api.integration.getSyncStatus.useQuery(
    { syncJobId: activeSyncJobId || '' },
    {
      // Only enable if we have an ID and initial check is done
      enabled: !!activeSyncJobId && !initialSyncCheck.isLoading,
      refetchInterval: 3000, // Poll every 3 seconds
      // Don't refetch stale data on window focus if already polling
      refetchOnWindowFocus: false,
      onSuccess: (data) => {
        console.debug(`Sync status update for ${activeSyncJobId}: ${data.status}`)
        // Handle terminal states
        if (data?.status === SYNC_STATUS.COMPLETED || data?.status === SYNC_STATUS.FAILED) {
          // Show appropriate toast
          if (data.status === SYNC_STATUS.COMPLETED) {
            toastSuccess({ title: 'Sync complete', description: 'All messages have been synced.' })
          } else {
            toastError({
              title: 'Sync failed',
              description: data.error || 'An unknown error occurred.',
            })
          }
          // Clear active ID after a delay
          // setTimeout(() => setActiveSyncJobId(null), 5000)
          setTimeout(() => {
            setActiveSyncJobId(null)
          }, 5000)
        }
      },
      onError: (error) => {
        console.error(`Failed to fetch sync status for ${activeSyncJobId}`, { error })
        toastError({ title: 'Failed to fetch sync status', description: error.message })
        setActiveSyncJobId(null)
      },
    }
  )
  const handleStartSync = () => {
    const selectedOption = options[Number(selectedIndex)]
    // console.log('Starting sync with selected index:', selectedOption.value)
    startSync.mutate({ integrationId, days: selectedOption.value || 7 })
  }
  // Determine the status to display
  const currentStatus =
    syncStatus.data?.status || (activeSyncJobId ? SYNC_STATUS.PENDING : undefined)

  // Loading and refetching states
  const isSyncLoading = startSync.isPending || syncStatus.isLoading || initialSyncCheck.isLoading
  const isSyncRefetching = syncStatus.isFetching && !syncStatus.isLoading
  const renderStatus = () => {
    if (!activeSyncJobId && !startSync.isPending) {
      return null
    }
    if (isSyncLoading && !syncStatus.data) {
      return <div className='text-gray-500'>Loading sync status...</div>
    }
    if (activeSyncJobId && !syncStatus.data && !isSyncLoading) {
      return <div className='text-red-600'>Could not load sync status.</div>
    }
    // If we have data, display the status
    if (syncStatus.data) {
      const { totalRecords, processedRecords, failedRecords } = syncStatus.data
      const total = totalRecords || 0
      const completed = processedRecords || 0
      const failed = failedRecords || 0
      let progressText = ''
      if (total > 0) {
        progressText = `(${completed}/${total} completed, ${failed} failed)`
      }
      // Get status config for color and other properties
      const statusConfig = syncStatusConfig[syncStatus.data.status]
      const statusTextColor = statusConfig?.color || 'text-gray-500'
      return (
        <div className={statusTextColor}>
          {syncStatus.data.status === SYNC_STATUS.PENDING && 'Message Sync Pending...'}
          {syncStatus.data.status === SYNC_STATUS.IN_PROGRESS &&
            `Syncing messages... ${progressText}`}
          {syncStatus.data.status === SYNC_STATUS.COMPLETED &&
            `Message Sync Complete. ${progressText}`}
          {syncStatus.data.status === SYNC_STATUS.FAILED && (
            <>
              {syncStatus.data.error === 'CANCELLED_BY_USER'
                ? 'Sync Cancelled'
                : `Message Sync Failed. ${progressText}`}
              {syncStatus.data.error && syncStatus.data.error !== 'CANCELLED_BY_USER'
                ? ` Details: ${syncStatus.data.error}`
                : ''}
            </>
          )}
          {isSyncRefetching && (
            <span className='ml-2 text-xs text-gray-500 animate-pulse'>Updating...</span>
          )}
        </div>
      )
    }
    return null
  }
  // Determine if the button should be disabled
  const isSyncInProgress =
    startSync.isPending ||
    (activeSyncJobId &&
      (currentStatus === SYNC_STATUS.PENDING || currentStatus === SYNC_STATUS.IN_PROGRESS))
  const buttonText = startSync.isPending
    ? 'Starting Sync...'
    : currentStatus === SYNC_STATUS.PENDING
      ? 'Sync Pending...'
      : currentStatus === SYNC_STATUS.IN_PROGRESS
        ? 'Syncing...'
        : undefined
  return (
    <div>
      <div className='inline-flex items-center gap-2'>
        <div className='inline-flex rounded-md shadow-2xs rtl:space-x-reverse'>
          <Button
            className={cn('shadow-none rounded-s-lg rounded-e-none focus-visible:z-10')}
            variant='outline'
            onClick={handleStartSync}
            disabled={isSyncInProgress}
            size='sm'>
            {buttonText ?? options[Number(selectedIndex)].label}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className=' shadow-none rounded-s-none rounded-e-lg focus-visible:z-10 border-l-0 border-r '
                size='sm'
                variant='outline'
                aria-label='Options'>
                <ChevronDownIcon size={16} aria-hidden='true' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='max-w-64 md:max-w-xs'
              side='bottom'
              sideOffset={4}
              align='end'>
              <DropdownMenuRadioGroup value={selectedIndex} onValueChange={setSelectedIndex}>
                {options.map((option, index) => (
                  <DropdownMenuRadioItem
                    key={option.label}
                    value={String(index)}
                    className='pr-8 pl-2 items-start [&>span]:pt-1.5 '>
                    <div className='flex flex-col gap-1'>
                      <span className='text-sm font-medium'>{option.label}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Cancel button - shown when sync is in progress */}
        {activeSyncJobId && isSyncInProgress && (
          <Button
            variant='ghost'
            size='sm'
            onClick={handleCancelSync}
            disabled={cancelSync.isPending}
            loading={cancelSync.isPending}
            loadingText='Cancelling...'>
            Cancel
          </Button>
        )}
      </div>

      {/* <Button
          onClick={handleStartSync}
          variant="outline"
          size="sm"
          disabled={isSyncInProgress}
          className={isSyncInProgress ? 'opacity-50 cursor-not-allowed' : ''}>
          {startSync.isPending
            ? 'Starting Sync...'
            : currentStatus === SYNC_STATUS.PENDING
              ? 'Sync Pending...'
              : currentStatus === SYNC_STATUS.IN_PROGRESS
                ? 'Syncing...'
                : 'Sync Messages'}
        </Button> */}
      {/* {renderStatus()} */}

      {/* Confirmation dialog */}
      <ConfirmDialog />
    </div>
  )
}
export default MessageSyncStatus

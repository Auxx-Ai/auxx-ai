'use client'
import type { IntegrationSyncStatus } from '@auxx/database/types'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  CloudDownload,
  Edit,
  InboxIcon,
  MailPlus,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
// ~/app/(protected)/app/settings/integrations/_components/integration-routing.tsx
import { useMemo, useState } from 'react'
import MessageSyncStatus from '~/components/mail/message-sync-status'
import { toRecordId, useRecord, useRecordList, useResource } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Props for the IntegrationRouting component */
interface IntegrationRoutingProps {
  integration: any // Replace with stronger typing when available
}

/**
 * IntegrationRouting component
 * Manages routing settings for an integration to inbox mapping
 */
export default function IntegrationRouting({ integration }: IntegrationRoutingProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [selectedRecordId, setSelectedRecordId] = useState<string>('')
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const addIntegration = api.inbox.addIntegration.useMutation({
    onSuccess: () => {
      setDialogOpen(false)
      utils.integration.getIntegrations.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error connecting inbox', description: error.message })
    },
  })

  // Get inbox resource definition
  const { resource: inboxResource } = useResource('inboxes')

  // Load all available inboxes via useRecordList
  const { records: inboxes } = useRecordList({
    entityDefinitionId: inboxResource?.id ?? '',
    enabled: !!inboxResource?.id,
  })

  // Build recordId for the connected inbox
  const connectedInboxRecordId = useMemo(() => {
    if (!inboxResource?.id || !integration.inboxId) return undefined
    return toRecordId(inboxResource.id, integration.inboxId)
  }, [inboxResource?.id, integration.inboxId])

  // Get connected inbox via useRecord
  const { record: connectedInbox, isLoading: isConnectedInboxLoading } = useRecord({
    recordId: connectedInboxRecordId,
    enabled: !!connectedInboxRecordId,
  })

  // Determine if we're loading the connected inbox
  const isLoadingConnectedInbox = !!connectedInboxRecordId && isConnectedInboxLoading
  // Handle opening the dialog - pre-select the connected inbox if exists
  const handleOpenDialog = () => {
    if (connectedInboxRecordId) {
      setSelectedRecordId(connectedInboxRecordId)
    }
    setDialogOpen(true)
  }

  // Handle connect to inbox
  const handleConnectInbox = () => {
    if (!selectedRecordId) return
    addIntegration.mutate({
      recordId: selectedRecordId,
      integrationId: integration.id,
      isDefault: true,
    })
  }
  // Prefer lastSuccessfulSync over lastSyncedAt for display
  const lastSyncDate = integration.lastSuccessfulSync || integration.lastSyncedAt
  const lastSynced = lastSyncDate ? new Date(lastSyncDate).toLocaleString() : 'Never'

  // Throttle state
  const isThrottled =
    integration.throttleRetryAfter && new Date(integration.throttleRetryAfter) > new Date()

  const removeIntegration = api.integration.disconnect.useMutation({
    onSuccess: () => {
      setIsRemoving(false)
      toastSuccess({
        title: 'Integration removed',
        description: 'The integration has been removed from this inbox',
      })
      // Invalidate the integrations query to refresh the list
      utils.integration.getIntegrations.invalidate()
      utils.thread.getCounts.invalidate()
    },
    onError: (error) => {
      setIsRemoving(false)
      toastError({ title: 'Error removing integration', description: error.message })
    },
  })
  // Handle removing an integration with confirmation
  const handleRemoveIntegration = async () => {
    const confirmed = await confirm({
      title: 'Remove integration?',
      description:
        'Permanently delete integration and all associated messages. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      setIsRemoving(true)
      const result = await removeIntegration.mutateAsync({ integrationId: integration.id })
      if (result) {
        // Optionally, redirect or refresh the page
        router.push('/app/settings/integrations')
      }
    }
  }

  return (
    <div className='p-6 space-y-10'>
      <div className='space-y-1'>
        <div className='flex items-center justify-between'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2  tracking-tight font-semibold text-foreground text-base'>
              <CloudDownload className='size-4' /> Data Sync
            </div>
            <p className='text-sm text-muted-foreground'>
              Configure how data from this integration is synced to your inboxes.
            </p>
          </div>
          <MessageSyncStatus integrationId={integration.id} />
        </div>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start'>
          <div className='text-sm text-muted-foreground'>Last synced</div>
          <Badge variant='green' size='sm'>
            {lastSynced}
          </Badge>
        </div>
        {integration.syncStatus && (
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start'>
            <div className='text-sm text-muted-foreground'>Sync status</div>
            <SyncStatusBadge syncStatus={integration.syncStatus} />
          </div>
        )}
        {isThrottled && (
          <Alert>
            <Clock className='h-4 w-4' />
            <AlertTitle>Rate limited</AlertTitle>
            <AlertDescription>
              This integration is temporarily throttled. Sync will resume after{' '}
              {new Date(integration.throttleRetryAfter).toLocaleString()}.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div className='space-y-4'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2  tracking-tight font-semibold text-foreground text-base'>
            <MailPlus className='size-4' /> Message Routing
          </div>
          <p className='text-sm text-muted-foreground'>
            Configure how messages from this integration are routed to your inboxes.
          </p>
        </div>
        <div>
          {connectedInbox || isLoadingConnectedInbox ? (
            <div className='space-y-4'>
              <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
                <div className='flex items-center gap-3'>
                  <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0'>
                    <InboxIcon className='size-4' />
                  </div>
                  <div className='flex flex-col'>
                    {isLoadingConnectedInbox ? (
                      <Skeleton className='h-3 w-24' />
                    ) : (
                      <span className='text-sm font-medium'>{connectedInbox?.displayName}</span>
                    )}
                    <span className='text-xs text-muted-foreground'>
                      Messages will be routed to this inbox
                    </span>
                  </div>
                </div>
                {isLoadingConnectedInbox ? (
                  <Skeleton className='h-7 w-32' />
                ) : (
                  <Button variant='outline' onClick={handleOpenDialog} size='sm'>
                    <Edit />
                    Edit default inbox
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className='space-y-4'>
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertTitle>Not connected</AlertTitle>
                <AlertDescription>
                  This integration is not connected to any inbox. Messages won't be received until
                  you connect it.
                </AlertDescription>
              </Alert>

              <Button variant='default' onClick={handleOpenDialog}>
                Connect to inbox
              </Button>
            </div>
          )}
        </div>

        {/* Dialog for selecting inbox */}
        {dialogOpen ? (
          <Dialog open onOpenChange={setDialogOpen}>
            <DialogContent size='sm'>
              <DialogHeader className='mb-4'>
                <DialogTitle>{connectedInbox ? 'Change inbox' : 'Connect to inbox'}</DialogTitle>
                <DialogDescription>
                  {connectedInbox
                    ? 'Select a different inbox to route messages to'
                    : 'Select an inbox to route messages from this integration'}
                </DialogDescription>
              </DialogHeader>

              <div className=''>
                <Select value={selectedRecordId} onValueChange={setSelectedRecordId}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select an inbox' />
                  </SelectTrigger>
                  <SelectContent>
                    {inboxes?.map((inbox) => (
                      <SelectItem
                        key={inbox.id}
                        value={inbox.recordId ?? toRecordId(inboxResource!.id, inbox.id)}>
                        {inbox.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {(!inboxes || inboxes.length === 0) && (
                  <p className='mt-2 text-sm text-muted-foreground'>
                    No inboxes available. Please create an inbox first.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant='ghost' size='sm' onClick={() => setDialogOpen(false)}>
                  Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                <Button
                  data-dialog-submit
                  onClick={handleConnectInbox}
                  disabled={!selectedRecordId || addIntegration.isPending}
                  variant='outline'
                  size='sm'
                  loading={addIntegration.isPending}
                  loadingText='Connecting...'>
                  Connect <KbdSubmit variant='outline' size='sm' />
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className='space-y-2'>
        <div className='flex items-center gap-2  tracking-tight font-semibold text-foreground text-base'>
          <AlertTriangle className='size-4' /> Danger Zone
        </div>
        <div className='group flex items-center border py-2 px-3 hover:bg-destructive/2 transition-colors duration-200 rounded-2xl border-destructive/50'>
          <div className='flex flex-col justify-between gap-4 w-full md:flex-row md:items-center'>
            <div className='flex items-center gap-3'>
              <div className='size-8 border border-destructive/10 bg-destructive/2 rounded-lg flex items-center justify-center group-hover:bg-destructive/5 transition-colors overflow-hidden shrink-0'>
                <AlertTriangle className='size-4 text-destructive' />
              </div>
              <div className='flex flex-col'>
                <span className='text-sm text-destructive'>Delete Integration</span>
                <span className='text-xs text-destructive/80'>
                  Permanently delete integration and all associated messages.
                </span>
              </div>
            </div>
            <div className='shrink-0'>
              <Button
                variant='destructive'
                onClick={handleRemoveIntegration}
                disabled={isRemoving}
                size='sm'>
                Delete Integration
              </Button>
            </div>
            <ConfirmDialog />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Badge showing the current sync status */
function SyncStatusBadge({ syncStatus }: { syncStatus: IntegrationSyncStatus }) {
  switch (syncStatus) {
    case 'NOT_SYNCED':
      return (
        <Badge variant='secondary' size='sm'>
          Not synced
        </Badge>
      )
    case 'SYNCING':
      return (
        <Badge variant='blue' size='sm'>
          Syncing
        </Badge>
      )
    case 'ACTIVE':
      return (
        <Badge variant='green' size='sm'>
          Active
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge variant='destructive' size='sm'>
          Failed
        </Badge>
      )
  }
}

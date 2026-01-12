'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-routing.tsx
import React, { useState } from 'react'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
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
import { useInbox } from '~/hooks/use-inbox'
import { Badge } from '@auxx/ui/components/badge'
import { AlertCircle, AlertTriangle, CloudDownload, Edit, InboxIcon, MailPlus } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import MessageSyncStatus from '~/components/mail/message-sync-status'
import { useConfirm } from '~/hooks/use-confirm'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { useRouter } from 'next/navigation'
import type { InboxEntity as Inbox } from '@auxx/database/models'
interface IntegrationRoutingProps {
  integration: any // Replace with stronger typing when available
  inboxes: Inbox[]
}
/**
 * IntegrationRouting component
 * Manages routing settings for an integration to inbox mapping
 */
export default function IntegrationRouting({ integration, inboxes }: IntegrationRoutingProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [selectedInboxId, setSelectedInboxId] = useState<string>('')
  const { addIntegration } = useInbox()
  // const syncMutation = api.integration.syncMessages.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()
  // Find connected inbox for this integration
  const connectedInbox = inboxes.find((inbox) =>
    inbox.integrations?.some((i) => i.integrationId === integration.id)
  )
  // Handle connect to inbox
  const handleConnectInbox = () => {
    if (!selectedInboxId) return
    addIntegration.mutate(
      {
        inboxId: selectedInboxId,
        integrationId: integration.id,
        isDefault: true, // Set as default for this inbox
      },
      {
        onSuccess: () => {
          setDialogOpen(false)
        },
      }
    )
  }
  // Format last synced time
  const lastSynced = integration.lastSyncedAt
    ? new Date(integration.lastSyncedAt).toLocaleString()
    : 'Never'
  const utils = api.useUtils()
  const removeIntegration = api.integration.disconnect.useMutation({
    onSuccess: () => {
      setIsRemoving(false)
      toastSuccess({
        title: 'Integration removed',
        description: 'The integration has been removed from this inbox',
      })
      // Invalidate the integrations query to refresh the list
      utils.integration.getIntegrations.invalidate()
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
    <div className="p-6 space-y-10">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2  tracking-tight font-semibold text-foreground text-base">
              <CloudDownload className="size-4" /> Data Sync
            </div>
            <p className="text-sm text-muted-foreground">
              Configure how data from this integration is synced to your inboxes.
            </p>
          </div>
          <MessageSyncStatus integrationId={integration.id} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start">
          <div className="text-sm text-muted-foreground">Last synced</div>
          <Badge variant="green" size="sm">
            {lastSynced}
          </Badge>
        </div>
      </div>
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2  tracking-tight font-semibold text-foreground text-base">
            <MailPlus className="size-4" /> Message Routing
          </div>
          <p className="text-sm text-muted-foreground">
            Configure how messages from this integration are routed to your inboxes.
          </p>
        </div>
        <div>
          {connectedInbox ? (
            <div className="space-y-4">
              <div className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
                <div className="flex items-center gap-3">
                  <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0">
                    <InboxIcon className="size-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{connectedInbox.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Messages will be routed to this inbox
                    </span>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setDialogOpen(true)} size="sm">
                  <Edit />
                  Edit default inbox
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Not connected</AlertTitle>
                <AlertDescription>
                  This integration is not connected to any inbox. Messages won't be received until
                  you connect it.
                </AlertDescription>
              </Alert>

              <Button variant="default" onClick={() => setDialogOpen(true)}>
                Connect to inbox
              </Button>
            </div>
          )}
        </div>

        {/* Dialog for selecting inbox */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent size="sm">
            <DialogHeader className="mb-4">
              <DialogTitle>{connectedInbox ? 'Change inbox' : 'Connect to inbox'}</DialogTitle>
              <DialogDescription>
                {connectedInbox
                  ? 'Select a different inbox to route messages to'
                  : 'Select an inbox to route messages from this integration'}
              </DialogDescription>
            </DialogHeader>

            <div className="">
              <Select value={selectedInboxId} onValueChange={setSelectedInboxId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an inbox" />
                </SelectTrigger>
                <SelectContent>
                  {inboxes.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {inboxes.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No inboxes available. Please create an inbox first.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
              </Button>
              <Button
                data-dialog-submit
                onClick={handleConnectInbox}
                disabled={!selectedInboxId || addIntegration.isPending}
                variant="outline"
                size="sm"
                loading={addIntegration.isPending}
                loadingText="Connecting...">
                Connect <KbdSubmit variant="outline" size="sm" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2  tracking-tight font-semibold text-foreground text-base">
          <AlertTriangle className="size-4" /> Danger Zone
        </div>
        <div className="group flex items-center border py-2 px-3 hover:bg-destructive/2 transition-colors duration-200 rounded-2xl border-destructive/50">
          <div className="flex flex-col justify-between gap-4 w-full md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="size-8 border border-destructive/10 bg-destructive/2 rounded-lg flex items-center justify-center group-hover:bg-destructive/5 transition-colors overflow-hidden shrink-0">
                <AlertTriangle className="size-4 text-destructive" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-destructive">Delete Integration</span>
                <span className="text-xs text-destructive/80">
                  Permanently delete integration and all associated messages.
                </span>
              </div>
            </div>
            <div className="shrink-0">
              <Button
                variant="destructive"
                onClick={handleRemoveIntegration}
                disabled={isRemoving}
                size="sm">
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

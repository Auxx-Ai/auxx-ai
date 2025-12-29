// /app/settings/inbox/_components/inbox-integrations-tab.tsx
'use client'

import { useState } from 'react'
import { api } from '~/trpc/react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Button } from '@auxx/ui/components/button'
import { CheckCircle, ChevronRight, MailIcon, X } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import type { InboxWithRelations, BaseIntegration } from '@auxx/lib/types'
import { useRouter } from 'next/navigation'

export function InboxIntegrationsTab({ inbox }: { inbox: InboxWithRelations }) {
  const router = useRouter()
  const [isRemoving, setIsRemoving] = useState(false)

  // Use the confirm hook for confirmation dialogs
  const [confirm, ConfirmDialog] = useConfirm()

  // Remove integration mutation
  const removeIntegration = api.inbox.removeIntegration.useMutation({
    onSuccess: () => {
      setIsRemoving(false)
      toastSuccess({
        title: 'Integration removed',
        description: 'The integration has been removed from this inbox',
      })
    },
    onError: (error) => {
      setIsRemoving(false)
      toastError({ title: 'Error removing integration', description: error.message })
    },
  })

  // Handle removing an integration with confirmation
  const handleRemoveIntegration = async (integrationId: string) => {
    const confirmed = await confirm({
      title: 'Remove integration?',
      description:
        'This will remove this integration from the inbox. Any emails from this integration will no longer be routed to this inbox.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      setIsRemoving(true)
      removeIntegration.mutate({ inboxId: inbox.id, integrationId })
    }
  }

  const getIntegrationName = (integration: BaseIntegration): string => {
    if (integration.name) {
      return integration.name
    }
    return integration.provider.charAt(0).toUpperCase() + integration.provider.slice(1)
  }
  const handleGoToIntegration = (integrationId: string) => {
    // Navigate to the integration details page
    router.push(`/app/settings/integrations/${integrationId}`)
  }

  return (
    <>
      {/* Render the confirmation dialog */}
      <ConfirmDialog />

      <div>
        {/* <h3 className="mb-4 text-lg font-medium">Connected Integrations</h3> */}

        {/* Integrations table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inbox.integrations.length > 0 ? (
              inbox.integrations.map((integration) => (
                <TableRow key={integration.integrationId}>
                  <TableCell>
                    <div className="flex items-center h-full">
                      <MailIcon className="mr-2 h-4 w-4" />
                      <span>{getIntegrationName(integration.integration)}</span>
                      {integration.isDefault && <Badge className="ml-2">Default</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                      <span>Connected</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation() // Prevent row click event
                        handleGoToIntegration(integration.integrationId)
                      }}>
                      <ChevronRight className="h-4 w-4" />
                      <span className="sr-only">Go to Integration</span>
                    </Button>
                    {/* <Button
                      variant="ghost"
                      size="icon"
                      disabled={isRemoving}
                      onClick={() => handleRemoveIntegration(integration.integrationId)}>
                      <X className="h-4 w-4" />
                      <span className="sr-only">Remove</span>
                    </Button> */}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="py-4 text-center text-muted-foreground">
                  No integrations connected. Add an integration to start receiving emails.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Add Integration button (implementation would be added in practice) */}
      </div>
    </>
  )
}

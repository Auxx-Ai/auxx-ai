// apps/web/src/components/inbox/inbox-integrations-tab.tsx
'use client'

import type { InboxIntegration } from '@auxx/lib/inboxes'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { CheckCircle, ChevronRight, MailIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Props for InboxIntegrationsTab */
interface InboxIntegrationsTabProps {
  inboxId: string
  integrations: InboxIntegration[]
}

/** Tab component for managing inbox integrations */
export function InboxIntegrationsTab({ inboxId, integrations }: InboxIntegrationsTabProps) {
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

  /** Handle removing an integration with confirmation */
  const handleRemoveIntegration = async (integrationId: string) => {
    const confirmed = await confirm({
      title: 'Remove channel?',
      description:
        'This will remove this integration from the inbox. Any emails from this integration will no longer be routed to this inbox.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      setIsRemoving(true)
      removeIntegration.mutate({ inboxId, integrationId })
    }
  }

  /** Get display name for an integration */
  const getIntegrationName = (integration: { name: string; provider: string }): string => {
    if (integration.name) {
      return integration.name
    }
    return integration.provider.charAt(0).toUpperCase() + integration.provider.slice(1)
  }

  /** Navigate to integration details page */
  const handleGoToIntegration = (integrationId: string) => {
    router.push(`/app/settings/channels/${integrationId}`)
  }

  return (
    <>
      {/* Render the confirmation dialog */}
      <ConfirmDialog />

      <div>
        {/* Integrations table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-20'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.length > 0 ? (
              integrations.map((integration) => (
                <TableRow key={integration.integrationId}>
                  <TableCell>
                    <div className='flex items-center h-full'>
                      <MailIcon className='mr-2 h-4 w-4' />
                      <span>{getIntegrationName(integration.integration)}</span>
                      {integration.isDefault && <Badge className='ml-2'>Default</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center'>
                      <CheckCircle className='mr-2 h-4 w-4 text-green-500' />
                      <span>Connected</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleGoToIntegration(integration.integrationId)
                      }}>
                      <ChevronRight className='h-4 w-4' />
                      <span className='sr-only'>Go to Integration</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className='py-4 text-center text-muted-foreground'>
                  No channels connected. Add a channel to start receiving emails.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

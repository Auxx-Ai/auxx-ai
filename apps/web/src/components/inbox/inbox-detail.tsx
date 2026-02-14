// apps/web/src/components/inbox/inbox-detail.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@auxx/ui/components/table'
import { PencilIcon, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { toRecordId, useResource } from '../resources'
import { useInbox } from '../threads/hooks'
import { InboxDialog } from './inbox-dialog'
import { InboxIntegrationsTab } from './inbox-integrations-tab'

/** Component for displaying inbox details with integrations */
export function InboxDetail({ inboxId }: { inboxId: string }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Build RecordId from resource definition
  const { resource } = useResource('inboxes')
  const recordId = toRecordId(resource?.id, inboxId)

  // Get tRPC utils for cache invalidation
  const utils = api.useUtils()

  // Fetch inbox data from entity system
  const { inbox, isLoading: isLoadingInbox } = useInbox(recordId)

  // Fetch integrations separately (not part of entity system)
  const { data: integrations, isLoading: isLoadingIntegrations } =
    api.inbox.getIntegrations.useQuery({ inboxId }, { enabled: !!inbox })

  const isLoading = isLoadingInbox || isLoadingIntegrations

  /** Navigate back to inbox list */
  const handleBack = () => {
    router.push('/app/settings/inbox')
  }

  /** Open edit dialog */
  const handleEditInbox = () => {
    setDialogOpen(true)
  }

  /** Handle successful dialog save */
  const handleDialogSuccess = () => {
    utils.inbox.getIntegrations.invalidate({ inboxId })
    // utils.inbox.getAll.invalidate()
  }

  return (
    <>
      <SettingsPage
        title={`Inbox - ${inbox?.name ?? 'Loading...'}`}
        description='Manage your inbox integrations.'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Inboxes', href: '/app/settings/inbox' },
          { title: inbox?.name ?? 'Loading...' },
        ]}
        button={
          <Button variant='outline' size='sm' onClick={handleEditInbox}>
            <PencilIcon />
            Edit Inbox
          </Button>
        }>
        <div>
          {isLoading ? (
            <Table className='w-full'>
              {/* Loading skeleton */}
              <TableHeader>
                <TableRow>
                  <TableCell>
                    <Skeleton className='h-4 w-full max-w-md' />
                  </TableCell>
                  <TableCell>
                    <Skeleton className='h-4 w-full max-w-sm' />
                  </TableCell>
                  <TableCell className='w-[80px]'>
                    <Skeleton className='h-4 w-full max-w-xs' />
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 3 }).map((_, index) => (
                  <TableRow key={`skeleton-row-${index}`} className='h-[53px]'>
                    <TableCell>
                      <Skeleton className='h-4 w-full max-w-md' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-full max-w-sm' />
                    </TableCell>
                    <TableCell className='w-[80px]'>
                      <Skeleton className='h-4 w-full max-w-xs' />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : inbox && integrations ? (
            <InboxIntegrationsTab inboxId={inboxId} integrations={integrations} />
          ) : (
            <EmptyState
              icon={X}
              title='Inbox not found'
              description={<>Inbox doesn't exist...</>}
              button={
                <Button onClick={handleBack} className='mt-4' variant='outline'>
                  Go Back
                </Button>
              }
            />
          )}
        </div>
      </SettingsPage>

      {/* Edit Dialog - pass recordId (already built above) */}
      {dialogOpen && (
        <InboxDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          recordId={recordId}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  )
}

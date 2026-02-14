// apps/web/src/components/inbox/inbox-list.tsx
'use client'

import type { Inbox } from '@auxx/lib/inboxes'
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
import { InboxIcon, PlusIcon, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { InboxDialog } from './inbox-dialog'

/** Component for displaying the list of inboxes */
export function InboxList() {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  // Fetch all inboxes for the organization
  const { data: inboxes, isLoading: isLoadingInboxes } = api.inbox.getAll.useQuery()

  // Get tRPC utils for cache invalidation
  const utils = api.useUtils()

  /** Get status badge based on inbox status */
  const getStatusBadge = (status: Inbox['status']) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant='green'>Active</Badge>
      case 'ARCHIVED':
        return <Badge variant='gray'>Archived</Badge>
      case 'PAUSED':
        return <Badge variant='yellow'>Paused</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }

  /** Get access display based on visibility */
  const getAccessDisplay = (visibility: Inbox['visibility']) => {
    switch (visibility) {
      case 'org_members':
        return 'All members'
      case 'private':
        return 'Private'
      case 'custom':
        return 'Custom'
      default:
        return visibility
    }
  }

  /** Open the create inbox dialog */
  const handleCreateInbox = () => {
    setDialogOpen(true)
  }

  /** Navigate to the inbox detail page */
  const handleRowClick = (inboxId: string) => {
    router.push(`/app/settings/inbox/${inboxId}`)
  }

  /** Handle successful dialog submission */
  const handleDialogSuccess = () => {
    utils.inbox.getAll.invalidate()
  }

  return (
    <SettingsPage
      title='Inboxes'
      description='Manage your shared inboxes and their settings.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Inboxes' }]}
      button={
        <Button variant='outline' size='sm' onClick={handleCreateInbox}>
          <PlusIcon />
          Create Inbox
        </Button>
      }>
      <div className='flex h-full'>
        {isLoadingInboxes ? (
          <EmptyState
            icon={RefreshCw}
            iconClassName='animate-spin'
            title='Loading inboxes...'
            description={<>Hang on tight while we load your inboxes...</>}
            button={<div className='h-12'></div>}
          />
        ) : inboxes && inboxes.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[300px]'>Inbox</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxes.map((inbox) => (
                <TableRow
                  key={inbox.id}
                  onClick={() => handleRowClick(inbox.id)}
                  className='cursor-pointer hover:bg-muted'>
                  <TableCell>
                    <div className='flex items-center space-x-3'>
                      {/* Colored dot based on inbox color */}
                      <div
                        className='h-3 w-3 rounded-full'
                        style={{
                          backgroundColor: inbox.color || '#4F46E5',
                        }}
                      />
                      <div>
                        <div className='font-medium'>{inbox.name}</div>
                        {inbox.description && (
                          <div className='text-sm text-muted-foreground'>{inbox.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getAccessDisplay(inbox.visibility)}</TableCell>
                  <TableCell>{getStatusBadge(inbox.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={InboxIcon}
            title='Create your first inbox'
            description={<>Inboxes help you organize your messages.</>}
            button={
              <Button size='sm' variant='outline' onClick={handleCreateInbox}>
                <PlusIcon />
                Create Inbox
              </Button>
            }
          />
        )}
      </div>

      {/* Dialog only renders when open */}
      {dialogOpen && (
        <InboxDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={handleDialogSuccess}
        />
      )}
    </SettingsPage>
  )
}

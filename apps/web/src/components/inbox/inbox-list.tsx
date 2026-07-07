// apps/web/src/components/inbox/inbox-list.tsx
'use client'

import type { Inbox } from '@auxx/lib/inboxes'
import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import {
  InboxIcon,
  MoreHorizontal,
  PencilIcon,
  PlusIcon,
  RefreshCw,
  Trash2Icon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useResource } from '~/components/resources'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useInboxes } from '~/components/threads/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { InboxDialog } from './inbox-dialog'

/** Component for displaying the list of inboxes */
export function InboxList() {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  // recordId to edit; null opens the dialog in create mode.
  const [editRecordId, setEditRecordId] = useState<RecordId | null>(null)

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  // Read inboxes from the generic record store; field-value mutations flush
  // this automatically, so no manual invalidation is required after edits.
  const { inboxes, records, isLoading: isLoadingInboxes, refresh } = useInboxes()
  const { resource } = useResource('inbox')

  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      utils.inbox.getAll.invalidate()
      utils.record.listAll.invalidate({ entityDefinitionId: 'inbox' })
      refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  /** Get status badge based on inbox status */
  const getStatusBadge = (status: Inbox['status'] | undefined) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant='green'>Active</Badge>
      case 'ARCHIVED':
        return <Badge variant='gray'>Archived</Badge>
      case 'PAUSED':
        return <Badge variant='yellow'>Paused</Badge>
      default:
        return <Badge>{status ?? 'Unknown'}</Badge>
    }
  }

  /** Get access display based on the org-wide floor lens */
  const getAccessDisplay = (defaultLens: Inbox['defaultLens'] | undefined) => {
    switch (defaultLens) {
      case 'none':
        return 'Restricted'
      case 'subject':
        return 'Subject only'
      case 'metadata':
        return 'Activity only'
      default:
        return 'All members'
    }
  }

  /** Open the create inbox dialog */
  const handleCreateInbox = () => {
    setEditRecordId(null)
    setDialogOpen(true)
  }

  /** Open the inbox editor dialog for an existing inbox */
  const handleEditInbox = (recordId: RecordId) => {
    setEditRecordId(recordId)
    setDialogOpen(true)
  }

  /** Delete an inbox after confirmation */
  const handleDeleteInbox = async (inboxId: string, name: string) => {
    const confirmed = await confirm({
      title: 'Delete inbox?',
      description: `This will permanently delete "${name}" and all its settings. This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteInbox.mutate({ inboxId })
  }

  /** Navigate to the inbox detail page */
  const handleRowClick = (inboxId: string) => {
    router.push(`/app/settings/inbox/${inboxId}`)
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
      {isLoadingInboxes ? (
        <EmptyState
          icon={RefreshCw}
          iconClassName='animate-spin'
          title='Loading inboxes...'
          description={<>Hang on tight while we load your inboxes...</>}
          button={<div className='h-12'></div>}
        />
      ) : inboxes.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[300px]'>Inbox</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-[60px]' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {inboxes.map((inbox) => {
              const record = records.find((r) => r.id === inbox.id)
              const status = Array.isArray(inbox.status) ? inbox.status[0] : inbox.status
              return (
                <TableRow
                  key={inbox.id}
                  onClick={() => handleRowClick(inbox.id)}
                  className='cursor-pointer hover:bg-muted'>
                  <TableCell>
                    <div className='flex items-center space-x-3'>
                      <RecordIcon
                        avatarUrl={record?.avatarUrl}
                        iconId={resource?.icon ?? 'inbox'}
                        color={resource?.color ?? 'gray'}
                        size='xs'
                      />
                      <div>
                        <div className='font-medium'>{inbox.name}</div>
                        {inbox.description && (
                          <div className='text-sm text-muted-foreground'>{inbox.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {inbox.isPersonal ? (
                      <Badge variant='gray'>Personal</Badge>
                    ) : (
                      getAccessDisplay(inbox.defaultLens)
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(status)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label='Inbox actions'
                          onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => handleEditInbox(inbox.recordId)}>
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant='destructive'
                          disabled={deleteInbox.isPending}
                          onClick={() => handleDeleteInbox(inbox.id, inbox.name)}>
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
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

      {/* Dialog only renders when open */}
      {dialogOpen && (
        <InboxDialog open={dialogOpen} onOpenChange={setDialogOpen} recordId={editRecordId} />
      )}
      <ConfirmDialog />
    </SettingsPage>
  )
}

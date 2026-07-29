// apps/web/src/components/inbox/inbox-list.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { Inbox as InboxIcon, PlusIcon, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useResource } from '~/components/resources'
import { useInboxes } from '~/components/threads/hooks'
import { type InboxItem, invalidateInboxRecordLists } from '~/components/threads/hooks/use-inbox'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { InboxDialog } from './inbox-dialog'
import { InboxCard } from './ui/inbox-card'
import { InboxPlaceholderCard } from './ui/inbox-placeholder-card'

const BREADCRUMBS = [{ title: 'Settings', href: '/app/settings' }, { title: 'Inboxes' }]

const GRID_CLASS = 'grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'

/** Container-query wrapper so the grid's `@md`/`@2xl` breakpoints resolve. */
function InboxGrid({ children }: { children: ReactNode }) {
  return (
    <div className='@container'>
      <div className={GRID_CLASS}>{children}</div>
    </div>
  )
}

/** Inbox settings list page — a responsive ListCard grid of shared and personal inboxes. */
export function InboxList() {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  // recordId to edit; null opens the dialog in create mode.
  const [editRecordId, setEditRecordId] = useState<InboxItem['recordId'] | null>(null)

  useUser({ requireOrganization: true })
  useRequireCapability(PermissionKey.channelsManage)

  // Read inboxes from the generic record store; field-value mutations flush
  // this automatically, so no manual invalidation is required after edits.
  const { inboxes, records, isLoading, refresh } = useInboxes()
  const { resource } = useResource('inbox')

  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      invalidateInboxRecordLists(utils)
      refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting inbox', description: error.message })
    },
  })

  /** Open the create inbox dialog */
  const handleCreateInbox = () => {
    setEditRecordId(null)
    setDialogOpen(true)
  }

  /** Open the inbox editor dialog for an existing inbox */
  const handleEditInbox = (inbox: InboxItem) => {
    setEditRecordId(inbox.recordId)
    setDialogOpen(true)
  }

  /** Delete an inbox after confirmation */
  const handleDeleteInbox = async (inbox: InboxItem) => {
    const confirmed = await confirm({
      title: 'Delete inbox?',
      description: `This will permanently delete "${inbox.name}" and all its settings. This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteInbox.mutate({ inboxId: inbox.id })
  }

  const shared = inboxes.filter((inbox) => !inbox.isPersonal)
  const personal = inboxes.filter((inbox) => inbox.isPersonal)

  const renderCard = (inbox: InboxItem) => (
    <InboxCard
      key={inbox.id}
      inbox={inbox}
      record={records.find((r) => r.id === inbox.id)}
      resourceIcon={resource?.icon ?? undefined}
      resourceColor={resource?.color ?? undefined}
      onEdit={handleEditInbox}
      onDelete={handleDeleteInbox}
      deletePending={deleteInbox.isPending}
    />
  )

  return (
    <SettingsPage
      title='Inboxes'
      description='Manage your shared inboxes and their settings.'
      breadcrumbs={BREADCRUMBS}
      button={
        <Button variant='outline' size='sm' onClick={handleCreateInbox}>
          <PlusIcon />
          Create Inbox
        </Button>
      }>
      <div className='p-3 sm:p-6'>
        {isLoading ? (
          <SettingsSection icon={InboxIcon} title='Shared inboxes'>
            <InboxGrid>
              {[0, 1, 2].map((i) => (
                <ListCard key={i} loading />
              ))}
            </InboxGrid>
          </SettingsSection>
        ) : inboxes.length === 0 ? (
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
        ) : (
          <div className='space-y-6'>
            <SettingsSection
              icon={InboxIcon}
              title='Shared inboxes'
              description='Inboxes shared across your workspace.'>
              <InboxGrid>
                {shared.map(renderCard)}
                <InboxPlaceholderCard onClick={handleCreateInbox} />
              </InboxGrid>
            </SettingsSection>

            {personal.length > 0 && (
              <SettingsSection
                icon={Users}
                title='Personal inboxes'
                description="Members' connected personal mailboxes.">
                <InboxGrid>{personal.map(renderCard)}</InboxGrid>
              </SettingsSection>
            )}
          </div>
        )}
      </div>

      {/* Dialog only renders when open */}
      {dialogOpen && (
        <InboxDialog open={dialogOpen} onOpenChange={setDialogOpen} recordId={editRecordId} />
      )}
      <ConfirmDialog />
    </SettingsPage>
  )
}

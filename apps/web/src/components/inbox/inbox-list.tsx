// apps/web/src/components/inbox/inbox-list.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { Inbox as InboxIcon, Lock, PlusIcon } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { useOAuthReturn } from '~/components/apps/hooks/use-oauth-return'
import { ChannelGalleryDialog } from '~/components/channels/ui/channel-gallery-dialog'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useResource } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { InboxDialog } from './inbox-dialog'
import { InboxCard, type SettingsInboxItem } from './ui/inbox-card'
import { InboxPlaceholderCard, PersonalInboxPlaceholderCard } from './ui/inbox-placeholder-card'

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

/** Member-scoped inbox settings: owned personal inboxes plus accessible shared inboxes. */
export function InboxList() {
  const utils = api.useUtils()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = useAccess()
  const canManageChannels = can(PermissionKey.channelsManage)
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [personalGalleryOpen, setPersonalGalleryOpen] = useState(false)
  const [selectedInbox, setSelectedInbox] = useState<SettingsInboxItem | null>(null)

  useUser({ requireOrganization: true })
  useOAuthReturn()

  const { data: inboxes = [], isLoading, error } = api.inbox.settingsList.useQuery()
  const { resource } = useResource('inbox')

  useEffect(() => {
    if (searchParams.get('connect') === 'personal') setPersonalGalleryOpen(true)
  }, [searchParams])

  const deleteInbox = api.inbox.delete.useMutation({
    onSuccess: () => {
      void utils.inbox.settingsList.invalidate()
    },
    onError: (mutationError) => {
      toastError({ title: 'Error deleting inbox', description: mutationError.message })
    },
  })

  const shared = inboxes.filter((inbox) => !inbox.isPersonal)
  const personal = inboxes.filter((inbox) => inbox.isPersonal)

  const handleCreateInbox = () => {
    setSelectedInbox(null)
    setDialogOpen(true)
  }

  const handleEditInbox = (inbox: SettingsInboxItem) => {
    if (!inbox.canManage) return
    setSelectedInbox(inbox)
    setDialogOpen(true)
  }

  const handleDeleteInbox = async (inbox: SettingsInboxItem) => {
    if (!inbox.canDelete) return
    const confirmed = await confirm({
      title: 'Delete inbox?',
      description: `This will permanently delete "${inbox.name}" and all its settings. This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteInbox.mutate({ inboxId: inbox.id })
  }

  const handlePersonalGalleryChange = (open: boolean) => {
    setPersonalGalleryOpen(open)
    if (!open && searchParams.get('connect') === 'personal') {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('connect')
      const query = params.toString()
      router.replace(query ? `/app/settings/inbox?${query}` : '/app/settings/inbox')
    }
  }

  const renderCard = (inbox: SettingsInboxItem) => (
    <InboxCard
      key={inbox.id}
      inbox={inbox}
      resourceIcon={resource?.icon ?? undefined}
      resourceColor={resource?.color ?? undefined}
      onEdit={handleEditInbox}
      onDelete={handleDeleteInbox}
      deletePending={deleteInbox.isPending}
    />
  )

  return (
    <>
      <SettingsPage
        title='Inboxes'
        description='Manage your personal accounts and the shared inboxes you can access.'
        breadcrumbs={BREADCRUMBS}
        button={
          canManageChannels ? (
            <Button variant='outline' size='sm' onClick={handleCreateInbox}>
              <PlusIcon />
              Create shared inbox
            </Button>
          ) : undefined
        }>
        <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
          {error ? (
            <EmptyState
              icon={InboxIcon}
              title='Could not load inboxes'
              description={error.message}
            />
          ) : (
            <>
              <SettingsSection
                icon={Lock}
                title='Personal inboxes'
                description='Private mailboxes connected to your own Gmail or Outlook account.'>
                <InboxGrid>
                  {isLoading ? (
                    <>
                      <ListCard loading descriptionLines={0} />
                      <ListCard loading descriptionLines={0} />
                    </>
                  ) : (
                    <>
                      {personal.map(renderCard)}
                      <PersonalInboxPlaceholderCard onClick={() => setPersonalGalleryOpen(true)} />
                    </>
                  )}
                </InboxGrid>
              </SettingsSection>

              {(isLoading || shared.length > 0 || canManageChannels) && (
                <SettingsSection
                  icon={InboxIcon}
                  title='Shared inboxes'
                  description='Team queues you can work in or manage.'>
                  <InboxGrid>
                    {isLoading ? (
                      <>
                        <ListCard loading descriptionLines={0} />
                        <ListCard loading descriptionLines={0} />
                      </>
                    ) : (
                      <>
                        {shared.map(renderCard)}
                        {canManageChannels && <InboxPlaceholderCard onClick={handleCreateInbox} />}
                      </>
                    )}
                  </InboxGrid>
                </SettingsSection>
              )}
            </>
          )}
        </div>
      </SettingsPage>

      {dialogOpen && (
        <InboxDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          recordId={selectedInbox?.recordId}
          inboxSummary={selectedInbox ?? undefined}
          canDelete={selectedInbox?.canDelete ?? false}
          onSuccess={() => void utils.inbox.settingsList.invalidate()}
        />
      )}

      <ChannelGalleryDialog
        open={personalGalleryOpen}
        onOpenChange={handlePersonalGalleryChange}
        personalOnly
        returnTo='/app/settings/inbox'
      />

      <ConfirmDialog />
    </>
  )
}

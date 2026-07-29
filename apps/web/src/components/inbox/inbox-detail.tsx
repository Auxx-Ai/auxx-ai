// apps/web/src/components/inbox/inbox-detail.tsx
'use client'

import type { InboxIntegration } from '@auxx/lib/inboxes'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { PencilIcon, Waypoints, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ChannelGalleryDialog } from '~/components/channels/ui/channel-gallery-dialog'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { OrphanedPersonalInboxBanner } from '~/components/mail-permissions/ui/orphaned-inbox-banner'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { Channel } from '../channels/store/channel-store'
import { toRecordId } from '../resources'
import { toInboxAccessRecordId, useInboxByInstanceId } from '../threads/hooks'
import { InboxDialog } from './inbox-dialog'
import { ConnectExistingChannelDialog } from './ui/connect-existing-channel-dialog'
import { InboxChannelCard } from './ui/inbox-channel-card'
import { InboxChannelPlaceholderCard } from './ui/inbox-channel-placeholder-card'
import { InboxInfoCard } from './ui/inbox-info-card'

const GRID_CLASS = 'grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'

/** Inbox detail page — a responsive ListCard grid of the channels routing into this inbox. */
export function InboxDetail({ inboxId }: { inboxId: string }) {
  const router = useRouter()
  const utils = api.useUtils()
  const { can, canAdminInstance, isLoading: isLoadingCapabilities } = useAccess()
  const { userId } = useUser()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Resolve by the bare route id so personal inboxes retain their own
  // definition-aware RecordId instead of being forced onto the shared def.
  const { inbox, isLoading: isLoadingInbox } = useInboxByInstanceId(inboxId)

  // Fetch integrations separately (not part of entity system)
  const { data: integrations, isLoading: isLoadingIntegrations } =
    api.inbox.getIntegrations.useQuery({ inboxId }, { enabled: !!inbox })

  // The dehydrated instance snapshot is the source of truth for settings
  // authority. Use the stable access key, not the record layer's def UUID.
  const canManageInbox = inbox ? canAdminInstance(toInboxAccessRecordId(inbox)) : false

  /**
   * Three DIFFERENT server gates, previously collapsed into one flag — which
   * left a member who owns a personal inbox with no way to reach their own
   * channel (no `channels.manage`, so the tile lost its link AND its menu):
   *
   * - Opening the channel's settings page answers to `requireChannelManageAccess`
   *   (`manage-access.ts`): `channels.manage` OR the owner of a PERSONAL channel.
   *   Inbox Manager is not part of it, and the ownership carve-out is the half
   *   that matters here (§11).
   * - Unrouting answers to `inbox.removeIntegration`: `channels.manage` AND
   *   inbox Manager, no carve-out.
   * - Connecting additionally cannot target a personal inbox at all —
   *   `addIntegration` and `assertSharedConnectInbox` both reject one — so those
   *   affordances stay off there instead of offering a guaranteed 400.
   */
  const canOpenChannel =
    can(PermissionKey.channelsManage) || (!!inbox?.isPersonal && inbox.ownerUserId === userId)
  const canRouteChannels = canManageInbox && can(PermissionKey.channelsManage)
  const canConnectChannels = canRouteChannels && !inbox?.isPersonal

  const isLoading = isLoadingInbox || isLoadingIntegrations || isLoadingCapabilities

  const removeIntegration = api.inbox.removeIntegration.useMutation({
    onSuccess: () => {
      utils.inbox.getIntegrations.invalidate({ inboxId })
      toastSuccess({
        title: 'Channel removed',
        description: 'The channel has been removed from this inbox.',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error removing channel', description: error.message })
    },
  })

  // Reassign an existing channel onto this inbox (mirrors the channel page). The
  // channel belongs to exactly one inbox, so this moves it off its previous one;
  // its existing conversations only move if the user opts in below.
  const addIntegration = api.inbox.addIntegration.useMutation({
    onError: (error) => {
      toastError({ title: 'Error connecting channel', description: error.message })
    },
  })
  const moveThreads = api.inbox.moveIntegrationThreads.useMutation({
    onSuccess: () => {
      utils.thread.getCounts.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error moving conversations', description: error.message })
    },
  })

  /** Connect an already-connected channel to this inbox, offering to move its threads. */
  const handleConnectExisting = async (channel: Channel) => {
    setPickerOpen(false)
    if (!inbox || !canConnectChannels || channel.inboxId === inbox.id) return

    const hasDefault = (integrations ?? []).some((i) => i.isDefault)
    try {
      await addIntegration.mutateAsync({
        recordId: inbox.recordId,
        integrationId: channel.id,
        isDefault: !hasDefault,
      })
    } catch {
      return // toast already fired
    }
    utils.inbox.getIntegrations.invalidate({ inboxId })
    utils.channel.list.invalidate() // keep the channel store's inboxId fresh

    if (!channel.inboxId) return // was unassigned → nothing to move
    const fromInboxRecordId = toRecordId('inbox', channel.inboxId)
    const { count } = await utils.inbox.countMovableThreads.fetch({
      integrationId: channel.id,
      fromInboxRecordId,
    })
    if (count === 0) return

    const confirmed = await confirm({
      title: 'Move existing conversations?',
      description: `Move ${count} existing conversation${count === 1 ? '' : 's'} from the previous inbox into this one? New messages already route here.`,
      confirmText: 'Move conversations',
      cancelText: 'Keep where they are',
    })
    if (confirmed) {
      moveThreads.mutate({
        integrationId: channel.id,
        fromInboxRecordId,
        toInboxRecordId: inbox.recordId,
      })
    }
  }

  /** Remove a channel from this inbox after confirmation (unassigns routing). */
  const handleRemove = async (integration: InboxIntegration) => {
    if (!canRouteChannels) return

    const confirmed = await confirm({
      title: 'Remove channel?',
      description:
        'This will remove this channel from the inbox. Its messages will no longer be routed here.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeIntegration.mutate({ inboxId, integrationId: integration.integrationId })
  }

  return (
    <>
      <SettingsPage
        title={`Inbox - ${inbox?.name ?? 'Loading...'}`}
        description='Manage the channels connected to this inbox.'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Inboxes', href: '/app/settings/inbox' },
          { title: inbox?.name ?? 'Loading...' },
        ]}
        button={
          canManageInbox ? (
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              <PencilIcon />
              Edit Inbox
            </Button>
          ) : undefined
        }>
        <div className='p-3 sm:p-6'>
          {isLoading ? (
            <div className='space-y-6'>
              <InboxInfoCard loading />
              <SettingsSection icon={Waypoints} title='Connected channels'>
                <div className='@container'>
                  <div className={GRID_CLASS}>
                    {[0, 1, 2].map((i) => (
                      <ListCard key={i} loading descriptionLines={0} />
                    ))}
                  </div>
                </div>
              </SettingsSection>
            </div>
          ) : inbox && integrations ? (
            <div className='space-y-6'>
              <OrphanedPersonalInboxBanner inbox={inbox} />
              <InboxInfoCard inbox={inbox} />
              <SettingsSection
                icon={Waypoints}
                title='Connected channels'
                description='Channels routing messages into this inbox.'>
                <div className='@container'>
                  <div className={GRID_CLASS}>
                    {integrations.map((integration) => (
                      <InboxChannelCard
                        key={integration.integrationId}
                        integration={integration}
                        onRemove={handleRemove}
                        removePending={removeIntegration.isPending}
                        canOpen={canOpenChannel}
                        canRemove={canRouteChannels}
                      />
                    ))}
                    {canConnectChannels && (
                      <InboxChannelPlaceholderCard
                        onConnectNew={() => setGalleryOpen(true)}
                        onConnectExisting={() => setPickerOpen(true)}
                      />
                    )}
                  </div>
                </div>
              </SettingsSection>
            </div>
          ) : (
            <EmptyState
              icon={X}
              title='Inbox not found'
              description={<>Inbox doesn't exist...</>}
              button={
                <Button
                  onClick={() => router.push('/app/settings/inbox')}
                  className='mt-4'
                  variant='outline'>
                  Go Back
                </Button>
              }
            />
          )}
        </div>
      </SettingsPage>

      {/* Edit Dialog - pass the record layer's definition-aware RecordId. */}
      {dialogOpen && inbox && (
        <InboxDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          recordId={inbox.recordId}
          inboxSummary={inbox}
          canDelete={canRouteChannels && !inbox.isPersonal}
          onSuccess={() => utils.inbox.getIntegrations.invalidate({ inboxId })}
          onDeleted={() => router.replace('/app/settings/inbox')}
        />
      )}

      {/* Connect gallery, pre-scoped to this inbox as the delivery destination */}
      {inbox && canConnectChannels && (
        <ChannelGalleryDialog
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          initialInboxId={inbox.id}
        />
      )}

      {/* Connect an existing channel — reassigns it onto this inbox */}
      {inbox && canConnectChannels && (
        <ConnectExistingChannelDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          inboxId={inbox.id}
          onSelect={handleConnectExisting}
        />
      )}

      <ConfirmDialog />
    </>
  )
}

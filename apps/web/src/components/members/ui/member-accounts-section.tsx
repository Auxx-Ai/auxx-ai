// apps/web/src/components/members/ui/member-accounts-section.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { EmptySection } from '@auxx/ui/components/section'
import { CircleUser, Plug } from 'lucide-react'
import { ChannelCard } from '~/components/channels/ui/channel-card'
import { SettingsSection } from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { api } from '~/trpc/react'

/**
 * The member's personal connected channels, rendered with the same ChannelCard
 * grid as the Channels settings page. `channel.list` also returns org-wide shared
 * channels, so we keep only channels linked to a personal inbox this member owns.
 */
export function MemberAccountsSection({ userId }: { userId: string }) {
  const { data, isLoading } = api.channel.list.useQuery({ userId })
  const { inboxes } = useInboxes()

  // Personal accounts only: a channel linked to a personal inbox owned by this member.
  const channels = (data?.channels ?? []).filter((channel) => {
    const inbox = inboxes.find((i) => i.id === channel.inboxId)
    return inbox?.isPersonal && inbox.ownerUserId === userId
  })

  return (
    <SettingsSection
      icon={CircleUser}
      title='Accounts'
      description='Personal channels connected by this member'>
      <div className='@container space-y-2'>
        {isLoading ? (
          <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
            {[0, 1, 2].map((i) => (
              <ListCard key={i} loading descriptionLines={0} />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <EmptySection
            icon={<Plug />}
            title='No connected accounts'
            description="This member hasn't connected any personal channels."
          />
        ) : (
          <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} inboxes={inboxes} />
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}

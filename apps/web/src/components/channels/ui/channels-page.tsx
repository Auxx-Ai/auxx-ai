// apps/web/src/components/channels/ui/channels-page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Button } from '@auxx/ui/components/button'
import { ListCard } from '@auxx/ui/components/list-card'
import { Lock, Plus, Waypoints } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useOAuthReturn } from '~/components/apps/hooks/use-oauth-return'
import { useChannels, useChannelsLoading } from '~/components/channels/hooks/use-channels'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ChannelCard } from './channel-card'
import { ChannelGalleryDialog } from './channel-gallery-dialog'
import { ChannelPlaceholderCard } from './channel-placeholder-card'

const BREADCRUMBS = [{ title: 'Settings', href: '/app/settings' }, { title: 'Channels' }]

/**
 * Channels settings list page (channels v2). One section, one responsive ListCard grid with a
 * dashed placeholder that opens the gallery. Mounts `useOAuthReturn` so post-redirect connect
 * toasts fire here (the connect `returnTo` target), and opens the gallery on `?connect=1`.
 */
export function ChannelsPage() {
  const channels = useChannels()
  const isLoading = useChannelsLoading()
  const { inboxes } = useInboxes()
  const { hasAccess, isLoading: isFeatureLoading } = useFeatureFlags()
  const searchParams = useSearchParams()

  const [galleryOpen, setGalleryOpen] = useState(false)

  // Post-redirect success/error toasts (Gmail/Outlook/social connects return here).
  useOAuthReturn()

  // Deep link: `?connect=1` opens the gallery (onboarding checklist / empty states link here).
  useEffect(() => {
    if (searchParams.get('connect') === '1') setGalleryOpen(true)
  }, [searchParams])

  const canUseChannels = hasAccess(FeatureKey.channels)

  if (!isFeatureLoading && !canUseChannels) {
    return (
      <SettingsPage
        title='Channels'
        description='Connect email, chat, social, and phone channels.'
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Channels Not Available'
          description='Upgrade your plan to connect channels.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Channels'
      description='Connect email, chat, social, and phone channels.'
      breadcrumbs={BREADCRUMBS}
      button={
        <Button variant='outline' size='sm' onClick={() => setGalleryOpen(true)}>
          <Plus />
          Add
        </Button>
      }>
      <div className='p-3 sm:p-6'>
        <SettingsSection
          icon={Waypoints}
          title='Channels'
          description='Email, chat, social, and phone channels connected to your workspace.'>
          <div className='@container space-y-2'>
            {isLoading ? (
              <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
                {[0, 1, 2].map((i) => (
                  <ListCard key={i} loading descriptionLines={0} />
                ))}
              </div>
            ) : (
              <>
                {channels.length > 0 && (
                  <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
                    {channels.map((channel) => (
                      <ChannelCard key={channel.id} channel={channel} inboxes={inboxes} />
                    ))}
                  </div>
                )}
                {/* Add card sits on its own row below the grid, sized like a single tile. */}
                <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
                  <ChannelPlaceholderCard onClick={() => setGalleryOpen(true)} />
                </div>
              </>
            )}
          </div>
        </SettingsSection>
      </div>

      <ChannelGalleryDialog open={galleryOpen} onOpenChange={setGalleryOpen} />
    </SettingsPage>
  )
}

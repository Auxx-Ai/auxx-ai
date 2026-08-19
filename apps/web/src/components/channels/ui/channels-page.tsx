// apps/web/src/components/channels/ui/channels-page.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { FeatureKey } from '@auxx/lib/types'
import { ListCard } from '@auxx/ui/components/list-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Ban, Lock, Waypoints } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useOAuthReturn } from '~/components/apps/hooks/use-oauth-return'
import { useChannels, useChannelsLoading } from '~/components/channels/hooks/use-channels'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ChannelCard } from './channel-card'
import { ChannelGalleryDialog } from './channel-gallery-dialog'
import { ChannelPlaceholderCard } from './channel-placeholder-card'
import { SuppressionList } from './suppression-list'

const BREADCRUMBS = [{ title: 'Settings', href: '/app/settings' }, { title: 'Channels' }]

/**
 * Channels settings page (channels v2): "Channels" tab — one responsive ListCard grid with a
 * dashed placeholder that opens the gallery — plus an admin-only "Suppressions" tab (org-wide
 * sequence suppression list; it lives here because all mail-flow config does). Mounts
 * `useOAuthReturn` so post-redirect connect toasts fire here (the connect `returnTo` target),
 * and opens the gallery on `?connect=1`.
 */
export function ChannelsPage() {
  const channels = useChannels()
  const isLoading = useChannelsLoading()
  const { inboxes } = useInboxes()
  const { hasAccess, isLoading: isFeatureLoading } = useFeatureFlags()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { can } = useAccess()

  const [galleryOpen, setGalleryOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(() =>
    searchParams.get('tab') === 'suppressions' ? 'suppressions' : 'channels'
  )
  // `suppressionRouter`'s list/add/remove assert `channelsManage`, so the tab
  // clamp mirrors the same capability (plan 21 §10.4) — a deep link from someone
  // without the key never mounts a query that would 403.
  const effectiveTab = can(PermissionKey.channelsManage) ? activeTab : 'channels'

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    router.push(`/app/settings/channels?tab=${value}`, { scroll: false })
  }

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
    <Tabs
      value={effectiveTab}
      onValueChange={handleTabChange}
      className='flex h-full min-h-0 flex-1 flex-col'>
      <SettingsPage
        title='Channels'
        description='Connect email, chat, social, and phone channels.'
        breadcrumbs={BREADCRUMBS}
        subHeaderClassName='p-0'
        subHeader={
          can(PermissionKey.channelsManage) ? (
            <TabsList variant='outline'>
              <TabsTrigger value='channels' variant='outline'>
                <Waypoints />
                Channels
              </TabsTrigger>
              <TabsTrigger value='suppressions' variant='outline'>
                <Ban />
                Suppressions
              </TabsTrigger>
            </TabsList>
          ) : undefined
        }>
        <TabsContent value='channels'>
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
        </TabsContent>

        <TabsContent value='suppressions' className='flex flex-1 flex-col'>
          <SuppressionList />
        </TabsContent>

        <ChannelGalleryDialog
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          resumePendingConnect
        />
      </SettingsPage>
    </Tabs>
  )
}

'use client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
// ~/app/(protected)/app/settings/channels/_components/integration-tabs.tsx
import { useState } from 'react'
import { useChannel, useChannelsLoading } from '~/components/channels/hooks/use-channels'
import {
  getIntegrationStatus,
  IntegrationStatusIndicator,
} from '~/components/global/integration-status-indicator'
import { ReauthBanner } from '~/components/global/reauth-banner'
import SettingsPage from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import IntegrationRouting from './integration-routing'
import IntegrationSettingsAdvanced from './integration-settings-advanced'

/**
 * IntegrationTabs component
 * Displays tabs for routing and settings for a specific integration
 */
export default function IntegrationTabs() {
  const { integrationId } = useParams<{ integrationId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = searchParams?.get('tab') || 'routing'
  const [activeTab, setActiveTab] = useState(initialTab)

  const isIntegrationsLoading = useChannelsLoading()
  const integration = useChannel(integrationId)

  // `channels.manage`, or the owner of this personal channel — the client mirror
  // of `requireChannelManageAccess`. Keyed on the CAPABILITY, not the legacy
  // ADMIN/OWNER role: the server gate is `channels.manage`, so a member granted
  // it through a permission profile must not land on a read-only page.
  const { can } = useAccess()
  const { userId } = useUser()
  const canManageAnyChannel = can(PermissionKey.channelsManage)
  const { inboxes } = useInboxes()
  const linkedInbox = integration?.inboxId
    ? inboxes.find((inbox) => inbox.id === integration.inboxId)
    : undefined
  const canManage =
    canManageAnyChannel || (!!linkedInbox?.isPersonal && linkedInbox.ownerUserId === userId)

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    router.push(`/app/settings/channels/${integrationId}?tab=${value}`, { scroll: false })
  }

  /**
   * Where "back" goes. The Channels list page is guarded on `channels.manage`
   * (`settings/channels/page.tsx`), so a personal-channel owner who reached this
   * page from their inbox would be bounced by the page guard. Send them back to
   * the inbox they came from instead.
   */
  const parentCrumb = canManageAnyChannel
    ? { title: 'Channels', href: '/app/settings/channels' }
    : {
        title: linkedInbox?.name ?? 'Inboxes',
        href: linkedInbox ? `/app/settings/inbox/${linkedInbox.id}` : '/app/settings/inbox',
      }

  const handleBack = () => {
    router.push(parentCrumb.href)
  }

  // Loading state
  if (isIntegrationsLoading) {
    return (
      <SettingsPage
        title={'Loading...'}
        description={'Manage your integration settings'}
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          parentCrumb,
          { title: 'Loading...' },
        ]}>
        <div className='space-y-6 p-3 sm:p-6'>
          <Skeleton className='h-64 w-full' />
        </div>
      </SettingsPage>
    )
  }

  // Error state - integration not found
  if (!integration) {
    return (
      <div className='space-y-6'>
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back to {parentCrumb.title}
        </Button>
        <div className='rounded-md border p-8 text-center'>
          <h2 className='text-xl font-bold'>Integration not found</h2>
          <p className='mt-2 text-muted-foreground'>
            The requested integration could not be found. It may have been removed.
          </p>
          <Button className='mt-4' onClick={handleBack}>
            Return to {parentCrumb.title}
          </Button>
        </div>
      </div>
    )
  }
  const title = `${getProviderName(integration.provider, integration.metadata)} Integration`

  // Check if integration requires re-authentication using actual database fields
  const requiresReauth = integration.requiresReauth || false
  const integrationStatus = getIntegrationStatus({
    enabled: integration.enabled,
    requiresReauth,
    lastAuthError: integration.lastAuthError,
    lastSyncedAt: integration.lastSyncedAt!,
    syncStatus: integration.syncStatus,
  })

  return (
    <Tabs defaultValue={activeTab} onValueChange={handleTabChange} className='w-full'>
      <SettingsPage
        title={title}
        description={integration.identifier || 'Manage your integration settings'}
        breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, parentCrumb, { title }]}
        button={
          <div className='flex items-center gap-3'>
            <IntegrationStatusIndicator
              status={integrationStatus}
              syncStage={integration.syncStage}
              pendingImportCount={integration.pendingImportCount}
              lastSyncAt={integration.lastSyncedAt}
              lastError={integration.lastAuthError}
              size='sm'
            />
            <TabsList>
              <TabsTrigger value='routing'>Routing</TabsTrigger>
              <TabsTrigger value='settings'>Settings</TabsTrigger>
            </TabsList>
          </div>
        }>
        <div className='space-y-4'>
          {/* Re-authentication Banner */}
          {requiresReauth && (
            <ReauthBanner
              integration={{
                id: integration.id,
                provider: integration.provider,
                email: integration.email,
                name: integration.name!,
                lastAuthError: integration.lastAuthError,
                lastAuthErrorAt: integration.lastAuthErrorAt!,
                requiresReauth: true,
                metadata: integration.metadata,
              }}
            />
          )}

          <TabsContent value='routing' className='space-y-4'>
            <IntegrationRouting
              integration={integration}
              canManage={canManage}
              isPersonalChannel={!!linkedInbox?.isPersonal}
            />
          </TabsContent>

          <TabsContent value='settings' className='space-y-4'>
            <IntegrationSettingsAdvanced integration={integration} canManage={canManage} />
          </TabsContent>
        </div>
      </SettingsPage>
    </Tabs>
  )
}

/**
 * Get provider display name
 */
function getProviderName(provider: string, metadata?: any) {
  if (provider === 'email' && metadata?.channelType === 'forwarding-address') {
    return 'Forwarding'
  }
  switch (provider.toLowerCase()) {
    case 'google':
      return 'Gmail'
    case 'outlook':
      return 'Outlook'
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    case 'openphone':
      return 'Quo'
    default:
      return provider
  }
}

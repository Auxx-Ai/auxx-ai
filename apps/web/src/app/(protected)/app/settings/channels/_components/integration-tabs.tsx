'use client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
// ~/app/(protected)/app/settings/channels/_components/integration-tabs.tsx
import { useState } from 'react'
import {
  getIntegrationStatus,
  IntegrationStatusIndicator,
} from '~/components/global/integration-status-indicator'
import { ReauthBanner } from '~/components/global/reauth-banner'
import SettingsPage from '~/components/global/settings-page'
import { useIntegration } from '~/hooks/use-integration'
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

  const { integrations, isLoading: isIntegrationsLoading } = useIntegration()

  const integration = integrations?.integrations?.find((item) => item.id === integrationId)

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    router.push(`/app/settings/channels/${integrationId}?tab=${value}`, { scroll: false })
  }

  // Handle back button click
  const handleBack = () => {
    router.push('/app/settings/channels')
  }

  // Loading state
  if (isIntegrationsLoading) {
    return (
      <SettingsPage
        title={'Loading...'}
        description={'Manage your integration settings'}
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Channels', href: '/app/settings/channels' },
          { title: 'Loading...' },
        ]}>
        <div className='space-y-6 p-6'>
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
          Back to Channels
        </Button>
        <div className='rounded-md border p-8 text-center'>
          <h2 className='text-xl font-bold'>Integration not found</h2>
          <p className='mt-2 text-muted-foreground'>
            The requested integration could not be found. It may have been removed.
          </p>
          <Button className='mt-4' onClick={handleBack}>
            Return to Channels
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
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Channels', href: '/app/settings/channels' },
          { title },
        ]}
        button={
          <div className='flex items-center gap-3'>
            <IntegrationStatusIndicator
              status={integrationStatus}
              syncStage={integration.syncStage}
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
              }}
            />
          )}

          <TabsContent value='routing' className='space-y-4'>
            <IntegrationRouting integration={integration} />
          </TabsContent>

          <TabsContent value='settings' className='space-y-4'>
            <IntegrationSettingsAdvanced integration={integration} />
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
      return 'OpenPhone'
    default:
      return provider
  }
}

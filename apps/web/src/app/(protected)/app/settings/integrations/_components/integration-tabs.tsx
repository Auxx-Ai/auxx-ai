'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-tabs.tsx
import React, { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { useIntegration } from '~/hooks/use-integration'
import { useInbox } from '~/hooks/use-inbox'
import IntegrationRouting from './integration-routing'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import IntegrationSettingsAdvanced from './integration-settings-advanced'
import SettingsPage from '~/components/global/settings-page'
import { ReauthBanner } from '~/components/global/reauth-banner'
import {
  IntegrationStatusIndicator,
  getIntegrationStatus,
} from '~/components/global/integration-status-indicator'

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
  const { inboxes, isLoading: isInboxesLoading } = useInbox()

  const integration = integrations?.integrations?.find((item) => item.id === integrationId)

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    router.push(`/app/settings/integrations/${integrationId}?tab=${value}`, { scroll: false })
  }

  // Handle back button click
  const handleBack = () => {
    router.push('/app/settings/integrations')
  }

  // Loading state
  if (isIntegrationsLoading || isInboxesLoading) {
    return (
      <SettingsPage
        title={'Loading...'}
        description={'Manage your integration settings'}
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Integrations', href: '/app/settings/integrations' },
          { title: 'Loading...' },
        ]}>
        <div className="space-y-6 p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      </SettingsPage>
    )
  }

  // Error state - integration not found
  if (!integration) {
    return (
      <div className="space-y-6">
        <Button variant="outline" size="sm" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Integrations
        </Button>
        <div className="rounded-md border p-8 text-center">
          <h2 className="text-xl font-bold">Integration not found</h2>
          <p className="mt-2 text-muted-foreground">
            The requested integration could not be found. It may have been removed.
          </p>
          <Button className="mt-4" onClick={handleBack}>
            Return to Integrations List
          </Button>
        </div>
      </div>
    )
  }
  const title = `${getProviderName(integration.provider)} Integration`

  // Check if integration requires re-authentication using actual database fields
  const requiresReauth = integration.requiresReauth || false
  const integrationStatus = getIntegrationStatus({
    enabled: integration.enabled,
    requiresReauth,
    lastAuthError: integration.lastAuthError,
    lastSyncedAt: integration.lastSyncedAt!,
  })

  return (
    <Tabs defaultValue={activeTab} onValueChange={handleTabChange} className="w-full">
      <SettingsPage
        title={title}
        description={integration.identifier || 'Manage your integration settings'}
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Integrations', href: '/app/settings/integrations' },
          { title },
        ]}
        button={
          <div className="flex items-center gap-3">
            <IntegrationStatusIndicator
              status={integrationStatus}
              lastSyncAt={integration.lastSyncedAt}
              lastError={integration.lastAuthError}
              size="sm"
            />
            <TabsList>
              <TabsTrigger value="routing">Routing</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
          </div>
        }>
        <div className="space-y-4">
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

          <TabsContent value="routing" className="space-y-4">
            <IntegrationRouting integration={integration} inboxes={inboxes || []} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
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
function getProviderName(provider: string) {
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

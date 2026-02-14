// ~/app/(protected)/app/settings/integrations/[integrationId]/page.tsx
'use client' // Required for useParams and conditional rendering logic

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import ChatWidgetSettings from '../_components/chat-widget-settings' // Import the new page component
import IntegrationTabs from '../_components/integration-tabs' // For non-chat integrations

/**
 * Integration Settings/Edit Page
 * Dynamically renders settings UI based on the integration provider type.
 */
export default function IntegrationSettingsPage() {
  const params = useParams()
  const integrationId = params?.integrationId as string | undefined

  // Fetch basic integration info just to get the provider type
  const {
    data: integrationBaseInfo,
    isLoading,
    error,
  } = api.integration.getProviderType.useQuery(
    { integrationId: integrationId! },
    {
      enabled: !!integrationId, // Only run query if integrationId is available
      staleTime: 5 * 60 * 1000, // Cache for 5 mins
      retry: false, // Don't retry if not found initially
    }
  )

  if (!integrationId) {
    // Should ideally not happen with correct routing setup
    return <div className='container py-6'>Invalid Integration ID.</div>
  }

  if (isLoading) {
    return (
      <div className='container space-y-4 py-6'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-10 w-full max-w-md' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  if (error || !integrationBaseInfo) {
    return (
      <div className='container py-6'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load integration details: {error?.message || 'Integration not found.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Conditional Rendering based on provider type
  return (
    <>
      {integrationBaseInfo.provider === 'chat' ? (
        // Render the dedicated Chat Widget settings page
        <ChatWidgetSettings integrationId={integrationId} />
      ) : (
        // Render the standard tabs for other integration types
        <IntegrationTabs
          integrationId={integrationId}
          providerType={integrationBaseInfo.provider}
        />
      )}
    </>
  )
}

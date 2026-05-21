// apps/web/src/app/(protected)/app/settings/channels/[integrationId]/page.tsx
'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { ChatWidgetSettings } from '~/components/chat-widget'
import { api } from '~/trpc/react'
import IntegrationTabs from '../_components/integration-tabs'

/**
 * Channel Settings Page
 * Dynamically renders settings UI based on the channel provider type.
 */
export default function IntegrationSettingsPage() {
  const params = useParams()
  const integrationId = params?.integrationId as string | undefined

  const {
    data: integrationBaseInfo,
    isLoading,
    error,
  } = api.channel.getProviderType.useQuery(
    { integrationId: integrationId! },
    {
      enabled: !!integrationId,
      staleTime: 5 * 60 * 1000,
      retry: false,
    }
  )

  if (!integrationId) {
    return <div className='container py-6'>Invalid Channel ID.</div>
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
            Failed to load channel details: {error?.message || 'Channel not found.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (integrationBaseInfo.provider === 'chat') {
    return <ChatWidgetSettings channelId={integrationId} />
  }
  return <IntegrationTabs />
}

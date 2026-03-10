// /Users/mklooth/Sites/auxx-ai/apps/web/src/app/(protected)/app/settings/integrations/new/[integrationType]/[integrationId]/page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { CheckCircle, XCircle } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'

/**
 * NewIntegrationSuccess component
 * Displays the result of a new integration setup
 * Note: [integrationType] is a route param representing integration.provider (not removed schema field)
 */
export default function NewIntegrationSuccess() {
  // Get URL parameters
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()

  const utils = api.useUtils()

  // Extract params from URL
  // Note: integrationType route parameter represents the provider type
  const integrationId = searchParams.get('integrationId')
  const integrationType = params.integrationType as string
  const success = searchParams.get('success') === 'true'
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // biome-ignore lint/correctness/useExhaustiveDependencies: utils.user.me.invalidate is stable
  useEffect(() => {
    // Show appropriate toast based on success/error status
    if (success) {
      toastSuccess({
        title: 'Integration successful',
        description: `Your ${integrationType} integration has been set up successfully.`,
      })

      utils.user.me.invalidate()
    } else if (error) {
      toastError({
        title: 'Integration failed',
        description: error || 'There was an error setting up your integration.',
      })
    }
  }, [success, error, integrationType])

  // Navigate back to integrations page
  const handleReturn = () => {
    router.push('/app/settings/channels')
  }

  return (
    <SettingsPage
      title={`${integrationType} Integration`}
      description='Setup your new integration'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: 'Add New Channel', href: '/app/settings/channels/new' },
        { title: integrationType },
      ]}>
      <div className='p-6'>
        <Card className='max-w-md mx-auto mt-10'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {success ? (
                <>
                  <CheckCircle className='text-green-500' />
                  Channel Connected
                </>
              ) : (
                <>
                  <XCircle className='text-red-500' />
                  Channel Connection Failed
                </>
              )}
            </CardTitle>
            <CardDescription>
              {integrationType.charAt(0).toUpperCase() + integrationType.slice(1)} integration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className='mb-4'>
              {success
                ? `Your ${integrationType} integration has been successfully set up.`
                : `There was an error setting up your ${integrationType} integration: ${errorDescription || 'Unknown error'}`}
            </p>
            <Button onClick={handleReturn}>Return to Channels</Button>
          </CardContent>
        </Card>
      </div>
    </SettingsPage>
  )
}

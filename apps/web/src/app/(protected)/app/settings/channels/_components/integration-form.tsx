// apps/web/src/app/(protected)/app/settings/channels/_components/integration-form.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import ImapConnectForm from './imap-connect-form'
import { getIntegrationProviderIcon } from './integration-table'
import ProviderCredentialsForm from './provider-credentials-form'

interface IntegrationFormProps {
  type: string
}

/**
 * IntegrationForm component
 * Renders the appropriate form based on integration type
 */
export default function IntegrationForm({ type }: IntegrationFormProps) {
  const router = useRouter()
  const getAuthUrl = api.channel.getAuthUrl.useMutation({
    onError: (error) => {
      toastError({ title: 'Error generating authentication URL', description: error.message })
    },
  })

  // For OAuth providers (google/outlook), check credential status
  const isOAuthProvider = type === 'google' || type === 'outlook'
  const { data: credentialStatus, isLoading: isLoadingStatus } =
    api.channel.getProviderCredentialStatus.useQuery(
      { provider: type as 'google' | 'outlook' },
      { enabled: isOAuthProvider }
    )

  // Handle OAuth connection
  const handleOAuthConnect = () => {
    getAuthUrl.mutate(
      {
        provider: type as any,
        redirectPath: '/app/settings/channels',
      },
      {
        onSuccess: (data) => {
          if (data.authUrl) {
            window.location.href = data.authUrl
          }
        },
      }
    )
  }

  // Handle going back
  const handleBack = () => {
    router.push('/app/settings/channels/new')
  }

  // Render the form based on integration type
  const renderForm = () => {
    switch (type.toLowerCase()) {
      // OAuth-based integrations that support BYOC
      case 'google':
      case 'outlook': {
        if (isLoadingStatus) {
          return (
            <div className='flex items-center justify-center p-8'>
              <div className='text-sm text-muted-foreground'>Loading...</div>
            </div>
          )
        }

        // Show credential form if platform credentials aren't available and org has no custom creds
        const needsCustomCredentials =
          !credentialStatus?.platformCredentialsAvailable && !credentialStatus?.hasCustomCredentials

        if (needsCustomCredentials) {
          return (
            <ProviderCredentialsForm
              provider={type as 'google' | 'outlook'}
              onCredentialsSaved={handleOAuthConnect}
              onBack={handleBack}
            />
          )
        }

        // Platform credentials available or org already has custom creds — show normal connect
        return (
          <div className='flex flex-col space-y-1.5 p-3'>
            <div className='flex flex-col space-y-1.5'>
              <div className='flex items-center space-x-2'>
                {getIntegrationProviderIcon(type, 'size-6')}
                <div className='font-semibold leading-none tracking-tight'>Connect {type}</div>
              </div>
              <div className='text-sm text-muted-foreground'>
                Connect your {type} account to start receiving and managing messages
              </div>
            </div>
            {credentialStatus?.hasCustomCredentials && (
              <div className='rounded-md border p-2 text-xs text-muted-foreground'>
                Using your {credentialStatus.displayName} credentials
                {credentialStatus.clientId && (
                  <span className='ml-1 font-mono'>
                    ({credentialStatus.clientId.slice(0, 12)}...)
                  </span>
                )}
              </div>
            )}
            <div className='flex items-center '>
              <p className='mb-4 text-sm text-muted-foreground'>
                Click the button below to authorize access to your {type} account. You will be
                redirected to {type} to complete the authorization process.
              </p>
            </div>
            <div className='flex justify-between'>
              <Button type='button' variant='outline' onClick={handleBack}>
                <ArrowLeft />
                Back
              </Button>
              <Button
                variant='info'
                onClick={handleOAuthConnect}
                disabled={getAuthUrl.isPending}
                loading={getAuthUrl.isPending}
                loadingText='Connecting...'>
                {`Connect to ${type}`}
              </Button>
            </div>
          </div>
        )
      }

      // Other OAuth-based integrations (no BYOC support yet)
      case 'facebook':
      case 'instagram':
        return (
          <div className='flex flex-col space-y-1.5 p-3'>
            <div className='flex flex-col space-y-1.5'>
              <div className='flex items-center space-x-2'>
                {getIntegrationProviderIcon(type, 'size-6')}
                <div className='font-semibold leading-none tracking-tight'>Connect {type}</div>
              </div>
              <div className='text-sm text-muted-foreground'>
                Connect your {type} account to start receiving and managing messages
              </div>
            </div>
            <div className='flex items-center '>
              <p className='mb-4 text-sm text-muted-foreground'>
                Click the button below to authorize access to your {type} account. You will be
                redirected to {type} to complete the authorization process.
              </p>
            </div>
            <div className='flex justify-between'>
              <Button type='button' variant='outline' onClick={handleBack}>
                <ArrowLeft />
                Back
              </Button>
              <Button
                variant='info'
                onClick={handleOAuthConnect}
                disabled={getAuthUrl.isPending}
                loading={getAuthUrl.isPending}
                loadingText='Connecting...'>
                {`Connect to ${type}`}
              </Button>
            </div>
          </div>
        )

      case 'imap':
        return <ImapConnectForm onBack={handleBack} />

      // Default case
      default:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Unsupported Integration Type</CardTitle>
              <CardDescription>
                The selected integration type is not currently supported
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-muted-foreground'>
                Please go back and select a different integration type.
              </p>
            </CardContent>
            <CardFooter>
              <Button type='button' variant='outline' onClick={handleBack}>
                <ArrowLeft />
                Go Back
              </Button>
            </CardFooter>
          </Card>
        )
    }
  }

  return (
    <SettingsPage
      title={`${type} Integration`}
      description='Setup your new integration'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: 'Add New Channel', href: '/app/settings/channels/new' },
        { title: type },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft />
          Back
        </Button>
      }>
      <div className='mt-6 mx-auto border rounded-lg p-4 max-w-2xl'>{renderForm()}</div>
    </SettingsPage>
  )
}

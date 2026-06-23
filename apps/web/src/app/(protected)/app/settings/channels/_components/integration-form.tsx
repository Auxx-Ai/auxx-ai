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
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import ImapConnectForm from './imap-connect-form'
import { getIntegrationProviderIcon } from './integration-table'

interface IntegrationFormProps {
  type: string
}

/**
 * IntegrationForm component
 * Renders the appropriate form based on integration type
 */
export default function IntegrationForm({ type }: IntegrationFormProps) {
  const router = useRouter()

  // Gmail/Outlook/Facebook/Instagram all connect via the unified connections OAuth flow.
  const isOAuthChannel =
    type === 'google' || type === 'outlook' || type === 'facebook' || type === 'instagram'
  const { data: prep, isLoading: isLoadingPrep } = api.channel.prepareConnect.useQuery(
    { provider: type as 'google' | 'outlook' | 'facebook' | 'instagram' },
    { enabled: isOAuthChannel }
  )
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirecting, setRedirecting] = useState(false)

  const handleChannelConnect = () => {
    if (!prep) return
    const url = new URL(prep.authorizeUrl, window.location.origin)
    url.searchParams.set('returnTo', '/app/settings/channels')
    if (prep.requiresOwnClient) {
      url.searchParams.set('var_clientId', clientId.trim())
      url.searchParams.set('var_clientSecret', clientSecret.trim())
    }
    setRedirecting(true)
    window.location.href = url.toString()
  }

  // Handle going back
  const handleBack = () => {
    router.push('/app/settings/channels/new')
  }

  // Render the form based on integration type
  const renderForm = () => {
    switch (type.toLowerCase()) {
      // OAuth channels (email + social) — routed through the unified connections flow.
      case 'google':
      case 'outlook':
      case 'facebook':
      case 'instagram': {
        if (isLoadingPrep || !prep) {
          return (
            <div className='flex items-center justify-center p-8'>
              <div className='text-sm text-muted-foreground'>Loading...</div>
            </div>
          )
        }

        const needsOwnClient = prep.requiresOwnClient
        const ownClientReady = !needsOwnClient || (!!clientId.trim() && !!clientSecret.trim())

        return (
          <div className='flex flex-col space-y-3 p-3'>
            <div className='flex flex-col space-y-1.5'>
              <div className='flex items-center space-x-2'>
                {getIntegrationProviderIcon(type, 'size-6')}
                <div className='font-semibold leading-none tracking-tight'>Connect {type}</div>
              </div>
              <div className='text-sm text-muted-foreground'>
                Connect your {type} account to start receiving and managing messages
              </div>
            </div>

            {needsOwnClient ? (
              <div className='space-y-2 rounded-md border p-3'>
                <p className='text-xs text-muted-foreground'>
                  {prep.ownClientReason === 'pending-approval'
                    ? `Our platform ${type} app is pending verification — connect with your own OAuth client for now.`
                    : `No platform ${type} app is configured — enter your own OAuth client credentials.`}
                </p>
                <div className='space-y-1.5'>
                  <Label htmlFor='clientId'>Client ID</Label>
                  <Input
                    id='clientId'
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder='Your OAuth client id'
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='clientSecret'>Client Secret</Label>
                  <Input
                    id='clientSecret'
                    type='password'
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder='Your OAuth client secret'
                  />
                </div>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                Click the button below to authorize access to your {type} account. You will be
                redirected to {type} to complete the authorization process.
              </p>
            )}

            <div className='flex justify-between'>
              <Button type='button' variant='outline' onClick={handleBack}>
                <ArrowLeft />
                Back
              </Button>
              <Button
                variant='info'
                onClick={handleChannelConnect}
                disabled={!ownClientReady || redirecting}
                loading={redirecting}
                loadingText='Connecting...'>
                {`Connect to ${type}`}
              </Button>
            </div>
          </div>
        )
      }

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

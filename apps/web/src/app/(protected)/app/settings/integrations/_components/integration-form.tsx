'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-form.tsx
import React from 'react'
import { useIntegration } from '~/hooks/use-integration'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { ArrowLeft, Mail, Facebook, Instagram } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { GoogleIcon } from '~/constants/icons'
import OpenPhoneIntegrationForm from './openphone-integration-form'
import SettingsPage from '~/components/global/settings-page'

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
  const { getAuthUrl } = useIntegration()

  // Handle OAuth connection
  const handleOAuthConnect = () => {
    getAuthUrl.mutate(
      {
        provider: type as any, // Cast to expected enum type
        redirectPath: '/app/settings/integrations',
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
    router.push('/app/settings/integrations/new')
  }

  // Render the form based on integration type
  const renderForm = () => {
    switch (type.toLowerCase()) {
      // OAuth-based integrations
      case 'google':
      case 'outlook':
      case 'facebook':
      case 'instagram':
        return (
          <div className="flex flex-col space-y-1.5 p-3">
            <div className="flex flex-col space-y-1.5">
              <div className="flex items-center space-x-2">
                {getIntegrationProviderIcon(type, 'size-6')}
                <div className="font-semibold leading-none tracking-tight">Connect {type}</div>
              </div>
              <div className="text-sm text-muted-foreground">
                Connect your {type} account to start receiving and managing messages
              </div>
            </div>
            <div className="flex items-center ">
              <p className="mb-4 text-sm text-muted-foreground">
                Click the button below to authorize access to your {type} account. You will be
                redirected to {type} to complete the authorization process.
              </p>
            </div>
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={handleBack}>
                <ArrowLeft />
                Back
              </Button>
              <Button
                variant="info"
                onClick={handleOAuthConnect}
                disabled={getAuthUrl.isPending}
                loading={getAuthUrl.isPending}
                loadingText="Connecting...">
                {`Connect to ${type}`}
              </Button>
            </div>
          </div>
        )

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
              <p className="text-sm text-muted-foreground">
                Please go back and select a different integration type.
              </p>
            </CardContent>
            <CardFooter>
              <Button type="button" variant="outline" onClick={handleBack}>
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
      description="Setup your new integration"
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Integrations', href: '/app/settings/integrations' },
        { title: 'Add New Integration', href: '/app/settings/integrations/new' },
        { title: type },
      ]}
      button={
        <Button variant="outline" size="sm" onClick={handleBack}>
          <ArrowLeft />
          Back
        </Button>
      }>
      <div className="mt-6 mx-auto border rounded-lg p-4 max-w-2xl">{renderForm()}</div>
    </SettingsPage>
  )
}

// apps/web/src/app/(protected)/app/settings/channels/new/page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ArrowLeft, Mail, MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppListCard } from '~/components/apps/app-list-card'
import SettingsPage from '~/components/global/settings-page'
import { getIntegrationProviderIcon } from '../_components/integration-table'

/**
 * Integration Chooser Page
 * Allows users to select which type of integration to connect
 */
export default function IntegrationChooserPage() {
  const router = useRouter()

  const handleBack = () => {
    router.push('/app/settings/channels')
  }

  const integrations = [
    {
      type: 'google',
      title: 'Gmail',
      subtitle: 'Email',
      description: 'Connect your Gmail account to send and receive emails',
    },
    {
      type: 'outlook',
      title: 'Outlook',
      subtitle: 'Email',
      description: 'Connect your Microsoft Outlook account to send and receive emails',
    },
    {
      type: 'imap',
      title: 'IMAP Email',
      subtitle: 'Email',
      description: 'Connect any IMAP/SMTP email server (self-hosted, enterprise)',
      icon: <Mail className='size-4' />,
    },
    {
      type: 'facebook',
      title: 'Facebook',
      subtitle: 'Social',
      description: 'Connect your Facebook page to manage messages and comments',
    },
    {
      type: 'instagram',
      title: 'Instagram',
      subtitle: 'Social',
      description: 'Connect your Instagram account to manage direct messages',
    },
    {
      type: 'openphone',
      title: 'OpenPhone',
      subtitle: 'Phone',
      description: 'Connect your OpenPhone account to send and receive SMS messages',
    },
    {
      type: 'chat',
      title: 'Chat Widget',
      subtitle: 'Chat',
      description: 'Create a live chat widget for your website',
      icon: <MessageSquare className='size-4' />,
    },
    {
      type: 'whatsapp',
      title: 'WhatsApp',
      subtitle: 'Social',
      description: 'Connect your WhatsApp Business account to manage conversations',
    },
  ]

  return (
    <SettingsPage
      title='Add a New Channel'
      description='Select a service to connect to your workspace'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: 'Add New Channel' },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back to Channels
        </Button>
      }>
      <div className='space-y-4 sm:space-y-6 p-3 sm:p-6'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {integrations.map((integration) => (
            <AppListCard
              key={integration.type}
              title={integration.title}
              description={integration.description}
              href={`/app/settings/channels/new/${integration.type}`}
              icon={integration.icon ?? getIntegrationProviderIcon(integration.type, 'size-4')}
              subtitle={integration.subtitle}
            />
          ))}
        </div>
      </div>
    </SettingsPage>
  )
}

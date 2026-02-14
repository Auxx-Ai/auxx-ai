'use client'
import { Button } from '@auxx/ui/components/button'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import SettingsPage from '~/components/global/settings-page'
import IntegrationCard from '../_components/integration-card'

/**
 * Integration Chooser Page
 * Allows users to select which type of integration to connect
 */
export default function IntegrationChooserPage() {
  const router = useRouter()

  const handleBack = () => {
    router.push('/app/settings/integrations')
  }

  return (
    <SettingsPage
      title='Add a New Integration'
      description='Select a service to connect to your workspace'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Integrations', href: '/app/settings/integrations' },
        { title: 'Add New Integration' },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back to Integrations
        </Button>
      }>
      <div className='space-y-6 p-6'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {/* Email Integrations */}
          <IntegrationCard
            type='google'
            title='Gmail'
            description='Connect your Gmail account to send and receive emails'
          />

          <IntegrationCard
            type='outlook'
            title='Outlook'
            description='Connect your Microsoft Outlook account to send and receive emails'
          />

          {/* Social Media Integrations */}
          <IntegrationCard
            type='facebook'
            title='Facebook'
            description='Connect your Facebook page to manage messages and comments'
          />

          <IntegrationCard
            type='instagram'
            title='Instagram'
            description='Connect your Instagram account to manage direct messages'
            comingSoon={false}
          />

          {/* Phone Integrations */}
          <IntegrationCard
            type='openphone'
            title='OpenPhone'
            description='Connect your OpenPhone account to send and receive SMS messages'
          />
          <IntegrationCard
            type='chat' // Use the provider key
            title='Chat Widget'
            description='Create a live chat widget for your website'
            icon={<MessageSquare className='h-8 w-8 text-indigo-500' />} // Custom icon
          />

          {/* Additional Integration Types (Coming Soon) */}
          <IntegrationCard
            type='whatsapp'
            title='WhatsApp'
            description='Connect your WhatsApp Business account to manage conversations'
            comingSoon={true}
          />
        </div>
      </div>
    </SettingsPage>
  )
}

// apps/web/src/app/(protected)/app/settings/channels/new/page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ListCard } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowLeft, Mail, MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import { platformScope, platformTarget } from '~/components/connections/ui/connection-targets'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { getIntegrationProviderIcon } from '../_components/integration-table'

interface ChannelOption {
  type: string
  title: string
  subtitle: string
  description: string
  icon?: React.ReactNode
  /** If set, clicking the card runs this instead of navigating to /new/{type}. */
  createInline?: boolean
  /**
   * If set, clicking the card opens the shared connect dialog for this platform provider
   * (via `useConnectFlow`) instead of navigating to /new/{type}. Used for secret channels
   * that connect through the generic connections surface.
   */
  connectProviderKey?: string
}

/**
 * Integration Chooser Page
 * Allows users to select which type of integration to connect
 */
export default function IntegrationChooserPage() {
  const router = useRouter()
  const utils = api.useUtils()
  const createChatChannel = api.channel.createChatChannel.useMutation({
    onSuccess: ({ channelId }) => {
      utils.channel.list.invalidate()
      router.push(`/app/settings/channels/${channelId}`)
    },
    onError: (e) => toastError({ title: 'Failed to create chat widget', description: e.message }),
  })

  // Secret channels (e.g. Quo/OpenPhone) connect through the generic connections surface: the
  // shared field dialog persists via `connections.save`, whose provisioning hook creates the
  // channel. The provider's `connectionVariables` drive the form — no bespoke per-channel route.
  const { data: providers = [] } = api.connections.listProviders.useQuery()
  const flow = useConnectFlow({
    showName: true,
    onConnected: () => {
      utils.channel.list.invalidate()
      router.push('/app/settings/channels')
    },
  })

  const connectProvider = (providerKey: string) => {
    const provider = providers.find((p) => p.providerKey === providerKey)
    if (!provider) return
    flow.start({ target: platformTarget(provider), scope: platformScope(provider) })
  }

  const handleBack = () => {
    router.push('/app/settings/channels')
  }

  const integrations: ChannelOption[] = [
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
      title: 'Quo',
      subtitle: 'Phone',
      description: 'Connect your Quo (OpenPhone) account to send and receive SMS messages',
      connectProviderKey: 'openphone',
    },
    {
      type: 'chat',
      title: 'Chat Widget',
      subtitle: 'Chat',
      description: 'Create a live chat widget for your website',
      icon: <MessageSquare className='size-4' />,
      createInline: true,
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
          {integrations.map((integration) => {
            const icon = integration.icon ?? getIntegrationProviderIcon(integration.type, 'size-4')
            if (integration.createInline) {
              return (
                <ListCard
                  key={integration.type}
                  title={integration.title}
                  description={integration.description}
                  onClick={() => createChatChannel.mutate()}
                  disabled={createChatChannel.isPending}
                  icon={icon}
                  subtitle={integration.subtitle}
                />
              )
            }
            if (integration.connectProviderKey) {
              const providerKey = integration.connectProviderKey
              return (
                <ListCard
                  key={integration.type}
                  title={integration.title}
                  description={integration.description}
                  onClick={() => connectProvider(providerKey)}
                  disabled={flow.pending}
                  icon={icon}
                  subtitle={integration.subtitle}
                />
              )
            }
            return (
              <ListCard
                key={integration.type}
                title={integration.title}
                description={integration.description}
                href={`/app/settings/channels/new/${integration.type}`}
                icon={icon}
                subtitle={integration.subtitle}
              />
            )
          })}
        </div>
      </div>
      {flow.Dialogs}
    </SettingsPage>
  )
}

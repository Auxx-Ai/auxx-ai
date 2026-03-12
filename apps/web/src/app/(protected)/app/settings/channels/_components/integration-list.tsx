'use client'
import { FeatureKey } from '@auxx/lib/types'
import { Button } from '@auxx/ui/components/button'
import { Plus, Waypoints } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useChannels, useChannelsLoading } from '~/components/channels/hooks/use-channels'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import IntegrationTable from './integration-table'

/**
 * IntegrationList component
 * Displays a list of integrations and provides functionality to manage them
 */
export default function IntegrationList() {
  const router = useRouter()
  const channels = useChannels()
  const isLoading = useChannelsLoading()
  const { inboxes } = useInboxes()

  const { hasAccess, getLimit, isLoading: isFeatureLoading } = useFeatureFlags()

  const canUseChannels = hasAccess(FeatureKey.CHANNELS)
  const channelsLimit = getLimit(FeatureKey.CHANNELS)

  // Handle click on New Integration button
  const handleNewIntegration = () => {
    router.push('/app/settings/channels/new')
  }

  return (
    <SettingsPage
      title='Channels'
      description='Manage your external service channels for email, messaging, and telephony'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Channels' }]}
      button={
        <Button
          variant='outline'
          size='sm'
          onClick={handleNewIntegration}
          disabled={isFeatureLoading || !canUseChannels}>
          <Plus />
          New Channel
        </Button>
      }>
      {isLoading ? (
        <EmptyState
          icon={Waypoints}
          iconClassName='animate-spin'
          title='Loading Channels...'
          description='&nbsp;'
          button={<div className='h-12'></div>}
        />
      ) : channels.length > 0 ? (
        <IntegrationTable integrations={channels} inboxes={inboxes || []} />
      ) : (
        <EmptyState
          icon={Waypoints}
          title='No Channels Found'
          description={
            <>
              Connect your first channel to start <br />
              receiving and managing messages.
            </>
          }
          button={
            <Button onClick={handleNewIntegration} size='sm' variant='outline'>
              <Plus />
              Connect your first channel
            </Button>
          }
        />
      )}
    </SettingsPage>
  )
}

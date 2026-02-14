'use client'
import { FeatureKey } from '@auxx/lib/types'
import { Button } from '@auxx/ui/components/button'
import { Plus, Waypoints } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useInboxes } from '~/components/threads/hooks'
import { useIntegration } from '~/hooks/use-integration'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import IntegrationTable from './integration-table'

/**
 * IntegrationList component
 * Displays a list of integrations and provides functionality to manage them
 */
export default function IntegrationList() {
  const router = useRouter()
  const { integrations, isLoading } = useIntegration()
  const { inboxes } = useInboxes()

  const { hasAccess, getLimit, isLoading: isFeatureLoading } = useFeatureFlags()

  const canUseChannels = hasAccess(FeatureKey.CHANNELS)
  const channelsLimit = getLimit(FeatureKey.CHANNELS)

  // Handle click on New Integration button
  const handleNewIntegration = () => {
    router.push('/app/settings/integrations/new')
  }

  return (
    <SettingsPage
      title='Integrations'
      description='Manage your external service integrations for email, messaging, and telephony'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Integrations' }]}
      button={
        <Button
          variant='outline'
          size='sm'
          onClick={handleNewIntegration}
          disabled={isFeatureLoading || !canUseChannels}>
          <Plus />
          New Integration
        </Button>
      }>
      {isLoading ? (
        <EmptyState
          icon={Waypoints}
          iconClassName='animate-spin'
          title='Loading Integrations...'
          description='&nbsp;'
          button={<div className='h-12'></div>}
        />
      ) : integrations?.integrations && integrations.integrations.length > 0 ? (
        <IntegrationTable integrations={integrations.integrations} inboxes={inboxes || []} />
      ) : (
        <EmptyState
          icon={Waypoints}
          title='No Integrations Found'
          description={
            <>
              Connect your first integration to start <br />
              receiving and managing messages.
            </>
          }
          button={
            <Button onClick={handleNewIntegration} size='sm' variant='outline'>
              <Plus />
              Connect your first integration
            </Button>
          }
        />
      )}
    </SettingsPage>
  )
}

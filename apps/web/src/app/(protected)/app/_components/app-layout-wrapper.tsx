// apps/web/src/app/(protected)/app/_components/app-layout-wrapper.tsx
'use client'

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { BLOCKED_SUBSCRIPTION_STATUSES } from '@auxx/types/billing'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type { ReactNode } from 'react'
import { ChannelProvider } from '~/components/channels/providers/channel-provider'
import { ViewStoreProvider } from '~/components/dynamic-table/context/view-store-provider'
import { FilesystemProvider } from '~/components/files/provider/filesystem-provider'
import { Dashboard } from '~/components/global/dashboard'
import KBar from '~/components/kbar'
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { FloatingComposeRoot } from '~/components/mail/email-editor/floating-compose-root'
import { ResourceProvider } from '~/components/resources'
import { SubscriptionEnded } from '~/components/subscriptions/subscription-ended'
import { ThreadDataProvider } from '~/components/threads'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { PusherProvider } from '~/providers/pusher-provider'

interface AppLayoutWrapperProps {
  children: ReactNode
  user: any
}

/** Helper function to check if subscription is expired */
function isSubscriptionExpired(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  return (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    subscription.status.toLowerCase()
  )
}

/** Helper function to check if trial is expired */
function isTrialExpired(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  return subscription.hasTrialEnded && subscription.status === 'trialing'
}

/**
 * Client wrapper that checks subscription and conditionally renders Dashboard or SubscriptionEnded
 */
export function AppLayoutWrapper({ children, user }: AppLayoutWrapperProps) {
  const organizations = useDehydratedOrganizations()
  const { organizationId: currentOrgId } = useOrganizationIdContext()
  const selfHosted = useIsSelfHosted()

  const currentOrg = organizations.find((org) => org.id === currentOrgId)

  // Self-hosted deployments skip subscription checks entirely
  const subscriptionExpired = !selfHosted && isSubscriptionExpired(currentOrg?.subscription ?? null)
  const trialExpired = !selfHosted && isTrialExpired(currentOrg?.subscription ?? null)

  // Show subscription ended screen if expired or trial ended
  if (subscriptionExpired || trialExpired) {
    return (
      <SimpleLayout>
        <SubscriptionEnded
          isTrialEnded={trialExpired}
          organizationName={currentOrg?.name}
          otherOrganizationsCount={organizations.length - 1}
          planName={currentOrg?.subscription?.plan ?? null}
        />
      </SimpleLayout>
    )
  }

  // Show normal dashboard for active subscriptions
  return (
    <ViewStoreProvider>
      <ResourceProvider>
        <ChannelProvider>
          <FilesystemProvider>
            <PusherProvider>
              <ThreadDataProvider>
                <KBar>
                  <TooltipProvider>
                    <Dashboard user={user}>{children}</Dashboard>
                    <FloatingComposeRoot />
                  </TooltipProvider>
                </KBar>
              </ThreadDataProvider>
            </PusherProvider>
          </FilesystemProvider>
        </ChannelProvider>
      </ResourceProvider>
    </ViewStoreProvider>
  )
}

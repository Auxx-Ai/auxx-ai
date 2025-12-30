// apps/web/src/app/(protected)/app/_components/app-layout-wrapper.tsx
'use client'

import { type ReactNode } from 'react'
import { Dashboard } from '~/components/global/dashboard'
import KBar from '~/components/kbar'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { SubscriptionEnded } from '~/components/subscriptions/subscription-ended'
import { SimpleLayout } from '~/components/layouts/simple-layout'
import { ResourceProvider } from '~/components/resources'
import { FilesystemProvider } from '~/components/files/provider/filesystem-provider'

interface AppLayoutWrapperProps {
  children: ReactNode
  user: any
}

/** Helper function to check if subscription is expired */
function isSubscriptionExpired(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  const expiredStatuses = ['canceled', 'unpaid', 'past_due', 'incomplete_expired']
  return expiredStatuses.includes(subscription.status.toLowerCase())
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

  const currentOrg = organizations.find((org) => org.id === currentOrgId)
  
  const subscriptionExpired = isSubscriptionExpired(currentOrg?.subscription ?? null)
  const trialExpired = isTrialExpired(currentOrg?.subscription ?? null)

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
    <ResourceProvider>
      <FilesystemProvider>
        <KBar>
          <TooltipProvider>
            <Dashboard user={user}>{children}</Dashboard>
          </TooltipProvider>
        </KBar>
      </FilesystemProvider>
    </ResourceProvider>
  )
}

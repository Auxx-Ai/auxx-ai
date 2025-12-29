'use client'
import { SubscriptionEnded } from '~/components/subscriptions/subscription-ended'
import { useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'

export default function SubscriptionEndedPage() {
  const trialExpired = true
  const organizations = useDehydratedOrganizations()
  const { organizationId: currentOrgId } = useOrganizationIdContext()

  const currentOrg = organizations.find((org) => org.id === currentOrgId)

  return (
    <SubscriptionEnded
      isTrialEnded={trialExpired}
      organizationName={currentOrg?.name}
      otherOrganizationsCount={organizations.length - 1}
      planName={currentOrg?.subscription?.plan ?? null}
    />
  )
}

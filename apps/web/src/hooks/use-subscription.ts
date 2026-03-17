// apps/web/src/hooks/use-subscription.ts

import { BLOCKED_SUBSCRIPTION_STATUSES } from '@auxx/types/billing'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'

/**
 * Hook to get subscription data for the current organization
 * Uses dehydrated state - no API calls!
 * @returns Subscription data or null if no subscription
 */
export function useSubscription() {
  const organizationId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(organizationId)
  return org?.subscription ?? null
}

/**
 * Hook to check if current organization has an active subscription
 * @returns True if subscription is active
 */
export function useHasActiveSubscription(): boolean {
  const selfHosted = useIsSelfHosted()
  const subscription = useSubscription()
  if (selfHosted) return true // Always active for self-hosted
  if (!subscription) return false

  // Active statuses
  const activeStatuses = ['active', 'trialing']
  return activeStatuses.includes(subscription.status.toLowerCase())
}

/**
 * Hook to check if subscription is expired
 * @returns True if subscription is expired or canceled
 */
export function useIsSubscriptionExpired(): boolean {
  const selfHosted = useIsSelfHosted()
  const subscription = useSubscription()
  if (selfHosted) return false // Never expired for self-hosted
  if (!subscription) return false

  return (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    subscription.status.toLowerCase()
  )
}

/**
 * Hook to check if current organization is on trial
 * @returns True if currently trialing and trial hasn't ended
 */
export function useIsOnTrial(): boolean {
  const selfHosted = useIsSelfHosted()
  const subscription = useSubscription()
  if (selfHosted) return false // No trial concept for self-hosted
  if (!subscription) return false

  return subscription.status.toLowerCase() === 'trialing' && !subscription.hasTrialEnded
}

/**
 * Hook to get subscription status details for current organization
 * @returns Detailed subscription status
 */
export function useSubscriptionStatus() {
  const selfHosted = useIsSelfHosted()
  const subscription = useSubscription()
  // Call all hooks unconditionally (React rules of hooks)
  const isActive = useHasActiveSubscription()
  const isExpired = useIsSubscriptionExpired()
  const isOnTrial = useIsOnTrial()

  if (selfHosted) {
    return {
      subscription: null,
      isActive: true,
      isExpired: false,
      isOnTrial: false,
      hasCanceled: false,
      willCancelAtPeriodEnd: false,
      hasScheduledChanges: false,
    }
  }

  return {
    subscription,
    isActive,
    isExpired,
    isOnTrial,
    hasCanceled: subscription?.canceledAt !== null,
    willCancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    hasScheduledChanges: subscription?.scheduledPlanId !== null,
  }
}

// app/(protected)/app/settings/plans/_components/plan-comparison.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useDehydratedSubscription } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { BillingCycleToggle } from './billing-cycle-toggle'
import { HorizontalPlanCard } from './horizontal-plan-card'
import { PlanCard } from './plan-card'

/** Plan type for callbacks */
export type Plan = {
  id: string
  name: string
  description: string | null
  features: string[]
  monthlyPrice: number
  annualPrice: number
  isCustomPricing: boolean
  trialDays: number
  hasTrial: boolean
  isMostPopular: boolean
  minSeats: number
  maxSeats: number
  selfServed: boolean
  isFree: boolean
  hierarchyLevel: number
}

/** Props for PlanComparison component */
interface PlanComparisonProps {
  /** Whether component is rendered inside a dialog */
  inDialog?: boolean
  /** Visual style variant */
  variant?: 'default' | 'translucent'
  /** Callback when a plan is selected (used in dialog mode) */
  onPlanSelect?: (plan: Plan) => void
}

/**
 * Plan comparison component showing all available plans
 * Can be rendered standalone or inside a dialog
 */
export function PlanComparison({
  inDialog = false,
  variant = 'default',
  onPlanSelect,
}: PlanComparisonProps) {
  useUser({ requireOrganization: true })
  // Read-only surface — `billingView`, matching the settings nav's own gate.
  // Selecting a plan goes through `PlanChangeCard`, which requires `billingManage`.
  useRequireCapability(PermissionKey.billingView)

  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')

  const dehydratedSubscription = useDehydratedSubscription()

  // Shopify is monthly-only (per-seat is billed as usage, which can't ride an annual cycle).
  // Default a missing capability to `true` (Stripe/unknown → annual offered). See plan 15.
  const annualBillingCycle = dehydratedSubscription?.capabilities.annualBillingCycle ?? true

  // Shopify App Store rules 1.2.1 / 1.2.3 forbid advertising a plan that can't be billed
  // through Shopify or that tells the merchant to contact support, so the Enterprise
  // ("Custom" / "Contact Sales") card must not render on a Shopify-billed org. Fall back to
  // the *provider* rather than to `true` — a cache blob written before `customPricingPlans`
  // existed would otherwise fail open and keep showing the card. No subscription row at all
  // → `undefined !== 'shopify'` → true → Stripe default. See plan v3/04.
  const customPricingPlans =
    dehydratedSubscription?.capabilities.customPricingPlans ??
    dehydratedSubscription?.billingProvider !== 'shopify'

  const [initialCycleSet, setInitialCycleSet] = useState(false) // Flag to set default only once

  const { data: plans, isLoading: plansLoading } = api.billing.getPlans.useQuery()
  const { data: subscription, isLoading: subscriptionLoading } =
    api.billing.getCurrentSubscription.useQuery()

  const isLoading = plansLoading || subscriptionLoading

  // Effect to set the initial billing cycle based on the subscription
  useEffect(() => {
    // Only run if subscription data is loaded and we haven't set the initial cycle yet
    if (!subscriptionLoading && !initialCycleSet) {
      // Monthly-only providers (Shopify) stay pinned to MONTHLY — never copy a cycle in.
      if (!annualBillingCycle) {
        setBillingCycle('MONTHLY')
        setInitialCycleSet(true)
        return
      }
      // Check if there's an active, non-trial subscription with a billing cycle
      if (
        subscription?.billingCycle &&
        (subscription.status === 'active' || subscription.status === 'past_due') // Consider active or past_due as having a set cycle
      ) {
        setBillingCycle(subscription.billingCycle)
        console.log(`Defaulting billing cycle to user's current: ${subscription.billingCycle}`)
      } else {
        console.log(
          'No active subscription cycle found or in trial/canceled, defaulting to MONTHLY.'
        )
      }
      // Mark that we've attempted to set the initial state
      setInitialCycleSet(true)
    }
  }, [subscription, subscriptionLoading, initialCycleSet, annualBillingCycle]) // Dependencies

  // Filter out internal plans (e.g. Demo) and — on providers that can't bill them —
  // custom-priced plans, then separate free and paid. A custom-priced plan is still shown
  // when it IS the current plan, so an org parked on Enterprise by an admin billing
  // override doesn't lose its own card.
  // `Plan.features` is a jsonb column, so it arrives as `unknown` — narrow it
  // here rather than trusting the shape all the way down into the cards.
  const availablePlans: Plan[] =
    plans
      ?.filter((plan) => plan.hierarchyLevel >= 0)
      .filter(
        (plan) => customPricingPlans || !plan.isCustomPricing || plan.id === subscription?.planId
      )
      .map((plan) => ({
        ...plan,
        features: Array.isArray(plan.features) ? (plan.features as string[]) : [],
      })) ?? []
  const paidPlans = availablePlans.filter((plan) => !plan.isFree)
  const freePlan = availablePlans.find((plan) => plan.isFree)

  // Track the rendered card count — with Enterprise filtered out, two cards in a
  // three-column track sit left-stranded. Static class strings so Tailwind can see them.
  const paidGridCols = paidPlans.length >= 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2'

  return (
    <div className={inDialog ? '' : 'p-6'}>
      {annualBillingCycle && (
        <div className='flex flex-col gap-4 justify-center items-center'>
          <BillingCycleToggle value={billingCycle} onChange={setBillingCycle} variant={variant} />
        </div>
      )}

      {isLoading && !initialCycleSet ? (
        <div>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 pt-6'>
            {[...Array(3)].map((_, i) => (
              <div key={i} className='rounded-2xl border p-3'>
                <Skeleton className='mb-2 h-8 w-32' />
                <Skeleton className='mb-4 h-6 w-24' />
                <Skeleton className='mb-2 h-6 w-full' />
                <Skeleton className='mb-4 h-6 w-full' />
                <div className='mb-4 space-y-2'>
                  <Skeleton className='h-4 w-full' />
                  <Skeleton className='h-4 w-full' />
                  <Skeleton className='h-4 w-full' />
                </div>
                <Skeleton className='h-8 w-full' />
              </div>
            ))}
          </div>
          <div className='rounded-2xl border h-30 grid-cols-3 mt-3'></div>
        </div>
      ) : (
        <>
          {/* Paid Plans Grid */}
          <div className={cn('grid grid-cols-1 gap-4 pt-6', paidGridCols)}>
            {paidPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                billingCycle={billingCycle}
                variant={variant}
                isCurrentPlan={
                  subscription?.planId === plan.id && subscription?.billingCycle === billingCycle
                }
                onPlanSelect={onPlanSelect}
              />
            ))}
          </div>

          {/* Free Plan - Horizontal Card Below */}
          {freePlan && (
            <div className='mt-6'>
              <HorizontalPlanCard
                plan={freePlan}
                billingCycle={billingCycle}
                variant={variant}
                isCurrentPlan={subscription?.planId === freePlan.id}
                onPlanSelect={onPlanSelect}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

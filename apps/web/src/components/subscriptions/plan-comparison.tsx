// app/(protected)/app/settings/plans/_components/plan-comparison.tsx
'use client'

import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { PlanCard } from './plan-card'
import { HorizontalPlanCard } from './horizontal-plan-card'
import { BillingCycleToggle } from './billing-cycle-toggle'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useUser } from '~/hooks/use-user'

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
  /** Callback when a plan is selected (used in dialog mode) */
  onPlanSelect?: (plan: Plan) => void
}

/**
 * Plan comparison component showing all available plans
 * Can be rendered standalone or inside a dialog
 */
export function PlanComparison({ inDialog = false, onPlanSelect }: PlanComparisonProps) {
  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })

  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')

  const [initialCycleSet, setInitialCycleSet] = useState(false) // Flag to set default only once

  const { data: plans, isLoading: plansLoading } = api.billing.getPlans.useQuery()
  const { data: subscription, isLoading: subscriptionLoading } =
    api.billing.getCurrentSubscription.useQuery()

  const isLoading = plansLoading || subscriptionLoading

  // Effect to set the initial billing cycle based on the subscription
  useEffect(() => {
    // Only run if subscription data is loaded and we haven't set the initial cycle yet
    if (!subscriptionLoading && !initialCycleSet) {
      // Check if there's an active, non-trial subscription with a billing cycle
      if (
        subscription &&
        subscription.billingCycle &&
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
  }, [subscription, subscriptionLoading, initialCycleSet]) // Dependencies

  // Separate free and paid plans
  const paidPlans = plans?.filter((plan) => !plan.isFree) ?? []
  const freePlan = plans?.find((plan) => plan.isFree)

  return (
    <div className={inDialog ? '' : 'p-6'}>
      <div className="flex flex-col gap-4 justify-center items-center">
        <BillingCycleToggle value={billingCycle} onChange={setBillingCycle} />
      </div>

      {isLoading && !initialCycleSet ? (
        <div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 pt-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-2xl border p-3">
                <Skeleton className="mb-2 h-8 w-32" />
                <Skeleton className="mb-4 h-6 w-24" />
                <Skeleton className="mb-2 h-6 w-full" />
                <Skeleton className="mb-4 h-6 w-full" />
                <div className="mb-4 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border h-30 grid-cols-3 mt-3"></div>
        </div>
      ) : (
        <>
          {/* Paid Plans Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 pt-6">
            {paidPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                billingCycle={billingCycle}
                isCurrentPlan={
                  subscription?.planId === plan.id && subscription?.billingCycle === billingCycle
                }
                onPlanSelect={onPlanSelect}
              />
            ))}
          </div>

          {/* Free Plan - Horizontal Card Below */}
          {freePlan && (
            <div className="mt-6">
              <HorizontalPlanCard
                plan={freePlan}
                billingCycle={billingCycle}
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

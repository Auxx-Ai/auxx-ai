// app/(protected)/app/settings/plans/_components/plan-card.tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardFooter, CardHeader } from '@auxx/ui/components/card'
import { Check, Sparkles } from 'lucide-react'
import { api } from '~/trpc/react'
import { useRouter } from 'next/navigation'
import { toastError } from '@auxx/ui/components/toast'
import { showCelebrationConfetti } from './show-confetti'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'

type PlanCardProps = {
  plan: {
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
  billingCycle: 'MONTHLY' | 'ANNUAL'
  isCurrentPlan: boolean
  showTrialOption?: boolean
  /** Callback when plan is selected (used in dialog mode) */
  onPlanSelect?: (plan: PlanCardProps['plan']) => void
}

export function PlanCard({
  plan,
  billingCycle,
  isCurrentPlan,
  showTrialOption = true,
  onPlanSelect,
}: PlanCardProps) {
  const router = useRouter()
  const utils = api.useUtils()

  const [trialEligible, setTrialEligible] = useState(false)

  // Fetch subscription data
  const { data: subscription, isLoading: isLoadingSubscription } =
    api.billing.getCurrentSubscription.useQuery()

  const currentPlanLevel = subscription?.plan?.hierarchyLevel ?? -1

  // Check trial eligibility
  const { data: eligibilityData } = api.billing.checkTrialEligibility.useQuery(
    { planId: plan.id },
    { enabled: showTrialOption && plan.trialDays > 0 && !plan.isCustomPricing && !isCurrentPlan }
  )

  useEffect(() => {
    if (eligibilityData) {
      setTrialEligible(eligibilityData.isEligible)
    }
  }, [eligibilityData])

  // Upgrade subscription mutation
  const upgradeSubscription = api.billing.upgradeSubscription.useMutation({
    onSuccess: (data) => {
      if (data.redirect && data.url) {
        window.location.href = data.url
      } else {
        utils.billing.getCurrentSubscription.invalidate()
        utils.billing.checkTrialStatus.invalidate()
        router.refresh()
      }
    },
    onError: (error) => {
      toastError({
        title: 'Error processing plan selection',
        description: error.message,
      })
    },
  })

  // Calculate price based on billing cycle
  const price = billingCycle === 'MONTHLY' ? plan.monthlyPrice : plan.annualPrice
  const pricePerMonth = billingCycle === 'MONTHLY' ? price : Math.round(price / 12)

  // Annual savings calculation
  const monthlyCost = plan.monthlyPrice * 12
  const annualCost = plan.annualPrice
  const annualSavings = monthlyCost - annualCost

  // Format features array from JSON
  const features = Array.isArray(plan.features)
    ? plan.features
    : typeof plan.features === 'string'
      ? JSON.parse(plan.features)
      : []

  // --- Determine Button Text & Action ---
  let buttonText = 'Select Plan' // Default text
  let actionType: 'current' | 'upgrade' | 'downgrade' | 'contact' | 'select' = 'select' // Default action type

  if (plan.isCustomPricing) {
    buttonText = 'Contact Sales'
    actionType = 'contact'
  } else if (isCurrentPlan) {
    buttonText = 'Current Plan'
    actionType = 'current'
  } else if (currentPlanLevel === -1) {
    // If no current plan, default action is 'select' or 'subscribe'
    // If trial is available, specific buttons handle it. Otherwise, main button.
    buttonText = 'Select Plan'
    actionType = 'select' // Or 'subscribe' if you prefer
  } else if (plan.hierarchyLevel > currentPlanLevel) {
    buttonText = 'Upgrade Plan'
    actionType = 'upgrade'
  } else if (plan.hierarchyLevel < currentPlanLevel) {
    buttonText = 'Downgrade Plan'
    actionType = 'downgrade'
  }

  const handleSelectPlan = () => {
    // If onPlanSelect callback provided (dialog mode), use it instead
    if (onPlanSelect) {
      onPlanSelect(plan)
      return
    }

    if (subscription && currentPlanLevel < plan.hierarchyLevel) {
      showCelebrationConfetti()
    }

    upgradeSubscription.mutate({
      planName: plan.name,
      billingCycle,
      seats: 1,
      successUrl: `${window.location.origin}/app/settings/plans?success=true`,
      cancelUrl: `${window.location.origin}/app/settings/plans?canceled=true`,
    })
  }

  const handleStartTrial = () => {
    // If onPlanSelect callback provided (dialog mode), use it instead
    if (onPlanSelect) {
      onPlanSelect(plan)
      return
    }

    upgradeSubscription.mutate({
      planName: plan.name,
      billingCycle,
      seats: 1,
      successUrl: `${window.location.origin}/app/settings/plans?trial_started=true`,
      cancelUrl: `${window.location.origin}/app/settings/plans`,
    })
  }

  const isProcessing = upgradeSubscription.isPending || isLoadingSubscription
  const isTrialProcessing = upgradeSubscription.isPending || isLoadingSubscription

  return (
    <div className="flex flex-col flex-1">
      {/* {plan.isMostPopular ? (
        <div className="pb-2 text-center font-semibold text-bad-500">Most popular</div>
      ) : (
        <div className="pb-2 text-center font-bold text-muted-foreground"> &nbsp;</div>
      )} */}
      <div
        className={cn(
          'flex flex-1 rounded-2xl flex-col ring-1 ring-black/10',
          isCurrentPlan && 'ring-info'
        )}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold leading-none tracking-tight">{plan.name}</div>
              <div className="text-xs text-muted-foreground">{plan.description}</div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grow">
          {plan.isCustomPricing ? (
            <div className="mb-6 text-2xl font-normal">Custom</div>
          ) : (
            <div className="mb-6">
              {plan.isFree ? (
                <>
                  <div className="text-2xl font-normal">
                    <span className="">Free</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Forever</div>
                </>
              ) : (
                <div className="flex flex-row relative">
                  <div className="flex flex-col">
                    <div className="text-2xl font-normal">
                      <span className="">${(pricePerMonth / 100).toFixed(0)}</span>
                      <span className="text-xs font-normal text-muted-foreground">/seat/mo</span>
                    </div>

                    <div className="mt-1 text-xs text-muted-foreground">
                      Billed {billingCycle.toLowerCase()}
                    </div>
                  </div>
                  {/* {billingCycle === 'ANNUAL' && annualSavings > 0 && (
                    <div>
                      <Badge className="absolute" variant="green">
                        Save ${(annualSavings / 100).toFixed(0)}/year
                      </Badge>
                    </div>
                  )} */}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            {features.map((feature: string, index: number) => (
              <div key={index} className="flex items-start">
                <div className="mr-2 mt-0.5 flex items-center ring-1 ring-black/10 justify-center size-4 rounded-md bg-muted shrink-0">
                  <Check className="size-3 shrink-0 " />
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-2 p-3 pt-0">
          {actionType === 'contact' ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push('/contact-sales')}>
              Contact Sales
            </Button>
          ) : actionType === 'current' ? (
            <Button className="w-full" disabled>
              Current Plan
            </Button>
          ) : trialEligible && plan.hasTrial && plan.trialDays > 0 ? (
            // Show Trial button if eligible
            <Button
              className="w-full" // Or specific trial styling
              onClick={handleStartTrial}
              loading={isTrialProcessing}
              loadingText="Processing..."
              variant="outline">
              <Sparkles />
              Start {plan.trialDays}-Day Free Trial
            </Button>
          ) : (
            // Default action button (Upgrade/Downgrade/Select)
            <Button
              className="w-full" // Adjust styling based on actionType if desired
              onClick={handleSelectPlan}
              variant="outline"
              loading={isProcessing}
              loadingText="Processing...">
              {buttonText}
            </Button>
          )}
        </CardFooter>
      </div>
    </div>
  )
}

// app/(protected)/app/settings/plans/_components/horizontal-plan-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { showCelebrationConfetti } from './show-confetti'

/** Props for horizontal plan card */
type HorizontalPlanCardProps = {
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
  variant?: 'default' | 'translucent'
  /** Callback when plan is selected (used in dialog mode) */
  onPlanSelect?: (plan: HorizontalPlanCardProps['plan']) => void
}

/**
 * Horizontal card layout for plan (typically used for free plan)
 * Displays plan information in a wide, horizontal format below paid plans
 */
export function HorizontalPlanCard({
  plan,
  billingCycle,
  isCurrentPlan,
  showTrialOption = true,
  variant = 'default',
  onPlanSelect,
}: HorizontalPlanCardProps) {
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

  // Format features array from JSON
  const features = Array.isArray(plan.features)
    ? plan.features
    : typeof plan.features === 'string'
      ? JSON.parse(plan.features)
      : []

  // Determine Button Text & Action
  let buttonText = 'Select Plan'
  let actionType: 'current' | 'upgrade' | 'downgrade' | 'contact' | 'select' = 'select'

  if (plan.isCustomPricing) {
    buttonText = 'Contact Sales'
    actionType = 'contact'
  } else if (isCurrentPlan) {
    buttonText = 'Current Plan'
    actionType = 'current'
  } else if (currentPlanLevel === -1) {
    buttonText = 'Select Plan'
    actionType = 'select'
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

  const t = variant === 'translucent'
  const mutedText = t ? 'text-white/50' : 'text-muted-foreground'
  const btnVariant = t ? 'translucent' : 'outline'

  return (
    <div
      className={cn(
        'flex flex-col md:flex-row gap-6 rounded-lg border p-3 items-center',
        t && 'border-white/10',
        isCurrentPlan && 'ring-1 ring-info'
      )}>
      {/* Left Section: Plan Info & Pricing */}
      <div className='flex flex-col md:w-1/3 justify-center'>
        <div className='font-semibold leading-none tracking-tight mb-2'>{plan.name}</div>
        <div className={cn('text-sm', mutedText)}>{plan.description}</div>
      </div>

      {/* Middle Section: Features */}
      <div className='flex-1 md:w-1/2'>
        <div className=' gap-4 space-y-1'>
          {features.map((feature: string, index: number) => (
            <div key={index} className='flex items-start'>
              <div
                className={cn(
                  'mr-2 mt-0.5 flex items-center ring-1 justify-center size-4 rounded-md shrink-0',
                  t ? 'ring-white/10 bg-muted/10' : 'ring-black/10 bg-muted'
                )}>
                <Check className='size-3 shrink-0 ' />
              </div>
              <span className='text-sm'>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right Section: CTA */}
      <div className='flex items-center md:w-1/6 justify-end'>
        {actionType === 'contact' ? (
          <Button
            className='w-full md:w-auto'
            variant={btnVariant}
            onClick={() => router.push('/contact-sales')}>
            Contact Sales
          </Button>
        ) : actionType === 'current' ? (
          <Button className='w-full md:w-auto' disabled>
            Current Plan
          </Button>
        ) : trialEligible && plan.hasTrial && plan.trialDays > 0 ? (
          <Button
            className='w-full md:w-auto'
            onClick={handleStartTrial}
            loading={isProcessing}
            loadingText='Processing...'
            variant={btnVariant}>
            <Sparkles />
            Start {plan.trialDays}-Day Trial
          </Button>
        ) : (
          <Button
            className='w-full md:w-auto'
            onClick={handleSelectPlan}
            variant={btnVariant}
            loadingText='Processing...'
            loading={isProcessing}>
            {buttonText}
          </Button>
        )}
      </div>
    </div>
  )
}

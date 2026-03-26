// apps/web/src/app/(protected)/onboarding/_components/onboarding-navigation.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ArrowRight } from 'lucide-react'

/**
 * Props for OnboardingNavigation component
 */
interface OnboardingNavigationProps {
  onBack?: () => void
  onContinue?: () => void
  onSkip?: () => void
  showBack?: boolean
  showContinue?: boolean
  showSkip?: boolean
  continueText?: string
  skipText?: string
  continueDisabled?: boolean
  continueLoading?: boolean
}

/**
 * Navigation component for onboarding pages
 */
export function OnboardingNavigation({
  onBack,
  onContinue,
  onSkip,
  showBack = true,
  showContinue = true,
  showSkip = false,
  continueText = 'Continue',
  skipText = 'Skip for now',
  continueDisabled = false,
  continueLoading = false,
}: OnboardingNavigationProps) {
  return (
    <div className='flex items-center justify-between pt-6'>
      <div>
        {showBack && onBack && (
          <Button
            type='button'
            variant='ghost'
            onClick={onBack}
            className='gap-2 hover:bg-white/40 hover:text-black/80'>
            Back
          </Button>
        )}
      </div>

      <div className='flex items-center gap-3'>
        {showSkip && onSkip && (
          <Button type='button' variant='ghost' onClick={onSkip}>
            {skipText}
          </Button>
        )}

        {showContinue && onContinue && (
          <Button
            type='button'
            onClick={onContinue}
            disabled={continueDisabled || continueLoading}
            loading={continueLoading}
            loadingText='Please wait...'
            className='gap-2'>
            {continueText}
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  )
}

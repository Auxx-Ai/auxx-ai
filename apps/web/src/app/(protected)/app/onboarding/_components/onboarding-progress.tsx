// apps/web/src/app/(protected)/app/onboarding/_components/onboarding-progress.tsx
'use client'

import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@auxx/ui/components/stepper'
import { useOnboarding } from './onboarding-provider'

/**
 * Step configuration
 */
const steps = [
  { step: 1, title: 'Personal' },
  { step: 2, title: 'Organization' },
  { step: 3, title: 'Connections' },
  { step: 4, title: 'Team' },
]

/**
 * Onboarding progress indicator component
 */
export function OnboardingProgress() {
  const { state } = useOnboarding()
  const { currentStep, completedSteps } = state

  return (
    <div className='w-full pt-4 px-6'>
      <Stepper value={currentStep}>
        {steps.map(({ step, title }, index) => (
          <StepperItem
            key={step}
            step={step}
            completed={completedSteps.includes(step) && step < currentStep}
            className='not-last:flex-1 max-md:items-start'>
            <StepperTrigger className='rounded max-md:flex-col pointer-events-none'>
              <StepperIndicator className='data-[state=completed]:bg-foreground' />
              <div className='hidden md:block text-center md:text-left'>
                <StepperTitle className='text-sm'>{title}</StepperTitle>
              </div>
            </StepperTrigger>
            {index < steps.length - 1 && (
              <StepperSeparator className='max-md:mt-3 md:mx-4 group-data-[state=completed]/step:bg-foreground' />
            )}
          </StepperItem>
        ))}
      </Stepper>
    </div>
  )
}

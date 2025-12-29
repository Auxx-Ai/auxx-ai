// apps/web/src/app/(protected)/subscription/convert/_components/convert-progress.tsx
'use client'

import { useConvert } from './convert-provider'
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@auxx/ui/components/stepper'

/**
 * Step configuration
 */
const steps = [
  { step: 1, title: 'Plan' },
  { step: 2, title: 'Add-ons' },
  { step: 3, title: 'Summary' },
]

/**
 * Convert progress indicator component
 */
export function ConvertProgress() {
  const { state } = useConvert()
  const { currentStep, completedSteps } = state

  return (
    <div className="w-full pt-4 px-6 max-w-xl mx-auto">
      <Stepper value={currentStep}>
        {steps.map(({ step, title }, index) => (
          <StepperItem
            key={step}
            step={step}
            completed={completedSteps.includes(step) && step < currentStep}
            className="not-last:flex-1 max-md:items-start">
            <StepperTrigger className="rounded max-md:flex-col pointer-events-none">
              <StepperIndicator className="data-[state=completed]:bg-foreground" />
              <div className="hidden md:block text-center md:text-left">
                <StepperTitle className="text-sm">{title}</StepperTitle>
              </div>
            </StepperTrigger>
            {index < steps.length - 1 && (
              <StepperSeparator className="max-md:mt-3 md:mx-4 group-data-[state=completed]/step:bg-foreground" />
            )}
          </StepperItem>
        ))}
      </Stepper>
    </div>
  )
}

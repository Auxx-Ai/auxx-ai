// apps/web/src/components/data-import/import-step-cards.tsx

'use client'

import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@auxx/ui/components/stepper'
import { IMPORT_STEP_CONFIG, IMPORT_STEPS } from './constants'
import type { ImportStep, StepStatus, StepData } from './types'

interface ImportStepCardsProps {
  currentStep: ImportStep
  stepStatuses: Record<ImportStep, StepStatus>
  stepData: StepData
  onStepClick: (step: ImportStep) => void
}

/** Maps step ID to step number (1-based) */
const STEP_NUMBER: Record<ImportStep, number> = {
  upload: 1,
  'map-columns': 2,
  'review-values': 3,
  confirm: 4,
}

/**
 * Step navigation using Stepper component.
 * Shows step status with inline titles and descriptions.
 */
export function ImportStepCards({
  currentStep,
  stepStatuses,
  stepData,
  onStepClick,
}: ImportStepCardsProps) {
  const currentStepNumber = STEP_NUMBER[currentStep]

  /** Handle step click - only allow clicking completed or active steps */
  const handleStepClick = (stepId: ImportStep) => {
    const status = stepStatuses[stepId]
    const isClickable = status === 'complete' || stepId === currentStep
    if (isClickable) {
      onStepClick(stepId)
    }
  }

  return (
    <div className="border-b bg-background px-6 py-0 rounded-t-xl">
      <Stepper value={currentStepNumber} className="h-20">
        {IMPORT_STEPS.map((stepId, index) => {
          const config = IMPORT_STEP_CONFIG[stepId]
          const status = stepStatuses[stepId]
          const stepNumber = STEP_NUMBER[stepId]
          const isCompleted = status === 'complete'
          const isDisabled = status === 'pending'

          const description = getStepDescription(stepId, status, stepData)

          return (
            <StepperItem
              key={stepId}
              step={stepNumber}
              completed={isCompleted}
              disabled={isDisabled}
              className="not-last:flex-1">
              <StepperTrigger
                className="gap-4 rounded group/trigger"
                onClick={() => handleStepClick(stepId)}>
                <StepperIndicator className="bg-primary-300 " />
                <div className="-order-1 cursor-pointer relative text-left group-hover/trigger:before:bg-primary-100 z-10 before:absolute before:-inset-2 before:rounded-xl before:ring-1 before:ring-transparent before:transition-colors group-hover/trigger:before:ring-primary-300/50">
                  <StepperTitle className="z-20 relative">{config.title}</StepperTitle>
                  <StepperDescription className="z-20 relative">{description}</StepperDescription>
                </div>
              </StepperTrigger>
              {index < IMPORT_STEPS.length - 1 && (
                <StepperSeparator className="mx-4 bg-primary-200" />
              )}
            </StepperItem>
          )
        })}
      </Stepper>
    </div>
  )
}

/**
 * Get step-specific description based on status and data.
 */
function getStepDescription(stepId: ImportStep, status: StepStatus, data: StepData): string {
  switch (stepId) {
    case 'upload': {
      const { rowCount, fileName } = data.upload
      if (status === 'complete' && rowCount !== null) {
        return `${rowCount.toLocaleString()} rows in ${fileName}`
      }
      return 'Select CSV file'
    }

    case 'map-columns': {
      const { mappedCount, totalColumns } = data['map-columns']
      if (status === 'complete' || status === 'active') {
        return `${mappedCount}/${totalColumns} columns mapped`
      }
      return 'Map CSV columns to fields'
    }

    case 'review-values': {
      const { errorCount, warningCount } = data['review-values']
      if (status === 'error') {
        return `${errorCount} errors to fix`
      }
      if (status === 'complete') {
        return warningCount > 0 ? `${warningCount} warnings` : 'All values valid'
      }
      return 'Review and fix values'
    }

    case 'confirm': {
      const { toCreate, toUpdate, toSkip } = data.confirm
      const total = toCreate + toUpdate + toSkip
      if (status === 'complete') {
        return `${total} records processed`
      }
      if (status === 'active' && total > 0) {
        return `${toCreate} create, ${toUpdate} update, ${toSkip} skip`
      }
      return 'Review and start import'
    }
  }
}

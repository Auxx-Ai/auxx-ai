// apps/web/src/components/data-import/import-page.tsx

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import {
  MainPage,
  MainPageHeader,
  MainPageContent,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
} from '@auxx/ui/components/main-page'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { ImportStepCards } from './import-step-cards'
import { ImportActions } from './import-actions'
import { StepUpload } from './steps/step-upload'
import { StepMapColumns } from './steps/step-map-columns'
import { StepReviewValues } from './steps/step-review-values'
import { StepConfirmImport } from './steps/step-confirm-import'
import { useImportWizard } from './hooks/use-import-wizard'
import { IMPORT_STEPS } from './constants'
import type { ImportStep } from './types'

/** Parser for step query param with validation */
const stepParser = parseAsStringLiteral(IMPORT_STEPS).withDefault('upload')

interface ImportPageProps {
  /** Target resource type (e.g., 'contact', 'entity_product') */
  targetTable: string
  /** Resource display name for breadcrumb */
  resourceLabel: string
  /** Base path for breadcrumb navigation */
  basePath: string
  /** Base path for import routes (e.g., '/app/contacts/import') */
  importBasePath: string
  /** Job ID from URL ('new' or actual job ID) */
  jobId: string
}

/**
 * Main import page component.
 * Uses MainPage layout with breadcrumb navigation and Stepper for step indicators.
 * Uses nuqs for URL-based step navigation.
 */
export function ImportPage({
  targetTable,
  resourceLabel,
  basePath,
  importBasePath,
  jobId,
}: ImportPageProps) {
  const router = useRouter()
  const isNewImport = jobId === 'new'
  const actualJobId = isNewImport ? null : jobId

  // Step state from URL query param
  const [currentStep, setCurrentStep] = useQueryState('step', stepParser)

  // Confirm dialog for starting new import
  const [confirm, ConfirmDialog] = useConfirm()

  // Delete job mutation for when user wants to start over
  const deleteJob = api.dataImport.deleteJob.useMutation()

  // State for map-columns step data (avoids extra DB calls)
  const [mapColumnsData, setMapColumnsData] = useState<
    { mappedCount: number; totalColumns: number } | undefined
  >()

  const wizard = useImportWizard({
    targetTable,
    jobId: actualJobId,
    currentStep,
    mapColumnsData,
  })

  // Validate step based on job state
  useEffect(() => {
    // If jobId is 'new' but step is not 'upload', reset to upload
    if (isNewImport && currentStep !== 'upload') {
      setCurrentStep('upload')
    }
    // If job is completed, go to confirm step to show results
    if (!isNewImport && wizard.isComplete && currentStep !== 'confirm') {
      setCurrentStep('confirm')
    }
    // If we have a real jobId but step is 'upload', advance to map-columns
    else if (!isNewImport && currentStep === 'upload') {
      setCurrentStep('map-columns')
    }
  }, [isNewImport, currentStep, setCurrentStep, wizard.isComplete])

  /** Navigate to a step */
  const navigateToStep = (step: ImportStep, newJobId?: string) => {
    if (newJobId && newJobId !== jobId) {
      // Job ID changed (after upload), navigate to new URL
      router.push(`${importBasePath}/${newJobId}?step=${step}`)
    } else {
      // Same job, just update step query param
      setCurrentStep(step)
    }
  }

  /** Handle step click - show confirmation when clicking upload to start new import */
  const handleStepClick = async (step: ImportStep) => {
    // Check if clicking "upload" while on step 2+ (has active job)
    if (step === 'upload' && !isNewImport) {
      const confirmed = await confirm({
        title: 'Start a new import?',
        description: 'This will delete your current import progress and start fresh.',
        confirmText: 'Start New Import',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        try {
          await deleteJob.mutateAsync({ jobId })
          router.push(`${importBasePath}/new?step=upload`)
        } catch (error) {
          toastError({
            title: 'Failed to delete import',
            description: error instanceof Error ? error.message : 'An error occurred',
          })
        }
      }
      return
    }

    // Normal navigation for other steps
    if (wizard.canNavigateToStep(step)) {
      navigateToStep(step)
    }
  }

  /** Called when upload completes - navigate to map-columns with new job ID */
  const handleUploadComplete = (newJobId: string) => {
    router.push(`${importBasePath}/${newJobId}?step=map-columns`)
  }

  /** Called when import completes - navigate back to resource list */
  const handleImportComplete = () => {
    router.push(basePath)
  }

  /** Called when mapping counts change in StepMapColumns */
  const handleMappingChange = useCallback((mappedCount: number, totalColumns: number) => {
    setMapColumnsData({ mappedCount, totalColumns })
  }, [])

  const renderStep = () => {
    switch (currentStep) {
      case 'upload':
        return <StepUpload targetTable={targetTable} onComplete={handleUploadComplete} />
      case 'map-columns':
        return (
          <StepMapColumns
            jobId={actualJobId!}
            onComplete={() => navigateToStep('review-values')}
            onMappingChange={handleMappingChange}
          />
        )
      case 'review-values':
        return (
          <StepReviewValues jobId={actualJobId!} onComplete={() => navigateToStep('confirm')} />
        )
      case 'confirm':
        return <StepConfirmImport jobId={actualJobId!} onComplete={handleImportComplete} />
    }
  }

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <ImportActions wizard={wizard} basePath={basePath} importBasePath={importBasePath} />
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={resourceLabel} href={basePath} />
          <MainPageBreadcrumbItem title="Import" last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className="flex flex-col flex-1 min-h-0 ">
          {/* Step navigation as Stepper */}
          <ImportStepCards
            currentStep={currentStep}
            stepStatuses={wizard.stepStatuses}
            stepData={wizard.stepData}
            onStepClick={handleStepClick}
          />

          {/* Current step content */}
          <div className="flex-1 overflow-y-auto relative flex flex-col min-h-0">
            {renderStep()}
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}

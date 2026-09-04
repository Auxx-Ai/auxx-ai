// apps/web/src/components/data-import/import-page.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { IMPORT_STEPS } from './constants'
import { useImportWizard } from './hooks/use-import-wizard'
import { ImportActions } from './import-actions'
import { ImportStepCards } from './import-step-cards'
import { StepConfirmImport } from './steps/step-confirm-import'
import { StepMapColumns } from './steps/step-map-columns'
import { StepReviewValues } from './steps/step-review-values'
import { StepUpload } from './steps/step-upload'
import type { ImportStep } from './types'

/** Parser for step query param with validation */
const stepParser = parseAsStringLiteral(IMPORT_STEPS).withDefault('upload')

interface ImportPageProps {
  /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
  /** Resource display name for breadcrumb */
  resourceLabel: string
  /** Base path for breadcrumb navigation */
  basePath: string
  /** Base path for import routes (e.g., '/app/contacts/import') */
  importBasePath: string
  /**
   * Breadcrumb leaf, when this is a NAMED IMPORTER rather than the resource's own
   * import — e.g. `'Import supplier prices'`. Defaults to `'Import'`.
   */
  importTitle?: string
  /**
   * The named importer's target def, when one is in play.
   *
   * 🛑 Must be carried on every in-wizard URL. `entityDefinitionId` is resolved
   * from this query param on the server, so dropping it on a step navigation
   * silently reverts the wizard to the host def while the JOB stays on the
   * target — the header, the field list and the step counts would all then
   * describe a different entity than the one being imported.
   */
  importTarget?: string
  /** Job ID from URL ('new' or actual job ID) */
  jobId: string
  /**
   * Extra query string a HOST importer needs carried on every in-wizard link,
   * already `&`-prefixed and encoded (e.g. `'&account=abc'`).
   *
   * The bank statement importer is the first caller: the target `bank_account`
   * is chosen on a card BEFORE the file, and it is neither a column in the file
   * nor derivable from the job, so it has to survive a step navigation. Optional,
   * and empty for every other importer.
   */
  extraQuery?: string
  /**
   * Rendered above the plan summary on the confirm step.
   *
   * For what a host importer knows that the generic one cannot: the bank
   * importer puts the coverage effect and the cross-source overlap here, which
   * is the difference between "62 rows" and "62 rows, 14 of them already here
   * from the feed, and this closes the gap on ···5381".
   */
  confirmExtra?: ReactNode
  /**
   * Fired once when the run itself finishes, successfully or not - NOT when the
   * user leaves the completion card.
   *
   * 🛑 This is a different moment from {@link basePath} navigation, and the
   * difference matters: the bank importer files the rows against an account here
   * (stamping `source`, `importBatchId`, `bankAccount` and the coverage floor),
   * and a person who closes the tab on the green tick must not be left with
   * unfiled statement lines nobody can reverse.
   */
  onJobFinished?: (jobId: string) => void
}

/**
 * Main import page component.
 * Uses MainPage layout with breadcrumb navigation and Stepper for step indicators.
 * Uses nuqs for URL-based step navigation.
 */
export function ImportPage({
  entityDefinitionId,
  resourceLabel,
  basePath,
  importBasePath,
  importTitle,
  importTarget,
  jobId,
  extraQuery = '',
  confirmExtra,
  onJobFinished,
}: ImportPageProps) {
  const router = useRouter()
  const isNewImport = jobId === 'new'
  const actualJobId = isNewImport ? null : jobId
  /**
   * `&target=…` for in-wizard links, empty when this is the host's own import,
   * plus whatever the host asked to be carried alongside it.
   */
  const targetQuery =
    (importTarget ? `&target=${encodeURIComponent(importTarget)}` : '') + extraQuery

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
    entityDefinitionId,
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
      router.push(`${importBasePath}/${newJobId}?step=${step}${targetQuery}`)
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
          router.push(`${importBasePath}/new?step=upload${targetQuery}`)
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
    router.push(`${importBasePath}/${newJobId}?step=map-columns${targetQuery}`)
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
        return (
          <StepUpload entityDefinitionId={entityDefinitionId} onComplete={handleUploadComplete} />
        )
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
        return (
          <StepConfirmImport
            jobId={actualJobId!}
            onComplete={handleImportComplete}
            extra={confirmExtra}
            onJobFinished={onJobFinished ? () => onJobFinished(actualJobId!) : undefined}
          />
        )
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
          <MainPageBreadcrumbItem title={importTitle ?? 'Import'} />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='flex flex-col flex-1 min-h-0 min-w-0'>
          {/* Step navigation as Stepper */}
          <ImportStepCards
            currentStep={currentStep}
            stepStatuses={wizard.stepStatuses}
            stepData={wizard.stepData}
            onStepClick={handleStepClick}
          />

          {/* Current step content */}
          <div className='flex-1 overflow-y-auto relative flex flex-col min-h-0 min-w-0'>
            {renderStep()}
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}

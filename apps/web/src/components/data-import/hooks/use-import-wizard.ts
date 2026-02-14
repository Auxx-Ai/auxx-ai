// apps/web/src/components/data-import/hooks/use-import-wizard.ts

'use client'

import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { IMPORT_STEPS } from '../constants'
import type { ImportStep, StepData, StepStatus } from '../types'

interface UseImportWizardOptions {
  entityDefinitionId: string
  jobId: string | null
  currentStep: ImportStep
  /** Optional override for map-columns data (avoids extra DB calls) */
  mapColumnsData?: { mappedCount: number; totalColumns: number }
}

/**
 * Hook for managing import wizard data and step status calculations.
 * Step navigation is handled via nuqs URL state.
 */
export function useImportWizard({ jobId, currentStep, mapColumnsData }: UseImportWizardOptions) {
  // Fetch job data to determine step statuses
  const { data: job, isLoading: isJobLoading } = api.dataImport.getJob.useQuery(
    { jobId: jobId! },
    { enabled: !!jobId }
  )

  // Only query getMappedColumns when NOT on map-columns step (for review-values error counts)
  // On map-columns step, we use mapColumnsData passed from child component to avoid extra DB calls
  const { data: mappedColumns } = api.dataImport.getMappedColumns.useQuery(
    { jobId: jobId! },
    { enabled: !!jobId && currentStep !== 'map-columns' }
  )

  const { data: plan } = api.dataImport.getPlan.useQuery(
    { jobId: jobId! },
    { enabled: !!jobId && currentStep === 'confirm' }
  )

  const saveMapping = api.dataImport.saveMappingTemplate.useMutation()

  // Calculate step statuses based on job state
  const stepStatuses = useMemo((): Record<ImportStep, StepStatus> => {
    const currentIndex = IMPORT_STEPS.indexOf(currentStep)

    return {
      upload: jobId ? 'complete' : currentStep === 'upload' ? 'active' : 'pending',
      'map-columns':
        currentIndex > 1 ? 'complete' : currentStep === 'map-columns' ? 'active' : 'pending',
      'review-values':
        currentIndex > 2
          ? 'complete'
          : currentStep === 'review-values'
            ? mappedColumns?.some((c) => c.errorCount > 0)
              ? 'error'
              : 'active'
            : 'pending',
      confirm:
        job?.status === 'completed' ? 'complete' : currentStep === 'confirm' ? 'active' : 'pending',
    }
  }, [currentStep, jobId, job?.status, mappedColumns])

  // Calculate step data for display in StatCards
  const stepData = useMemo((): StepData => {
    // Use override from child component if available (on map-columns step)
    // Otherwise fall back to query data or job.columnCount
    const mappedCount =
      mapColumnsData?.mappedCount ?? mappedColumns?.filter((c) => c.targetFieldKey).length ?? 0
    const totalColumns = mapColumnsData?.totalColumns ?? job?.columnCount ?? 0
    const errorCount = mappedColumns?.reduce((sum, c) => sum + (c.errorCount ?? 0), 0) ?? 0
    const warningCount = mappedColumns?.reduce((sum, c) => sum + (c.warningCount ?? 0), 0) ?? 0

    return {
      upload: {
        rowCount: job?.rowCount ?? null,
        fileName: job?.sourceFileName ?? null,
      },
      'map-columns': {
        mappedCount,
        totalColumns,
      },
      'review-values': {
        errorCount,
        warningCount,
      },
      confirm: {
        toCreate: plan?.estimates?.toCreate ?? 0,
        toUpdate: plan?.estimates?.toUpdate ?? 0,
        toSkip: plan?.estimates?.toSkip ?? 0,
      },
    }
  }, [job, mappedColumns, plan, mapColumnsData])

  // Check if navigation to a step is allowed
  const canNavigateToStep = useCallback(
    (step: ImportStep): boolean => {
      const targetIndex = IMPORT_STEPS.indexOf(step)
      const currentIndex = IMPORT_STEPS.indexOf(currentStep)

      // Can always go to current step
      if (step === currentStep) return true

      // Can always go to confirm step if job is completed
      if (step === 'confirm' && job?.status === 'completed') return true

      // Can go back to any completed step
      if (targetIndex < currentIndex) {
        return stepStatuses[step] === 'complete'
      }

      // Can only go forward one step at a time
      if (targetIndex === currentIndex + 1) {
        return stepStatuses[currentStep] === 'complete'
      }

      return false
    },
    [currentStep, stepStatuses, job?.status]
  )

  // Can save mapping template if we have mappings configured
  const canSaveMapping = !!jobId && stepStatuses['map-columns'] === 'complete'

  const handleSaveMapping = useCallback(async () => {
    if (!jobId) return
    await saveMapping.mutateAsync({ jobId })
  }, [jobId, saveMapping])

  return {
    // State
    jobId,
    currentStep,
    stepStatuses,
    stepData,
    isLoading: !!jobId && isJobLoading,
    isComplete: job?.status === 'completed',

    // Navigation check
    canNavigateToStep,

    // Mapping template
    canSaveMapping,
    saveMapping: handleSaveMapping,
    isSaving: saveMapping.isPending,
  }
}

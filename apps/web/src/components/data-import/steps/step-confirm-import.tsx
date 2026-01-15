// apps/web/src/components/data-import/steps/step-confirm-import.tsx

'use client'

import { useState, useEffect } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { api } from '~/trpc/react'
import { ImportPlanSummary, PlanPreviewTable, usePlanPreviewData } from '../plan-preview'
import { ImportCompleteCard } from '../plan-preview/import-complete-card'
import { ExecutionProgress } from '../progress/execution-progress'
import { useImportSSE } from '../hooks/use-import-sse'
import type { PreviewColumnMapping } from '../plan-preview'

interface StepConfirmImportProps {
  jobId: string
  onComplete: () => void
}

/**
 * Step 4: Confirm and execute import.
 * Auto-generates plan on mount, shows summary with preview table, executes with real-time progress.
 */
export function StepConfirmImport({ jobId, onComplete }: StepConfirmImportProps) {
  const [isExecuting, setIsExecuting] = useState(false)

  const { data: plan, isLoading: planLoading } = api.dataImport.getPlan.useQuery({ jobId })
  const { data: job, isLoading: jobLoading } = api.dataImport.getJob.useQuery({ jobId })
  const { data: mappedColumns } = api.dataImport.getMappedColumns.useQuery({ jobId })

  const generatePlan = api.dataImport.generatePlan.useMutation()
  const confirmImport = api.dataImport.confirmImport.useMutation()
  const utils = api.useUtils()

  // Preview data hook (SSE + query)
  const {
    rows: previewRows,
    isLoading: isLoadingPreview,
    isPlanning,
    addRow,
    clearRows,
  } = usePlanPreviewData({
    jobId,
    jobStatus: job?.status,
  })

  // Convert mappedColumns to PreviewColumnMapping format
  const mappings: PreviewColumnMapping[] =
    mappedColumns?.map((col) => ({
      sourceColumnIndex: col.columnIndex,
      sourceColumnName: col.columnName,
      targetFieldKey: col.targetFieldKey,
      targetFieldLabel: col.targetFieldKey ?? undefined,
    })) ?? []

  // Auto-generate plan when entering this step if not already generated
  useEffect(() => {
    if (!jobLoading && job?.status === 'waiting' && !generatePlan.isPending) {
      clearRows() // Clear any stale SSE rows
      generatePlan.mutateAsync({ jobId }).then(() => {
        utils.dataImport.getPlan.invalidate({ jobId })
        utils.dataImport.getJob.invalidate({ jobId })
      })
    }
  }, [
    jobLoading,
    job?.status,
    jobId,
    generatePlan,
    clearRows,
    utils.dataImport.getPlan,
    utils.dataImport.getJob,
  ])

  // SSE connection for real-time progress (during planning and execution)
  const { progress: sseProgress, isConnected } = useImportSSE({
    jobId,
    enabled: job?.status === 'planning' || isExecuting,
    onPlanningRow: (row) => {
      addRow(row)
    },
    onPlanningComplete: () => {
      utils.dataImport.getPlan.invalidate({ jobId })
      utils.dataImport.getJob.invalidate({ jobId })
    },
    onComplete: () => {
      setIsExecuting(false)
      utils.dataImport.getJob.invalidate({ jobId })
    },
  })

  const handleConfirmImport = async () => {
    setIsExecuting(true)
    await confirmImport.mutateAsync({ jobId })
  }

  const isLoading = jobLoading || planLoading || generatePlan.isPending || job?.status === 'waiting'

  // Show loading with skeleton stats
  if (isLoading) {
    return <ImportPlanSummary loading />
  }

  // Show execution progress
  if (isExecuting) {
    return <ExecutionProgress progress={sseProgress} isConnected={isConnected} />
  }

  // Show completion
  if (job?.status === 'completed') {
    const stats = job.statistics as
      | { created?: number; updated?: number; skipped?: number }
      | undefined
    return (
      <ImportCompleteCard
        entityDefinitionId={job.importMapping.entityDefinitionId}
        statistics={{
          created: stats?.created ?? 0,
          updated: stats?.updated ?? 0,
          skipped: stats?.skipped ?? 0,
        }}
        onComplete={onComplete}
      />
    )
  }

  // Show plan summary with preview table
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Plan Summary - fixed at top */}
      {plan && <ImportPlanSummary plan={plan} />}

      {/* Preview Table - scrolls independently with sticky header */}
      <div className="flex-1 min-h-0">
        <PlanPreviewTable
          rows={previewRows}
          mappings={mappings}
          isPlanning={isPlanning}
          isLoading={isLoadingPreview}
        />
      </div>

      {/* Start Import Footer */}
      {!isPlanning && job?.status === 'ready' && (
        <div className="flex items-center justify-between px-2 py-1 border-t bg-muted">
          <div className="flex items-center gap-3 min-w-0">
            <EntityIcon iconId="upload" variant="muted" />
            <div className="min-w-0">
              <p className="font-medium text-sm">Ready to Import</p>
              <p className="text-sm text-muted-foreground">{job?.importMapping.relatedEntityDefinitionId}</p>
            </div>
          </div>
          <Button onClick={handleConfirmImport} variant="default" size="sm">
            <Play />
            Start Import
          </Button>
        </div>
      )}
    </div>
  )
}

// apps/web/src/components/data-import/steps/step-confirm-import.tsx

'use client'

import { isFinishedImportStatus } from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { useImportSSE } from '../hooks/use-import-sse'
import type { PreviewColumnMapping } from '../plan-preview'
import { ImportPlanSummary, PlanPreviewTable, usePlanPreviewData } from '../plan-preview'
import { ImportCompleteCard } from '../plan-preview/import-complete-card'
import { ExecutionProgress } from '../progress/execution-progress'

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

  // Auto-generate plan when entering this step if not already generated.
  //
  // The ref is the guard that actually holds. `generatePlan.isPending` does
  // not: the mutation only ENQUEUES the planning job, so it resolves long
  // before the worker flips the import job off `waiting`, and `job.status`
  // here is a cached query that is not re-fetched until the mutation settles.
  // Every render in that window passed both conditions — a single BOM import
  // fired this four times. `generatePlan` is also a fresh object identity each
  // render, so listing it as a dependency re-ran the effect continuously.
  const planRequestedForJob = useRef<string | null>(null)
  useEffect(() => {
    if (jobLoading || job?.status !== 'waiting') return
    if (planRequestedForJob.current === jobId) return
    planRequestedForJob.current = jobId

    clearRows() // Clear any stale SSE rows
    generatePlan.mutateAsync({ jobId }).then(() => {
      utils.dataImport.getPlan.invalidate({ jobId })
      utils.dataImport.getJob.invalidate({ jobId })
    })
  }, [
    jobLoading,
    job?.status,
    jobId,
    generatePlan.mutateAsync,
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
      // Refresh the record grid — an import is a bulk insert the list query
      // cannot know about. This previously targeted `utils.resource.listFiltered`,
      // a procedure that does not exist on `resourceRouter`, so it silently never
      // refreshed anything; plan v3/02 removed the dead call and this restores the
      // intent against the real one.
      utils.record.listFiltered.invalidate()
    },
    // A run that writes nothing now terminates as `failed` rather than being
    // laundered into `completed`, which makes this arm reachable for the first
    // time — the SSE hook has always emitted it, but with no handler attached
    // `isExecuting` was never cleared and the wizard sat on the progress
    // spinner until the stream timed out. Clearing it lets the outcome card
    // render the failure.
    onError: () => {
      setIsExecuting(false)
      utils.dataImport.getJob.invalidate({ jobId })
      // Relation auto-create runs before the rows do, so even a run that
      // imported nothing may have minted records on a TARGET def.
      utils.record.listFiltered.invalidate()
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

  // Show completion. `completed_with_errors` and `failed` are terminal too —
  // gating this on `'completed'` alone left a run that lost rows stuck on the
  // pre-run plan summary with no outcome shown at all.
  if (job && isFinishedImportStatus(job.status)) {
    // Every counter is read here, for one reason: whatever this cast omits is
    // silently dropped on the way to the card. `failed` used to be missing from
    // this list, which is how an import that rejected all 201 of its rows
    // rendered 0/0/0/0 beneath a green check.
    const stats = job.statistics as
      | {
          created?: number
          updated?: number
          skipped?: number
          unmatched?: number
          failed?: number
          warnings?: number
        }
      | undefined
    return (
      <ImportCompleteCard
        jobId={jobId}
        entityDefinitionId={job.importMapping.entityDefinitionId}
        statistics={{
          created: stats?.created ?? 0,
          updated: stats?.updated ?? 0,
          skipped: stats?.skipped ?? 0,
          unmatched: stats?.unmatched ?? 0,
          failed: stats?.failed ?? 0,
          warnings: stats?.warnings ?? 0,
        }}
        onComplete={onComplete}
      />
    )
  }

  // Show plan summary with preview table
  return (
    <div className='flex flex-col flex-1 min-h-0 min-w-0'>
      {/* Plan Summary - fixed at top */}
      {plan && <ImportPlanSummary plan={plan} jobId={jobId} />}

      {/* Preview Table - scrolls independently with sticky header */}
      <div className='flex-1 min-h-0 min-w-0'>
        <PlanPreviewTable
          rows={previewRows}
          mappings={mappings}
          isPlanning={isPlanning}
          isLoading={isLoadingPreview}
        />
      </div>

      {/* Start Import Footer */}
      {!isPlanning && job?.status === 'ready' && (
        <div className='flex items-center justify-between px-2 py-1 border-t bg-muted'>
          <div className='flex items-center gap-3 min-w-0'>
            <EntityIcon iconId='upload' variant='muted' />
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Ready to Import</p>
              <p className='text-sm text-muted-foreground'>{job?.importMapping.title}</p>
            </div>
          </div>
          <Button onClick={handleConfirmImport} variant='default' size='sm'>
            <Play />
            Start Import
          </Button>
        </div>
      )}
    </div>
  )
}

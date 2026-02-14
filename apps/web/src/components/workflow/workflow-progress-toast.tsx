// apps/web/src/components/workflow/workflow-progress-toast.tsx

'use client'

import { Progress } from '@auxx/ui/components/progress'
import { Check, ChevronDown, ChevronRight, Loader2, Pause, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast as sonnerToast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'

/**
 * Shows a unified workflow progress toast
 * Works for both single runs and batches
 */
export function showWorkflowProgressToast(params: { runId: string } | { batchId: string }) {
  const id = 'runId' in params ? `workflow-run-${params.runId}` : `workflow-batch-${params.batchId}`

  sonnerToast.custom((toastId) => <WorkflowProgressToastContent toastId={toastId} {...params} />, {
    id,
    duration: Infinity,
    position: 'top-right',
  })
}

interface ToastContentProps {
  toastId: string | number
  runId?: string
  batchId?: string
}

/**
 * Toast content component that displays workflow progress
 */
function WorkflowProgressToastContent({ toastId, runId, batchId }: ToastContentProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  // Select raw data - these return stable references when unchanged
  const run = useWorkflowRunStatusStore((s) => (runId ? s.runs.get(runId) : undefined))
  const batchProgress = useWorkflowRunStatusStore(
    useShallow((s) => (batchId ? s.getBatchProgress(batchId) : null))
  )

  // Compute progress object with useMemo - only recalculates when deps change
  const progress = useMemo(() => {
    if (batchProgress) {
      return {
        ...batchProgress,
        currentNodeTitle: undefined as string | undefined,
        error: undefined as string | undefined,
      }
    }
    if (run) {
      return {
        batchId: run.runId,
        workflowName: run.workflowName,
        total: 1,
        running: run.status === 'running' ? 1 : 0,
        completed: run.status === 'completed' ? 1 : 0,
        failed: run.status === 'failed' ? 1 : 0,
        paused: run.status === 'paused' ? 1 : 0,
        currentNodeTitle: run.currentNodeTitle,
        error: run.error,
      }
    }
    return null
  }, [batchProgress, run])

  const dismiss = useCallback(() => {
    sonnerToast.dismiss(toastId)
  }, [toastId])

  // Auto-dismiss after completion
  useEffect(() => {
    if (progress && progress.running === 0 && progress.paused === 0) {
      const delay = progress.total === 1 ? 3000 : 5000
      const timer = setTimeout(dismiss, delay)
      return () => clearTimeout(timer)
    }
  }, [progress, dismiss])

  if (!progress) return null

  const completedCount = progress.completed + progress.failed
  const percentComplete = Math.round((completedCount / progress.total) * 100)
  const isComplete = progress.running === 0 && progress.paused === 0
  const isSingleRun = progress.total === 1

  // Determine icon and color
  const StatusIcon = isComplete
    ? progress.failed === 0
      ? Check
      : X
    : progress.paused > 0
      ? Pause
      : Loader2

  const iconClass = isComplete
    ? progress.failed === 0
      ? 'text-good-500'
      : 'text-red-500'
    : progress.paused > 0
      ? 'text-yellow-500'
      : 'animate-spin text-blue-500'

  // Status text for single runs
  const statusText = isSingleRun
    ? progress.running > 0 && progress.currentNodeTitle
      ? `Running: ${progress.currentNodeTitle}`
      : progress.completed > 0
        ? 'Completed successfully'
        : progress.failed > 0
          ? progress.error || 'Workflow failed'
          : progress.paused > 0
            ? 'Waiting for approval'
            : 'Starting...'
    : null

  return (
    <div className='flex rounded-2xl bg-white dark:bg-primary-400 shadow-lg shadow-black/10 ring-1 ring-black/5 w-full md:max-w-[350px] min-w-[300px] items-start ps-2 p-1.5 gap-2'>
      <div className='mt-[2px]'>
        <StatusIcon className={`size-5 ${iconClass}`} />
      </div>
      <div className='flex flex-1 items-start flex-col gap-2'>
        <div className='w-full flex items-center justify-start gap-2 mt-[2px]'>
          <p className='text-[14px] mb-0 font-medium text-primary-600 dark:text-primary-800 truncate'>
            {progress.workflowName}
          </p>
          {!isSingleRun && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className='size-4.5 bg-black/5 rounded-md flex items-center justify-center shrink-0'>
              {isExpanded ? (
                <ChevronDown className='size-4 text-muted-foreground' />
              ) : (
                <ChevronRight className='size-4 text-muted-foreground' />
              )}
            </button>
          )}
        </div>

        {/* Single run: show status text inline */}
        {isSingleRun && statusText && (
          <p className='text-xs text-muted-foreground truncate'>{statusText}</p>
        )}

        {/* Batch: show progress bar and counts */}
        {!isSingleRun && isExpanded && (
          <div className='w-full space-y-2'>
            <Progress value={percentComplete} className='h-1.5' />
            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <span>
                {completedCount} / {progress.total}
              </span>
              <div className='flex items-center gap-2'>
                {progress.completed > 0 && (
                  <span className='text-good-600'>{progress.completed}</span>
                )}
                {progress.failed > 0 && <span className='text-red-600'>{progress.failed}</span>}
                {progress.paused > 0 && <span className='text-yellow-600'>{progress.paused}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
      <div>
        <button
          onClick={dismiss}
          className='shrink-0 flex items-center justify-center size-6 rounded-full hover:bg-black/5 dark:hover:bg-black/10'>
          <X className='size-4' />
        </button>
      </div>
    </div>
  )
}

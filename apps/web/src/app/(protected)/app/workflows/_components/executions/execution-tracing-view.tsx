// apps/web/src/app/(protected)/app/workflows/_components/executions/execution-tracing-view.tsx

import { WorkflowRunStatus } from '@auxx/database/enums'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { AlertCircle, CheckCircle, Clock, StopCircle } from 'lucide-react'
import { useMemo } from 'react'
import { TraceTreeView } from '~/components/workflow/panels/run/components/trace-tree-view'
import { buildTraceTree } from '~/components/workflow/panels/run/utils/trace-tree'
import { useRunStore } from '~/components/workflow/store/run-store'
import type { FlowNode } from '~/components/workflow/types'

/**
 * Standalone tracing view for displaying historical workflow execution details.
 * Unlike TracingTab, this component:
 * - Does not require ReactFlowProvider or WorkflowStoreProvider
 * - Does not include stop workflow functionality (for viewing completed runs)
 * - Only uses useRunStore for display data
 */
export function ExecutionTracingView() {
  const activeRun = useRunStore((state) => state.activeRun)
  const displayExecutions = useRunStore((state) => state.displayExecutions)
  const runViewMode = useRunStore((state) => state.runViewMode)
  const getLoopIterations = useRunStore((state) => state.getLoopIterations)
  const graphSnapshot = useRunStore((state) => state.graphSnapshot)

  // Use stored graph snapshot for node data
  const nodes = graphSnapshot?.nodes as FlowNode[] | undefined

  // This view only renders completed/historical runs — branch status reflects
  // executed nodes only (pending placeholders mean "never reached").
  const runFinished =
    runViewMode === 'previous' ||
    activeRun?.status === WorkflowRunStatus.SUCCEEDED ||
    activeRun?.status === WorkflowRunStatus.FAILED ||
    activeRun?.status === WorkflowRunStatus.STOPPED

  // Cache the nested trace to avoid rebuilding it on every render
  const traceItems = useMemo(
    () => buildTraceTree(displayExecutions, nodes, runFinished),
    [displayExecutions, nodes, runFinished]
  )

  // Show empty state when no executions but workflow exists
  if (displayExecutions.length === 0 && activeRun) {
    const getEmptyStateMessage = () => {
      switch (activeRun.status) {
        case WorkflowRunStatus.FAILED:
          return 'Workflow failed before executing any nodes'
        case WorkflowRunStatus.STOPPED:
          return 'Workflow was stopped before executing any nodes'
        case WorkflowRunStatus.WAITING:
          return 'Workflow is waiting before executing any nodes'
        default:
          return 'This run completed without executing any nodes'
      }
    }
    return (
      <div className='flex flex-col items-center justify-center py-12'>
        <AlertCircle className='h-12 w-12 text-muted-foreground mb-4' />
        <p className='text-lg font-medium text-muted-foreground'>No node executions recorded</p>
        <p className='text-sm text-muted-foreground mt-1'>{getEmptyStateMessage()}</p>
      </div>
    )
  }

  // Show empty state when no run data
  if (!activeRun) {
    return (
      <div className='flex flex-col items-center justify-center py-12'>
        <AlertCircle className='h-12 w-12 text-muted-foreground mb-4' />
        <p className='text-lg font-medium text-muted-foreground'>No execution data</p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Completed indicator for successful workflow */}
      {activeRun.status === WorkflowRunStatus.SUCCEEDED && (
        <Alert variant='good'>
          <AlertTitle>
            <CheckCircle />
            Workflow completed successfully
          </AlertTitle>
          <AlertDescription>See nodes below for execution details</AlertDescription>
        </Alert>
      )}

      {/* Failed indicator for failed workflow */}
      {activeRun.status === WorkflowRunStatus.FAILED && (
        <Alert variant='destructive' className='bg-red-50/50 dark:bg-red-950/20'>
          <AlertTitle>
            <AlertCircle />
            Workflow execution failed
          </AlertTitle>
          <AlertDescription>
            {activeRun.error ? `Error: ${activeRun.error}` : 'Check failed nodes below for details'}
          </AlertDescription>
        </Alert>
      )}

      {/* Stopped indicator for manually stopped workflow */}
      {activeRun.status === WorkflowRunStatus.STOPPED && (
        <Alert variant='comparison'>
          <AlertTitle>
            <StopCircle />
            Workflow was stopped
          </AlertTitle>
          <AlertDescription>Execution was manually cancelled</AlertDescription>
        </Alert>
      )}

      {/* Waiting indicator for paused workflow */}
      {activeRun.status === WorkflowRunStatus.WAITING && (
        <Alert variant='bad'>
          <AlertTitle>
            <Clock />
            Workflow is waiting
          </AlertTitle>
          <AlertDescription>Waiting for manual confirmation or external input</AlertDescription>
        </Alert>
      )}

      {/* Node execution cards, nested by branch */}
      <TraceTreeView
        items={traceItems}
        workflowStatus={activeRun.status}
        getLoopIterations={getLoopIterations}
      />
    </div>
  )
}

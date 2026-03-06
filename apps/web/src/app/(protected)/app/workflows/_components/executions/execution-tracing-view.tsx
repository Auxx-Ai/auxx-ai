// apps/web/src/app/(protected)/app/workflows/_components/executions/execution-tracing-view.tsx

import { WorkflowRunStatus } from '@auxx/database/enums'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { AlertCircle, CheckCircle, Clock, StopCircle } from 'lucide-react'
import { useMemo } from 'react'
import { BranchGroup } from '~/components/workflow/panels/run/components/branch-group'
import { LoopExecutionCard } from '~/components/workflow/panels/run/components/loop-execution-card'
import { NodeExecutionCard } from '~/components/workflow/panels/run/components/node-execution-card'
import { groupExecutionsByBranch } from '~/components/workflow/panels/run/utils/group-executions'
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
  const getLoopIterations = useRunStore((state) => state.getLoopIterations)
  const graphSnapshot = useRunStore((state) => state.graphSnapshot)

  // Use stored graph snapshot for node data
  const nodes = graphSnapshot?.nodes as FlowNode[] | undefined

  console.log('displayExecutions', displayExecutions)
  // Cache grouped executions to avoid recomputing on every render
  const groupedExecutions = useMemo(
    () => groupExecutionsByBranch(displayExecutions, nodes),
    [displayExecutions, nodes]
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

      {/* Node execution cards with branch grouping */}
      <div className='space-y-0.5'>
        {groupedExecutions.map((group, index) => {
          if (group.type === 'single') {
            // Single execution (not part of a grouped branch)
            const depth = (group.execution.executionMetadata as any)?.depth ?? 0

            // Check if this is a loop node
            if (group.execution.nodeType === 'loop') {
              const iterations = getLoopIterations(group.execution.nodeId)
              return (
                <div key={group.execution.id} style={{ paddingLeft: `${depth * 24}px` }}>
                  <LoopExecutionCard
                    loopNodeExecution={group.execution}
                    iterations={iterations}
                    workflowStatus={activeRun.status}
                  />
                </div>
              )
            }

            // Regular node
            return (
              <div key={group.execution.id} style={{ paddingLeft: `${depth * 24}px` }}>
                <NodeExecutionCard execution={group.execution} workflowStatus={activeRun.status} />
              </div>
            )
          } else {
            // Branch group (multiple executions in same branch)
            // Calculate branch index for parallel branches at same depth using cached groups
            const parallelBranchIndex = groupedExecutions
              .filter((g) => g.type === 'branch' && g.depth === group.depth)
              .findIndex((g) => g === group)

            return (
              <BranchGroup
                key={`branch-${group.branchId}-${index}`}
                branchId={group.branchId}
                depth={group.depth}
                status={group.status}
                branchIndex={parallelBranchIndex}>
                {group.executions.map((execution) => {
                  // Check if this is a loop node inside a branch
                  if (execution.nodeType === 'loop') {
                    const iterations = getLoopIterations(execution.nodeId)
                    return (
                      <LoopExecutionCard
                        key={execution.id}
                        loopNodeExecution={execution}
                        iterations={iterations}
                        workflowStatus={activeRun.status}
                      />
                    )
                  }

                  return (
                    <NodeExecutionCard
                      key={execution.id}
                      execution={execution}
                      workflowStatus={activeRun.status}
                    />
                  )
                })}
              </BranchGroup>
            )
          }
        })}
      </div>
    </div>
  )
}

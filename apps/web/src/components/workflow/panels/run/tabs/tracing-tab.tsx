// apps/web/src/components/workflow/panels/run/tabs/tracing-tab.tsx
import React, { useCallback, useState, useMemo } from 'react'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useWorkflowRun } from '~/hooks/use-workflow-run'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { NodeExecutionCard } from '../components/node-execution-card'
import { LoopExecutionCard } from '../components/loop-execution-card'
import { BranchGroup } from '../components/branch-group'
import { groupExecutionsByBranch } from '../utils/group-executions'
import { Loader2, AlertCircle, CheckCircle, StopCircle, Clock } from 'lucide-react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { Tooltip } from '~/components/global/tooltip'
import { WorkflowRunStatus } from '@auxx/database/enums'
import { useStoreApi } from '@xyflow/react'
import type { FlowNode } from '~/components/workflow/types'
/**
 * Tracing tab showing node-by-node execution details
 */
export function TracingTab() {
  const activeRun = useRunStore((state) => state.activeRun)
  const displayExecutions = useRunStore((state) => state.displayExecutions)
  const isRunning = useRunStore((state) => state.isRunning)
  const getLoopIterations = useRunStore((state) => state.getLoopIterations)
  const graphSnapshot = useRunStore((state) => state.graphSnapshot)
  const workflowAppId = useWorkflowStore((state) => state.workflowAppId)
  const store = useStoreApi()

  // Use stored graph snapshot instead of live React Flow state
  // This ensures loop-child filtering matches the tree that produced the tracing data
  const nodes = (graphSnapshot?.nodes ?? store.getState().nodes) as FlowNode[] | undefined

  // Cache grouped executions to avoid recomputing on every render
  // This is especially important since groupExecutionsByBranch was called twice per render
  // (once in the main map, once for calculating parallelBranchIndex)
  const groupedExecutions = useMemo(
    () => groupExecutionsByBranch(displayExecutions, nodes),
    [displayExecutions, nodes]
  )

  const { stopWorkflow } = useWorkflowRun()
  // Local state for stop button loading
  const [isStopping, setIsStopping] = useState(false)
  /**
   * Handle stopping the workflow run
   */
  const handleStopWorkflow = useCallback(async () => {
    if (!workflowAppId || !activeRun?.id) return
    setIsStopping(true)
    try {
      await stopWorkflow(workflowAppId)
      toastSuccess({
        title: 'Workflow stopped',
        description: 'The workflow has been stopped successfully',
      })
    } catch (error) {
      console.error('[TracingTab] Failed to stop workflow:', error)
      // Handle specific error messages
      if (
        error instanceof Error &&
        error.message?.includes('Cannot stop workflow run with status')
      ) {
        const statusMatch = error.message.match(/Cannot stop workflow run with status: (\w+)/)
        const status = statusMatch?.[1] || 'unknown'
        toastError({
          title: 'Cannot stop workflow',
          description: `Workflow is already ${status.toLowerCase()} and cannot be stopped`,
        })
      } else {
        toastError({
          title: 'Failed to stop workflow',
          description:
            error instanceof Error
              ? error.message
              : 'An error occurred while stopping the workflow',
        })
      }
    } finally {
      setIsStopping(false)
    }
  }, [workflowAppId, activeRun?.id, stopWorkflow])

  // Show loading state when workflow is running and no executions yet
  if (
    (isRunning || activeRun?.status === WorkflowRunStatus.RUNNING) &&
    displayExecutions.length === 0
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-12 w-12 text-muted-foreground mb-4 animate-spin" />
        <p className="text-lg font-medium text-muted-foreground">Workflow is running</p>
        <p className="text-sm text-muted-foreground mt-1">Execution tree will appear shortly</p>
      </div>
    )
  }
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
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium text-muted-foreground">No node executions recorded</p>
        <p className="text-sm text-muted-foreground mt-1">{getEmptyStateMessage()}</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {/* Running indicator banner */}
      {(activeRun?.status === WorkflowRunStatus.RUNNING ||
        activeRun?.status === WorkflowRunStatus.WAITING) && (
        <Alert variant="accent" className="flex-row flex items-between">
          <div className="flex-1">
            <AlertTitle>
              <Loader2 className="animate-spin" />
              Workflow is running
            </AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              Node executions will appear as they complete
            </AlertDescription>
          </div>
          <Tooltip content="Stop workflow run" side="left" sideOffset={0}>
            <Button
              variant="default"
              size="icon-sm"
              onClick={handleStopWorkflow}
              disabled={isStopping || !workflowAppId}
              loading={isStopping}>
              <StopCircle className="animate-pulse" />
            </Button>
          </Tooltip>
        </Alert>
      )}

      {/* Completed indicator for successful workflow */}
      {!isRunning && activeRun?.status === WorkflowRunStatus.SUCCEEDED && (
        <Alert variant="good">
          <AlertTitle>
            <CheckCircle />
            Workflow completed successfully
          </AlertTitle>
          <AlertDescription>See nodes below for execution details</AlertDescription>
        </Alert>
      )}

      {/* Failed indicator for failed workflow */}
      {!isRunning && activeRun?.status === WorkflowRunStatus.FAILED && (
        <Alert variant="destructive" className=" bg-red-50/50 dark:bg-red-950/20">
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
      {!isRunning && activeRun?.status === WorkflowRunStatus.STOPPED && (
        <Alert variant="comparison">
          <AlertTitle>
            <StopCircle />
            Workflow was stopped
          </AlertTitle>
          <AlertDescription>Execution was manually cancelled</AlertDescription>
        </Alert>
      )}

      {/* Waiting indicator for paused workflow */}
      {!isRunning && activeRun?.status === WorkflowRunStatus.WAITING && (
        <Alert variant="bad">
          <AlertTitle>
            <Clock />
            Workflow is waiting
          </AlertTitle>
          <AlertDescription>Waiting for manual confirmation or external input</AlertDescription>
        </Alert>
      )}

      {/* Node execution cards with branch grouping */}
      <div className="space-y-0.5">
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
                    workflowStatus={activeRun?.status}
                  />
                </div>
              )
            }

            // Regular node
            return (
              <div key={group.execution.id} style={{ paddingLeft: `${depth * 24}px` }}>
                <NodeExecutionCard execution={group.execution} workflowStatus={activeRun?.status} />
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
                        workflowStatus={activeRun?.status}
                      />
                    )
                  }

                  return (
                    <NodeExecutionCard
                      key={execution.id}
                      execution={execution}
                      workflowStatus={activeRun?.status}
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

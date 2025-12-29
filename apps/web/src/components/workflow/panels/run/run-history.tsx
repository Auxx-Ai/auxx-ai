// apps/web/src/components/workflow/panels/run/run-history.tsx
import React, { memo, useCallback, useState, useEffect } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, XCircle, Loader2, StopCircle, Activity } from 'lucide-react'
import { PopoverContent } from '@auxx/ui/components/popover'
import InfiniteScroll from '@auxx/ui/components/infinite-scroll'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store'
import { formatRelativeDate } from '~/utils/date'
import { api } from '~/trpc/react'
import { WorkflowRunStatus as WorkflowRunStatusEnum } from '@auxx/database/enums'
import { type WorkflowRunStatus } from '@auxx/database/types'

interface RunHistoryProps {
  className?: string
  onRunSelect?: (runId: string) => void
}

/**
 * Status icon component for workflow runs
 */
const StatusIcon = memo(({ status }: { status: WorkflowRunStatus }) => {
  switch (status) {
    case WorkflowRunStatusEnum.SUCCEEDED:
      return <CheckCircle2 className="size-4 text-green-500" />
    case WorkflowRunStatusEnum.FAILED:
      return <XCircle className="size-4 text-red-500" />
    case WorkflowRunStatusEnum.RUNNING:
      return <Loader2 className="size-4 text-blue-500 animate-spin" />
    case WorkflowRunStatusEnum.STOPPED:
      return <StopCircle className="size-4 text-orange-500" />
    default:
      return <Activity className="size-4 text-muted-foreground" />
  }
})
StatusIcon.displayName = 'StatusIcon'

/**
 * RunHistory component displays a list of workflow run history with lazy loading
 */
export const RunHistory = memo<RunHistoryProps>(({ className, onRunSelect }) => {
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Get workflowAppId from workflow store
  const workflowAppId = useWorkflowStore((state) => state.workflowAppId)

  // Run store state
  const runHistory = useRunStore((state) => state.runHistory)
  const activeRun = useRunStore((state) => state.activeRun)
  const showPrevious = useRunStore((state) => state.showPrevious)
  const addMultipleToHistory = useRunStore((state) => state.addMultipleToHistory)

  // Lazy-load runs with infinite pagination
  const {
    data: runsData,
    isLoading: isLoadingRuns,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = api.workflow.listWorkflowRuns.useInfiniteQuery(
    { workflowAppId: workflowAppId!, limit: 20 },
    {
      enabled: !!workflowAppId,
      staleTime: 30 * 1000, // 30 second cache
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  )

  // Flatten all pages into a single array
  const allRuns = runsData?.pages.flatMap((page) => page.items) ?? []

  // Populate run store when data arrives
  useEffect(() => {
    if (allRuns.length > 0) {
      const workflowRuns = allRuns.map((run) => ({
        ...run,
        _isBasicData: true,
      }))
      addMultipleToHistory(workflowRuns as any)
    }
  }, [allRuns.length, addMultipleToHistory])

  // Query for fetching complete run data with node executions (when clicking a run)
  const { data: completeRun, isLoading: isLoadingCompleteRun } = api.workflow.getWorkflowRun.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId }
  )

  // Update loading state
  useEffect(() => {
    setLoadingRunId(isLoadingCompleteRun && selectedRunId ? selectedRunId : null)
  }, [isLoadingCompleteRun, selectedRunId])

  // Handle successful data fetch
  useEffect(() => {
    if (completeRun && selectedRunId) {
      showPrevious(completeRun as any)
      setSelectedRunId(null)
    }
  }, [completeRun, selectedRunId, showPrevious])

  const handleRunClick = useCallback(
    (runId: string) => {
      setSelectedRunId(runId)
      onRunSelect?.(runId)
    },
    [onRunSelect]
  )

  return (
    <PopoverContent
      className={cn(
        'w-80 p-0 max-h-[400px] overflow-y-auto backdrop-blur-sm bg-white/40 dark:bg-white/5',
        className
      )}
      align="end">
      <div className="border-b border-black/8 px-3 py-1 sticky top-0 backdrop-blur-sm dark:bg-black/40 bg-white/40 z-10">
        <h3 className="font-medium text-sm">Run History</h3>
        <p className="text-xs text-muted-foreground">
          {isLoadingRuns
            ? 'Loading...'
            : runHistory.length === 0
              ? 'No runs yet'
              : `${runHistory.length} run${runHistory.length > 1 ? 's' : ''}`}
        </p>
      </div>

      {isLoadingRuns ? (
        <div className="p-8 text-center">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading runs...</p>
        </div>
      ) : runHistory.length > 0 ? (
        <div className="px-2 py-2">
          <InfiniteScroll
            isLoading={isFetching}
            hasMore={hasNextPage ?? false}
            next={() => fetchNextPage()}>
            {runHistory.map((run) => {
              const isActive = activeRun?.id === run.id
              return (
                <div
                  key={run.id}
                  className={cn(
                    'mb-2 rounded-lg border-[0.5px] border-border bg-secondary/30 shadow-xs last-of-type:mb-0',
                    'cursor-pointer hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500 transition-all',
                    isActive && 'ring-1 ring-blue-500 bg-secondary/50'
                  )}
                  onClick={() => handleRunClick(run.id)}>
                  <div className="px-3 py-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {run.triggeredFrom === 'DEBUGGING' ? 'Test' : 'Production'} Run #
                          {run.sequenceNumber}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatRelativeDate(run.createdAt)}
                          {(run.totalSteps || run.elapsedTime) && (
                            <span className="ml-1">
                              •
                              {run.totalSteps && <span className="ml-1">{run.totalSteps} steps</span>}
                              {run.totalSteps && run.elapsedTime && <span className="mx-1">•</span>}
                              {run.elapsedTime && <span>{(run.elapsedTime / 1000).toFixed(1)}s</span>}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {loadingRunId === run.id ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <StatusIcon status={run.status} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </InfiniteScroll>
          {isFetching && hasNextPage && (
            <div className="py-2 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No runs recorded yet
        </div>
      )}
    </PopoverContent>
  )
})
RunHistory.displayName = 'RunHistory'

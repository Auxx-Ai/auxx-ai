// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-runs-provider.tsx
'use client'
import { createContext, useContext, useState, type ReactNode, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { addDays, startOfDay, endOfDay } from 'date-fns'
import type { WorkflowRunsFilter } from './types'
import type { WorkflowRunEntity as WorkflowRun } from '@auxx/database/models'
/**
 * Context type for workflow runs provider
 */
interface WorkflowRunsContextType {
  // Data
  items: WorkflowRun[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  // Filters
  filter: WorkflowRunsFilter
  setFilter: (
    filter: WorkflowRunsFilter | ((prev: WorkflowRunsFilter) => WorkflowRunsFilter)
  ) => void
  // Actions
  fetchNextPage: () => void
  refetch: () => void
  // Mutations
  handleStopRun: (run: WorkflowRun) => void
  handleDeleteRun: (run: WorkflowRun) => void
  handleBulkStopRuns: (runIds: string[]) => void
  handleBulkDeleteRuns: (runIds: string[]) => void
  handleExport: () => void
  // Navigation
  handleViewDetails: (run: WorkflowRun) => void
}
const WorkflowRunsContext = createContext<WorkflowRunsContextType | undefined>(undefined)
interface WorkflowRunsProviderProps {
  children: ReactNode
  workflowId: string
}
/**
 * Provider component for workflow runs data and actions
 */
export function WorkflowRunsProvider({ children, workflowId }: WorkflowRunsProviderProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  // Filter State
  const [filter, setFilter] = useState<WorkflowRunsFilter>({
    status: 'all',
    startDate: startOfDay(addDays(new Date(), -7)), // Default to last 7 days
    endDate: endOfDay(new Date()),
  })
  // Memoize query parameters with proper date serialization
  const queryInput = useMemo(() => {
    const params: {
      workflowAppId: string
      limit: number
      status?: typeof filter.status
      startDate?: Date
      endDate?: Date
    } = { workflowAppId: workflowId, limit: 50 }
    if (filter.status !== 'all') {
      params.status = filter.status
    }
    if (filter.startDate) {
      params.startDate = startOfDay(filter.startDate)
    }
    if (filter.endDate) {
      params.endDate = endOfDay(filter.endDate)
    }
    return params
  }, [workflowId, filter.status, filter.startDate?.toISOString(), filter.endDate?.toISOString()])
  // Fetch workflow runs with infinite query
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    api.workflow.listWorkflowRuns.useInfiniteQuery(queryInput, {
      getNextPageParam: (lastPage) => {
        console.log('getNextPageParam called with:', lastPage.nextCursor)
        return lastPage.nextCursor
      },
      refetchOnWindowFocus: false,
      enabled: !!workflowId,
    })
  // Flatten paginated data
  const items: WorkflowRun[] = data?.pages.flatMap((page) => page.items) ?? []
  // Stop workflow run mutation
  const stopWorkflowRun = api.workflow.stopWorkflowRun.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Workflow run stopped successfully' })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Failed to stop workflow run', description: error.message })
    },
  })
  // TODO: Add delete workflow run mutation when endpoint is available
  // Action handlers
  const handleStopRun = useCallback(
    async (run: WorkflowRun) => {
      if (run.status !== 'RUNNING') {
        toastError({ title: 'Only running workflows can be stopped' })
        return
      }
      const confirmed = await confirm({
        title: 'Stop Workflow Run?',
        description: `This will stop the currently running workflow execution "${run.id.slice(-8)}".`,
        confirmText: 'Stop',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      try {
        await stopWorkflowRun.mutateAsync({ runId: run.id })
      } catch (error) {
        // Error handling is done in the mutation onError
      }
    },
    [confirm, stopWorkflowRun]
  )
  const handleBulkStopRuns = useCallback(
    async (runIds: string[]) => {
      const runningRuns = items.filter(
        (item) => runIds.includes(item.id) && item.status === 'RUNNING'
      )
      if (runningRuns.length === 0) {
        toastError({ title: 'No running workflows selected' })
        return
      }
      const confirmed = await confirm({
        title: `Stop ${runningRuns.length} Workflow Runs?`,
        description: 'This will stop all selected running workflow executions.',
        confirmText: 'Stop All',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      // Process stops sequentially to avoid overwhelming the system
      for (const run of runningRuns) {
        try {
          await stopWorkflowRun.mutateAsync({ runId: run.id })
        } catch (error) {
          console.error('Failed to stop run:', run.id, error)
        }
      }
    },
    [confirm, items, stopWorkflowRun]
  )
  const handleDeleteRun = useCallback(
    async (run: WorkflowRun) => {
      if (run.status === 'RUNNING') {
        toastError({ title: 'Cannot delete a running workflow' })
        return
      }
      const confirmed = await confirm({
        title: 'Delete Workflow Run?',
        description: `This will permanently delete the workflow run "${run.id.slice(-8)}". This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      // TODO: Implement when delete endpoint is available
      console.log('Delete run:', run.id)
    },
    [confirm]
  )

  const handleBulkDeleteRuns = useCallback(async (runIds: string[]) => {
    // TODO: Implement when delete endpoint is available
    console.log('Selected runs for deletion:', runIds)
  }, [])
  const handleExport = useCallback(() => {
    // Convert items to CSV
    const headers = [
      'Run ID',
      'Status',
      'Triggered From',
      'Version',
      'Duration (ms)',
      'Total Tokens',
      'Total Steps',
      'Created At',
      'Finished At',
      'Error',
    ]
    const rows = items.map((item) => [
      item.id,
      item.status,
      item.triggeredFrom,
      item.version,
      item.elapsedTime ?? '',
      item.totalTokens,
      item.totalSteps,
      item.createdAt.toISOString(),
      item.finishedAt?.toISOString() ?? '',
      item.error ?? '',
    ])
    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-runs-${workflowId}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess({ title: 'Workflow runs exported' })
  }, [items, workflowId])
  // Navigation handlers
  const handleViewDetails = useCallback(
    (run: WorkflowRun) => {
      // router.push(`/app/workflows/${workflowId}/runs/${run.id}`)
    },
    [router, workflowId]
  )
  const contextValue: WorkflowRunsContextType = {
    // Data
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    // Filters
    filter,
    setFilter,
    // Actions
    fetchNextPage: () => fetchNextPage(),
    refetch,
    // Mutations
    handleStopRun,
    handleDeleteRun,
    handleBulkStopRuns,
    handleBulkDeleteRuns,
    handleExport,
    // Navigation
    handleViewDetails,
  }
  return (
    <WorkflowRunsContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog />
    </WorkflowRunsContext.Provider>
  )
}
/**
 * Hook to use workflow runs context
 */
export function useWorkflowRuns() {
  const context = useContext(WorkflowRunsContext)
  if (context === undefined) {
    throw new Error('useWorkflowRuns must be used within a WorkflowRunsProvider')
  }
  return context
}

// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-executions.tsx
'use client'
import { useMemo, useState, useCallback } from 'react'
import { StopCircle, Play, Trash2 } from 'lucide-react'
import { DynamicTable } from '~/components/dynamic-table'
import { WorkflowRunsProvider, useWorkflowRuns } from './workflow-runs-provider'
import { WorkflowRunsFilterBar } from './workflow-runs-filter-bar'
import { createWorkflowRunsColumns } from './workflow-runs-columns'
import { EmptyState } from '~/components/global/empty-state'
import { WorkflowExecutionDetailDrawer } from './workflow-execution-detail-drawer'
import type { WorkflowExecutionsProps } from './types'
import type { WorkflowRunEntity as WorkflowRun } from '@auxx/database/models'
/**
 * Content component that uses the workflow runs context
 */
function WorkflowExecutionsContent({ workflowId }: { workflowId: string }) {
  const {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    filter,
    setFilter,
    handleStopRun,
    handleDeleteRun,
    handleBulkStopRuns,
    handleBulkDeleteRuns,
    handleExport,
  } = useWorkflowRuns()

  // Local state for selected run (for drawer)
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null)
  // Column definitions with actions
  const columns = useMemo(
    () =>
      createWorkflowRunsColumns({
        onStopRun: handleStopRun,
        onViewDetails: setSelectedRun,
        onDeleteRun: handleDeleteRun,
      }),
    [handleStopRun, handleDeleteRun]
  )
  // Bulk actions
  const bulkActions = useMemo(
    () => [
      {
        label: 'Stop Selected',
        icon: StopCircle,
        variant: 'destructive' as const,
        action: (selectedRuns: WorkflowRun[]) => {
          const runIds = selectedRuns.map((run) => run.id)
          handleBulkStopRuns(runIds)
        },
        disabled: (selectedRuns: WorkflowRun[]) => {
          return selectedRuns.every((run) => run.status !== 'RUNNING')
        },
      },
      {
        label: 'Delete Selected',
        icon: Trash2,
        variant: 'destructive' as const,
        action: (selectedRuns: WorkflowRun[]) => {
          const runIds = selectedRuns.map((run) => run.id)
          handleBulkDeleteRuns(runIds)
        },
        disabled: (selectedRuns: WorkflowRun[]) => {
          return selectedRuns.some((run) => run.status === 'RUNNING')
        },
      },
    ],
    [handleBulkStopRuns, handleBulkDeleteRuns]
  )
  // Load more on scroll
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  return (
    <>
      <DynamicTable<WorkflowRun>
        tableId="workflow-runs"
        className="h-full"
        columns={columns}
        data={items}
        isLoading={isLoading}
        bulkActions={bulkActions}
        onRowSelectionChange={() => {}}
        onScrollToBottom={handleLoadMore}
        onExport={handleExport}
        customFilter={<WorkflowRunsFilterBar filter={filter} setFilter={setFilter} />}
        emptyState={
          <EmptyState
            icon={Play}
            title="No workflow executions"
            description="Workflow runs will appear here when your workflows are executed."
          />
        }
      />

      {/* Execution Detail Drawer */}
      {selectedRun && (
        <WorkflowExecutionDetailDrawer
          run={selectedRun}
          workflowId={workflowId}
          open={!!selectedRun}
          onOpenChange={(open) => !open && setSelectedRun(null)}
        />
      )}
    </>
  )
}
/**
 * Main workflow executions component with provider
 */
export function WorkflowExecutions({ workflowId }: WorkflowExecutionsProps) {
  return (
    <WorkflowRunsProvider workflowId={workflowId}>
      <WorkflowExecutionsContent workflowId={workflowId} />
    </WorkflowRunsProvider>
  )
}

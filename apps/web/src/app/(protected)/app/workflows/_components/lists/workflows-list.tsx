// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-list.tsx
'use client'

import { useWorkflows } from '../providers/workflows-provider'
import { WorkflowsGridView } from './workflows-grid-view'
import { WorkflowsTableView } from './workflows-table-view'
import { WorkflowsEmptyState } from './workflows-empty-state'
import { Skeleton } from '@auxx/ui/components/skeleton'

export function WorkflowsList() {
  const { workflows, isLoading, viewMode, searchQuery, selectedTriggerType } = useWorkflows()

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="border rounded-xl p-3 pb-4">
            {/* Header: Icon and dropdown */}
            <div className="flex items-start justify-between mb-1">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-7 w-7 rounded" />
            </div>
            {/* Title and badge */}
            <div className="flex justify-between items-center mb-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            {/* Stats */}
            <Skeleton className="h-3 w-24 mb-2" />
            {/* Last updated */}
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <WorkflowsEmptyState searchQuery={searchQuery} selectedTriggerType={selectedTriggerType} />
    )
  }

  return viewMode === 'grid' ? <WorkflowsGridView /> : <WorkflowsTableView />
}

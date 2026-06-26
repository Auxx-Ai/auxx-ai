// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-list.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { useWorkflows } from '../providers/workflows-provider'
import { WorkflowsEmptyState } from './workflows-empty-state'
import { WorkflowsGridView } from './workflows-grid-view'
import { WorkflowsTableView } from './workflows-table-view'

export function WorkflowsList() {
  const { workflows, isLoading, viewMode, searchQuery, selectedTriggerType } = useWorkflows()

  if (isLoading) {
    return (
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {[...Array(6)].map((_, i) => (
          <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
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

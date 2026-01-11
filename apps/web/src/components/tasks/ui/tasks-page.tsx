// apps/web/src/components/tasks/ui/tasks-page.tsx

'use client'

import { useState } from 'react'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { TasksList } from './tasks-list'
import { TaskFilterBar } from './task-filter-bar'
import { TasksStatsCards } from './tasks-stats-cards'
import { CreateTaskButton } from './create-task-button'
import type { TaskSortConfig } from '@auxx/lib/tasks/client'
import type { Condition } from '~/components/conditions'

/**
 * TasksPage renders a full-page global task management view.
 * Follows the same layout pattern as DatasetsPage.
 */
export function TasksPage() {
  const [filters, setFilters] = useState<Condition[]>([])
  const [sort, setSort] = useState<TaskSortConfig>({
    field: 'deadline',
    direction: 'asc',
  })

  // TODO: Fetch stats from API (deferred)
  const stats = null

  return (
    <MainPage>
      <MainPageHeader action={<CreateTaskButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Tasks" href="/app/tasks" />
          <MainPageBreadcrumbItem title="Overview" last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        {/* Stats Cards */}
        <TasksStatsCards stats={stats} />

        {/* Filter Bar */}
        <TaskFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
        />

        {/* Task List */}
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-muted @container">
          <TasksList
            viewMode="global"
            filters={filters}
            sort={sort}
            showEntityReferences
            className="p-3"
          />
        </div>
      </MainPageContent>
    </MainPage>
  )
}

// apps/web/src/components/tasks/ui/tasks-page.tsx

'use client'

import type { TaskSortConfig } from '@auxx/lib/tasks/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { useState } from 'react'
import type { Condition } from '~/components/conditions'
import { CreateTaskButton } from './create-task-button'
import { TaskFilterBar } from './task-filter-bar'
import { TasksList } from './tasks-list'
import { TasksStatsCards } from './tasks-stats-cards'

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
  const [includeCompleted, setIncludeCompleted] = useState(true)

  // TODO: Fetch stats from API (deferred)
  const stats = null

  return (
    <MainPage>
      <MainPageHeader action={<CreateTaskButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Tasks' href='/app/tasks' />
          <MainPageBreadcrumbItem title='Overview' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        {/* Stats Cards */}
        <TasksStatsCards stats={stats} />

        {/* Filter Bar + Task List */}
        <ScrollArea className='flex-1 min-h-0 bg-muted dark:bg-[#1e2227] @container'>
          <div className='sticky top-0 z-10 backdrop-blur-sm'>
            <TaskFilterBar
              filters={filters}
              onFiltersChange={setFilters}
              sort={sort}
              onSortChange={setSort}
              includeCompleted={includeCompleted}
              onIncludeCompletedChange={setIncludeCompleted}
            />
          </div>
          <TasksList
            viewMode='global'
            filters={filters}
            sort={sort}
            includeCompleted={includeCompleted}
            showEntityReferences
            className='p-3'
          />
        </ScrollArea>
      </MainPageContent>
    </MainPage>
  )
}

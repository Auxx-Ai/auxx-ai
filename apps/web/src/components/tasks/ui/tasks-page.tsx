// apps/web/src/components/tasks/ui/tasks-page.tsx

'use client'

import type { TaskSortConfig } from '@auxx/lib/tasks/client'
import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useState } from 'react'
import type { Condition } from '~/components/conditions'
import { api } from '~/trpc/react'
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
  // "Follow-ups" chip — build plan decision 16: rule/AI-created tasks only. Kopilot
  // chat-created tasks are user-initiated (closer to manual) and stay out of the chip.
  const [followUpsOnly, setFollowUpsOnly] = useState(false)

  // Org-wide task counts for the overview header (independent of the filter bar)
  const { data: stats } = api.task.stats.useQuery()

  return (
    <MainPage>
      <MainPageHeader action={<CreateTaskButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Tasks' href='/app/tasks' />
          <MainPageBreadcrumbItem title='Overview' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        {/* Stats Cards */}
        <TasksStatsCards stats={stats ?? null} />

        {/* Filter Bar + Task List */}
        <ListPageScroll
          toolbar={
            <TaskFilterBar
              filters={filters}
              onFiltersChange={setFilters}
              sort={sort}
              onSortChange={setSort}
              includeCompleted={includeCompleted}
              onIncludeCompletedChange={setIncludeCompleted}
              followUpsOnly={followUpsOnly}
              onFollowUpsOnlyChange={setFollowUpsOnly}
            />
          }>
          <TasksList
            viewMode='global'
            filters={filters}
            sort={sort}
            includeCompleted={includeCompleted}
            sources={followUpsOnly ? ['rule', 'ai'] : undefined}
            showEntityReferences
          />
        </ListPageScroll>
      </MainPageContent>
    </MainPage>
  )
}

// apps/web/src/components/tasks/hooks/use-tasks.ts

'use client'

import { useMemo, useCallback, useEffect } from 'react'
import { api } from '~/trpc/react'
import { useTaskStore } from '../stores/task-store'
import type { TaskWithRelations, TaskPriority } from '@auxx/lib/tasks'
import type { TaskSortConfig } from '@auxx/lib/tasks/client'
import type { RecordId } from '@auxx/lib/resources/client'

/**
 * Options for useTasks hook
 */
interface UseTasksOptions {
  /** Filter to tasks linked to this resource (omit for global view) */
  recordId?: RecordId
  /** Filter by assignee IDs */
  assigneeIds?: string[]
  /** Filter by priority levels */
  priority?: TaskPriority[]
  /** Search query */
  search?: string
  /** Sort configuration */
  sort?: TaskSortConfig
  /** Include completed tasks */
  includeCompleted?: boolean
  /** Include archived tasks */
  includeArchived?: boolean
  /** Items per page */
  limit?: number
  /** Disable fetching */
  enabled?: boolean
}

/**
 * Result from useTasks hook
 */
interface UseTasksResult {
  /** List of tasks with relations */
  tasks: TaskWithRelations[]
  /** Loading initial data */
  isLoading: boolean
  /** Loading more pages */
  isFetchingNextPage: boolean
  /** More pages available */
  hasNextPage: boolean
  /** Load next page */
  fetchNextPage: () => void
  /** Force refresh */
  refresh: () => void
  /** Total count */
  total: number
}

/** Default sort config */
const DEFAULT_SORT: TaskSortConfig = { field: 'deadline', direction: 'asc' }

/**
 * Hook to fetch and cache a list of tasks.
 * Supports filtering by resource, custom conditions, and sorting.
 * Omit recordId for global task view.
 */
export function useTasks({
  recordId,
  assigneeIds,
  priority,
  search,
  sort = DEFAULT_SORT,
  includeCompleted = false,
  includeArchived = false,
  limit = 50,
  enabled = true,
}: UseTasksOptions = {}): UseTasksResult {
  // Get store actions
  const setTasks = useTaskStore((s) => s.setTasks)

  // Build query input
  const queryInput = useMemo(
    () => ({
      recordId,
      assigneeIds,
      priority,
      search,
      includeCompleted,
      includeArchived,
      limit,
    }),
    [recordId, assigneeIds, priority, search, includeCompleted, includeArchived, limit]
  )

  // Fetch tasks using query (not infinite for now - keeping it simple)
  const { data, isLoading, isFetching, refetch } = api.task.list.useQuery(queryInput, {
    enabled,
    staleTime: 30_000,
  })

  // Sync to store when data changes
  useEffect(() => {
    if (data?.tasks) {
      setTasks(data.tasks)
    }
  }, [data, setTasks])

  // Return query data directly - pending state is only for checkbox visual feedback
  // Grouping uses original data; after delay, query cache is updated to move task
  const tasks = data?.tasks ?? []

  // Fetch next page handler (placeholder for infinite query)
  const fetchNextPage = useCallback(() => {
    // TODO: Implement pagination with infinite query
  }, [])

  // Refresh handler
  const refresh = useCallback(() => {
    refetch()
  }, [refetch])

  // Get total from response
  const total = data?.total ?? 0

  return {
    tasks,
    isLoading,
    isFetchingNextPage: isFetching && !isLoading,
    hasNextPage: data?.hasMore ?? false,
    fetchNextPage,
    refresh,
    total,
  }
}

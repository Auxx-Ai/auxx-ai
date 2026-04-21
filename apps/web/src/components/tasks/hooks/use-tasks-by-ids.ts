// apps/web/src/components/tasks/hooks/use-tasks-by-ids.ts

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import { useEffect, useMemo } from 'react'
import { useTaskStore } from '../stores/task-store'

interface UseTasksByIdsOptions {
  /** Task ids to hydrate (batched by the provider) */
  taskIds: string[]
  /** Disable fetching */
  enabled?: boolean
}

interface UseTasksByIdsResult {
  /** Tasks in same order as input ids (undefined if pending / not-found) */
  tasks: (TaskWithRelations | undefined)[]
  /** Quick lookup by task id */
  tasksByKey: Map<string, TaskWithRelations>
  /** True while any ids are still loading */
  isLoading: boolean
  /** Every requested task is either cached or known not-found */
  isComplete: boolean
  /** Ids the server reported as missing */
  notFoundIds: string[]
}

const EMPTY_TASKS: undefined[] = []
const EMPTY_MAP = new Map<string, TaskWithRelations>()
const EMPTY_NOT_FOUND: string[] = []

/**
 * Batch-coalesced by-id hydration for a list of task ids. Shape mirrors
 * `useRecords` so kopilot reference blocks can share the same snapshot-first
 * render ladder.
 */
export function useTasksByIds({
  taskIds,
  enabled = true,
}: UseTasksByIdsOptions): UseTasksByIdsResult {
  const taskIdsKey = useMemo(() => taskIds.join(','), [taskIds])
  const requestTask = useTaskStore((s) => s.requestTask)

  // biome-ignore lint/correctness/useExhaustiveDependencies: taskIds derived from taskIdsKey
  useEffect(() => {
    if (!enabled || taskIds.length === 0) return
    for (const id of taskIds) requestTask(id)
  }, [enabled, taskIdsKey, requestTask])

  const tasksMap = useTaskStore((s) => s.tasks)
  const loadingIds = useTaskStore((s) => s.loadingIds)
  const pendingIds = useTaskStore((s) => s.pendingFetchIds)
  const notFoundIdsSet = useTaskStore((s) => s.notFoundIds)

  const tasks = useMemo(() => {
    if (taskIds.length === 0) return EMPTY_TASKS as (TaskWithRelations | undefined)[]
    return taskIds.map((id) => tasksMap.get(id))
  }, [taskIds, tasksMap])

  const tasksByKey = useMemo(() => {
    if (taskIds.length === 0) return EMPTY_MAP
    const map = new Map<string, TaskWithRelations>()
    taskIds.forEach((id, idx) => {
      const t = tasks[idx]
      if (t) map.set(id, t)
    })
    return map
  }, [taskIds, tasks])

  const isLoading = useMemo(() => {
    if (taskIds.length === 0) return false
    return taskIds.some((id) => loadingIds.has(id) || pendingIds.has(id))
  }, [taskIds, loadingIds, pendingIds])

  const isComplete = useMemo(() => {
    if (taskIds.length === 0) return true
    return taskIds.every((id) => tasksMap.has(id) || notFoundIdsSet.has(id))
  }, [taskIds, tasksMap, notFoundIdsSet])

  const notFoundIds = useMemo(() => {
    if (taskIds.length === 0) return EMPTY_NOT_FOUND
    return taskIds.filter((id) => notFoundIdsSet.has(id))
  }, [taskIds, notFoundIdsSet])

  return { tasks, tasksByKey, isLoading, isComplete, notFoundIds }
}

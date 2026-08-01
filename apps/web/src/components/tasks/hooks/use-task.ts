// apps/web/src/components/tasks/hooks/use-task.ts

import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { TRPCClientErrorLike } from '@trpc/client'
import type { AppRouter } from '~/server/api/root'
import { api } from '~/trpc/react'
import { useTaskStore } from '../stores/task-store'

/**
 * Options for useTask hook
 */
interface UseTaskOptions {
  taskId: string
  enabled?: boolean
}

/**
 * Result from useTask hook
 */
interface UseTaskResult {
  task: TaskWithRelations | null
  isLoading: boolean
  /** tRPC's error shape — structurally distinct from `Error`, though the runtime value is one. */
  error: TRPCClientErrorLike<AppRouter> | null
}

/**
 * Hook to fetch a single task by ID.
 * First checks cache, then fetches from API if needed.
 */
export function useTask({ taskId, enabled = true }: UseTaskOptions): UseTaskResult {
  // Check cache first
  const cachedTask = useTaskStore((s) => s.tasks.get(taskId))

  // Fetch from API if not cached
  const { data, isLoading, error } = api.task.byId.useQuery(
    { id: taskId },
    {
      enabled: enabled && !cachedTask,
      staleTime: 30_000,
    }
  )

  return {
    task: cachedTask ?? data ?? null,
    isLoading: !cachedTask && isLoading,
    error: error ?? null,
  }
}
